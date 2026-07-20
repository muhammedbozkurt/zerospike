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
  glucose: boolean;
  glucoseTime: string; // "HH:MM"
  postMeal: boolean;
  /** Post-meal check delay in minutes (drives both the auto reminder and the
   *  "I started eating" timer). */
  postMealMinutes: 90 | 120 | 150;
  /** Weekly summary nudge, at a user-chosen day + time. */
  weekly: boolean;
  weeklyDay: number; // expo-notifications weekday: 1 = Sunday ... 7 = Saturday
  weeklyTime: string; // "HH:MM"
  /** After the user logs a reading below their own threshold, offer a neutral
   *  15-minute re-measure reminder. User-set threshold, stored in mg/dL. */
  lowFollowup: boolean;
  lowThresholdMgdl: number;
}

export const DEFAULT_PREFS: NotificationPrefs = {
  enabled: true,
  basal: true,
  basalTime: "22:00",
  glucose: false,
  glucoseTime: "08:00",
  postMeal: true,
  postMealMinutes: 120,
  weekly: false,
  weeklyDay: 1,
  weeklyTime: "20:00",
  lowFollowup: true,
  lowThresholdMgdl: 70,
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
