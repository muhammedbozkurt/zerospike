import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

import i18n, { currentLang } from "../i18n";
import { getLatestSugarLog, getSugarAverageSince } from "../db/logs";
import { getNotificationPrefs } from "./notificationPrefs";
import { getPostMealTimerState, hasNotificationPermission } from "./notifications";
import { getProfile } from "../db/profiles";
import { listReminders } from "../db/reminders";
import { targetBandFor } from "../agpChart";
import { nextUpcoming, type UpcomingItem } from "../upcomingReminders";
import {
  getAlarmAuthorizationStatus,
  isAlarmKitAvailable,
} from "../../modules/zerospike-alarmkit";
import {
  hypoThreshold,
  VERY_HIGH_MGDL,
  formatGlucose,
  glucoseUnitLabel,
} from "../glucose";
import {
  insulinModeOf,
  insulinModeShowsBasal,
  insulinModeUsesInsulin,
} from "../insulinMode";
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
/** The Android Quick Add widget's registered name (see app.json). */
export const ANDROID_QUICK_ADD_WIDGET_NAME = "ZerospikeQuickAdd";
/** The Android last-reading widget's registered name (see app.json). The 2.3.1
 *  twin of the iOS ZerospikeReading widget: one small tile that pins the LAST
 *  reading rather than the rolling average the glance widget shows. */
export const ANDROID_READING_WIDGET_NAME = "ZerospikeReading";
/** ANDROID_LOG_GLUCOSE_WIDGET_NAME / ANDROID_LOG_MEAL_WIDGET_NAME /
 *  ANDROID_TIMER_WIDGET_NAME live in androidWidget.ts (single source of
 *  truth) and are re-imported where needed below, so the two files can never
 *  drift apart on these three names. */

export type ReminderKind = "postMeal" | "basal" | "med" | "glucose" | "custom";

export interface LiveData {
  /** epoch ms this snapshot was computed. */
  updatedAt: number;
  /** Display unit, so native surfaces format without re-deriving it. */
  unit: GlucoseUnit;
  /** The active in-app language (e.g. "ar"), so a native surface can mirror the
   *  app's own writing direction instead of the device's system language. */
  lang: string;
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
  /** What that reminder is CALLED, already localized here: the user's own row
   *  name when they gave one, otherwise the plain type noun (and the post-meal
   *  countdown's own name for the running timer). The lock-screen families show
   *  a name rather than a bare countdown, and a native surface must never own a
   *  second copy of nine translations. Null whenever `nextReminderAt` is. */
  nextReminderLabel: string | null;
  /** How that reminder will actually be DELIVERED, from the same three-way AND
   *  applyReminders arms with (lib/alarmSelect.ts) rather than from the stored
   *  column alone - so a lock-screen glyph can never promise an alarm the
   *  device would ring as a notification. Null whenever `nextReminderAt` is. */
  nextReminderMode: "alarm" | "notification" | null;
  /** End of a RUNNING post-meal window (epoch ms), or null. Carried SEPARATELY
   *  from `nextReminderAt` because the lock-screen rectangular family gives the
   *  running countdown the top line even when a daily reminder happens to be
   *  due sooner: a timer already ticking is the thing the user came to the lock
   *  screen to check. */
  postMealEndsAt: number | null;
  /** Whether the active profile uses insulin at all (insulin_mode !== "none").
   *  The Quick Add widgets hide their injection shortcut when it is false, so a
   *  profile that hid every in-app injection surface is not offered one from the
   *  home screen. Presentation only, exactly like lib/insulinMode.ts in the app. */
  usesInsulin: boolean;
  /** Whether the active profile tracks oral medication (oral_meds_enabled = 1).
   *  Unlike `usesInsulin` this one defaults to HIDDEN on every surface: it is a
   *  new shortcut, so a snapshot written before it existed must not grow a tile
   *  on its own. Presentation only, same scope as the flag above. */
  usesOralMeds: boolean;
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
    /** Quick Add widget shortcut titles (iOS QuickAdd.swift + the Android
     *  quick add widget), so those tiles never own their own translations. */
    quickAdd: string;
    addGlucose: string;
    addMeal: string;
    addInjection: string;
    /** The medication tile's title. Carries the app's OWN `meds.entryLabel`
     *  noun rather than an "Add ..." phrasing of its own: that string already
     *  ships in every language the app does, so the tile cannot be the one
     *  place a locale is missing. */
    addMed: string;
    /** The post-meal countdown's own heading, for the iOS timer widget's
     *  RUNNING state (`widget.timerTitle`, already shipping in all nine
     *  languages). */
    timerTitle: string;
    /** The "start the countdown" call to action for that widget's IDLE state.
     *  NULL while `dashboard.startCountdown` is still untranslated: i18next
     *  answers a missing key with the key itself, and a widget must never print
     *  "dashboard.startCountdown" at someone - the native side falls back to the
     *  brand name instead (see `localized` below and SmallWidgets.swift). */
    startCountdown: string | null;
  };
}

