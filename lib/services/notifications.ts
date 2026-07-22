import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import i18n from "../i18n";
import {
  getNotificationPrefs,
  type NotificationPrefs,
} from "./notificationPrefs";
import { formatGlucose, glucoseUnitLabel } from "../glucose";
import {
  endPostMealActivity,
  startPostMealActivity,
} from "../../modules/zerospike-live-activity";

const BASAL_ID = "zerospike-basal-reminder";
const GLUCOSE_ID = "zerospike-glucose-reminder";
const WEEKLY_ID = "zerospike-weekly-summary";
const TRIAL_ID = "zerospike-trial-ending";
// One fixed id for the post-meal check, so the meal-log auto reminder and the
// "I started eating" button can never stack two notifications at the same time
// (re-scheduling with the same id replaces the pending one).
const POSTMEAL_ID = "zerospike-postmeal-reminder";
// End time (epoch ms) of the pending post-meal reminder, persisted so the
// dashboard button can disable itself and show a live countdown. Written by the
// service on every successful schedule (button OR the automatic paths) so the
// countdown always matches the real notification.
const POSTMEAL_TIMER_END_KEY = "zerospike.postMealTimerEnd";

// Foreground presentation: show banners while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Ensures the Android "reminders" channel exists, named from i18n. Called on
 * every schedule (not cached) so the channel name follows the app language;
 * re-calling with the same id updates the name in place.
 */
async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("reminders", {
    name: i18n.t("notifications.channelName"),
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#22d3ee",
  });
}

const androidChannel =
  Platform.OS === "android" ? { channelId: "reminders" } : {};

// iOS Time-Sensitive interruption level: a time-based reminder breaks through
// Focus / silent and surfaces prominently, while staying a NEUTRAL reminder.
// This is NOT a critical alert (no com.apple.developer.usernotifications.critical
// entitlement - that carries medical-device risk and is deliberately avoided).
// Time-Sensitive needs the com.apple.developer.usernotifications.time-sensitive
// entitlement to break Focus; without it iOS silently downgrades to 'active', so
// adding this field is always safe. See docs/native-live-surfaces.md.
const IOS_TIME_SENSITIVE =
  Platform.OS === "ios" ? { interruptionLevel: "timeSensitive" as const } : {};

/** Content extras for a time-based reminder (Android high-importance channel +
 *  iOS Time-Sensitive). Used by the actionable reminders, not the weekly nudge. */
const reminderExtras = { ...androidChannel, ...IOS_TIME_SENSITIVE };

/**
 * Requests notification permission gracefully. Returns true if granted.
 * Never throws - a denied permission simply disables reminders.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  try {
    if (!Device.isDevice) return false; // simulators can't receive push reliably
    await ensureAndroidChannel();

    const settings = await Notifications.getPermissionsAsync();
    let status = settings.status;
    if (status !== "granted") {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    return status === "granted";
  } catch {
    return false;
  }
}

/** True if notification permission is already granted (does not prompt). */
export async function hasNotificationPermission(): Promise<boolean> {
  try {
    if (!Device.isDevice) return false;
    const settings = await Notifications.getPermissionsAsync();
    return settings.status === "granted";
  } catch {
    return false;
  }
}

function parseHHMM(time: string): { hour: number; minute: number } {
  const [h, m] = time.split(":").map((n) => parseInt(n, 10));
  return {
    hour: Number.isFinite(h) ? h : 22,
    minute: Number.isFinite(m) ? m : 0,
  };
}

// ── Daily repeating reminders ──────────────────────────────────────────────
// These are low-level: they (re)schedule unconditionally. Permission and the
// preference gating are decided by applyNotificationPrefs (the orchestrator).

/**
 * Whether timed reminders can actually be expected to arrive.
 *
 * Two things can silently break a scheduled reminder after the user has already
 * said yes: the OS permission being revoked later, and (Android) the reminders
 * channel being turned down or blocked in system settings. Both are queryable,
 * so both are reported here and the UI shows one neutral card with a route into
 * system settings.
 *
 * KNOWN LIMIT: Android 12+ also gates *exact* alarm delivery behind
 * SCHEDULE_EXACT_ALARM, and expo-notifications exposes no JS API for
 * AlarmManager.canScheduleExactAlarms() in this SDK. Rather than assert a state
 * we cannot read, "exactAlarmUnknown" reports that honestly for API 31+; the UI
 * folds it into the same card only when nothing stronger is already wrong, so a
 * user on a modern Android still gets the settings route without being shown a
 * warning that pretends to be a measurement.
 */
export type ReminderReliability = {
  /** The OS-level notification permission is missing. */
  permissionMissing: boolean;
  /** Android: the reminders channel is blocked or set below default importance. */
  channelLimited: boolean;
  /** Android 12+: exact-alarm state is not readable from JS (see above). */
  exactAlarmUnknown: boolean;
};

