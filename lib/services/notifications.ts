import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import i18n from "../i18n";
import {
  getNotificationPrefs,
  type NotificationPrefs,
} from "./notificationPrefs";
import { formatGlucose, glucoseUnitLabel, hypoThreshold, LOW_FOLLOWUP_MINUTES } from "../glucose";
import { getProfile, listProfiles } from "../db/profiles";
import {
  applyLegacyRemindersBridge,
  listReminders,
} from "../db/reminders";
import type { Reminder, UserProfile } from "../db/types";
import { insulinModeOf, insulinModeShowsBasal } from "../insulinMode";
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
const MED_ID = "zerospike-med-reminder";
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
// Profile the running timer belongs to (audit finding B): a caregiver who
// starts the countdown on one profile and switches to another must not have it
// silently show/act as if it were the new profile's own timer. Absent on a
// timer armed before this field existed - readPostMealTimerProfile treats that
// the same as "no lock" (shows for whichever profile is active).
const POSTMEAL_TIMER_PROFILE_KEY = "zerospike.postMealTimerProfile";
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
// Mirrors AppContext's ACTIVE_PROFILE_KEY: the schedulers run outside React, so
// they resolve the active profile the same way the app bootstrap does.
const ACTIVE_PROFILE_KEY = "zerospike.activeProfile";

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
  | "med"
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
  // Scheduling has moved to the reminders registry (schema v17): a basal
  // reminder now lives under "zerospike-rem-<id>", not the fixed BASAL_ID
  // above. app/settings/profile.tsx calls this the moment a profile stops
  // showing basal insulin, so it has to reach whichever id space the pending
  // notification actually lives in - see applyReminders.
  await cancelReminderNotificationsOfType("basal");
}

/**
 * Daily oral-medication reminder. Neutral copy: it says the user asked to be
 * reminded, never what to take, how much, or when it is "due".
 */
export async function scheduleMedReminder(time: string): Promise<void> {
  await ensureAndroidChannel();
  await cancelMedReminder();
  const { hour, minute } = parseHHMM(time);
  await Notifications.scheduleNotificationAsync({
    identifier: MED_ID,
    content: {
      title: i18n.t("notifications.medTitle"),
      body: i18n.t("notifications.medBody"),
      data: { route: "med" satisfies NotificationRoute },
      ...reminderExtras,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute,
    },
  });
}

export async function cancelMedReminder(): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(MED_ID);
  } catch {
    // not scheduled - ignore
  }
  // See cancelBasalReminder above: app/settings/profile.tsx calls this when
  // oral-medication tracking is turned off, and the reminder it means to take
  // down now lives under "zerospike-rem-<id>".
  await cancelReminderNotificationsOfType("med");
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
  // See cancelBasalReminder above, for the same reason and the same id move.
  await cancelReminderNotificationsOfType("glucose");
}

// ── Reminders registry (schema v17) ─────────────────────────────────────────
// One table (lib/db/reminders.ts) now backs basal/med/glucose AND any number of
// user-defined custom reminders. applyReminders below reads it and is what
// applyNotificationPrefs actually calls; scheduleBasalReminder/scheduleMedReminder/
// scheduleGlucoseReminder above stay in place (their fixed ids are still torn
// down defensively - see cancelBasalReminder etc, and the bridge below) but are
// no longer wired into the apply flow.

/** Every reminder-registry notification carries this prefix, so a sweep can
 *  always tell "ours, and not backed by a row" apart from anything else. */
const REMINDER_ID_PREFIX = "zerospike-rem-";

function reminderIdentifier(id: string): string {
  return `${REMINDER_ID_PREFIX}${id}`;
}

/** The content for one reminder row. basal/med/glucose reuse the exact copy the
 *  fixed-id schedulers above already use; a custom reminder gets the shared
 *  "Reminder" title and the label the user gave it as the body. No route for a
 *  custom tap: there is no screen for it yet (next wave), and an unrecognised
 *  NotificationRoute is already a safe no-op on tap (see app/_layout.tsx). */
