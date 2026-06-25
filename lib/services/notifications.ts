import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import i18n from "../i18n";
import {
  getNotificationPrefs,
  type NotificationPrefs,
} from "./notificationPrefs";

const BASAL_ID = "zerospike-basal-reminder";
const GLUCOSE_ID = "zerospike-glucose-reminder";
const WEEKLY_ID = "zerospike-weekly-summary";

/** Mirrors the in-app low-pen banner threshold. */
const PEN_LOW_THRESHOLD = 20;
/** Ids of pens we've already alerted at low level (avoids per-injection spam). */
const PEN_LOW_FLAG_KEY = "zerospike.penLowNotified";

// Foreground presentation: show banners while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
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

/**
 * Requests notification permission gracefully. Returns true if granted.
 * Never throws — a denied permission simply disables reminders.
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

export async function scheduleBasalReminder(time: string): Promise<void> {
  await ensureAndroidChannel();
  await cancelBasalReminder();
  const { hour, minute } = parseHHMM(time);
  await Notifications.scheduleNotificationAsync({
    identifier: BASAL_ID,
    content: {
      title: i18n.t("notifications.basalTitle"),
      body: i18n.t("notifications.basalBody"),
      ...androidChannel,
    },
    trigger: { hour, minute, repeats: true },
  });
}

export async function cancelBasalReminder(): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(BASAL_ID);
  } catch {
    // not scheduled — ignore
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
      ...androidChannel,
    },
    trigger: { hour, minute, repeats: true },
  });
}

export async function cancelGlucoseReminder(): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(GLUCOSE_ID);
  } catch {
    // not scheduled — ignore
  }
}

/** Weekly summary nudge, fixed to Sunday 20:00 (weekday 1 in expo-notifications). */
export async function scheduleWeeklySummary(): Promise<void> {
  await ensureAndroidChannel();
  await cancelWeeklySummary();
  await Notifications.scheduleNotificationAsync({
    identifier: WEEKLY_ID,
    content: {
      title: i18n.t("notifications.weeklyTitle"),
      body: i18n.t("notifications.weeklyBody"),
      ...androidChannel,
    },
    trigger: { weekday: 1, hour: 20, minute: 0, repeats: true },
  });
}

export async function cancelWeeklySummary(): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(WEEKLY_ID);
  } catch {
    // not scheduled — ignore
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

  if (p.weekly) await scheduleWeeklySummary();
  else await cancelWeeklySummary();
}

// ── Event-driven: post-meal check ──────────────────────────────────────────

/**
 * Schedules the one-off post-meal reminder, fired whenever a fasting reading or
 * a meal is logged. Honors the saved preference (enabled + delay), and no-ops
 * if disabled or permission is denied.
 */
export async function schedulePostMealReminder(): Promise<string | null> {
  const prefs = await getNotificationPrefs();
  if (!prefs.enabled || !prefs.postMeal) return null;

  const granted = await requestNotificationPermission();
  if (!granted) return null;

  return Notifications.scheduleNotificationAsync({
    content: {
      title: i18n.t("notifications.postmealTitle"),
      body: i18n.t("notifications.postmealBody"),
      ...androidChannel,
    },
    trigger: { seconds: prefs.postMealHours * 60 * 60 },
  });
}

// ── Event-driven: low-pen alert ────────────────────────────────────────────

async function getLowFlags(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(PEN_LOW_FLAG_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function setLowFlags(ids: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(PEN_LOW_FLAG_KEY, JSON.stringify(ids));
  } catch {
    // best-effort
  }
}

/**
 * Notifies once when a pen first drops below the low threshold. The pen is
 * flagged so repeat injections don't re-alert; the flag clears when the pen is
 * back above the threshold (e.g. replaced), so a later drop alerts again.
 * Call after an injection has decremented the pen.
 */
export async function maybeNotifyPenLow(pen: {
  id: string;
  name: string;
  remaining_units: number;
}): Promise<void> {
  const flags = await getLowFlags();
  const isLow = pen.remaining_units < PEN_LOW_THRESHOLD;
  const flagged = flags.includes(pen.id);

  if (isLow && !flagged) {
    const prefs = await getNotificationPrefs();
    if (prefs.enabled && prefs.penLow) {
      const granted = await requestNotificationPermission();
      if (granted) {
        await Notifications.scheduleNotificationAsync({
          identifier: `zerospike-pen-low-${pen.id}`,
          content: {
            title: i18n.t("notifications.penLowTitle"),
            body: i18n.t("notifications.penLowBody", {
              name: pen.name,
              n: Math.round(pen.remaining_units),
            }),
            ...androidChannel,
          },
          trigger: null, // immediate
        });
      }
    }
    // Flag regardless of send, so the in-app banner (not a notification) covers
    // the disabled case without re-checking on every future injection.
    await setLowFlags([...flags, pen.id]);
  } else if (!isLow && flagged) {
    await setLowFlags(flags.filter((x) => x !== pen.id));
  }
}
