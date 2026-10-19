import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { Platform } from "react-native";

import { logEvent } from "./analytics";
import { currentLang } from "./i18n";
import { getDeviceId } from "./identity/deviceId";
import {
  FEEDBACK_UUID,
  buildFeedbackBody,
  buildFeedbackRequest,
  classifyFeedbackStatus,
  feedbackEventProps,
  type FeedbackDraft,
  type FeedbackResult,
  type KeyValueStore,
} from "./feedbackSurvey";

/** The `feedback` edge function (expo `extra.feedbackFnUrl`), same arrangement as trackFnUrl. */
const FEEDBACK_FN_URL: string | undefined = (
  Constants.expoConfig?.extra as Record<string, unknown> | undefined
)?.feedbackFnUrl as string | undefined;

const POST_TIMEOUT_MS = 15_000;

/** AsyncStorage as the survey flags' store. */
export const feedbackKv: KeyValueStore = {
  get: (key) => AsyncStorage.getItem(key),
  set: (key, value) => AsyncStorage.setItem(key, value),
};

/**
 * Sends one message. Never throws and never logs the text or the e-mail; the
 * only analytics is feedback_sent with kind and reason code, after the server
 * has accepted it. The caller keeps the typed text on any failure.
 */
export async function submitFeedback(
  draft: FeedbackDraft,
  timeoutMs: number = POST_TIMEOUT_MS
): Promise<FeedbackResult> {
  if (!FEEDBACK_FN_URL) return { ok: false, reason: "not_configured" };
  const id = (await getDeviceId()).trim().toLowerCase();
  if (!FEEDBACK_UUID.test(id)) return { ok: false, reason: "no_device_id" };
  const body = buildFeedbackBody(draft, {
    appVersion: Constants.nativeAppVersion ?? Constants.expoConfig?.version ?? "",
    platform: Platform.OS,
    locale: currentLang(),
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(FEEDBACK_FN_URL, {
      ...buildFeedbackRequest(id, body),
      signal: controller.signal,
    });
    const result = classifyFeedbackStatus(res.status);
    if (result.ok) {
      const props = feedbackEventProps(draft);
      logEvent("feedback_sent", { kind: props.kind, reason_code: props.reason_code });
    }
    return result;
  } catch {
    return { ok: false, reason: "unavailable" };
  } finally {
    clearTimeout(timer);
  }
}