function reminderContent(row: Reminder): Notifications.NotificationContentInput {
  switch (row.type) {
    case "basal":
      return {
        title: i18n.t("notifications.basalTitle"),
        body: i18n.t("notifications.basalBody"),
        data: { route: "basal" satisfies NotificationRoute },
        ...reminderExtras,
      };
    case "med":
      return {
        title: i18n.t("notifications.medTitle"),
        body: i18n.t("notifications.medBody"),
        data: { route: "med" satisfies NotificationRoute },
        ...reminderExtras,
      };
    case "glucose":
      return {
        title: i18n.t("notifications.glucoseTitle"),
        body: i18n.t("notifications.glucoseBody"),
        data: { route: "glucose" satisfies NotificationRoute },
        ...reminderExtras,
      };
    case "custom":
    default:
      return {
        title: i18n.t("notifications.customTitle"),
        body: row.label ?? "",
        ...reminderExtras,
      };
  }
}

async function scheduleReminderRow(row: Reminder): Promise<void> {
  const { hour, minute } = parseHHMM(row.time);
  await Notifications.scheduleNotificationAsync({
    identifier: reminderIdentifier(row.id),
    content: reminderContent(row),
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute,
    },
  });
}

async function cancelReminderIdentifier(identifier: string): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(identifier);
  } catch {
    // not scheduled - ignore
  }
}

/** Cancels every currently-scheduled reminder-registry notification of one
 *  type, whatever row(s) it came from. Used by cancelBasalReminder /
 *  cancelMedReminder / cancelGlucoseReminder, which app/settings/profile.tsx
 *  calls directly when a profile stops showing basal insulin or oral
 *  medication - a live teardown, not a change to the stored row. */
async function cancelReminderNotificationsOfType(
  type: Reminder["type"]
): Promise<void> {
  try {
    const rows = await listReminders();
    for (const row of rows) {
      if (row.type === type) await cancelReminderIdentifier(reminderIdentifier(row.id));
    }
  } catch {
    // best-effort; a failed lookup must not throw out of a settings toggle
  }
}

/**
 * The one-time move of the legacy basal/med/glucose prefs into the reminders
 * table (lib/db/remindersBridge.ts), run at most once per process AND at most
 * once ever (app_meta-guarded - see bridgeLegacyReminders). The in-flight
 * promise is cached (not just a boolean) so two calls to applyNotificationPrefs
 * landing close together - app bootstrap and a profile switch, say - await the
 * SAME attempt instead of racing two inserts of the same rows.
 *
 * When this call is the one that actually bridges, the pre-registry fixed-id
 * notifications are cancelled: from here on the same reminder is scheduled
 * under its new "zerospike-rem-<id>" identifier (by applyReminders, called
 * right after this from applyNotificationPrefs), and leaving the old id armed
 * would fire the same reminder twice.
 */
let remindersBridgePromise: Promise<void> | null = null;

function ensureRemindersBridged(prefs: NotificationPrefs): Promise<void> {
  if (!remindersBridgePromise) {
    remindersBridgePromise = (async () => {
      try {
        const bridged = await applyLegacyRemindersBridge({
          basal: prefs.basal,
          basalTime: prefs.basalTime,
          med: prefs.med,
          medTime: prefs.medTime,
          glucose: prefs.glucose,
          glucoseTime: prefs.glucoseTime,
        });
        if (bridged) {
          await Promise.all([
            cancelBasalReminder(),
            cancelMedReminder(),
            cancelGlucoseReminder(),
          ]);
        }
      } catch {
        // best-effort: a failed bridge leaves the table empty and the legacy
        // schedule untouched, which is never worse than doing nothing; the
        // next launch tries again (remindersBridgePromise resets per process).
      }
    })();
  }
  return remindersBridgePromise;
}

