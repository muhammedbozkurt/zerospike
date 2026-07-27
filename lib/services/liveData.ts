import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

import i18n from "../i18n";
import { listSugarLogs } from "../db/logs";
import { getNotificationPrefs } from "./notificationPrefs";
import { getPostMealTimerEnd } from "./notifications";
import { getProfile } from "../db/profiles";
import { targetBandFor } from "../agpChart";
import { hypoThreshold, VERY_HIGH_MGDL, formatGlucose } from "../glucose";
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
  /** The last reading PRE-FORMATTED in the display unit and the active locale
   *  (Intl), so native surfaces print it verbatim instead of formatting a number
   *  with a hard-coded dot (which showed "6.4" to a tr/de user). */
  lastGlucoseDisplay: string | null;
  /** epoch ms of that reading, or null. */
  lastGlucoseAt: number | null;
  /** Rolling average glucose over the last `avgWindowDays` (mg/dL), or null when
   *  there are no readings in the window. This is what the home-screen widget
   *  pins - a persistent, meaningful number rather than a single stale reading. */
  avgGlucoseMgdl: number | null;
  /** That average PRE-FORMATTED in the display unit + active locale. */
  avgGlucoseDisplay: string | null;
  /** The averaging window in days (7). */
  avgWindowDays: number;
  /** epoch ms the next reminder is due, or null when none is pending. */
  nextReminderAt: number | null;
  nextReminderKind: ReminderKind | null;
  /** The profile's OWN colour band (mg/dL), so every native surface colours a
   *  reading the same way the app does instead of a fixed 70/180 rule. */
  band: {
    hypo: number;
    low: number;
    high: number;
    veryHigh: number;
  };
  /** Strings the app already localized, so a native surface owns no copy of the
   *  five translations and can never drift out of the app's language. */
  labels: {
    lastReading: string;
    avgGlucose: string;
    avgWindow: string;
    nextReminder: string;
    noData: string;
    /** For building a hand-formatted "elapsed since" string (e.g. "6 sa 23 dk
     *  önce") - SwiftUI's `Text(date, style: .relative)` is localized to the
     *  WATCH's system language, not the app's in-app language, so the watch
     *  and watch-widget targets must compose their own relative-time string
     *  from these instead of relying on that formatter. */
    hourShort: string;
    minuteShort: string;
    /** Contains a "{{t}}" placeholder for the already-composed duration
     *  (e.g. "6 sa 23 dk"); do the substitution on the native side. */
    agoTemplate: string;
  };
}

/** The averaging window for the home-screen widget's pinned number. */
const AVG_WINDOW_DAYS = 7;

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

  const recent = await listSugarLogs(profileId, 1000);
  const latest = recent[0];
  // Rolling average over the last AVG_WINDOW_DAYS (canonical mg/dL).
  const windowStart = now - AVG_WINDOW_DAYS * 86_400_000;
  const inWindow = recent.filter(
    (l) => new Date(l.logged_at).getTime() >= windowStart
  );
  const avgGlucoseMgdl = inWindow.length
    ? Math.round(
        inWindow.reduce((sum, l) => sum + l.glucose_level_mgdl, 0) / inWindow.length
      )
    : null;
  const prefs = await getNotificationPrefs();
  // The profile's own band, so the widget/watch colour matches the app exactly.
  const profile = await getProfile(profileId);
  const targetBand = targetBandFor(profile ?? {});
  const band = {
    hypo: hypoThreshold(profile ?? {}),
    low: targetBand.low,
    high: targetBand.high,
    veryHigh: VERY_HIGH_MGDL,
  };

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
    lastGlucoseDisplay: latest
      ? formatGlucose(latest.glucose_level_mgdl, unit)
      : null,
    lastGlucoseAt: latest ? new Date(latest.logged_at).getTime() : null,
    avgGlucoseMgdl,
    avgGlucoseDisplay: avgGlucoseMgdl != null ? formatGlucose(avgGlucoseMgdl, unit) : null,
    avgWindowDays: AVG_WINDOW_DAYS,
    nextReminderAt: next?.at ?? null,
    nextReminderKind: next?.kind ?? null,
    band,
    labels: {
      lastReading: i18n.t("widget.lastReading"),
      avgGlucose: i18n.t("widget.avgGlucose"),
      avgWindow: i18n.t("widget.avgWindow", { n: AVG_WINDOW_DAYS }),
      nextReminder: i18n.t("widget.nextReminder"),
      noData: i18n.t("widget.noData"),
      hourShort: i18n.t("widget.hourShort"),
      minuteShort: i18n.t("widget.minuteShort"),
      agoTemplate: i18n.t("widget.agoTemplate"),
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
    // R10 FAZ 3: also relay to a paired Apple Watch. The watch cannot read the
    // App Group above, so this is its only path to the data (see
    // modules/zerospike-watch-bridge). Optional and best-effort: no watch, no
    // companion app, or the module not linked yet must never affect the phone.
    try {
      const { pushLiveDataToWatch } = await import("../../modules/zerospike-watch-bridge");
      pushLiveDataToWatch(json);
    } catch {
      // module not linked (Expo Go / pre-prebuild build) - silent no-op
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
