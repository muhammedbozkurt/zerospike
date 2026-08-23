import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Global notification preferences (device-level, not per-profile).
 *
 * Reminder schedules follow the device owner's daily routine, so they are
 * shared across profiles.
 */
export interface NotificationPrefs {
  /** Master switch: when false, no reminder is scheduled. */
  enabled: boolean;
  basal: boolean;
  basalTime: string; // "HH:MM"
  /** Daily oral-medication reminder. Off by default and never enabled by
   *  onboarding: it is opened from notification settings, and only shows up
   *  there once the active profile has oral_meds_enabled. */
  med: boolean;
  medTime: string; // "HH:MM"
  glucose: boolean;
  glucoseTime: string; // "HH:MM"
  postMeal: boolean;
  /** Post-meal check delay in minutes (drives both the auto reminder and the
   *  "I started eating" timer). */
  postMealMinutes: 60 | 90 | 120 | 150;
  /** Whether the post-meal countdown runs as a real (AlarmKit) timer that rings
   *  at the end, rather than as a notification. On by default, the same as the
   *  reminders registry's own delivery default (schema v21) - a device without
   *  AlarmKit, or without the permission, silently keeps the notification (see
   *  shouldUseAlarm in lib/alarmSelect.ts), so the default costs nothing there.
   *  Turning it off also takes the app's own Live Activity card back: AlarmKit
   *  draws its own countdown, and two countdown cards must never sit on the
   *  lock screen at once (see schedulePostMealAt). */
  postMealAlarm: boolean;
  /** Weekly summary nudge, at a user-chosen day + time. */
  weekly: boolean;
  weeklyDay: number; // expo-notifications weekday: 1 = Sunday ... 7 = Saturday
  weeklyTime: string; // "HH:MM"
  /** After the user logs a reading below their own threshold, offer a neutral
   *  15-minute re-measure reminder. */
  lowFollowup: boolean;
  /** @deprecated UX#1 (2.1.0 wave 2b): the offer now always uses the active
   *  profile's own low threshold (see lowFollowupThresholdMgdl in
   *  lib/services/notifications.ts), the same number classifyGlucose uses
   *  everywhere else. Kept only so an already-stored value still parses;
   *  no longer read. */
  lowThresholdMgdl: number;
  /** Rolling reminder that the journal has been empty for a day. Re-armed on
   *  every entry, so someone who logs regularly never sees it. */
  idleReminder: boolean;
}

export const DEFAULT_PREFS: NotificationPrefs = {
  enabled: true,
  basal: true,
  basalTime: "22:00",
  med: false,
  medTime: "09:00",
  glucose: false,
  glucoseTime: "08:00",
  postMeal: true,
  postMealMinutes: 120,
  postMealAlarm: true,
  weekly: false,
  weeklyDay: 1,
  weeklyTime: "20:00",
  lowFollowup: true,
  lowThresholdMgdl: 70,
  idleReminder: true,
};

const KEY = "zerospike.notifPrefs";

export async function getNotificationPrefs(): Promise<NotificationPrefs> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    // Merge so a newly-added field falls back to its default.
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PREFS;
  }
}

export async function setNotificationPrefs(
  prefs: NotificationPrefs
): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // best-effort persistence
  }
}