export async function checkReminderReliability(): Promise<ReminderReliability> {
  const result: ReminderReliability = {
    permissionMissing: false,
    channelLimited: false,
    exactAlarmUnknown: false,
  };
  try {
    result.permissionMissing = !(await hasNotificationPermission());
    if (Platform.OS !== "android") return result;

    const channel = await Notifications.getNotificationChannelAsync("reminders");
    if (channel && channel.importance < Notifications.AndroidImportance.DEFAULT) {
      result.channelLimited = true;
    }
    const api = Device.platformApiLevel ?? 0;
    result.exactAlarmUnknown = api >= 31;
  } catch {
    // A failed probe must never be reported as a problem with the user's setup.
  }
  return result;
}

/** True when anything above suggests a reminder might not arrive on time. */
export function remindersMayBeLimited(r: ReminderReliability): boolean {
  return r.permissionMissing || r.channelLimited || r.exactAlarmUnknown;
}

export async function scheduleBasalReminder(time: string): Promise<void> {
  await ensureAndroidChannel();
  await cancelBasalReminder();
  const { hour, minute } = parseHHMM(time);
  await Notifications.scheduleNotificationAsync({
    identifier: BASAL_ID,
    content: {
      title: i18n.t("notifications.basalTitle"),
      body: i18n.t("notifications.basalBody"),
      ...reminderExtras,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute,
    },
  });
}

export async function cancelBasalReminder(): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(BASAL_ID);
  } catch {
    // not scheduled - ignore
  }
}

export async function scheduleGlucoseReminder(time: string): Promise<void> {
  await ensureAndroidChannel();
  await cancelGlucoseReminder();
  const { hour, minute } = parseHHMM(time);
  await Notifications.scheduleNotificationAsync({
    identifier: GLUCOSE_ID,
    content: {
      title: i18n.t("notifications.glucoseTitle"),
      body: i18n.t("notifications.glucoseBody"),
      ...reminderExtras,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute,
    },
  });
}

export async function cancelGlucoseReminder(): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(GLUCOSE_ID);
  } catch {
    // not scheduled - ignore
  }
}

/** Weekly summary nudge at the user's chosen day + time (weekday: 1 = Sunday). */
export async function scheduleWeeklySummary(
  weekday: number,
  time: string
): Promise<void> {
  await ensureAndroidChannel();
  await cancelWeeklySummary();
  const { hour, minute } = parseHHMM(time);
  await Notifications.scheduleNotificationAsync({
    identifier: WEEKLY_ID,
    content: {
      title: i18n.t("notifications.weeklyTitle"),
      body: i18n.t("notifications.weeklyBody"),
      ...androidChannel,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
      weekday: Math.min(7, Math.max(1, Math.round(weekday))),
      hour,
      minute,
    },
  });
}

export async function cancelWeeklySummary(): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(WEEKLY_ID);
  } catch {
    // not scheduled - ignore
  }
}

/**
 * Applies the saved preferences: schedules the basal/glucose reminders that are
 * enabled and cancels the rest. With the master switch off (or permission
 * denied) it cancels everything it manages. Post-meal is event-driven (see
 * schedulePostMealReminder) so it is not touched here.
 */
export async function applyNotificationPrefs(
  prefs?: NotificationPrefs
): Promise<void> {
  const p = prefs ?? (await getNotificationPrefs());

  if (!p.enabled) {
    await cancelBasalReminder();
    await cancelGlucoseReminder();
    await cancelWeeklySummary();
    return;
  }

  const granted = await requestNotificationPermission();
  if (!granted) {
    await cancelBasalReminder();
    await cancelGlucoseReminder();
    await cancelWeeklySummary();
    return;
  }

  if (p.basal) await scheduleBasalReminder(p.basalTime);
  else await cancelBasalReminder();

  if (p.glucose) await scheduleGlucoseReminder(p.glucoseTime);
  else await cancelGlucoseReminder();

  if (p.weekly) await scheduleWeeklySummary(p.weeklyDay, p.weeklyTime);
  else await cancelWeeklySummary();
}

// ── Trial-ending reminder ──────────────────────────────────────────────────

/**
 * Local reminder scheduled `leadDays` before a free trial converts, so a user
 * can cancel in time and is never surprised by a charge. One-off.
 */
export async function scheduleTrialEndingReminder(trialDays: number): Promise<void> {
  const leadDays = 2;
  const fireInDays = trialDays - leadDays;
  if (fireInDays <= 0) return;
  const granted = await requestNotificationPermission();
  if (!granted) return;
  await ensureAndroidChannel();
  await Notifications.scheduleNotificationAsync({
    identifier: TRIAL_ID,
    content: {
      title: i18n.t("notifications.trialTitle"),
      body: i18n.t("notifications.trialBody"),
      ...androidChannel,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: fireInDays * 24 * 60 * 60,
      repeats: false,
    },
  });
}

// ── Event-driven: post-meal check ──────────────────────────────────────────

/** Schedules the single post-meal reminder `minutes` from now, replacing any
 *  pending one (same fixed id) so two can never fire close together. */