/**
 * A translated string, or null when the key has no translation yet.
 *
 * i18next returns the KEY ITSELF for a missing string. In the app that shows up
 * as an obviously broken label someone fixes in the same session; on a widget it
 * is baked into a tile on the user's lock screen until the next snapshot. So a
 * key that did not resolve is reported as absent, and every native surface
 * already treats an absent label as "draw the neutral state".
 */
function localized(key: string): string | null {
  const value = i18n.t(key);
  return typeof value === "string" && value.length > 0 && value !== key
    ? value
    : null;
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

  // Two aggregates, not a thousand rows. This snapshot needs exactly one reading
  // and one mean, and it used to read (and fully hydrate) the newest 1000 rows to
  // derive both in JS - on every log write, and again on every dashboard load.
  //
  // The five reads are independent of one another, so they go out together rather
  // than as a chain of awaits.
  const windowStart = new Date(now - AVG_WINDOW_DAYS * 86_400_000).toISOString();
  const [latest, avgWindow, prefs, profile, postMealState, reminders] = await Promise.all([
    getLatestSugarLog(profileId),
    getSugarAverageSince(profileId, windowStart),
    getNotificationPrefs(),
    // The profile's own band, so the widget/watch colour matches the app exactly.
    getProfile(profileId),
    getPostMealTimerState(),
    // The reminders registry (schema v17): basal/med/glucose/custom all live
    // here now, not in prefs.basal/med/glucose - see applyReminders in
    // ./notifications.ts, which schedules from this same table. Explicitly
    // scoped to THIS profile (schema v19): computeLiveData is always called
    // for one specific profile, so it is passed straight through rather than
    // relying on listReminders' own active-profile fallback to agree with it.
    listReminders(profileId),
  ]);
  const avgGlucoseMgdl =
    avgWindow.avgMgdl != null ? Math.round(avgWindow.avgMgdl) : null;
  const targetBand = targetBandFor(profile ?? {});
  const band = {
    hypo: hypoThreshold(profile ?? {}),
    low: targetBand.low,
    high: targetBand.high,
    veryHigh: VERY_HIGH_MGDL,
  };
  const tracksOralMeds = profile?.oral_meds_enabled === 1;

  // The SAME decision the reminders screen and the dashboard's "next" line make
  // (lib/upcomingReminders.ts): one gate set, one sort, one delivery call. This
  // used to be a second, hand-rolled candidate loop here, which is how the
  // widget ended up able to announce a reminder the app itself would not list -
  // and it had no way to say whether that reminder would RING or arrive as a
  // notification, which the lock-screen families now show.
  //
  // Owner check (mirrors app/(tabs)/index.tsx's postMealTimerForProfile): a
  // timer armed for a DIFFERENT profile must not surface on this profile's
  // snapshot, or a caregiver who started a countdown on one profile and
  // switched to another would see it announced as the new profile's own. A
  // timer with no recorded owner (armed before the lock existed) still
  // surfaces everywhere, same as before.
  const runningPostMeal =
    postMealState &&
    postMealState.endsAt > now &&
    (postMealState.profileId == null || postMealState.profileId === profileId)
      ? postMealState.endsAt
      : null;
  const alarmKitAvailable = isAlarmKitAvailable();
  const next: UpcomingItem | null = nextUpcoming({
    rows: reminders,
    now,
    // A day ahead, the same horizon the reminders screen uses.
    windowMs: 24 * 60 * 60 * 1000,
    // The SAME two gates applyReminders schedules behind, applied per row and
    // per mechanism (K3-2): the master switch empties everything, while the
    // notification permission only takes down the rows that would arrive AS
    // notifications - an alarm-mode row rings through AlarmKit without it.
    masterEnabled: prefs.enabled,
    notificationPermission: await hasNotificationPermission(),
    showsBasal: insulinModeShowsBasal(insulinModeOf(profile)),
    showsMeds: tracksOralMeds,
    alarmKitAvailable,
    alarmAuthorized:
      alarmKitAvailable && getAlarmAuthorizationStatus() === "authorized",
    postMealEndsAt: runningPostMeal,
    postMealAlarm: prefs.postMealAlarm,
  });

  /** What the next reminder is CALLED, resolved here so no native surface owns
   *  a second copy of the translations. */
  function nextReminderName(item: UpcomingItem | null): string | null {
    if (!item) return null;
    if (item.kind === "postMeal") return i18n.t("reminders.upcomingPostMeal");
    const own = item.label?.trim();
    if (own) return own;
    switch (item.type) {
      case "med":
        return i18n.t("reminders.typeMed");
      case "basal":
        return i18n.t("reminders.typeBasal");
      case "custom":
        return i18n.t("reminders.typeCustom");
      default:
        return i18n.t("reminders.typeGlucose");
    }
  }

  return {
    updatedAt: now,
    unit,
    lang: currentLang(),
    lastGlucoseMgdl: latest?.glucose_level_mgdl ?? null,
    lastGlucoseDisplay: latest
      ? formatGlucose(latest.glucose_level_mgdl, unit)
      : null,
    lastGlucoseAt: latest ? new Date(latest.logged_at).getTime() : null,
    avgGlucoseMgdl,
    avgGlucoseDisplay: avgGlucoseMgdl != null ? formatGlucose(avgGlucoseMgdl, unit) : null,
    avgWindowDays: AVG_WINDOW_DAYS,
    nextReminderAt: next?.at ?? null,
    nextReminderKind: next
      ? next.kind === "postMeal"
        ? "postMeal"
        : ((next.type ?? "glucose") as ReminderKind)
      : null,
    nextReminderLabel: nextReminderName(next),
    nextReminderMode: next?.mode ?? null,
    postMealEndsAt: runningPostMeal,
    usesInsulin: insulinModeUsesInsulin(insulinModeOf(profile)),
    usesOralMeds: tracksOralMeds,
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
      quickAdd: i18n.t("widget.quickAdd"),
      addGlucose: i18n.t("widget.addGlucose"),
      addMeal: i18n.t("widget.addMeal"),
      addInjection: i18n.t("widget.addInjection"),
      addMed: i18n.t("meds.entryLabel"),
      timerTitle: i18n.t("widget.timerTitle"),
      startCountdown: localized("dashboard.startCountdown"),
    },
  };
}

