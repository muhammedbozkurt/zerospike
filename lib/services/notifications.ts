import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import i18n from "../i18n";
import {
  getNotificationPrefs,
  type NotificationPrefs,
} from "./notificationPrefs";
import { formatGlucose, glucoseUnitLabel, LOW_FOLLOWUP_MINUTES } from "../glucose";
import {
  endPostMealActivity,
  startPostMealActivity,
} from "../../modules/zerospike-live-activity";
import {
  derivePostMealStart,
  retimePostMealWindow,
  type PostMealTimerWindow,
} from "../postMealTimer";

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
// The moment that same timer was ARMED. Persisted alongside the end so a window
// length changed in Settings can be re-measured from the meal instead of from
// the settings change (see applyPostMealWindowChange). A timer armed by an older
// build has no start recorded; it is derived from the end and the window it was
// armed with.
const POSTMEAL_TIMER_START_KEY = "zerospike.postMealTimerStart";
// Fire times (epoch ms) of the pending ONE-OFF reminders whose copy is not
// recoverable from anywhere else. The OS stores the literal text it was handed,
// so switching language leaves an already-scheduled reminder speaking the old
// one; to rewrite it we have to know when it was supposed to fire.
// (The post-meal check is not listed here: its end time is already persisted
// above, and that key stays the single source of truth for it.)
const ONEOFF_ENDS_KEY = "zerospike.oneOffReminderEnds";
// Single rolling "the journal is empty" reminder. One fixed id, re-armed from
// scratch on every entry, so it can never stack and never fires for someone who
// keeps logging. Its fire moment is persisted so re-applying preferences (or a
// language change) can rewrite the copy without sliding the reminder forward.
const IDLE_ID = "zerospike-idle-reminder";
const IDLE_END_KEY = "zerospike.idleReminderEnd";

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
 * Route hint carried in every notification's content.data. app/_layout.tsx reads
 * it (on tap AND on cold start via getLastNotificationResponseAsync) and opens
 * the screen the reminder is about, instead of dropping the user on whatever they
 * last had open.
 */
export type NotificationRoute =
  | "postMeal"
  | "basal"
  | "glucose"
  | "weekly"
  | "lowFollowup"
  | "trial"
  | "idle";

/**
 * The real outcome of asking for notification permission, so the UI can tell the
 * truth instead of pretending a denied prompt was granted:
 *  - granted:      the user allowed notifications
 *  - denied:       the user (or a prior choice) said no
 *  - undetermined: never asked / the prompt was dismissed without a choice
 *  - unavailable:  we could not ask at all (the probe itself threw). This is
 *                  reported honestly rather than being swallowed as a false.
 */
export type NotificationPermission =
  | "granted"
  | "denied"
  | "undetermined"
  | "unavailable";

/**
 * Requests notification permission and reports the real outcome. Never throws;
 * a probe that fails is reported as "unavailable" (not silently as a denial), so
 * onboarding and Settings can show an accurate status and a route into system
 * settings.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  try {
    // No Device.isDevice guard: this app only ever schedules LOCAL reminders (it
    // has no push token and no remote sender), and local notifications are asked
    // for and delivered on a simulator just like on a device. The guard belonged
    // to a push path that does not exist here, and it short-circuited before
    // requestPermissionsAsync, so the onboarding button never raised the OS
    // prompt on a simulator.
    await ensureAndroidChannel();

    const settings = await Notifications.getPermissionsAsync();
    let status = settings.status;
    if (status !== "granted") {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status === "granted") return "granted";
    if (status === "denied") return "denied";
    return "undetermined";
  } catch {
    return "unavailable";
  }
}

/** Convenience for the schedulers: did we actually get permission? */
export async function ensureNotificationPermission(): Promise<boolean> {
  return (await requestNotificationPermission()) === "granted";
}

/** True if notification permission is already granted (does not prompt). */
export async function hasNotificationPermission(): Promise<boolean> {
  try {
    const settings = await Notifications.getPermissionsAsync();
    return settings.status === "granted";
  } catch {
    return false;
  }
}

/**
 * Reads the current permission WITHOUT prompting, for a status row that is shown
 * independently of the app's own notification toggle. Same four honest states as
 * the request path.
 */
