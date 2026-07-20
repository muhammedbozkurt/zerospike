import AsyncStorage from "@react-native-async-storage/async-storage";

import { listSugarLogs } from "../db/logs";
import { getNotificationPrefs } from "./notificationPrefs";
import { getPostMealTimerEnd } from "./notifications";
import type { GlucoseUnit } from "../db/types";

/**
 * The single source of "what the live surfaces show".
 *
 * Every glanceable surface - the notification reminder, the iOS Live Activity /
 * Dynamic Island, the home-screen widget, and the Apple Watch app/complication
 * - renders exactly two things: the NEXT reminder's target time, and the LAST
 * glucose reading (value + when). This module computes that once and writes it
 * to shared storage so every surface reads the same numbers. It contains no
 * medical interpretation; it only reflects what the user has already logged.
 *
 * Shared storage: in-app consumers read AsyncStorage (LIVE_DATA_KEY). The native
 * targets read the SAME JSON from the App Group (LIVE_DATA_APP_GROUP). Bridging
 * the write to the App Group needs a native module (ExtensionStorage from
 * @bacons/apple-targets, or App Group UserDefaults on Android) - that is a HUMAN
 * native step; see docs/native-live-surfaces.md. Until then the JSON is written
 * to AsyncStorage and the shape/keys below are the contract the native code targets.
 */

/** iOS App Group / Android shared-prefs id the native readers use. */
export const LIVE_DATA_APP_GROUP = "group.com.greeneyeapp.zerospike";
/** Key holding the LiveData JSON, in both AsyncStorage and the App Group. */
export const LIVE_DATA_KEY = "zerospike.liveData";

export type ReminderKind = "postMeal" | "basal" | "glucose";

export interface LiveData {
  /** epoch ms this snapshot was computed. */
  updatedAt: number;
  /** Display unit, so native surfaces format without re-deriving it. */
  unit: GlucoseUnit;
  /** Last logged reading in mg/dL (canonical storage unit), or null. */
  lastGlucoseMgdl: number | null;
  /** epoch ms of that reading, or null. */
  lastGlucoseAt: number | null;
  /** epoch ms the next reminder is due, or null when none is pending. */
  nextReminderAt: number | null;
  nextReminderKind: ReminderKind | null;
}

/** epoch ms of the next time HH:MM occurs (today if still ahead, else tomorrow). */
function nextOccurrence(hhmm: string, now = new Date()): number {
  const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
  const d = new Date(now);
  d.setHours(Number.isFinite(h) ? h : 22, Number.isFinite(m) ? m : 0, 0, 0);
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/**
 * Assembles the current LiveData for a profile from the last reading and the
 * soonest pending reminder (post-meal timer, else the enabled daily reminders).
 */
export async function computeLiveData(
  profileId: string,
  unit: GlucoseUnit
): Promise<LiveData> {
  const now = Date.now();

  const [latest] = await listSugarLogs(profileId, 1);
  const prefs = await getNotificationPrefs();

  const candidates: { at: number; kind: ReminderKind }[] = [];

  const postMealEnd = await getPostMealTimerEnd();
  if (postMealEnd && postMealEnd > now) {
    candidates.push({ at: postMealEnd, kind: "postMeal" });
  }
  if (prefs.enabled && prefs.basal) {
    candidates.push({ at: nextOccurrence(prefs.basalTime), kind: "basal" });
  }
  if (prefs.enabled && prefs.glucose) {
    candidates.push({ at: nextOccurrence(prefs.glucoseTime), kind: "glucose" });
  }
  candidates.sort((a, b) => a.at - b.at);
  const next = candidates[0] ?? null;

  return {
    updatedAt: now,
    unit,
    lastGlucoseMgdl: latest?.glucose_level_mgdl ?? null,
    lastGlucoseAt: latest ? new Date(latest.logged_at).getTime() : null,
    nextReminderAt: next?.at ?? null,
    nextReminderKind: next?.kind ?? null,
  };
}

/**
 * Computes and persists the LiveData snapshot. Safe to call on app open and
 * after any log/timer/preference change; failures are swallowed (a stale live
 * surface must never break the app). Returns the snapshot it wrote.
 *
 * NATIVE SEAM: to feed the iOS Live Activity / widget / watch, also write
 * `json` to the App Group here once @bacons/apple-targets is wired, e.g.
 *   ExtensionStorage.set(LIVE_DATA_KEY, json, { appGroup: LIVE_DATA_APP_GROUP })
 * and reload the widget timeline. See docs/native-live-surfaces.md.
 */
export async function syncLiveData(
  profileId: string,
  unit: GlucoseUnit
): Promise<LiveData | null> {
  try {
    const data = await computeLiveData(profileId, unit);
    await AsyncStorage.setItem(LIVE_DATA_KEY, JSON.stringify(data));
    return data;
  } catch {
    return null;
  }
}

/** Reads the last-written LiveData snapshot (in-app consumers). */
export async function readLiveData(): Promise<LiveData | null> {
  try {
    const raw = await AsyncStorage.getItem(LIVE_DATA_KEY);
    return raw ? (JSON.parse(raw) as LiveData) : null;
  } catch {
    return null;
  }
}
