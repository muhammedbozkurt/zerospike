import Constants from "expo-constants";
import * as Device from "expo-device";
import { Platform } from "react-native";

import { getAppVersion, getBuildNumber } from "../appVersion";
import { currentLang } from "../i18n";
import { getDeviceId, isInstallId } from "../identity/deviceId";
import {
  buildDeleteRequest,
  classifyDeleteStatus,
  isSendableAppUserId,
  type DeleteResult,
} from "./deleteDevice";
import type { PropValue } from "./eventSchema";
import { classifyResponse, type QueuedEvent, type SendResult } from "./flush";

/**
 * Wire format of POST {trackFnUrl} (the `track` edge function). The function URL
 * is a HUMAN deploy step read from app config (expo `extra.trackFnUrl`); when it
 * is unset the Supabase sink never starts. Same arrangement as lib/ai/spikeClient.
 */
const TRACK_FN_URL: string | undefined = (
  Constants.expoConfig?.extra as Record<string, unknown> | undefined
)?.trackFnUrl as string | undefined;

export const isTrackConfigured =
  typeof TRACK_FN_URL === "string" && TRACK_FN_URL.length > 0;

/** The `delete-device` edge function behind Settings > Data > "Delete my server records". Same arrangement as trackFnUrl. */
const DELETE_FN_URL: string | undefined = (
  Constants.expoConfig?.extra as Record<string, unknown> | undefined
)?.deleteDeviceFnUrl as string | undefined;

export const POST_TIMEOUT_MS = 15_000;
/** The RevenueCat SDK answers from memory; this only keeps a stalled bridge from holding the deletion up. */
const APP_USER_ID_TIMEOUT_MS = 3_000;

export interface TrackEnvelope {
  /** The same uuid on every retry of one batch; the server stores a batch id once. */
  batch_id: string;
  app_version: string;
  build: string;
  platform: string;
  os_version: string;
  locale: string;
  session_id: string;
  is_pro: boolean;
  /** Minutes the device clock is ahead of UTC (Istanbul is +180). */
  tz_offset: number;
  events: { name: string; props: Record<string, PropValue>; ts: string }[];
}

/** The batch must be non-empty and share one session and Pro state (see nextBatch in ./flush). */
export function buildEnvelope(batch: readonly QueuedEvent[], batchId: string): TrackEnvelope {
  const first = batch[0];
  return {
    batch_id: batchId,
    app_version: getAppVersion(),
    build: getBuildNumber(),
    platform: Platform.OS,
    os_version: Device.osVersion ?? String(Platform.Version),
    locale: currentLang(),
    session_id: first.sessionId,
    is_pro: first.isPro,
    tz_offset: -new Date().getTimezoneOffset(),
    events: batch.map(({ name, props, ts }) => ({ name, props, ts })),
  };
}

let cachedDeviceId: string | null = null;

async function deviceId(): Promise<string | null> {
  if (cachedDeviceId) return cachedDeviceId;
  const id = await getDeviceId();
  // A non-uuid is getDeviceId's storage-failure fallback; the server answers it
  // 400 and pooling such devices under one id would poison the data, so send
  // nothing this session (the batch stays queued) and wait for a real id.
  if (!isInstallId(id)) return null;
  cachedDeviceId = id;
  return id;
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function postBatch(
  batch: readonly QueuedEvent[],
  batchId: string,
  timeoutMs: number = POST_TIMEOUT_MS
): Promise<SendResult> {
  if (!TRACK_FN_URL) return { status: "retry" };
  const id = await deviceId();
  if (!id) return { status: "retry" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(TRACK_FN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-device-id": id },
      body: JSON.stringify(buildEnvelope(batch, batchId)),
      signal: controller.signal,
    });
    const body = await readJson(res);
    const result = classifyResponse(res.status, res.headers.get("retry-after"), body, Date.now());
    if (__DEV__ && result.status === "drop") {
      console.warn(`[analytics] track rejected a batch (${res.status}), dropping it`, body);
    }
    return result;
  } catch {
    return { status: "retry" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The RevenueCat customer this install is, when the SDK is up: the function
 * deletes the subscription events recorded under it too, including the ones
 * RevenueCat reported before the installation ID was attached to the customer.
 * The module is lazy-required like in lib/services/purchases.ts; null when the
 * SDK is missing, not configured yet or slow, in which case the function deletes
 * by installation ID alone.
 */
async function revenueCatAppUserId(): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const purchases = require("react-native-purchases").default;
    const read = (async (): Promise<unknown> =>
      (await purchases.isConfigured()) ? await purchases.getAppUserID() : null)();
    const stalled = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), APP_USER_ID_TIMEOUT_MS);
    });
    const id = await Promise.race([read, stalled]);
    return isSendableAppUserId(id) ? id : null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Asks the server to delete every record it holds under this installation ID
 * (and RevenueCat app user id). Never throws; the reason of a failure is for the
 * dev console, the screen only needs to know it did not work.
 */
export async function postDeleteDevice(
  timeoutMs: number = POST_TIMEOUT_MS
): Promise<DeleteResult> {
  if (!DELETE_FN_URL) return { ok: false, reason: "not_configured" };
  const id = await deviceId();
  if (!id) return { ok: false, reason: "no_device_id" };
  const appUserId = await revenueCatAppUserId();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(DELETE_FN_URL, {
      ...buildDeleteRequest(id, appUserId),
      signal: controller.signal,
    });
    await readJson(res);
    const result = classifyDeleteStatus(res.status);
    if (__DEV__ && !result.ok) {
      console.warn(`[analytics] delete-device answered ${res.status} (${result.reason})`);
    }
    return result;
  } catch {
    return { ok: false, reason: "unavailable" };
  } finally {
    clearTimeout(timer);
  }
}
