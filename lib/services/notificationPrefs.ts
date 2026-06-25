import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Global notification preferences (device-level, not per-profile).
 *
 * Reminder schedules follow the device owner's daily routine, so they are
 * shared across profiles. The pen-low alert is the exception: it is triggered
 * per injection against the *active* profile's pen, so no per-profile flag is
 * needed here.
 */
export interface NotificationPrefs {
  /** Master switch: when false, no reminder is scheduled. */
  enabled: boolean;
  basal: boolean;
  basalTime: string; // "HH:MM"
  glucose: boolean;
  glucoseTime: string; // "HH:MM"
  postMeal: boolean;
  postMealHours: 1 | 2 | 3;
  penLow: boolean;
  /** Weekly summary nudge (Sunday 20:00). */
  weekly: boolean;
}

export const DEFAULT_PREFS: NotificationPrefs = {
  enabled: true,
  basal: true,
  basalTime: "22:00",
  glucose: false,
  glucoseTime: "08:00",
  postMeal: true,
  postMealHours: 2,
  penLow: true,
  weekly: false,
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