/**
 * Best-effort relay to a paired watch app: an Apple Watch on iOS, a Wear OS
 * watch on Android. Both platform branches below call this SAME function
 * (see modules/zerospike-watch-bridge) instead of each carrying their own
 * copy of the try/catch, so the two native sides can never drift out of
 * sync on how a missing module or an unpaired watch is silenced. The watch
 * cannot read the iOS App Group or the Android AsyncStorage copy, so this
 * push is its only path to the data. Optional and best-effort: no watch, no
 * companion app, or the module not linked yet (Expo Go / pre-prebuild
 * build) must never affect the phone. On Android, an unpaired watch is
 * caught natively (Kotlin DataClient returns false) - no extra JS check.
 */
async function pushToPairedWatch(json: string): Promise<void> {
  try {
    const { pushLiveDataToWatch } = await import("../../modules/zerospike-watch-bridge");
    pushLiveDataToWatch(json);
  } catch {
    // module not linked (Expo Go / pre-prebuild build) - silent no-op
  }
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
    // R10 FAZ 3: also relay to a paired Apple Watch (see pushToPairedWatch).
    await pushToPairedWatch(json);
    return;
  }
  if (Platform.OS === "android") {
    try {
      const { requestWidgetUpdate } = await import("react-native-android-widget");
      const {
        buildZerospikeWidget,
        buildQuickAddWidget,
        buildReadingWidget,
        buildLogGlucoseWidget,
        buildLogMealWidget,
        buildTimerWidget,
        ANDROID_LOG_GLUCOSE_WIDGET_NAME,
        ANDROID_LOG_MEAL_WIDGET_NAME,
        ANDROID_TIMER_WIDGET_NAME,
      } = await import("./androidWidget");
      const data = JSON.parse(json) as LiveData;
      // allSettled, not a chain of awaits: the six widgets are independent
      // surfaces and each is optional (the user may have placed none of them).
      // Chained, one rejection - a name the installed launcher does not know, a
      // widget host that went away - swallowed the redraw of every widget after
      // it, so the newest one in the list was the most likely to go stale.
      await Promise.allSettled([
        requestWidgetUpdate({
          widgetName: ANDROID_WIDGET_NAME,
          // The callback receives the placed widget's current dp size, so the
          // layout can tier itself (see sizesFor in androidWidget.ts).
          renderWidget: (info) => buildZerospikeWidget(data, info),
        }),
        requestWidgetUpdate({
          widgetName: ANDROID_QUICK_ADD_WIDGET_NAME,
          renderWidget: (info) => buildQuickAddWidget(data, info),
        }),
        requestWidgetUpdate({
          widgetName: ANDROID_READING_WIDGET_NAME,
          renderWidget: (info) => buildReadingWidget(data, info),
        }),
        requestWidgetUpdate({
          widgetName: ANDROID_LOG_GLUCOSE_WIDGET_NAME,
          renderWidget: (info) => buildLogGlucoseWidget(data, info),
        }),
        requestWidgetUpdate({
          widgetName: ANDROID_LOG_MEAL_WIDGET_NAME,
          renderWidget: (info) => buildLogMealWidget(data, info),
        }),
        // The one most likely to go stale otherwise (C1): the countdown
        // widget's content depends on a running post-meal timer, which is
        // armed/ended from lib/services/notifications.ts, not from a log
        // write - without this call it only ever redrew on its own 15-minute
        // period (app.json) or a manual tap.
        requestWidgetUpdate({
          widgetName: ANDROID_TIMER_WIDGET_NAME,
          renderWidget: (info) => buildTimerWidget(data, info),
        }),
      ]);
    } catch {
      // No widget placed on the home screen, or the module is not linked yet.
    }
    // Also relay to a paired Wear OS watch (see pushToPairedWatch). Outside
    // the try/catch above so a widget-side failure can never skip it.
    await pushToPairedWatch(json);
  }
}

