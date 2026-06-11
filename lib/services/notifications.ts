import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Platform } from "react-native";
import i18n from "../i18n";

const BASAL_ID_KEY = "zerospike-basal-reminder"; // stable identifier reused

// Foreground presentation: show banners while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

let androidChannelReady = false;
async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android" || androidChannelReady) return;
  await Notifications.setNotificationChannelAsync("reminders", {
    name: "Hatırlatmalar",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#22d3ee",
  });
  androidChannelReady = true;
}

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

function parseHHMM(time: string): { hour: number; minute: number } {
  const [h, m] = time.split(":").map((n) => parseInt(n, 10));
  return {
    hour: Number.isFinite(h) ? h : 22,
    minute: Number.isFinite(m) ? m : 0,
  };
}

/**
 * Schedules (or reschedules) the daily night-insulin reminder at the given
 * 'HH:MM'. Cancels any previous basal reminder first so we never stack them.
 */
export async function scheduleBasalReminder(time: string): Promise<void> {
  const granted = await requestNotificationPermission();
  if (!granted) return;

  await cancelBasalReminder();
  const { hour, minute } = parseHHMM(time);

  await Notifications.scheduleNotificationAsync({
    identifier: BASAL_ID_KEY,
    content: {
      title: i18n.t("notifications.basalTitle"),
      body: i18n.t("notifications.basalBody"),
      ...(Platform.OS === "android" ? { channelId: "reminders" } : {}),
    },
    trigger: {
      hour,
      minute,
      repeats: true,
    },
  });
}

export async function cancelBasalReminder(): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(BASAL_ID_KEY);
  } catch {
    // not scheduled — ignore
  }
}

/**
 * Schedules the one-off 2-hour post-meal reminder, fired whenever a fasting
 * reading or a meal is logged. Returns the scheduled id (or null if denied).
 */
export async function schedulePostMealReminder(): Promise<string | null> {
  const granted = await requestNotificationPermission();
  if (!granted) return null;

  return Notifications.scheduleNotificationAsync({
    content: {
      title: i18n.t("notifications.postmealTitle"),
      body: i18n.t("notifications.postmealBody"),
      ...(Platform.OS === "android" ? { channelId: "reminders" } : {}),
    },
    trigger: {
      seconds: 2 * 60 * 60, // 2 hours
    },
  });
}