export async function getNotificationPermission(): Promise<NotificationPermission> {
  try {
    const settings = await Notifications.getPermissionsAsync();
    if (settings.status === "granted") return "granted";
    if (settings.status === "denied") return "denied";
    return "undetermined";
  } catch {
    return "unavailable";
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
      data: { route: "basal" satisfies NotificationRoute },
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
      data: { route: "glucose" satisfies NotificationRoute },
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
      data: { route: "weekly" satisfies NotificationRoute },
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

// ── Rolling idle reminder: "nothing in the journal today" ───────────────────

/** How long the journal has to stay untouched before the reminder fires. */
const IDLE_GAP_HOURS = 24;
/** Delivery window. Nothing is ever handed to the user outside it. */
const IDLE_WINDOW_START_HOUR = 9;
const IDLE_WINDOW_END_HOUR = 21;

/**
 * When the next idle reminder should land: a full day after the last entry,
 * rolled into the 09:00-21:00 window so a reminder never arrives in the middle
 * of the night. Someone who logs at 03:00 is reminded the same day at 09:00;
 * someone who logs at 23:00 is reminded the NEXT morning, never at 23:00.
 */
function nextIdleFireAt(from: number = Date.now()): number {
  const d = new Date(from + IDLE_GAP_HOURS * 60 * 60 * 1000);
  const hour = d.getHours();
  if (hour >= IDLE_WINDOW_END_HOUR) d.setDate(d.getDate() + 1);
  if (hour >= IDLE_WINDOW_END_HOUR || hour < IDLE_WINDOW_START_HOUR) {
    d.setHours(IDLE_WINDOW_START_HOUR, d.getMinutes(), 0, 0);
  }
  return d.getTime();
}

async function readIdleEnd(): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(IDLE_END_KEY);
    if (!raw) return null;
    const end = parseInt(raw, 10);
    return Number.isFinite(end) ? end : null;
  } catch {
    return null;
  }
}

/**
 * (Re)arms the single idle reminder, replacing any pending one. `keepFireAt`
 * preserves an already-armed moment (used when preferences are re-applied or the
 * copy is rewritten for a new language) so those paths never push the reminder a
 * further day out; it is ignored once it has passed.
 *
 * Deliberately NOT Time-Sensitive: this is a gentle nudge about an empty
 * journal, not a timed check, so it must not break through Focus.
 */
export async function scheduleIdleReminder(keepFireAt?: number): Promise<void> {
  await ensureAndroidChannel();
  try {
    await Notifications.cancelScheduledNotificationAsync(IDLE_ID);
  } catch {
    // nothing pending
  }
  const fireAt =
    keepFireAt != null && keepFireAt > Date.now() + 60_000
      ? keepFireAt
      : nextIdleFireAt();
  await Notifications.scheduleNotificationAsync({
    identifier: IDLE_ID,
    content: {
      title: i18n.t("notifications.idleTitle"),
      body: i18n.t("notifications.idleBody"),
      data: { route: "idle" satisfies NotificationRoute },
      ...androidChannel,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: fireAt,
    },
  });
  try {
    await AsyncStorage.setItem(IDLE_END_KEY, String(fireAt));
  } catch {
    // best-effort persistence
  }
}

export async function cancelIdleReminder(): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(IDLE_ID);
  } catch {
    // nothing pending
  }
  try {
    await AsyncStorage.removeItem(IDLE_END_KEY);
  } catch {
    // best-effort
  }
}

/**
 * The single hook every logging path calls after a record is written: the day
 * has activity, so the idle reminder moves a full day out again.
 *
 * Fire-and-forget by contract - it never throws and never prompts (a save must
 * not raise an OS permission dialog), so a caller can `void` it without any
 * risk to the entry being saved.
 */
export async function noteJournalActivity(): Promise<void> {
  try {
    const prefs = await getNotificationPrefs();
    if (!prefs.enabled || !prefs.idleReminder) {
      await cancelIdleReminder();
      return;
    }
    if (!(await hasNotificationPermission())) return;
    await scheduleIdleReminder();
  } catch {
    // the reminder is a nudge; a failure must never surface in a logging flow
  }
}

// ── Pending one-off reminders, tracked so a language change can rewrite them ──

type OneOffKind = "lowFollowup" | "trial";

async function readOneOffEnds(): Promise<Partial<Record<OneOffKind, number>>> {
  try {
    const raw = await AsyncStorage.getItem(ONEOFF_ENDS_KEY);
    return raw ? (JSON.parse(raw) as Partial<Record<OneOffKind, number>>) : {};
  } catch {
    return {};
  }
}

