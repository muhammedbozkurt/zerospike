import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

import i18n from "../i18n";
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
 * Shared storage: in-app consumers read AsyncStorage (LIVE_DATA_KEY). The iOS
 * widget and Live Activity read the SAME JSON from the App Group
 * (LIVE_DATA_APP_GROUP), written here through ExtensionStorage. The Android
 * widget renders in the RN JS context, so it reads AsyncStorage directly - no
 * second copy of the data and no second format.
 *
 * Both native writes are best-effort: in Expo Go, or in any build made before
 * `npx expo prebuild` linked the targets, they are no-ops. A stale glanceable
 * surface must never break the app.
 */

/** iOS App Group id the widget and Live Activity read from. */
export const LIVE_DATA_APP_GROUP = "group.com.greeneyeapp.zerospike";
/** Key holding the LiveData JSON, in both AsyncStorage and the App Group. */
export const LIVE_DATA_KEY = "zerospike.liveData";
/** The Android home-screen widget's registered name (see app.json). */
export const ANDROID_WIDGET_NAME = "Zerospike";

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
  /** Strings the app already localized, so a native surface owns no copy of the
   *  five translations and can never drift out of the app's language. */
  labels: {
    lastReading: string;
    nextReminder: string;
    noData: string;
  };
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
    labels: {
      lastReading: i18n.t("widget.lastReading"),
      nextReminder: i18n.t("widget.nextReminder"),
      noData: i18n.t("widget.noData"),
    },
  };
}

/**
 * Pushes the snapshot to the native surfaces. Separate from the AsyncStorage
 * write so a missing native module can never lose the in-app copy.
 */
async function publishToNativeSurfaces(json: string): Promise<void> {
  if (Platform.OS === "ios") {
    try {
      const { ExtensionStorage } = await import("@bacons/apple-targets");
      const storage = new ExtensionStorage(LIVE_DATA_APP_GROUP);
      storage.set(LIVE_DATA_KEY, json);
      // Ask WidgetKit to rebuild its timeline with the value we just wrote.
      ExtensionStorage.reloadWidget();
    } catch {
      // Expo Go / pre-prebuild build: no App Group to write to.
    }
    return;
  }
  if (Platform.OS === "android") {
    try {
      const { requestWidgetUpdate } = await import("react-native-android-widget");
      const { buildZerospikeWidget } = await import("./androidWidget");
      await requestWidgetUpdate({
        widgetName: ANDROID_WIDGET_NAME,
        renderWidget: () => buildZerospikeWidget(JSON.parse(json) as LiveData),
      });
    } catch {
      // No widget placed on the home screen, or the module is not linked yet.
    }
  }
}

/**
 * Computes and persists the LiveData snapshot. Safe to call on app open and
 * after any log/timer/preference change; failures are swallowed (a stale live
 * surface must never break the app). Returns the snapshot it wrote.
 *
 * Also publishes the snapshot to the iOS App Group (widget + Live Activity) and
 * refreshes the Android widget. See docs/native-live-surfaces.md.
 */
export async function syncLiveData(
  profileId: string,
  unit: GlucoseUnit
): Promise<LiveData | null> {
  try {
    const data = await computeLiveData(profileId, unit);
    const json = JSON.stringify(data);
    await AsyncStorage.setItem(LIVE_DATA_KEY, json);
    void publishToNativeSurfaces(json);
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