async function schedulePostMealAt(minutes: number): Promise<void> {
  await ensureAndroidChannel();
  try {
    await Notifications.cancelScheduledNotificationAsync(POSTMEAL_ID);
  } catch {
    // nothing pending
  }
  const seconds = Math.max(60, Math.round(minutes * 60));
  await Notifications.scheduleNotificationAsync({
    identifier: POSTMEAL_ID,
    content: {
      title: i18n.t("notifications.postmealTitle"),
      body: i18n.t("notifications.postmealBody"),
      ...reminderExtras,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds,
      repeats: false,
    },
  });
  // Persist the end time so the dashboard button can count down and disable
  // itself. Only reached once permission is granted (callers gate on it), so it
  // never writes without a real pending notification.
  const endsAt = Date.now() + seconds * 1000;
  try {
    await AsyncStorage.setItem(POSTMEAL_TIMER_END_KEY, String(endsAt));
  } catch {
    // best-effort persistence
  }

  // Mirror the same countdown onto the lock screen and Dynamic Island, so the
  // user can see the time left without opening the app. Timer-style, no push:
  // iOS draws the countdown from the end date we just persisted. A no-op when
  // Live Activities are unavailable or the module is not linked.
  // Imported lazily: liveData reads the pending timer from this module, and a
  // module-scope import here would close that cycle.
  const { readLiveData } = await import("./liveData");
  const snapshot = await readLiveData();
  startPostMealActivity({
    endsAt,
    title: i18n.t("widget.timerTitle"),
    lastReading:
      snapshot?.lastGlucoseMgdl != null
        ? formatGlucose(snapshot.lastGlucoseMgdl, snapshot.unit)
        : null,
    unitLabel: snapshot ? glucoseUnitLabel(snapshot.unit) : "",
  });
}

/**
 * The active post-meal timer's end (epoch ms), or null when none is pending or
 * it has already elapsed. A stale (elapsed) key is cleaned up on read, so the
 * button falls back to its normal state on its own.
 */
export async function getPostMealTimerEnd(): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(POSTMEAL_TIMER_END_KEY);
    if (!raw) return null;
    const end = parseInt(raw, 10);
    if (!Number.isFinite(end)) return null;
    if (end <= Date.now()) {
      await AsyncStorage.removeItem(POSTMEAL_TIMER_END_KEY).catch(() => {});
      return null;
    }
    return end;
  } catch {
    return null;
  }
}

/**
 * Cancels a pending post-meal reminder and clears its timer. Used for early
 * completion: once the user logs their 2-hour reading the nudge is unnecessary.
 */
export async function cancelPostMealTimer(): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(POSTMEAL_ID);
  } catch {
    // nothing pending
  }
  try {
    await AsyncStorage.removeItem(POSTMEAL_TIMER_END_KEY);
  } catch {
    // best-effort
  }
  endPostMealActivity();
}

/**
 * Auto post-meal reminder, fired whenever a fasting reading or a meal is logged.
 * Honors the saved preference (enabled + postMeal toggle), and no-ops if
 * disabled or permission is denied.
 */
export async function schedulePostMealReminder(): Promise<void> {
  const prefs = await getNotificationPrefs();
  if (!prefs.enabled || !prefs.postMeal) return;
  if (!(await requestNotificationPermission())) return;
  await schedulePostMealAt(prefs.postMealMinutes);
}

/**
 * "I started eating" timer: an explicit user action, so it schedules the
 * post-meal check regardless of the auto-reminder toggle (still needs the master
 * switch on + permission). Shares POSTMEAL_ID, so pressing again just renews it.
 * Returns the minutes it was scheduled for, or null when notifications are off
 * or permission is denied.
 */
export async function startPostMealTimer(): Promise<number | null> {
  const prefs = await getNotificationPrefs();
  if (!prefs.enabled) return null;
  if (!(await requestNotificationPermission())) return null;
  await schedulePostMealAt(prefs.postMealMinutes);
  return prefs.postMealMinutes;
}

// ── User-initiated: re-measure follow-up after a low reading ────────────────

const LOWFOLLOW_ID = "zerospike-low-followup";

/**
 * Schedules a neutral 15-minute re-measure reminder. Offered (never automatic)
 * after the user logs a reading below their own threshold. Copy is descriptive,
 * with no diagnosis or alarm wording. Returns false if permission is denied.
 */
export async function scheduleLowFollowup(): Promise<boolean> {
  if (!(await requestNotificationPermission())) return false;
  await ensureAndroidChannel();
  try {
    await Notifications.cancelScheduledNotificationAsync(LOWFOLLOW_ID);
  } catch {
    // nothing pending
  }
  await Notifications.scheduleNotificationAsync({
    identifier: LOWFOLLOW_ID,
    content: {
      title: i18n.t("notifications.lowFollowTitle"),
      body: i18n.t("notifications.lowFollowBody"),
      ...reminderExtras,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 15 * 60,
      repeats: false,
    },
  });
  return true;
}