async function rememberOneOffEnd(kind: OneOffKind, endsAt: number): Promise<void> {
  try {
    const all = await readOneOffEnds();
    all[kind] = endsAt;
    await AsyncStorage.setItem(ONEOFF_ENDS_KEY, JSON.stringify(all));
  } catch {
    // best-effort: without the record the reminder just keeps its old copy
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

  // The master switch (and a revoked permission) also takes down the pending
  // post-meal check and its Live Activity. It is event-driven, so it is not
  // re-scheduled here - but leaving an armed one behind meant a user who turned
  // notifications OFF still got the countdown on their lock screen and the nudge
  // two hours later.
  if (!p.enabled) {
    await cancelBasalReminder();
    await cancelGlucoseReminder();
    await cancelWeeklySummary();
    await cancelPostMealTimer();
    await cancelIdleReminder();
    return;
  }

  const granted = await ensureNotificationPermission();
  if (!granted) {
    await cancelBasalReminder();
    await cancelGlucoseReminder();
    await cancelWeeklySummary();
    await cancelPostMealTimer();
    await cancelIdleReminder();
    return;
  }

  if (p.basal) await scheduleBasalReminder(p.basalTime);
  else await cancelBasalReminder();

  if (p.glucose) await scheduleGlucoseReminder(p.glucoseTime);
  else await cancelGlucoseReminder();

  if (p.weekly) await scheduleWeeklySummary(p.weeklyDay, p.weeklyTime);
  else await cancelWeeklySummary();

  // The idle reminder is event-driven (noteJournalActivity re-arms it on every
  // entry), so re-applying preferences must not move it: an already-armed one
  // keeps its fire moment and only has its copy refreshed.
  if (p.idleReminder) await scheduleIdleReminder((await readIdleEnd()) ?? undefined);
  else await cancelIdleReminder();
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
  const granted = await ensureNotificationPermission();
  if (!granted) return;
  await ensureAndroidChannel();
  await Notifications.scheduleNotificationAsync({
    identifier: TRIAL_ID,
    content: {
      title: i18n.t("notifications.trialTitle"),
      body: i18n.t("notifications.trialBody"),
      data: { route: "trial" satisfies NotificationRoute },
      ...androidChannel,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: fireInDays * 24 * 60 * 60,
      repeats: false,
    },
  });
  await rememberOneOffEnd("trial", Date.now() + fireInDays * 24 * 60 * 60 * 1000);
}

// ── Event-driven: post-meal check ──────────────────────────────────────────

/**
 * Schedules the single post-meal reminder `minutes` from now, replacing any
 * pending one (same fixed id) so two can never fire close together.
 *
 * `windowMin` is the figure the COPY names (the full window the user chose); it
 * differs from `minutes` only when an already-running timer is re-armed with what
 * is left of it, which must not renumber the reminder. `endsAt` / `startedAt`
 * likewise preserve a running timer's own moments so a re-arm never slides the
 * countdown.
 */
async function schedulePostMealAt(opts: {
  /** Minutes from now the reminder should fire. */
  minutes: number;
  /** Full window named in the copy; defaults to `minutes`. */
  windowMin?: number;
  /** Keep an already-running timer's end instead of `now + minutes`. */
  endsAt?: number;
  /** Keep an already-running timer's start instead of `now`. */
  startedAt?: number;
}): Promise<void> {
  const { minutes, windowMin = opts.minutes } = opts;
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
      body: i18n.t("notifications.postmealBody", { n: Math.round(windowMin) }),
      data: { route: "postMeal" satisfies NotificationRoute },
      ...reminderExtras,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds,
      repeats: false,
    },
  });
  // Persist the timer so the dashboard button can count down and disable itself,
  // and so a window changed in Settings can be re-measured from the meal. Only
  // reached once permission is granted (callers gate on it), so it never writes
  // without a real pending notification.
  const now = Date.now();
  const endsAt = opts.endsAt ?? now + seconds * 1000;
  const startedAt = opts.startedAt ?? now;
  try {
    await AsyncStorage.multiSet([
      [POSTMEAL_TIMER_END_KEY, String(endsAt)],
      [POSTMEAL_TIMER_START_KEY, String(startedAt)],
    ]);
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
      await completePostMealTimer();
      return null;
    }
    return end;
  } catch {
    return null;
  }
}

/**
 * The active timer's own start AND end, or null when none is pending. The start
 * is what makes the elapsed part of the window knowable: the progress bar reads
 * it instead of assuming the timer was armed with the CURRENT preference, and a
 * window change re-measures from it.
 *
 * A timer armed before the start was persisted falls back to the end minus the
 * saved window, which is exactly where it must have begun.
 */