/**
 * Applies the reminders registry: every row in lib/db/reminders.ts, scheduled
 * under "zerospike-rem-<id>" with a DAILY trigger, or cancelled when
 * `prefs.enabled` is off, permission is missing, the row itself is disabled, or
 * (basal/med only) the active profile's mode/oral-meds flag hides that surface
 * (glucose and custom carry no such gate). Also sweeps any
 * "zerospike-rem-"-prefixed notification that is still scheduled but no longer
 * backed by a row (a deleted reminder), so nothing leaks.
 *
 * Called unconditionally from applyNotificationPrefs, before it branches on
 * `prefs.enabled` / permission: this function does its own gating, so the
 * caller does not have to duplicate it.
 */
/** The pre-registry fixed ids (see BASAL_ID/MED_ID/GLUCOSE_ID above), still
 *  swept here defensively - see the note on the sweep below. */
const LEGACY_FIXED_IDS: readonly string[] = [BASAL_ID, MED_ID, GLUCOSE_ID];

export async function applyReminders(prefs: NotificationPrefs): Promise<void> {
  const granted = prefs.enabled && (await hasNotificationPermission());
  const rows = await listReminders();

  if (granted && rows.length > 0) await ensureAndroidChannel();

  const [showsBasal, showsMeds] = granted
    ? await Promise.all([activeProfileShowsBasal(), activeProfileShowsMeds()])
    : [false, false];

  const known = new Set<string>();
  for (const row of rows) {
    const identifier = reminderIdentifier(row.id);
    known.add(identifier);
    const gateOpen =
      row.type === "basal" ? showsBasal : row.type === "med" ? showsMeds : true;
    if (granted && row.enabled === 1 && gateOpen) {
      await scheduleReminderRow(row);
    } else {
      await cancelReminderIdentifier(identifier);
    }
  }

  // A row that was deleted still has to have its notification cancelled - the
  // delete itself (lib/db/reminders.ts) only removes the row, not the pending
  // OS notification. getAllScheduledNotificationsAsync is the only way to find
  // one that neither the loop above nor a normal cancel call would reach.
  //
  // The same pass also sweeps the pre-registry FIXED ids (BASAL_ID/MED_ID/
  // GLUCOSE_ID): ensureRemindersBridged only cancels those the one time it
  // actually performs the bridge, in a Promise.all that is not part of the
  // same DB transaction as the bridge insert - a process killed between the
  // two leaves the app_meta flag (and the seeded rows) committed but those
  // three legacy notifications still armed, and since the bridge is guarded to
  // run at most once ever, nothing would call cancelBasalReminder/etc again on
  // its behalf. Once the registry is what applyReminders schedules from, none
  // of these fixed ids should ever still be pending, so they are swept here
  // unconditionally alongside the orphaned "zerospike-rem-" ones.
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const n of scheduled) {
      if (n.identifier.startsWith(REMINDER_ID_PREFIX) && !known.has(n.identifier)) {
        await cancelReminderIdentifier(n.identifier);
      } else if (LEGACY_FIXED_IDS.includes(n.identifier)) {
        await cancelReminderIdentifier(n.identifier);
      }
    }
  } catch {
    // best-effort sweep; a failed listing must never break the apply
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
 * Drops a one-off's remembered fire moment. Cancelling without this left the
 * record behind, and rescheduleForLanguageChange re-arms anything still recorded
 * as pending - which would have resurrected a reminder the user just turned off.
 */
async function forgetOneOffEnd(kind: OneOffKind): Promise<void> {
  try {
    const all = await readOneOffEnds();
    if (all[kind] == null) return;
    delete all[kind];
    await AsyncStorage.setItem(ONEOFF_ENDS_KEY, JSON.stringify(all));
  } catch {
    // best-effort
  }
}

/**
 * The profile the schedulers work against. Read here rather than passed in, so
 * every path that re-applies preferences - Settings, onboarding, the language
 * change - resolves it the same way the app bootstrap does.
 */
async function readActiveProfile(): Promise<UserProfile | null> {
  const savedId = await AsyncStorage.getItem(ACTIVE_PROFILE_KEY);
  return (
    (savedId ? await getProfile(savedId) : null) ??
    (await listProfiles())[0] ??
    null
  );
}

/**
 * Whether the active profile's insulin mode includes long-acting insulin.
 *
 * The basal reminder is one of two scheduled surfaces tied to a per-profile
 * flag, while the preference behind it is device-level and defaults to ON. A
 * profile that says "no insulin" (or one switched to it later) would otherwise
 * keep a nightly insulin nudge armed with every insulin surface in the app
 * hidden.
 *
 * An unreadable profile keeps today's behaviour: a failed lookup must not
 * silently drop a reminder the user asked for.
 */
async function activeProfileShowsBasal(): Promise<boolean> {
  try {
    return insulinModeShowsBasal(insulinModeOf(await readActiveProfile()));
  } catch {
    return true;
  }
}

/**
 * Same guard for the oral-medication reminder: the preference is device-level,
 * the flag it belongs to is per-profile, so a profile that does not track pills
 * must not keep a daily pill nudge armed with every pill surface hidden.
 *
 * An unreadable profile keeps the reminder, for the reason above: a failed
 * lookup must not silently drop one the user turned on.
 */
async function activeProfileShowsMeds(): Promise<boolean> {
  try {
    const profile = await readActiveProfile();
    return profile == null || profile.oral_meds_enabled === 1;
  } catch {
    return true;
  }
}

/**
 * Applies the saved preferences: schedules the reminders-registry rows
 * (basal/medication/glucose/custom - see applyReminders) that are enabled and
 * cancels the rest, plus the weekly summary and the idle nudge. With the
 * master switch off (or permission denied) it cancels everything it manages.
 * Post-meal is event-driven (see schedulePostMealReminder) so it is not
 * touched here.
 *
 * NEVER prompts. This runs from background paths (app bootstrap, a profile
 * switch, a language change, a profile setting) where an OS permission dialog
 * would appear out of nowhere, so it only READS the permission. Asking is left
 * to the explicit user actions that earn it: the onboarding notification step,
 * the notification settings screen, and logging or starting a meal
 * (schedulePostMealReminder and startPostMealTimer prompt on their own path).
 */
export async function applyNotificationPrefs(
  prefs?: NotificationPrefs
): Promise<void> {
  const p = prefs ?? (await getNotificationPrefs());

  // One-time move of the pre-registry basal/med/glucose settings into the
  // reminders table; a no-op after the first call, this process or any other
  // (see ensureRemindersBridged).
  await ensureRemindersBridged(p);

  // applyReminders is unconditional and does its own gating (master switch,
  // permission, each row's own enabled flag, the profile gates) - the single
  // replacement for what used to be three separate schedule/cancel pairs here,
  // now covering basal/med/glucose AND any custom reminder in one pass.
  await applyReminders(p);

  // The master switch (and a revoked permission) also takes down the pending
  // post-meal check and its Live Activity. It is event-driven, so it is not
  // re-scheduled here - but leaving an armed one behind meant a user who turned
  // notifications OFF still got the countdown on their lock screen and the nudge
  // two hours later.
  if (!p.enabled) {
    await cancelWeeklySummary();
    await cancelPostMealTimer();
    await cancelIdleReminder();
    // The two one-offs are armed outside the preference screen (a low reading,
    // a started trial), so nothing else took them down: turning notifications
    // OFF still let a re-measure nudge and a trial reminder arrive days later.
    await cancelLowFollowup();
    await cancelTrialReminder();
    return;
  }

  const granted = await hasNotificationPermission();
  if (!granted) {
    await cancelWeeklySummary();
    await cancelPostMealTimer();
    await cancelIdleReminder();
    return;
  }

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

/**
 * Takes the trial reminder down. The reminder only makes sense while a trial is
 * still running towards its first charge, so a completed purchase (or the master
 * switch going off) must not leave a "your trial ends soon" nudge armed.
 */
export async function cancelTrialReminder(): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(TRIAL_ID);
  } catch {
    // nothing pending
  }
  await forgetOneOffEnd("trial");
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
  /** Profile the timer belongs to (see POSTMEAL_TIMER_PROFILE_KEY). Omitted by
   *  a re-arm that could not resolve one - the lock then stays open rather than
   *  guessing an owner. */
  profileId?: string;
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
    if (opts.profileId) {
      await AsyncStorage.multiSet([
        [POSTMEAL_TIMER_END_KEY, String(endsAt)],
        [POSTMEAL_TIMER_START_KEY, String(startedAt)],
        [POSTMEAL_TIMER_PROFILE_KEY, opts.profileId],
      ]);
    } else {
      await AsyncStorage.multiSet([
        [POSTMEAL_TIMER_END_KEY, String(endsAt)],
        [POSTMEAL_TIMER_START_KEY, String(startedAt)],
      ]);
      await AsyncStorage.removeItem(POSTMEAL_TIMER_PROFILE_KEY);
    }
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
  const profileId = (await readPostMealTimerProfile()) ?? undefined;
  const startedAt = await readPostMealStart();
  if (startedAt != null && startedAt < endsAt) return { startedAt, endsAt, profileId };
  const prefs = await getNotificationPrefs();
  return { startedAt: derivePostMealStart(endsAt, prefs.postMealMinutes), endsAt, profileId };
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

async function readPostMealTimerProfile(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(POSTMEAL_TIMER_PROFILE_KEY);
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
      POSTMEAL_TIMER_PROFILE_KEY,
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
      POSTMEAL_TIMER_PROFILE_KEY,
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
  const profile = await readActiveProfile();
  await schedulePostMealAt({ minutes: prefs.postMealMinutes, profileId: profile?.id });
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
  const profile = await readActiveProfile();
  await schedulePostMealAt({ minutes: prefs.postMealMinutes, profileId: profile?.id });
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
    // Preserve the running timer's own owner: a Settings change must not hand
    // an already-armed timer to whichever profile happens to be active when the
    // preference is edited.
    await schedulePostMealAt({
      minutes: next.remainingMs / 60_000,
      windowMin: nextWindowMin,
      endsAt: next.endsAt,
      startedAt: next.startedAt,
      profileId: (await readPostMealTimerProfile()) ?? undefined,
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
 * The threshold that decides whether a just-logged reading offers the low
 * follow-up reminder (see maybeOfferLowFollowup in app/(tabs)/index.tsx).
 *
 * UX#1: this used to be its own separate setting (NotificationPrefs.lowThresholdMgdl,
 * picked from a fixed list of mg/dL values), which could quietly disagree with the
 * active profile's own low threshold - the number classifyGlucose (lib/glucose.ts)
 * already uses to call a reading "low" everywhere else in the app. There is now
 * exactly one low threshold; NotificationPrefs.lowThresholdMgdl is kept only so an
 * already-stored value still parses, and is no longer read.
 *
 * An unreadable profile falls back to hypoThreshold's own default (70 mg/dL), for
 * the same reason the other readActiveProfile() callers below do: a failed lookup
 * must not silently withhold an offer the user would otherwise get.
 */
export async function lowFollowupThresholdMgdl(): Promise<number> {
  return hypoThreshold((await readActiveProfile()) ?? {});
}

/**
 * Schedules a neutral 15-minute re-measure reminder. Offered (never automatic)
 * after the user logs a reading below their own threshold. Copy is descriptive,
 * with no diagnosis or alarm wording. Returns false when the master switch is
 * off or permission is denied.
 *
 * The master switch is checked here because this is the one scheduler reached
 * without going through applyNotificationPrefs: an explicit tap must still not
 * arm a reminder for someone who turned every notification off.
 */
export async function scheduleLowFollowup(): Promise<boolean> {
  const prefs = await getNotificationPrefs();
  if (!prefs.enabled) return false;
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

/** Takes a pending re-measure reminder down and forgets its fire moment. */
export async function cancelLowFollowup(): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(LOWFOLLOW_ID);
  } catch {
    // nothing pending
  }
  await forgetOneOffEnd("lowFollowup");
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
        profileId: running.profileId,
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