/**
 * How long the native publish waits before it can fire again. Rebuilding a
 * WidgetKit timeline / re-rendering the Android widget / relaying to the watch is
 * the expensive half of a sync, and a burst of calls (a meal save writes a
 * reading, a meal and a bolus, and the dashboard reloads after each) asked for it
 * several times inside a second to show the same numbers.
 */
const NATIVE_PUBLISH_COALESCE_MS = 30_000;

let lastPublishAt = 0;
let pendingJson: string | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Publishes at most once per NATIVE_PUBLISH_COALESCE_MS, always with the LATEST
 * snapshot. Nothing is dropped: a call inside the window replaces the pending
 * payload and the trailing publish sends that. The in-app AsyncStorage copy is
 * written unconditionally by the caller, so nothing reading it ever sees a delay.
 */
function publishCoalesced(json: string): void {
  const now = Date.now();
  const elapsed = now - lastPublishAt;
  if (elapsed >= NATIVE_PUBLISH_COALESCE_MS) {
    lastPublishAt = now;
    void publishToNativeSurfaces(json);
    return;
  }
  pendingJson = json;
  if (pendingTimer != null) return;
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    const next = pendingJson;
    pendingJson = null;
    if (next == null) return;
    lastPublishAt = Date.now();
    void publishToNativeSurfaces(next);
  }, NATIVE_PUBLISH_COALESCE_MS - elapsed);
}

/**
 * Computes and persists the LiveData snapshot. Safe to call on app open and
 * after any log/timer/preference change; failures are swallowed (a stale live
 * surface must never break the app). Returns the snapshot it wrote.
 *
 * Also publishes the snapshot to the iOS App Group (widget + Live Activity) and
 * refreshes the Android widget (coalesced, see above). See
 * docs/native-live-surfaces.md.
 */
export async function syncLiveData(
  profileId: string,
  unit: GlucoseUnit
): Promise<LiveData | null> {
  try {
    const data = await computeLiveData(profileId, unit);
    const json = JSON.stringify(data);
    await AsyncStorage.setItem(LIVE_DATA_KEY, json);
    publishCoalesced(json);
    // K3-1: the lock-screen card carries the last reading, and it was frozen at
    // whatever that was when the countdown was armed - so logging, correcting or
    // deleting a reading mid-window left it showing a number the app no longer
    // agreed with. THIS is the one place to fix it: every write path already
    // ends here (a log, an edit, a delete, an undo all reach syncLiveData
    // through bumpData), and the dashboard's per-second countdown deliberately
    // does not, so the card is refreshed by data changes rather than by ticks.
    //
    // Only for a window this profile actually owns - the same lock computeLiveData
    // applies - and never a start: a reading is not a meal.
    //
    // C1: Android now carries the same running-countdown surface (a
    // notification, not a Live Activity - see modules/zerospike-live-activity's
    // Android side), so it needs the exact same reading refresh iOS always
    // got; only web (untargeted by this app) is excluded.
    if (
      (Platform.OS === "ios" || Platform.OS === "android") &&
      data.postMealEndsAt != null
    ) {
      void import("../../modules/zerospike-live-activity").then((m) =>
        m.updatePostMealActivityReading({
          lastReading: data.lastGlucoseDisplay,
          unitLabel: glucoseUnitLabel(unit),
        })
      );
    }
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