export async function getPostMealTimerState(): Promise<PostMealTimerWindow | null> {
  const endsAt = await getPostMealTimerEnd();
  if (endsAt == null) return null;
  const startedAt = await readPostMealStart();
  if (startedAt != null && startedAt < endsAt) return { startedAt, endsAt };
  const prefs = await getNotificationPrefs();
  return { startedAt: derivePostMealStart(endsAt, prefs.postMealMinutes), endsAt };
}

async function readPostMealStart(): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(POSTMEAL_TIMER_START_KEY);
    if (!raw) return null;
    const start = parseInt(raw, 10);
    return Number.isFinite(start) ? start : null;
  } catch {
    return null;
  }
}

/**
 * The countdown reached its end: clear the persisted timer and take the Live
 * Activity down. Nothing ended it before, so the lock-screen countdown sat at
 * 00:00 until iOS eventually expired it hours later - or until the user armed
 * another timer. The notification itself has already fired, so it is not
 * cancelled here.
 */
export async function completePostMealTimer(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([
      POSTMEAL_TIMER_END_KEY,
      POSTMEAL_TIMER_START_KEY,
    ]);
  } catch {
    // best-effort
  }
  endPostMealActivity();
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
    await AsyncStorage.multiRemove([
      POSTMEAL_TIMER_END_KEY,
      POSTMEAL_TIMER_START_KEY,
    ]);
  } catch {
    // best-effort
  }
  endPostMealActivity();
}

/**
 * Auto post-meal reminder, armed when a MEAL is logged.
 *
 * Deliberately not called by the plain glucose-logging paths: a reading is a
 * measurement, not a meal, so noting a fasting or manual value must not start a
 * post-meal countdown the user never asked for. The timer has exactly two
 * deliberate sources - this (a meal record) and the "I started eating" button.
 *
 * Honors the saved preference (enabled + postMeal toggle), and no-ops if
 * disabled or permission is denied.
 */
export async function schedulePostMealReminder(): Promise<void> {
  const prefs = await getNotificationPrefs();
  if (!prefs.enabled || !prefs.postMeal) return;
  if (!(await ensureNotificationPermission())) return;
  await schedulePostMealAt({ minutes: prefs.postMealMinutes });
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
  if (!(await ensureNotificationPermission())) return null;
  await schedulePostMealAt({ minutes: prefs.postMealMinutes });
  return prefs.postMealMinutes;
}

/** What a post-meal window change did to the running timer. */
export type PostMealWindowChange =
  /** No timer was running; only future ones use the new window. */
  | "idle"
  /** A timer is running and now ends at the re-measured moment. */
  | "retimed"
  /** More than the new window had already passed: the timer was closed out. */
  | "elapsed";

/**
 * Re-measures a RUNNING post-meal timer after the user changes the window length
 * in Settings.
 *
 * The window belongs to the meal, not to the moment the preference changed: with
 * 10 min behind a 120 min timer, moving to 90 leaves 80 min - it does not leave
 * the countdown sitting on the old 120. The reminder is re-scheduled for the new
 * moment (which also renumbers its copy) and the Live Activity is restarted on
 * the new end, so the lock-screen countdown never disagrees with the app.
 *
 * When more than the new window has already passed the timer is over: the
 * pending reminder and the Live Activity are taken down and NOTHING fires. A
 * nudge arriving the instant a preference is changed would be noise, and the
 * moment it was meant to describe is gone.
 *
 * `previousWindowMin` is only needed for a timer armed before the start moment
 * was persisted; it recovers where that timer began.
 */
export async function applyPostMealWindowChange(
  nextWindowMin: number,
  previousWindowMin?: number
): Promise<PostMealWindowChange> {
  try {
    const endsAt = await getPostMealTimerEnd();
    if (endsAt == null) return "idle";
    const startedAt =
      (await readPostMealStart()) ??
      derivePostMealStart(endsAt, previousWindowMin ?? nextWindowMin);

    const next = retimePostMealWindow({
      startedAt,
      currentEndsAt: endsAt,
      nextWindowMin,
      now: Date.now(),
    });
    if (next.kind === "unchanged") return "retimed";
    if (next.kind === "elapsed") {
      await cancelPostMealTimer();
      return "elapsed";
    }
    // Non-prompting: a settings toggle must not raise an OS dialog. Without
    // permission there is nothing to re-arm, so the stale timer is taken down
    // rather than left pointing at the old moment.
    if (!(await hasNotificationPermission())) {
      await cancelPostMealTimer();
      return "elapsed";
    }
    await schedulePostMealAt({
      minutes: next.remainingMs / 60_000,
      windowMin: nextWindowMin,
      endsAt: next.endsAt,
      startedAt: next.startedAt,
    });
    return "retimed";
  } catch {
    // The running timer keeps its old moment; nothing is lost.
    return "idle";
  }
}

// ── User-initiated: re-measure follow-up after a low reading ────────────────

const LOWFOLLOW_ID = "zerospike-low-followup";

/**
 * Schedules a neutral 15-minute re-measure reminder. Offered (never automatic)
 * after the user logs a reading below their own threshold. Copy is descriptive,
 * with no diagnosis or alarm wording. Returns false if permission is denied.
 */
export async function scheduleLowFollowup(): Promise<boolean> {
  if (!(await ensureNotificationPermission())) return false;
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
      data: { route: "lowFollowup" satisfies NotificationRoute },
      ...reminderExtras,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: LOW_FOLLOWUP_MINUTES * 60,
      repeats: false,
    },
  });
  await rememberOneOffEnd("lowFollowup", Date.now() + LOW_FOLLOWUP_MINUTES * 60_000);
  return true;
}

// ── Language change ─────────────────────────────────────────────────────────

/**
 * Re-registers every reminder the app manages, so their copy follows the app
 * language.
 *
 * A scheduled notification carries the LITERAL text it was handed; the OS never
 * re-reads it. Switching language therefore left every already-armed reminder
 * speaking the previous one - the night-insulin nudge, the weekly summary, and
 * the post-meal check a user had running while they changed the setting. The
 * recurring ones are simply re-applied from the saved preferences; the one-off
 * ones are re-armed for the REMAINING time so their fire moment does not move.
 *
 * Best-effort and never throws: a failure leaves the old (still working, just
 * old-language) reminders in place.
 */
export async function rescheduleForLanguageChange(): Promise<void> {
  try {
    // The Android channel name is i18n too, and setting it again renames in place.
    await ensureAndroidChannel();
    await applyNotificationPrefs();

    const now = Date.now();

    // Post-meal check: its end time is already persisted, so re-arm for whatever
    // is left of it instead of restarting the countdown.
    const running = await getPostMealTimerState();
    if (running != null && running.endsAt - now >= 60_000) {
      await schedulePostMealAt({
        minutes: (running.endsAt - now) / 60_000,
        windowMin: Math.round((running.endsAt - running.startedAt) / 60_000),
        endsAt: running.endsAt,
        startedAt: running.startedAt,
      });
    }

    const ends = await readOneOffEnds();
    const kept: Partial<Record<OneOffKind, number>> = {};

    if (ends.lowFollowup != null && ends.lowFollowup > now) {
      const ok = await rearmOneOff(
        LOWFOLLOW_ID,
        (ends.lowFollowup - now) / 1000,
        {
          title: i18n.t("notifications.lowFollowTitle"),
          body: i18n.t("notifications.lowFollowBody"),
          data: { route: "lowFollowup" satisfies NotificationRoute },
          ...reminderExtras,
        }
      );
      if (ok) kept.lowFollowup = ends.lowFollowup;
    }

    if (ends.trial != null && ends.trial > now) {
      const ok = await rearmOneOff(TRIAL_ID, (ends.trial - now) / 1000, {
        title: i18n.t("notifications.trialTitle"),
        body: i18n.t("notifications.trialBody"),
        data: { route: "trial" satisfies NotificationRoute },
        ...androidChannel,
      });
      if (ok) kept.trial = ends.trial;
    }

    await AsyncStorage.setItem(ONEOFF_ENDS_KEY, JSON.stringify(kept));
  } catch {
    // best-effort; the previously scheduled reminders still fire as before
  }
}

/** Replaces one pending one-off with fresh copy, keeping its fire moment. */
async function rearmOneOff(
  identifier: string,
  secondsLeft: number,
  content: Notifications.NotificationContentInput
): Promise<boolean> {
  const seconds = Math.round(secondsLeft);
  if (seconds < 1) return false;
  try {
    await Notifications.cancelScheduledNotificationAsync(identifier);
  } catch {
    // nothing pending
  }
  try {
    await Notifications.scheduleNotificationAsync({
      identifier,
      content,
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds,
        repeats: false,
      },
    });
    return true;
  } catch {
    return false;
  }
}

