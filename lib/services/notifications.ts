import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import i18n from "../i18n";
import { logCrash, logEvent } from "../analytics";
import {
  TRIAL_NUDGE_DELAY_MS,
  TRIAL_REMINDER_LEAD_DAYS,
  trialReminderFireAt,
} from "../trialTimeline";
import {
  getNotificationPrefs,
  type NotificationPrefs,
} from "./notificationPrefs";
import { formatGlucose, glucoseUnitLabel, hypoThreshold, LOW_FOLLOWUP_MINUTES } from "../glucose";
import { getProfile, listProfiles } from "../db/profiles";
import {
  applyLegacyRemindersBridge,
  dedupeBasalReminderRows,
  listReminders,
} from "../db/reminders";
import type { Reminder, UserProfile } from "../db/types";
import { insulinModeOf, insulinModeShowsBasal } from "../insulinMode";
import {
  endPostMealActivity,
  startPostMealActivity,
} from "../../modules/zerospike-live-activity";
import {
  cancelAlarm,
  getAlarmAuthorizationStatus,
  isAlarmKitAvailable,
  listScheduledAlarmIds,
  requestAlarmAuthorization,
  scheduleDailyAlarm,
  scheduleOneShotAlarm,
  type AlarmRoute,
} from "../../modules/zerospike-alarmkit";
import { reminderDelivery, shouldUseAlarm } from "../alarmSelect";
import { reminderAlarmTitle } from "../reminderLabel";
import {
  derivePostMealStart,
  decidePostMealAutoStart,
  postMealWindowSpanMinutes,
  restartPostMealWindowAt,
  startPostMealLate,
  isExactTimingError,
  postMealTimingNotice,
  POST_MEAL_WINDOW_MIN,
  type PostMealTimerWindow,
} from "../postMealTimer";

const BASAL_ID = "zerospike-basal-reminder";
const MED_ID = "zerospike-med-reminder";
const GLUCOSE_ID = "zerospike-glucose-reminder";
const WEEKLY_ID = "zerospike-weekly-summary";
const TRIAL_ID = "zerospike-trial-ending";
const TRIAL_NUDGE_ID = "zerospike-trial-day1-nudge";
// One fixed id for the post-meal check, so the meal-log auto reminder and the
// "I started eating" button can never stack two notifications at the same time
// (re-scheduling with the same id replaces the pending one).
const POSTMEAL_ID = "zerospike-postmeal-reminder";
// End time (epoch ms) of the pending post-meal reminder, persisted so the
// dashboard button can disable itself and show a live countdown. Written by the
// service on every successful schedule (button OR the automatic paths) so the
// countdown always matches the real notification.
const POSTMEAL_TIMER_END_KEY = "zerospike.postMealTimerEnd";
// The moment that same timer was ARMED. Persisted alongside the end so the
// elapsed bar and the "x min window" label are drawn from the timer's OWN span
// rather than re-derived from the fixed window, which is what keeps a
// backdated start ("I started eating a while ago") honest. A timer armed by an
// older build has no start recorded; it is derived from the end and the fixed
// window (POST_MEAL_WINDOW_MIN).
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
 * Android channel ids. Channels are IMMUTABLE once created - importance,
 * sound and vibration can never be changed on an existing id, only the
 * display NAME can - so giving the reminders channel a custom sound (see
 * assets/sounds/reminder.wav) meant moving to a new id rather than updating
 * "reminders" in place. Named constants so the cleanup below and the
 * reliability check (checkReminderReliability) can't drift from what
 * ensureAndroidChannel actually creates.
 */
const REMINDER_CHANNEL_ID = "reminders-v2";
const LEGACY_REMINDER_CHANNEL_ID = "reminders";
// High-priority channel for the low-value follow-up measurement reminder only
// (see scheduleLowFollowup) - every other reminder stays on REMINDER_CHANNEL_ID.
// Same immutability rule applies: importance/sound are fixed at creation.
const FOLLOWUP_CHANNEL_ID = "followup-v1";
// Silent, low-importance channel for the Android post-meal countdown surface
// (modules/zerospike-live-activity's PostMealNotification.kt posts to this id
// directly, not through this file's own scheduleNotificationAsync calls - see
// that module). IMPORTANCE_LOW: a countdown is a passive glance, never a
// sound - the alarm/notification that actually fires at zero still uses
// REMINDER_CHANNEL_ID via POSTMEAL_ID, untouched by this one.
const POSTMEAL_CHANNEL_ID = "postmeal-v1";

/**
 * Ensures the Android reminders channel exists, named from i18n and carrying
 * the custom reminder.wav sound. Called on every schedule (not cached) so the
 * channel name follows the app language; re-calling with the same id updates
 * the name in place (sound/importance cannot change post-creation, but they
 * are already right from the id's first creation).
 *
 * Also called EAGERLY on app launch (see app/_layout.tsx), before any
 * reminder is ever scheduled and regardless of OS permission: a channel that
 * is only created the first time something gets scheduled left system
 * Settings > App > Notifications showing no entry at all for a user who
 * denied the permission (or never reached the prompt) - see the permission
 * flow fixed below.
 */
const LED_COLOR = "#22d3ee"; // theme-ok

export async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
    name: i18n.t("notifications.channelName"),
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: LED_COLOR,
    sound: "reminder.wav",
  });
  // Separate MAX-importance (heads-up) channel for the low-value follow-up
  // measurement reminder only - see scheduleLowFollowup. Not bypassDnd: it
  // does not skip Do Not Disturb, only surfaces prominently when notifications
  // are allowed through.
  await Notifications.setNotificationChannelAsync(FOLLOWUP_CHANNEL_ID, {
    name: i18n.t("notifications.channelName"),
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: LED_COLOR,
    sound: "reminder.wav",
  });
  // Post-meal countdown channel (C1): LOW importance, no sound/vibration -
  // the countdown itself must never make noise. Created here too (not only
  // lazily by the native module) so it shows up in system settings from
  // first launch, same reasoning as the two channels above.
  await Notifications.setNotificationChannelAsync(POSTMEAL_CHANNEL_ID, {
    name: i18n.t("notifications.channelName"),
    importance: Notifications.AndroidImportance.LOW,
    sound: null,
  });
  // One-time-per-device sweep of the old sound-less channel. Harmless to
  // retry on every call (deleting an already-gone channel is a no-op), and
  // this is the only path that runs early enough (app launch) to also catch
  // a device that never schedules anything after upgrading.
  try {
    await Notifications.deleteNotificationChannelAsync(LEGACY_REMINDER_CHANNEL_ID);
  } catch (err) {
    // A channel that never existed is a no-op, so an error here is unexpected,
    // but the sweep is best-effort and retries on the next call.
    logCrash(err, { service: "notifications", op: "deleteLegacyChannel" });
  }
}

/** Category id for the basal reminder's own quick action (see
 *  ensureNotificationCategories below); the notification content that uses
 *  it sets categoryIdentifier to this same string. */
export const BASAL_CATEGORY_ID = "basal";

/** actionIdentifier a NotificationResponse carries when the basal reminder's
 *  quick action ("I already did it") was the one tapped, rather than the
 *  notification body itself - see app/_layout.tsx's response listener, which
 *  sends the two cases to different steps of app/basal-confirm.tsx. */
export const BASAL_DONE_ACTION_ID = "basal_done";

/**
 * Registers the basal reminder's one quick-action category: tapping it opens
 * app/basal-confirm.tsx straight on the site-picking step instead of the
 * plain confirm question. Cross-platform (unlike ensureAndroidChannel, this
 * is not behind a Platform.OS guard - iOS reads categoryIdentifier directly,
 * Android surfaces the action too), and called from the same two places as
 * ensureAndroidChannel: eagerly on every cold start (app/_layout.tsx) and
 * again on a language change (rescheduleForLanguageChange below), since the
 * button's own title is translated. Re-registering with the same identifier
 * replaces the category in place.
 */
export async function ensureNotificationCategories(): Promise<void> {
  try {
    await Notifications.setNotificationCategoryAsync(BASAL_CATEGORY_ID, [
      {
        identifier: BASAL_DONE_ACTION_ID,
        buttonTitle: i18n.t("basalConfirm.doneAction"),
        options: { opensAppToForeground: true },
      },
    ]);
  } catch (err) {
    // best-effort, like ensureAndroidChannel's own channel calls
    logCrash(err, { service: "notifications", op: "registerCategories" });
  }
}

const androidChannel =
  Platform.OS === "android" ? { channelId: REMINDER_CHANNEL_ID } : {};

/** Android channel for the low-value follow-up measurement reminder only (see
 *  FOLLOWUP_CHANNEL_ID / scheduleLowFollowup) - every other reminder keeps
 *  androidChannel above. */
const followupAndroidChannel =
  Platform.OS === "android" ? { channelId: FOLLOWUP_CHANNEL_ID } : {};

/**
 * Custom sound (assets/sounds/reminder.wav), wired through the
 * expo-notifications config plugin's `sounds` array. iOS reads the filename
 * straight off the notification content; Android's sound is fixed at
 * channel-creation time above, and a content-level sound field there is
 * ignored on API 26+ (this app's minSdkVersion), so nothing else is needed
 * for Android beyond the channelId.
 */
const iosSound = Platform.OS === "ios" ? { sound: "reminder.wav" as const } : {};

// iOS Time-Sensitive interruption level: breaks through Focus / silent and
// surfaces prominently, while staying a NEUTRAL reminder. This is NOT a
// critical alert (no com.apple.developer.usernotifications.critical
// entitlement - that carries medical-device risk and is deliberately avoided).
// Time-Sensitive needs the com.apple.developer.usernotifications.time-sensitive
// entitlement to break Focus; without it iOS silently downgrades to 'active'.
// Scoped to ONLY the low-value follow-up measurement reminder (see
// lowFollowupExtras below) - every other reminder deliberately stays at the
// default level. See docs/native-live-surfaces.md.
const IOS_TIME_SENSITIVE =
  Platform.OS === "ios" ? { interruptionLevel: "timeSensitive" as const } : {};

/** Content extras for a regular scheduled reminder (Android reminders-v2
 *  channel + the custom sound). Used by most schedulers below; the low-value
 *  follow-up measurement reminder uses lowFollowupExtras instead. */
const reminderExtras = { ...androidChannel, ...iosSound };

/** Content extras for the low-value follow-up measurement reminder only: its
 *  own high-priority Android channel (FOLLOWUP_CHANNEL_ID) + the custom sound
 *  + iOS Time-Sensitive. No other reminder uses this. */
const lowFollowupExtras = {
  ...followupAndroidChannel,
  ...iosSound,
  ...IOS_TIME_SENSITIVE,
};

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
  /** The one-off "connect Health" nudge a day into a trial. */
  | "trialNudge"
  | "idle"
  /** A user-defined reminder. Opens the dashboard and NOTHING else: the app
   *  does not know what a custom reminder is about, so picking a form for it
   *  would be a guess (2.3.0's K2-B). */
  | "custom";

/**
 * The real outcome of asking for notification permission, so the UI can tell the
 * truth instead of pretending a denied prompt was granted:
 *  - granted:           the user allowed notifications
 *  - denied:            the user said no, but the OS will still show its own
 *                        prompt again if asked (canAskAgain=true - Android's
 *                        one extra chance before a refusal becomes permanent)
 *  - deniedPermanently: the user said no and the OS will NOT prompt again
 *                        (canAskAgain=false - iOS after its single ask, or
 *                        Android's second refusal / "don't ask again"). Only
 *                        this state has to route through system settings.
 *  - undetermined:      never asked / the prompt was dismissed without a choice
 *  - unavailable:       we could not ask at all (the probe itself threw). This
 *                        is reported honestly rather than being swallowed as a
 *                        false.
 */
export type NotificationPermission =
  | "granted"
  | "denied"
  | "deniedPermanently"
  | "undetermined"
  | "unavailable";

/**
 * Requests notification permission and reports the real outcome. Never throws;
 * a probe that fails is reported as "unavailable" (not silently as a denial), so
 * onboarding and Settings can show an accurate status and a route into system
 * settings.
 *
 * Only calls the native prompt when the OS can actually still show one
 * (undetermined, or denied with canAskAgain=true). A denial that has already
 * lost that chance would make requestPermissionsAsync return the same denied
 * status with no dialog at all, so reading canAskAgain first - rather than
 * calling it unconditionally like before - is not just an optimisation: it is
 * what tells "the OS will still ask again" apart from "only system settings can
 * fix this" for the caller. Without that split, retrying from Settings after an
 * Android first refusal silently skipped the native prompt Android was still
 * willing to show and jumped straight to the system settings screen instead.
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
    if (settings.status === "granted") return "granted";
    if (settings.status === "denied" && !settings.canAskAgain) return "deniedPermanently";

    const req = await Notifications.requestPermissionsAsync();
    if (req.status === "granted") return "granted";
    if (req.status === "denied") return req.canAskAgain ? "denied" : "deniedPermanently";
    return "undetermined";
  } catch (err) {
    logCrash(err, { service: "notifications", op: "requestPermission" });
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
  } catch (err) {
    logCrash(err, { service: "notifications", op: "hasPermission" });
    return false;
  }
}

/**
 * Reads the current permission WITHOUT prompting, for a status row that is shown
 * independently of the app's own notification toggle. Same five honest states as
 * the request path, including the canAskAgain-derived split between a denial the
 * OS will still prompt for and one only system settings can undo.
 */
export async function getNotificationPermission(): Promise<NotificationPermission> {
  try {
    const settings = await Notifications.getPermissionsAsync();
    if (settings.status === "granted") return "granted";
    if (settings.status === "denied") {
      return settings.canAskAgain ? "denied" : "deniedPermanently";
    }
    return "undetermined";
  } catch (err) {
    logCrash(err, { service: "notifications", op: "readPermission" });
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

    const channel = await Notifications.getNotificationChannelAsync(REMINDER_CHANNEL_ID);
    if (channel && channel.importance < Notifications.AndroidImportance.DEFAULT) {
      result.channelLimited = true;
    }
    const api = Device.platformApiLevel ?? 0;
    result.exactAlarmUnknown = api >= 31;
  } catch (err) {
    // A failed probe must never be reported as a problem with the user's setup.
    logCrash(err, { service: "notifications", op: "reliabilityProbe" });
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
      categoryIdentifier: BASAL_CATEGORY_ID,
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
  } catch (err) {
    // not scheduled - ignore
    logCrash(err, { service: "notifications", op: "cancelBasal" });
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
  } catch (err) {
    // not scheduled - ignore
    logCrash(err, { service: "notifications", op: "cancelMed" });
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
  } catch (err) {
    // not scheduled - ignore
    logCrash(err, { service: "notifications", op: "cancelGlucose" });
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

/** The reverse of reminderIdentifier above: the reminder row id encoded in a
 *  "zerospike-rem-<id>" notification identifier, or null when the string
 *  carries no such id (a fixed-id legacy notification, or nothing at all -
 *  see app/basal-confirm.tsx, whose reminderId param is resolved this way in
 *  app/_layout.tsx's response listener). */
export function parseReminderIdentifier(
  identifier: string | null | undefined
): string | null {
  if (!identifier || !identifier.startsWith(REMINDER_ID_PREFIX)) return null;
  return identifier.slice(REMINDER_ID_PREFIX.length);
}

/** Every AlarmKit alarm this app schedules carries this prefix (2.2.0's A1),
 *  the exact same convention as REMINDER_ID_PREFIX above - see
 *  modules/zerospike-alarmkit, which only ever sees this already-prefixed
 *  string and applies no naming convention of its own. */
const ALARM_ID_PREFIX = "zerospike-alarm-";

function alarmIdentifier(id: string): string {
  return `${ALARM_ID_PREFIX}${id}`;
}

/** The reverse of alarmIdentifier above, exactly as parseReminderIdentifier is
 *  the reverse of reminderIdentifier: the reminder row id encoded in a
 *  "zerospike-alarm-<id>" identity string, or null when the string carries no
 *  such id. app/_layout.tsx runs an "Open"ed alarm's identity through this so a
 *  ringing reminder opens ITS OWN row (see takePendingAlarmContext in
 *  modules/zerospike-alarmkit), instead of the row that best matches the clock.
 *
 *  POSTMEAL_ALARM_ID below shares the prefix but is not a row id, so this
 *  returns its fixed "postmeal" suffix - harmless, since that alarm routes to
 *  the dashboard, which never reads a reminder id. */
export function parseAlarmIdentifier(
  identifier: string | null | undefined
): string | null {
  if (!identifier || !identifier.startsWith(ALARM_ID_PREFIX)) return null;
  const id = identifier.slice(ALARM_ID_PREFIX.length);
  return id.length > 0 ? id : null;
}

/** The post-meal countdown's own alarm identity (2.3.0's B). Same prefix as
 *  every reminder row's alarm, but a FIXED suffix rather than a row id - the
 *  countdown is a single device-wide timer, exactly like POSTMEAL_ID is on the
 *  notification side. applyReminders' orphan sweep skips it for that reason:
 *  no reminder row will ever claim it. */
const POSTMEAL_ALARM_ID = `${ALARM_ID_PREFIX}postmeal`;

/** The alarm's own on-screen title - just the text, unlike reminderContent
 *  below (which also carries Android channel/sound extras an AlarmKit alarm
 *  has no use for).
 *
 *  DELIBERATELY shorter than the notification title for the same row: AlarmKit's
 *  compact presentations clip hard (device QA caught "Glikoz olcu..." in the
 *  Dynamic Island), and the width is the OS's to decide, not ours. Which key -
 *  and when the user's own text is used untouched instead - is decided by
 *  reminderAlarmTitle in lib/reminderLabel.ts, so the policy is pinned by
 *  scripts/reminderLabel.test.ts rather than living inside this service.
 *
 *  Language changes need no special handling either way. A row whose STORED
 *  name fits the compact budget is passed through as text, and a stored name
 *  deliberately does not follow the app language (the same rule every other
 *  surface applies to a name the user has made their own). A row that falls
 *  back returns a KEY, resolved through i18n.t on every call - so the
 *  language-change re-arm (rescheduleForLanguageChange ->
 *  applyNotificationPrefs -> applyReminders) re-schedules it with the new
 *  language's noun. */
function reminderAlarmLabel(row: Reminder): string {
  const source = reminderAlarmTitle(row.type, row.label);
  return source.kind === "text" ? source.text : i18n.t(source.key);
}

/** Where a ringing alarm's "Open" button lands (2.3.0's K2-B). Deliberately the
 *  same value the SAME reminder's notification carries in its payload (see
 *  reminderContent below), so the two deliveries can never route differently. */
function reminderAlarmRoute(row: Reminder): AlarmRoute {
  switch (row.type) {
    case "basal":
      return "basal";
    case "med":
      return "med";
    case "glucose":
      return "glucose";
    case "custom":
    default:
      return "custom";
  }
}

/** The content for one reminder row. basal/med/glucose reuse the exact copy the
 *  fixed-id schedulers above already use; a custom reminder gets the shared
 *  "Reminder" title and the label the user gave it as the body, and routes to
 *  the dashboard with no sheet (2.3.0's K2-B) - the app cannot know what the
 *  user's own reminder is about, so opening a specific form would be a guess,
 *  while dropping the tap on whatever screen was last open was worse.
 *
 *  TITLE / BODY SPLIT (ZS-NOTIF). A banner clips the TITLE hard and long before
 *  it clips the body, and the title is the one line every presentation shows -
 *  so every title here is a short, STATIC category noun ("Olcum zamani", "Ilac
 *  zamani"), and everything that varies per row goes in the body instead. The
 *  row's own name leads that body ("Aksam olcumu. Kan sekerinizi olcme
 *  zamani."), because a clipped body still has to say WHICH reminder rang: a
 *  device with four measurement rows used to deliver four identical
 *  notifications, since the name was carried nowhere at all.
 *
 *  A name is only ever the user's (or the ready-made layout's) own text, so it
 *  is interpolated, never concatenated - i18next runs with escapeValue false
 *  (lib/i18n/index.ts), which is what keeps an apostrophe in "Anne'nin ilaci"
 *  from arriving as an HTML entity. */
function reminderContent(row: Reminder): Notifications.NotificationContentInput {
  const label = row.label?.trim();
  switch (row.type) {
    case "basal":
      // The one type with no per-row name (see resolveReminderLabel in
      // lib/reminderLabel.ts), so there is nothing to lead the body with.
      return {
        title: i18n.t("notifications.basalTitle"),
        body: i18n.t("notifications.basalBody"),
        data: { route: "basal" satisfies NotificationRoute },
        categoryIdentifier: BASAL_CATEGORY_ID,
        ...reminderExtras,
      };
    case "med":
      return {
        title: i18n.t("notifications.medTitle"),
        body: label
          ? i18n.t("notifications.medBodyNamed", { label })
          : i18n.t("notifications.medBody"),
        data: { route: "med" satisfies NotificationRoute },
        ...reminderExtras,
      };
    case "glucose":
      return {
        title: i18n.t("notifications.glucoseTitle"),
        body: label
          ? i18n.t("notifications.glucoseBodyNamed", { label })
          : i18n.t("notifications.glucoseBody"),
        data: { route: "glucose" satisfies NotificationRoute },
        ...reminderExtras,
      };
    case "custom":
    default:
      // A custom row is supposed to be named, but a row whose name was cleared
      // used to deliver an EMPTY body under a generic title - nothing at all to
      // read. The fallback sentence is the floor for that case.
      return {
        title: i18n.t("notifications.customTitle"),
        body: label || i18n.t("notifications.customBody"),
        data: { route: "custom" satisfies NotificationRoute },
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
  } catch (err) {
    // not scheduled - ignore
    logCrash(err, { service: "notifications", op: "cancelReminder" });
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
      if (row.type !== type) continue;
      await cancelReminderIdentifier(reminderIdentifier(row.id));
      // A row can be firing as a real AlarmKit alarm instead of a notification
      // (applyReminders' useAlarm branch) - a profile-screen teardown (basal
      // insulin off, oral meds off) has to take that down too, or the alarm
      // keeps ringing on a surface the profile no longer shows.
      await cancelAlarm(alarmIdentifier(row.id));
    }
  } catch (err) {
    // best-effort; a failed lookup must not throw out of a settings toggle
    logCrash(err, { service: "notifications", op: "cancelByType" });
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
        // Schema v19: whoever seeded rows here owns them. Resolved the same
        // way applyReminders below resolves its own profile, so a row this
        // bridge creates (only possible the very first time it ever runs, on
        // a device with no reminders row at all yet) is never left orphaned
        // for adoptOrphanReminders to have to pick up later.
        const profile = await readActiveProfile().catch((err) => {
          logCrash(err, { service: "notifications", op: "bridgeProfile" });
          return null;
        });
        const bridged = await applyLegacyRemindersBridge(
          {
            basal: prefs.basal,
            basalTime: prefs.basalTime,
            med: prefs.med,
            medTime: prefs.medTime,
            glucose: prefs.glucose,
            glucoseTime: prefs.glucoseTime,
          },
          profile?.id
        );
        if (bridged) {
          await Promise.all([
            cancelBasalReminder(),
            cancelMedReminder(),
            cancelGlucoseReminder(),
          ]);
        }
      } catch (err) {
        logCrash(err, { service: "notifications", op: "remindersBridge" });
        // best-effort: a failed bridge leaves the table empty and the legacy
        // schedule untouched, which is never worse than doing nothing; the
        // next launch tries again (remindersBridgePromise resets per process).
      }
    })();
  }
  return remindersBridgePromise;
}

/**
 * Applies the reminders registry: ONLY the active profile's rows in
 * lib/db/reminders.ts (schema v19 - see that file's own doc comment), scheduled
 * under "zerospike-rem-<id>" with a DAILY trigger, or cancelled when
 * `prefs.enabled` is off, permission is missing, the row itself is disabled, or
 * (basal/med only) the active profile's mode/oral-meds flag hides that surface
 * (glucose and custom carry no such gate). Also sweeps any
 * "zerospike-rem-"-prefixed notification that is still scheduled but no longer
 * backed by a row FOR THIS PROFILE - a deleted reminder, or (this is what makes
 * a profile switch remove the other profile's notifications with no extra
 * code) any row that belongs to a DIFFERENT profile, since `known` below is
 * built only from the rows this pass just listed for the active one.
 *
 * 2.2.0's A1: an otherwise-active row with alarm_enabled=1 gets a real AlarmKit
 * alarm ("zerospike-alarm-<id>") INSTEAD of the notification, but only once
 * shouldUseAlarm (lib/alarmSelect.ts) also confirms AlarmKit is available AND
 * authorized - never both at once, and never on a row this pass would not
 * otherwise have scheduled at all. The alarm side gets the exact same orphan
 * sweep as the notification side, off listScheduledAlarmIds() instead of
 * getAllScheduledNotificationsAsync().
 *
 * 2.3.0: alarm_enabled is now the DEFAULT for every row (schema v21), so on an
 * authorized iOS 26 device the alarm branch is the ordinary case and the
 * notification branch is what a user opted into. The logic below is unchanged
 * by that - the same three-way AND, the same never-both rule, the same
 * fallback to a notification whenever anything is missing - only how many rows
 * take which branch has moved.
 *
 * Called unconditionally from applyNotificationPrefs, before it branches on
 * `prefs.enabled` / permission: this function does its own gating, so the
 * caller does not have to duplicate it.
 */
/** The pre-registry fixed ids (see BASAL_ID/MED_ID/GLUCOSE_ID above), still
 *  swept here defensively - see the note on the sweep below. */
const LEGACY_FIXED_IDS: readonly string[] = [BASAL_ID, MED_ID, GLUCOSE_ID];

export async function applyReminders(prefs: NotificationPrefs): Promise<void> {
  // Resolved ONCE and reused for the profile id, the basal gate and the meds
  // gate below, instead of three independent (and previously redundant)
  // profile lookups. An unreadable active profile leaves whatever is already
  // scheduled untouched rather than risk tearing every reminder down over a
  // transient AsyncStorage/DB failure.
  let profile: UserProfile | null;
  try {
    profile = await readActiveProfile();
  } catch (err) {
    logCrash(err, { service: "notifications", op: "applyRemindersProfile" });
    return;
  }
  const profileId = profile?.id;

  // Self-heals a device that already has two "basal" rows for this profile
  // (see dedupeBasalReminderRows in lib/db/reminders.ts) on every apply pass,
  // not just the onboarding/profile-setup paths that call syncBasalReminderRow
  // - this is what actually reaches a device that already shipped the bug.
  await dedupeBasalReminderRows(profileId);
  // K3-2: the master switch and the OS notification permission are no longer
  // one flat gate. The master switch is the user's own "no" and still applies to
  // everything; the notification permission only decides whether a row that is
  // delivered as a NOTIFICATION can be armed. An alarm is delivered by AlarmKit,
  // so a user who granted the alarm permission and refused notifications used to
  // have every reminder silently dropped here.
  const masterEnabled = prefs.enabled;
  const notificationPermission = await hasNotificationPermission();
  const rows = await listReminders(profileId);

  // Unconditional and cheap (a single setNotificationCategoryAsync call, no
  // permission needed) - re-registers the basal quick action on every apply
  // pass, which runs on every cold start via AppContext's launch effect. The
  // eager module-scope call in app/_layout.tsx fires before the user's own
  // saved language has loaded from AsyncStorage, so without this the category
  // button stayed in whatever language i18n started in until the next actual
  // language change (rescheduleForLanguageChange) fixed it.
  await ensureNotificationCategories();

  if (masterEnabled && notificationPermission && rows.length > 0) {
    await ensureAndroidChannel();
  }

  // Pure VISIBILITY gates now (does this profile use basal insulin / oral
  // meds), with no permission folded in - the delivery decision below applies
  // that per row, per mechanism.
  const showsBasal = insulinModeShowsBasal(insulinModeOf(profile));
  const showsMeds = profile == null || profile.oral_meds_enabled === 1;

  // AlarmKit (2.2.0's A1): resolved ONCE per pass, same as the two gates above -
  // every row below shares the exact same OS/authorization snapshot rather
  // than each re-checking it. `alarmAuthorized` folds `alarmKitAvailable` in
  // so a row can never read as "authorized" on a device that has no AlarmKit
  // at all (getAlarmAuthorizationStatus() already reports "unavailable"
  // there, but this keeps the two checks from ever being able to disagree).
  const alarmKitAvailable = isAlarmKitAvailable();
  const alarmAuthorized =
    alarmKitAvailable && getAlarmAuthorizationStatus() === "authorized";

  const known = new Set<string>();
  const knownAlarms = new Set<string>();
  for (const row of rows) {
    const identifier = reminderIdentifier(row.id);
    const alarmId = alarmIdentifier(row.id);
    known.add(identifier);
    const gateOpen =
      row.type === "basal" ? showsBasal : row.type === "med" ? showsMeds : true;
    // ONE decision, shared with every surface that draws this row
    // (lib/alarmSelect.ts): "none" means nothing is armed for it this pass,
    // which the reminders screen says out loud rather than leaving it looking
    // scheduled.
    const delivery = reminderDelivery({
      masterEnabled,
      rowEnabled: row.enabled === 1,
      visibilityGateOpen: gateOpen,
      alarmEnabled: row.alarm_enabled === 1,
      alarmKitAvailable,
      alarmAuthorized,
      notificationPermission,
    });
    const rowActive = delivery !== "none";
    const useAlarm = delivery === "alarm";

    if (useAlarm) {
      // Real alarm INSTEAD of the notification - never both (see
      // docs/alarmkit-2.2.0.md's "cift teslim olmaz"). A failed schedule
      // (an OS-side AlarmKit error; authorization being revoked mid-flight
      // instead routes through the `rowActive`-but-not-`useAlarm` branch
      // below, which explicitly cancels the alarm) falls back to the plain
      // notification rather than lose the reminder outright - safe from a
      // double delivery either way, since ZerospikeAlarmKitModule.swift
      // always cancels whatever was previously armed under this SAME id
      // before attempting the new schedule, win or lose.
      const { hour, minute } = parseHHMM(row.time);
      const armed = await scheduleDailyAlarm({
        id: alarmId,
        hour,
        minute,
        label: reminderAlarmLabel(row),
        stopLabel: i18n.t("reminders.alarmStopButton"),
        openLabel: i18n.t("reminders.alarmOpenButton"),
        route: reminderAlarmRoute(row),
      });
      if (armed) {
        knownAlarms.add(alarmId);
        await cancelReminderIdentifier(identifier);
      } else {
        await scheduleReminderRow(row);
        // Symmetry with the two branches below: this row is now delivered by a
        // notification, so anything still armed under its alarm id has to go.
        // The orphan sweep at the end would normally catch it, but that sweep
        // depends on listScheduledAlarmIds(), which degrades to an empty list
        // when AlarmKit's own read throws (see the module) - and the one thing
        // that must never happen is the same reminder both ringing and
        // dropping a notification.
        await cancelAlarm(alarmId);
      }
    } else if (rowActive) {
      await scheduleReminderRow(row);
      // Covers the alarm-toggled-off case: a row that used to opt in already
      // has an alarm armed under `alarmId`, and turning the switch back off
      // must take it down and fall back to the notification just scheduled
      // above - best-effort, a "nothing pending" cancel is the common case.
      await cancelAlarm(alarmId);
    } else {
      await cancelReminderIdentifier(identifier);
      await cancelAlarm(alarmId);
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
  } catch (err) {
    // best-effort sweep; a failed listing must never break the apply
    logCrash(err, { service: "notifications", op: "orphanSweep" });
  }

  // Orphaned-alarm sweep (2.2.0's A1), the exact same pattern as the
  // notification sweep above: any "zerospike-alarm-" id AlarmKit still holds
  // that this pass did NOT just arm for the active profile - a deleted row, a
  // row whose "Play as alarm" switch was turned off, or (what makes a profile
  // switch clean up the other profile's alarms with no extra code) any row
  // belonging to a different profile. listScheduledAlarmIds() (and cancelAlarm
  // below) are no-ops when AlarmKit is unavailable, so this never needs its
  // own guard for that case.
  //
  // The post-meal countdown is the ONE alarm this sweep must keep its hands
  // off: it shares the "zerospike-alarm-" prefix but belongs to no reminder
  // row, so `knownAlarms` can never contain it and an unguarded sweep would
  // silently kill a running timer on the next apply pass (a profile switch, a
  // settings save, app launch). Its own lifecycle is entirely in
  // schedulePostMealAt / cancelPostMealTimer / completePostMealTimer.
  for (const alarmId of listScheduledAlarmIds()) {
    if (alarmId === POSTMEAL_ALARM_ID) continue;
    if (!knownAlarms.has(alarmId)) await cancelAlarm(alarmId);
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
      ...iosSound,
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
  } catch (err) {
    // not scheduled - ignore
    logCrash(err, { service: "notifications", op: "cancelWeekly" });
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
  } catch (err) {
    logCrash(err, { service: "notifications", op: "readIdleEnd" });
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
  } catch (err) {
    // nothing pending
    logCrash(err, { service: "notifications", op: "rearmIdle" });
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
      ...iosSound,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: fireAt,
    },
  });
  try {
    await AsyncStorage.setItem(IDLE_END_KEY, String(fireAt));
  } catch (err) {
    // best-effort persistence
    logCrash(err, { service: "notifications", op: "writeIdleEnd" });
  }
}

export async function cancelIdleReminder(): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(IDLE_ID);
  } catch (err) {
    // nothing pending
    logCrash(err, { service: "notifications", op: "cancelIdle" });
  }
  try {
    await AsyncStorage.removeItem(IDLE_END_KEY);
  } catch (err) {
    // best-effort
    logCrash(err, { service: "notifications", op: "clearIdleEnd" });
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
  } catch (err) {
    // the reminder is a nudge; a failure must never surface in a logging flow
    logCrash(err, { service: "notifications", op: "noteJournalActivity" });
  }
}

// ── Pending one-off reminders, tracked so a language change can rewrite them ──

type OneOffKind = "lowFollowup" | "trial" | "trialNudge";

async function readOneOffEnds(): Promise<Partial<Record<OneOffKind, number>>> {
  try {
    const raw = await AsyncStorage.getItem(ONEOFF_ENDS_KEY);
    return raw ? (JSON.parse(raw) as Partial<Record<OneOffKind, number>>) : {};
  } catch (err) {
    logCrash(err, { service: "notifications", op: "readOneOffEnds" });
    return {};
  }
}

async function rememberOneOffEnd(kind: OneOffKind, endsAt: number): Promise<void> {
  try {
    const all = await readOneOffEnds();
    all[kind] = endsAt;
    await AsyncStorage.setItem(ONEOFF_ENDS_KEY, JSON.stringify(all));
  } catch (err) {
    // best-effort: without the record the reminder just keeps its old copy
    logCrash(err, { service: "notifications", op: "rememberOneOff", kind });
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
  } catch (err) {
    // best-effort
    logCrash(err, { service: "notifications", op: "forgetOneOff", kind });
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
 * Applies the saved preferences: schedules the reminders-registry rows
 * (basal/medication/glucose/custom - see applyReminders) that are enabled and
 * cancels the rest, plus the weekly summary and the idle nudge. With the
 * master switch off (or permission denied) it cancels everything it manages.
 * Post-meal is event-driven (see schedulePostMealReminder), so nothing is ever
 * ARMED for it here - only an already-running window has its delivery
 * reconciled (see reconcilePostMealDelivery).
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
    // Everything here is delivered as a NOTIFICATION and cannot survive without
    // the permission - except the post-meal countdown, which follows the same
    // per-mechanism rule as the reminder rows (K3-2): with its alarm preference
    // on and AlarmKit authorized it rings through AlarmKit, so cancelling it
    // here would take away a working countdown from a user who deliberately
    // chose alarms over notifications.
    await cancelWeeklySummary();
    await cancelIdleReminder();
    const alarmKit = isAlarmKitAvailable();
    const postMealRingsAsAlarm = shouldUseAlarm({
      alarmEnabled: p.postMealAlarm,
      alarmKitAvailable: alarmKit,
      alarmAuthorized: alarmKit && getAlarmAuthorizationStatus() === "authorized",
    });
    if (!postMealRingsAsAlarm) await cancelPostMealTimer();
    return;
  }

  // A running countdown that belongs to ANOTHER profile has no business on
  // this profile's lock screen: the dashboard card already hides it, and the
  // Live Activity was the one surface still telling the other profile's story.
  // Only the card is taken down - the countdown itself, its stored end and its
  // alarm stay exactly as they are, because the two hours belong to the MEAL
  // and to whoever ate it, not to whoever is holding the phone now (see the
  // known limits in docs/plan-2.3.0.md).
  await hidePostMealActivityForOtherProfile();

  // A countdown that is already running gets its delivery re-checked against
  // what this device can do right now - the one post-meal thing this function
  // touches, and only ever to keep an existing window deliverable. Placed here
  // so it inherits the permission just proved above.
  await reconcilePostMealDelivery(p);

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
 * Content of the trial-ending reminder, shared by the first arming and a
 * language-change re-arm. The lead is the same constant the timeline and the
 * scheduler use, so the copy can never name a different number than the one
 * that fires. `count` only picks the singular or plural wording.
 */
function trialEndingContent(): Notifications.NotificationContentInput {
  const days = TRIAL_REMINDER_LEAD_DAYS;
  return {
    title: i18n.t("notifications.trialTitle", { count: days, days }),
    body: i18n.t("notifications.trialBody"),
    data: { route: "trial" satisfies NotificationRoute },
    ...androidChannel,
    ...iosSound,
  };
}

/**
 * Local reminder scheduled TRIAL_REMINDER_LEAD_DAYS before a free trial
 * converts, so the end of the trial is never a surprise. One-off. The copy says
 * what carries on with Pro; the paywall timeline and Settings carry the way out.
 *
 * `trialEndsAt` is the store's own expiry (epoch ms), so the reminder follows the
 * real end of the trial. Nothing is armed when that leaves no room for a reminder
 * that still comes BEFORE the end, or when the app's own notification switch is
 * off (checked before anything is asked of the OS, so a muted app never raises
 * the permission prompt).
 */
export async function scheduleTrialEndingReminder(trialEndsAt: number): Promise<void> {
  const fireAt = trialReminderFireAt(trialEndsAt);
  if (!(fireAt - Date.now() >= 1000)) return;
  if (!(await getNotificationPrefs()).enabled) return;
  const granted = await ensureNotificationPermission();
  if (!granted) return;
  // The prompt can sit open for a while: the room left is measured again.
  const seconds = Math.floor((fireAt - Date.now()) / 1000);
  if (seconds < 1) return;
  await ensureAndroidChannel();
  await Notifications.scheduleNotificationAsync({
    identifier: TRIAL_ID,
    content: trialEndingContent(),
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds,
      repeats: false,
    },
  });
  await rememberOneOffEnd("trial", fireAt);
  logEvent("trial_reminder_scheduled", { days_before: TRIAL_REMINDER_LEAD_DAYS });
}

/** Content of the day-1 nudge, shared by the first arming and a language-change re-arm. */
function trialNudgeContent(): Notifications.NotificationContentInput {
  const health = i18n.t(
    Platform.OS === "ios" ? "settings.healthSection" : "settings.healthSectionAndroid"
  );
  return {
    title: i18n.t("notifications.trialNudgeTitle"),
    body: i18n.t("notifications.trialNudgeBody", { health }),
    data: { route: "trialNudge" satisfies NotificationRoute },
    ...androidChannel,
    ...iosSound,
  };
}

/**
 * One gentle nudge 24 hours into a trial, to bring in the Health history.
 * One-off. The caller decides whether it applies (Health usable on this device
 * and not connected yet, see shouldScheduleTrialNudge). Never prompts: it only
 * arms when notifications are on and permitted already.
 */
export async function scheduleTrialDay1Nudge(): Promise<void> {
  const prefs = await getNotificationPrefs();
  if (!prefs.enabled) return;
  if (!(await hasNotificationPermission())) return;
  await ensureAndroidChannel();
  await Notifications.scheduleNotificationAsync({
    identifier: TRIAL_NUDGE_ID,
    content: trialNudgeContent(),
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: TRIAL_NUDGE_DELAY_MS / 1000,
      repeats: false,
    },
  });
  await rememberOneOffEnd("trialNudge", Date.now() + TRIAL_NUDGE_DELAY_MS);
}

/** Takes the day-1 nudge down, e.g. once Health is connected. */
export async function cancelTrialDay1Nudge(): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(TRIAL_NUDGE_ID);
  } catch (err) {
    logCrash(err, { service: "notifications", op: "cancelTrialNudge" });
  }
  await forgetOneOffEnd("trialNudge");
}

/**
 * Reports the day-1 nudge once its fire time has passed. The OS delivers it
 * with the app closed, so the app can only notice afterwards: it is called on
 * launch and on every foreground. A nudge whose permission has since gone is
 * dropped without a report.
 */
export async function reportTrialNudgeIfDelivered(now: number = Date.now()): Promise<void> {
  try {
    const firedAt = (await readOneOffEnds()).trialNudge;
    if (firedAt == null || firedAt > now) return;
    await forgetOneOffEnd("trialNudge");
    if (await hasNotificationPermission()) logEvent("trial_day1_nudge_sent");
  } catch (err) {
    logCrash(err, { service: "notifications", op: "reportTrialNudge" });
  }
}

/**
 * Takes the trial reminder and the day-1 nudge down. Both only make sense while
 * a trial is still running towards its first charge, so a completed purchase (or
 * the master switch going off) must not leave either armed.
 */
export async function cancelTrialReminder(): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(TRIAL_ID);
  } catch (err) {
    logCrash(err, { service: "notifications", op: "cancelTrialReminder" });
  }
  await forgetOneOffEnd("trial");
  await cancelTrialDay1Nudge();
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
 *
 * 2.3.0's B: with NotificationPrefs.postMealAlarm on (the default) and AlarmKit
 * available AND authorized - the same shouldUseAlarm three-way AND applyReminders
 * uses, never a second decision of its own - the END of the window is armed as a
 * real AlarmKit alarm instead of a notification. Only the DELIVERY moves: the
 * persisted keys, the end moment, the dashboard card and the app's own
 * PostMealActivity Live Activity are identical in both modes (K2-F: the alarm is
 * alert-only, so the system never draws a countdown surface of its own). An
 * alarm that fails to arm for any reason falls back to the notification, so the
 * countdown is never lost, and the two are never both armed.
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
  /** Floor for the OS trigger, in seconds. 60 by default, because a FRESH
   *  countdown is never worth arming for less than a minute. A re-arm that only
   *  moves the DELIVERY of an already-running window (applyPostMealAlarmModeChange,
   *  reconcilePostMealDelivery) passes 1 instead: those keep the end moment they
   *  were given, so rounding what is left up to a minute would fire after the
   *  countdown already read 0 - and skipping them outright, as the mode change
   *  used to, left the last minute of a window with no delivery at all. */
  minSeconds?: number;
  /** Arm ONLY if no live countdown is stored, and never overwrite one that is
   *  (P17). Off by default: every ordinary path - the user's own "I started
   *  eating", a meal log, a re-anchor - is a deliberate act that SHOULD replace
   *  whatever is running. Only the undo of a delete opts in, because it is
   *  putting an OLD countdown back and must lose to anything newer.
   *
   *  Returns false when the slot was taken, having touched nothing at all. */
  claimIfIdle?: boolean;
  /** Filled in by the call: `deliveryMissed` is true when the countdown was
   *  kept but no reminder could be armed because Android's exact-timing
   *  permission is off. */
  result?: { deliveryMissed: boolean };
}): Promise<boolean> {
  const { minutes, windowMin = opts.minutes, minSeconds = 60 } = opts;
  const seconds = Math.max(minSeconds, Math.round(minutes * 60));

  // Resolved BEFORE the delivery branch: a one-shot alarm is armed for the
  // absolute end moment, so the end has to exist before the alarm is asked
  // for. Both branches then persist the exact same pair below.
  const now = Date.now();
  const endsAt = opts.endsAt ?? now + seconds * 1000;
  const startedAt = opts.startedAt ?? now;

  // The whole timer - end, start and owner - in ONE write, BEFORE anything is
  // armed: the three values describe a single countdown, and a reader must
  // never catch a mix of an old one and a new one.
  const entries: [string, string][] = [
    [POSTMEAL_TIMER_END_KEY, String(endsAt)],
    [POSTMEAL_TIMER_START_KEY, String(startedAt)],
  ];
  if (opts.profileId) entries.push([POSTMEAL_TIMER_PROFILE_KEY, opts.profileId]);

  if (opts.claimIfIdle) {
    // COMPARE-AND-SET, and the FIRST thing this function does.
    //
    // Both halves matter. It is first because everything below it is
    // destructive to a countdown that is already running - the notification
    // cancel just underneath would strip the delivery off someone else's timer
    // before we ever noticed it was there. And the read sits directly against
    // the write with only synchronous code between them, so nothing can slip
    // in after we have looked and before we commit. A check made in the caller,
    // or even at the top of this function before ensureAndroidChannel and the
    // cancel, is not the same thing: those await real native bridge calls and
    // yield the event loop, which is exactly the window this closes.
    //
    // scripts/afterDelete.test.ts locks the adjacency in place against drift.
    let running = false;
    try {
      const raw = await AsyncStorage.getItem(POSTMEAL_TIMER_END_KEY);
      const end = raw == null ? NaN : parseInt(raw, 10);
      running = Number.isFinite(end) && end > Date.now();
    } catch (err) {
      // Unreadable storage: treat the slot as free, exactly as every other
      // read in this file falls back to "nothing running".
      logCrash(err, { service: "notifications", op: "readPostMealEnd" });
      running = false;
    }
    if (running) return false;
    try {
      await AsyncStorage.multiSet(entries);
      if (!opts.profileId) await AsyncStorage.removeItem(POSTMEAL_TIMER_PROFILE_KEY);
    } catch (err) {
      // best-effort persistence
      logCrash(err, { service: "notifications", op: "claimPostMealTimer" });
    }
  }

  await ensureAndroidChannel();
  try {
    await Notifications.cancelScheduledNotificationAsync(POSTMEAL_ID);
  } catch (err) {
    // nothing pending
    logCrash(err, { service: "notifications", op: "rearmPostMeal" });
  }

  if (!opts.claimIfIdle) {
    try {
      await AsyncStorage.multiSet(entries);
      if (!opts.profileId) await AsyncStorage.removeItem(POSTMEAL_TIMER_PROFILE_KEY);
    } catch (err) {
      // best-effort persistence
      logCrash(err, { service: "notifications", op: "writePostMealTimer" });
    }
  }

  try {
    const prefs = await getNotificationPrefs();
    const alarmKitAvailable = isAlarmKitAvailable();
    const armedAsAlarm =
      shouldUseAlarm({
        alarmEnabled: prefs.postMealAlarm,
        alarmKitAvailable,
        alarmAuthorized:
          alarmKitAvailable && getAlarmAuthorizationStatus() === "authorized",
      }) &&
      (await scheduleOneShotAlarm({
        id: POSTMEAL_ALARM_ID,
        atMs: endsAt,
        // The short form, for the same clipping reason as reminderAlarmLabel
        // above; the NOTIFICATION below keeps the full sentence.
        label: i18n.t("reminders.alarmTitlePostMeal"),
        stopLabel: i18n.t("reminders.alarmStopButton"),
        openLabel: i18n.t("reminders.alarmOpenButton"),
        route: "postMeal",
      }));

    if (!armedAsAlarm) {
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
      // Collects a timer left behind by the alarm mode being switched off (or by
      // a device that has since lost the AlarmKit permission) - the counterpart
      // of applyReminders' own "rowActive but not useAlarm" cancel.
      await cancelAlarm(POSTMEAL_ALARM_ID);
    }
  } catch (e) {
    if (isExactTimingError(e) && Platform.OS === "android") {
      // Only the on-time delivery is missing: the card and the ongoing
      // notification still work, so the countdown stays and the caller offers
      // the settings screen that fixes the delivery.
      if (opts.result) opts.result.deliveryMissed = true;
      try {
        await Notifications.cancelScheduledNotificationAsync(POSTMEAL_ID);
        await cancelAlarm(POSTMEAL_ALARM_ID);
      } catch (cancelErr) {
        // nothing pending
        logCrash(cancelErr, { service: "notifications", op: "postMealExactFallback" });
      }
      await mirrorPostMealActivity(endsAt, startedAt);
      return true;
    }
    // Nothing was armed, so nothing may be left claiming a countdown is
    // running: undo the write above and let the caller see the failure, exactly
    // as it did when persistence came last.
    try {
      await Notifications.cancelScheduledNotificationAsync(POSTMEAL_ID);
      await cancelAlarm(POSTMEAL_ALARM_ID);
    } catch (cancelErr) {
      // nothing pending
      logCrash(cancelErr, { service: "notifications", op: "postMealRollbackCancel" });
    }
    try {
      await AsyncStorage.multiRemove([
        POSTMEAL_TIMER_END_KEY,
        POSTMEAL_TIMER_START_KEY,
        POSTMEAL_TIMER_PROFILE_KEY,
      ]);
    } catch (rollbackErr) {
      // best-effort rollback
      logCrash(rollbackErr, { service: "notifications", op: "postMealRollback" });
    }
    throw e;
  }

  await mirrorPostMealActivity(endsAt, startedAt);
  return true;
}

/** Lock screen / ongoing-notification mirror of the countdown. Best-effort: the
 *  countdown is already persisted, so a failure here must never undo it (it used
 *  to throw out of the arm and leave a stored timer the card never showed). */
async function mirrorPostMealActivity(endsAt: number, startedAt: number): Promise<void> {
  try {
    // Mirror the same countdown onto the lock screen and Dynamic Island, so the
    // user can see the time left without opening the app. Timer-style, no push:
    // iOS draws the countdown from the end date we just persisted. A no-op when
    // Live Activities are unavailable or the module is not linked.
    // Imported lazily: liveData reads the pending timer from this module, and a
    // module-scope import here would close that cycle.
    //
    // Runs in BOTH delivery modes (2.3.0's K2-F): the alarm is alert-only, so it
    // draws nothing until the window ends and this card is the only countdown on
    // the lock screen either way. The alarm adds sound and a full-screen finish,
    // it does not replace the surface the user already knows.
    const { readLiveData } = await import("./liveData");
    const snapshot = await readLiveData();
    startPostMealActivity({
      endsAt,
      startedAt,
      title: i18n.t("widget.timerTitle"),
      lastReading:
        snapshot?.lastGlucoseMgdl != null
          ? formatGlucose(snapshot.lastGlucoseMgdl, snapshot.unit)
          : null,
      unitLabel: snapshot ? glucoseUnitLabel(snapshot.unit) : "",
    });
  } catch (err) {
    // best-effort mirror
    logCrash(err, { service: "notifications", op: "mirrorPostMealActivity" });
  }
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
  } catch (err) {
    logCrash(err, { service: "notifications", op: "readPostMealTimerEnd" });
    return null;
  }
}

/**
 * The active timer's own start AND end, or null when none is pending. The start
 * is what makes the elapsed part of the window knowable: the progress bar and
 * the "x min window" label both read the pair, instead of assuming every timer
 * spans POST_MEAL_WINDOW_MIN - which a backdated start ("I started eating a
 * while ago") deliberately does not.
 *
 * A timer armed before the start was persisted falls back to the end minus the
 * fixed window, which is exactly where it must have begun.
 */
export async function getPostMealTimerState(): Promise<PostMealTimerWindow | null> {
  const endsAt = await getPostMealTimerEnd();
  if (endsAt == null) return null;
  const profileId = (await readPostMealTimerProfile()) ?? undefined;
  const startedAt = await readPostMealStart();
  if (startedAt != null && startedAt < endsAt) return { startedAt, endsAt, profileId };
  return { startedAt: derivePostMealStart(endsAt, POST_MEAL_WINDOW_MIN), endsAt, profileId };
}

async function readPostMealStart(): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(POSTMEAL_TIMER_START_KEY);
    if (!raw) return null;
    const start = parseInt(raw, 10);
    return Number.isFinite(start) ? start : null;
  } catch (err) {
    logCrash(err, { service: "notifications", op: "readPostMealTimerStart" });
    return null;
  }
}

async function readPostMealTimerProfile(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(POSTMEAL_TIMER_PROFILE_KEY);
  } catch (err) {
    logCrash(err, { service: "notifications", op: "readPostMealTimerProfile" });
    return null;
  }
}

/**
 * The countdown reached its end: clear the persisted timer and take the Live
 * Activity down. Nothing else ends it: the `timerInterval` freezes the display
 * at 0:00 and `staleDate` only dims it (see PostMealActivity.swift), it does
 * not dismiss it, so without this call the card would sit on the lock screen
 * frozen and faded until the user opened the app, or the OS eventually expired
 * it hours later, or another timer got armed. The notification itself has
 * already fired, so it is not cancelled here.
 *
 * The AlarmKit timer (2.3.0's B) is deliberately NOT cancelled here either,
 * and for a stronger reason: "the countdown reached its end" is the exact
 * moment the alarm is supposed to be ringing. This runs from a plain read of
 * the stored end (getPostMealTimerEnd) and from the dashboard's own tick, both
 * of which can land while the alarm is still on screen - cancelling would
 * silence the one delivery the user chose. Nothing leaks: the identity is
 * reused (cancel-then-schedule) by the next arm, and applyReminders' orphan
 * sweep skips this id by design. cancelPostMealTimer is where an alarm really
 * does have to be taken down, because there the user ended the window early.
 */
export async function completePostMealTimer(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([
      POSTMEAL_TIMER_END_KEY,
      POSTMEAL_TIMER_START_KEY,
      POSTMEAL_TIMER_PROFILE_KEY,
    ]);
  } catch (err) {
    // best-effort
    logCrash(err, { service: "notifications", op: "completePostMealTimer" });
  }
  endPostMealActivity();
}

/**
 * Cancels a pending post-meal reminder and clears its timer. Used for early
 * completion: once the user logs their 2-hour reading the nudge is unnecessary.
 *
 * Takes down BOTH deliveries unconditionally (2.3.0's B): whichever one this
 * countdown was armed with, cancelling the other is a no-op, and an early
 * reading must never leave an alarm behind to ring at a moment the app already
 * considers finished.
 */
export async function cancelPostMealTimer(): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(POSTMEAL_ID);
  } catch (err) {
    // nothing pending
    logCrash(err, { service: "notifications", op: "cancelPostMeal" });
  }
  await cancelAlarm(POSTMEAL_ALARM_ID);
  try {
    await AsyncStorage.multiRemove([
      POSTMEAL_TIMER_END_KEY,
      POSTMEAL_TIMER_START_KEY,
      POSTMEAL_TIMER_PROFILE_KEY,
    ]);
  } catch (err) {
    // best-effort
    logCrash(err, { service: "notifications", op: "clearPostMealTimer" });
  }
  endPostMealActivity();
}

/** What a meal log's call to schedulePostMealReminder actually did. */
export type PostMealAutoStartResult =
  /** Armed a fresh countdown, same as always. */
  | "started"
  /** A timer was already running: left untouched (see decidePostMealAutoStart -
   *  the meal that triggered this call may be a second bite mid-countdown). */
  | "active"
  /** Idle, but the record is not close to now (a backdated entry): nothing armed. */
  | "backdated"
  /** The master switch, the postMeal toggle, or permission said no. */
  | "off";

/**
 * Auto post-meal reminder, armed when a MEAL is logged.
 *
 * Deliberately not called by the plain glucose-logging paths: a reading is a
 * measurement, not a meal, so noting a fasting or manual value must not start a
 * post-meal countdown the user never asked for. The timer has exactly two
 * deliberate sources - this (a meal record) and the "I started eating" button.
 *
 * `loggedAt` is the moment the MEAL actually happened (null/omitted = "now",
 * the same convention every caller already uses for "the user left the time
 * picker untouched"). Every call site passes it through unconditionally and
 * lets decidePostMealAutoStart (lib/postMealTimer.ts) make the call, rather
 * than each guessing with its own if: a timer already running is left alone,
 * and an idle timer only arms for a record close to now - a backdated entry
 * (writing up last night's dinner) must not start a countdown relative to
 * right now for a meal that already happened.
 *
 * Honors the saved preference (enabled + postMeal toggle), and no-ops if
 * disabled or permission is denied.
 *
 * `windowMin` (2.3.2) is never read from storage any more - the length is not
 * saved (see lib/postMealTimer.ts's own doc comment) - so every automatic
 * caller that omits it gets the fixed POST_MEAL_WINDOW_MIN, exactly what the
 * dashboard card is showing at the moment the meal is logged.
 */
export async function schedulePostMealReminder(
  loggedAt?: Date | number | null,
  windowMin: number = POST_MEAL_WINDOW_MIN
): Promise<PostMealAutoStartResult> {
  const prefs = await getNotificationPrefs();
  if (!prefs.enabled || !prefs.postMeal) return "off";
  const loggedAtMs =
    loggedAt == null ? Date.now() : loggedAt instanceof Date ? loggedAt.getTime() : loggedAt;
  const decision = decidePostMealAutoStart({
    timerActive: (await getPostMealTimerEnd()) != null,
    loggedAtMs,
    now: Date.now(),
  });
  if (decision !== "start") return decision;
  if (!(await ensureNotificationPermission())) return "off";
  const profile = await readActiveProfile();
  // The automatic path always arms the full window from now; only the "a
  // while ago" sheet ever starts one part-way through.
  await schedulePostMealAt({
    minutes: windowMin,
    profileId: profile?.id,
  });
  return "started";
}

/**
 * What the "I started eating" action did. */
export type PostMealStartOutcome =
  /** Armed, with `minutesLeft` of the window still ahead. */
  | {
      kind: "started";
      minutesLeft: number;
      /** Android: exact timing is off, so the reminder may be late or missing and
       *  the screen offers the settings route (openExactTimingSettings). */
      timingNotice: "none" | "exactTiming";
    }
  /** The meal was long enough ago that the window is already over: nothing is
   *  armed, and the screen offers to record the reading instead. */
  | { kind: "elapsed" }
  /** The master switch or the OS permission said no. */
  | { kind: "off" };

/**
 * "I started eating" timer: an explicit user action, so it schedules the
 * post-meal check regardless of the auto-reminder toggle (still needs the master
 * switch on + permission). Shares POSTMEAL_ID, so pressing again just renews it.
 *
 * `minutesAgo` is how long ago the meal actually began (2.3.0's G15) - 0 for the
 * ordinary tap, a real number when the user is logging late. The countdown
 * itself is always POST_MEAL_WINDOW_MIN (P14 removed the duration sheet's own
 * length field, its last source of a different value). The start moment is
 * BACKDATED and the end stays POST_MEAL_WINDOW_MIN after the meal, so a
 * countdown started 30 minutes into the window runs for 90 and lands where
 * the check belongs. startPostMealLate owns that arithmetic (and the
 * "already over" answer); this only arms what it returns.
 */
export async function startPostMealTimer(
  minutesAgo = 0
): Promise<PostMealStartOutcome> {
  const prefs = await getNotificationPrefs();
  if (!prefs.enabled) return { kind: "off" };
  if (!(await ensureNotificationPermission())) return { kind: "off" };
  const profile = await readActiveProfile();
  const next = startPostMealLate({ minutesAgo, now: Date.now() });
  if (next.kind === "elapsed") return { kind: "elapsed" };
  const result = { deliveryMissed: false };
  await schedulePostMealAt({
    minutes: next.remainingMs / 60_000,
    windowMin: POST_MEAL_WINDOW_MIN,
    endsAt: next.endsAt,
    startedAt: next.startedAt,
    profileId: profile?.id,
    // A backdated start can leave under a minute of the FIRST minute; the end
    // is real and must not be rounded forward.
    minSeconds: 1,
    result,
  });
  return {
    kind: "started",
    minutesLeft: Math.round(next.remainingMs / 60_000),
    timingNotice: postMealTimingNotice({
      platform: Platform.OS,
      authStatus: getAlarmAuthorizationStatus(),
      deliveryMissed: result.deliveryMissed,
      alarmPref: prefs.postMealAlarm,
    }),
  };
}

/**
 * Opens Android's "Alarms & reminders" screen for this app (exact timing).
 * Reuses the alarm module's own authorization flow, which launches
 * ACTION_REQUEST_SCHEDULE_EXACT_ALARM with package:<applicationId> and resolves
 * once the user comes back. No new native code and no manifest change.
 */
export async function openExactTimingSettings(): Promise<void> {
  if (Platform.OS !== "android") return;
  await requestAlarmAuthorization();
}

/**
 * The running countdown's own length, in whole minutes, derived from its
 * persisted start/end pair - or null when nothing is running. 2.3.2 dropped
 * the saved per-profile duration, so this is the only place left that still
 * knows how long an ALREADY-ARMED window is meant to run; a re-anchor that
 * cannot read it falls back to POST_MEAL_WINDOW_MIN rather than guess short.
 */
async function runningPostMealWindowMinutes(): Promise<number | null> {
  const state = await getPostMealTimerState();
  if (!state) return null;
  const span = Math.round((state.endsAt - state.startedAt) / 60_000);
  return span > 0 ? span : null;
}

/**
 * Dashboard "restart for this meal": a running timer is re-anchored to a
 * SPECIFIC meal's own moment instead of to now. The deliberate, user-initiated
 * counterpart to schedulePostMealReminder's "active" no-op - that call leaves an
 * already-running timer untouched on purpose, and this is how the user moves
 * the anchor themselves when the newer meal is the one they actually want the
 * 2-hour check measured from.
 *
 * `windowMin` (2.3.2) is normally left unset: with no saved preference left to
 * read, the RUNNING timer's own span (end minus start) is what "restart for
 * this meal" preserves - re-anchoring must move only the meal, never quietly
 * shrink or grow the countdown itself. A caller restoring a specific past
 * window verbatim (the dashboard's own undo, which already knows the exact
 * span it wants back) passes it explicitly instead.
 *
 * Non-prompting: the user already granted permission once to have a timer
 * running at all, so this never raises the OS dialog again - it only re-arms
 * with what is already granted.
 */
export async function restartPostMealTimerAt(
  loggedAt: Date | number,
  profileId?: string,
  windowMin?: number
): Promise<PostMealRetimeResult> {
  try {
    const prefs = await getNotificationPrefs();
    if (!prefs.enabled) return "idle";
    if (!(await hasNotificationPermission())) return "idle";
    const startedAt = loggedAt instanceof Date ? loggedAt.getTime() : loggedAt;
    const resolvedProfileId = profileId ?? (await readActiveProfile())?.id;
    const resolvedWindowMin =
      windowMin ?? (await runningPostMealWindowMinutes()) ?? POST_MEAL_WINDOW_MIN;
    const next = restartPostMealWindowAt({
      startedAt,
      windowMin: resolvedWindowMin,
      now: Date.now(),
    });
    if (next.kind === "elapsed") {
      await cancelPostMealTimer();
      return "elapsed";
    }
    await schedulePostMealAt({
      minutes: next.remainingMs / 60_000,
      windowMin: resolvedWindowMin,
      endsAt: next.endsAt,
      startedAt: next.startedAt,
      profileId: resolvedProfileId,
    });
    return "retimed";
  } catch (err) {
    // The running timer keeps its old anchor; nothing is lost.
    logCrash(err, { service: "notifications", op: "restartPostMealTimer" });
    return "idle";
  }
}

/** What putting a previously-ended countdown back did. */
export type PostMealRestoreResult =
  /** Armed again, at its original anchor and for its original span. */
  | "restored"
  /** What was left of the window ran out before the undo; nothing armed. */
  | "elapsed"
  /** A DIFFERENT countdown is running now; it was left strictly alone. */
  | "occupied"
  /** The master switch or the OS permission said no. */
  | "idle";

/**
 * Puts back a countdown that a delete ended, for the undo of that delete
 * (lib/afterDelete.ts).
 *
 * Deliberately NOT restartPostMealTimerAt, even though the arithmetic is the
 * same. That function exists to move a RUNNING countdown, so its "elapsed"
 * branch cancels unconditionally - correct there, wrong here: this is called
 * when the app believes nothing is running, and between the caller's check and
 * that branch there are several awaits (preferences, permission, the active
 * profile) in which the user can perfectly well tap "I started eating" or log
 * a meal. Reaching a cancel then would destroy a countdown this function never
 * armed, trading one wrong countdown for another.
 *
 * So there is NO cancel in here at all, on any path. A window that has run out
 * simply reports "elapsed" and arms nothing, which is the truth. And the check
 * for someone else's countdown is made as the LAST read before the write, with
 * no await between the two, so the gap it cannot cover is as small as this
 * codebase can make it.
 */
export async function restorePostMealWindow(
  window: PostMealTimerWindow
): Promise<PostMealRestoreResult> {
  try {
    const prefs = await getNotificationPrefs();
    if (!prefs.enabled) return "idle";
    if (!(await hasNotificationPermission())) return "idle";
    const windowMin = postMealWindowSpanMinutes(window);
    // Pure, and BEFORE anything is touched: if there is nothing left to arm,
    // this returns without having gone near the stored timer.
    const next = restartPostMealWindowAt({
      startedAt: window.startedAt,
      windowMin,
      now: Date.now(),
    });
    if (next.kind === "elapsed") return "elapsed";
    // claimIfIdle is the whole guard, and it is deliberately NOT a check made
    // here: schedulePostMealAt compares and sets with nothing awaiting between
    // the two, whereas anything decided at this level is separated from the
    // write by that function's own native-bridge awaits. Something armed while
    // the undo toast was up is newer and the user's own, and it comes back
    // untouched - no keys overwritten, no delivery stripped.
    const claimed = await schedulePostMealAt({
      minutes: next.remainingMs / 60_000,
      windowMin,
      endsAt: next.endsAt,
      startedAt: next.startedAt,
      profileId: window.profileId,
      claimIfIdle: true,
    });
    return claimed ? "restored" : "occupied";
  } catch (err) {
    // Nothing was armed (schedulePostMealAt rolls its own write back) and
    // nothing was taken down; the entry itself is already back either way.
    logCrash(err, { service: "notifications", op: "restorePostMealWindow" });
    return "idle";
  }
}

/** What a re-timing did to the running post-meal countdown. Shared by the two
 *  callers that can touch a window already in flight: restartPostMealTimerAt
 *  (which moves its end) and applyPostMealAlarmModeChange (which does not). */
export type PostMealRetimeResult =
  /** No timer was running; only future ones use the new window. */
  | "idle"
  /** A timer is running and now ends at the re-measured moment. */
  | "retimed"
  /** More than the new window had already passed: the timer was closed out. */
  | "elapsed";

/**
 * Re-arms a RUNNING post-meal countdown after its DELIVERY mode changed in
 * Settings (alarm <-> notification, 2.3.0's B), keeping the exact same start
 * and end: only the surface it rings on moves. Without this, a mode changed
 * mid-countdown would only take effect on the next meal, leaving the user
 * looking at a card the switch says should not be there.
 *
 * The last minute of a window is re-armed like any other (minSeconds: 1): the
 * end moment does not move here, so what is left is scheduled for exactly what
 * it is. Skipping it, as this used to, meant a switch to the notification with
 * 40 s to go cancelled the alarm and armed nothing in its place - no
 * notification, and no Live Activity either.
 *
 * The two directions need DIFFERENT permissions, and asking for the wrong one
 * is why a switch could silently do nothing: an alarm is delivered by AlarmKit,
 * so switching TO it depends on the AlarmKit authorization (shouldUseAlarm's own
 * three-way AND, resolved below) and not on the notification permission at all.
 * Only the notification direction needs that permission - and without it there
 * is nothing to arm, so the alarm is simply taken down and the countdown
 * finishes silently rather than ringing after the switch said it should not.
 *
 * Never reports "elapsed": it moves no end moment.
 */
export async function applyPostMealAlarmModeChange(): Promise<PostMealRetimeResult> {
  try {
    const running = await getPostMealTimerState();
    if (running == null) return "idle";
    const now = Date.now();
    const prefs = await getNotificationPrefs();
    const alarmKitAvailable = isAlarmKitAvailable();
    const toAlarm = shouldUseAlarm({
      alarmEnabled: prefs.postMealAlarm,
      alarmKitAvailable,
      alarmAuthorized:
        alarmKitAvailable && getAlarmAuthorizationStatus() === "authorized",
    });
    if (!toAlarm && !(await hasNotificationPermission())) {
      await cancelAlarm(POSTMEAL_ALARM_ID);
      return "retimed";
    }
    await schedulePostMealAt({
      minutes: (running.endsAt - now) / 60_000,
      windowMin: Math.round((running.endsAt - running.startedAt) / 60_000),
      endsAt: running.endsAt,
      startedAt: running.startedAt,
      profileId: running.profileId,
      minSeconds: 1,
    });
    return "retimed";
  } catch (err) {
    // The running countdown keeps the mode it was armed with; nothing is lost.
    logCrash(err, { service: "notifications", op: "postMealAlarmMode" });
    return "idle";
  }
}

/**
 * Takes the branded countdown card down when the ACTIVE profile is not the one
 * the countdown belongs to (2.3.0's P4).
 *
 * Deliberately one-way and card-only. The window itself is a property of the
 * meal, so switching profiles must not cancel it or move its end; the owner
 * gets it back - card included - on their next apply pass, because that pass
 * re-arms the Live Activity through schedulePostMealAt.
 */
async function hidePostMealActivityForOtherProfile(): Promise<void> {
  try {
    const running = await getPostMealTimerState();
    if (running == null || running.profileId == null) return;
    const active = await readActiveProfile();
    if (active?.id && active.id !== running.profileId) endPostMealActivity();
  } catch (err) {
    // best-effort: at worst the card stays a little longer than it should
    logCrash(err, { service: "notifications", op: "hideOtherProfileActivity" });
  }
}

/**
 * Puts a RUNNING post-meal countdown back on a delivery that can still reach
 * the user, without moving its end.
 *
 * schedulePostMealAt decides alarm-vs-notification ONCE, when the countdown is
 * armed, and that decision can stop being true while the window is still
 * running: the user revokes the AlarmKit permission in system settings (or the
 * app is relaunched on a device where it was revoked while closed). The alarm
 * is gone, no notification was ever scheduled because the arm chose the alarm
 * instead, and a 2-hour window then ends in silence. This is the reconciliation
 * for exactly that: it re-arms what is LEFT of the window as a notification.
 *
 * It moves the DELIVERY only. Since K2-F the Live Activity is up in both modes
 * (the alarm is alert-only and draws nothing until the end), so there is no
 * card to bring back here - what was lost was the ring, and that is all this
 * restores, along with the cancel of the dead alarm id.
 *
 * ONE direction only. A pending notification is left exactly where it is, even
 * on a device that could now ring an alarm instead: re-arming it "upwards"
 * would mean cancelling a notification and arming an alarm on the strength of a
 * decision the countdown was not started with, and any slip between the two is
 * the one thing that must never happen (see the never-both rule in
 * applyReminders). The pending-notification check below is also what makes this
 * safe to run on every apply pass - with a notification already armed there is
 * nothing to do, so it can never stack a second delivery onto the same window.
 *
 * Runs only with the notification permission already proved by the caller.
 */
async function reconcilePostMealDelivery(prefs: NotificationPrefs): Promise<void> {
  try {
    const running = await getPostMealTimerState();
    if (running == null) return;
    const remainingMs = running.endsAt - Date.now();
    if (remainingMs <= 0) return;

    const alarmKitAvailable = isAlarmKitAvailable();
    const canRingAsAlarm = shouldUseAlarm({
      alarmEnabled: prefs.postMealAlarm,
      alarmKitAvailable,
      alarmAuthorized:
        alarmKitAvailable && getAlarmAuthorizationStatus() === "authorized",
    });
    // The alarm this window was armed with is still deliverable: leave it be.
    if (canRingAsAlarm) return;

    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    if (scheduled.some((n) => n.identifier === POSTMEAL_ID)) return;

    await schedulePostMealAt({
      minutes: remainingMs / 60_000,
      windowMin: Math.round((running.endsAt - running.startedAt) / 60_000),
      endsAt: running.endsAt,
      startedAt: running.startedAt,
      profileId: running.profileId,
      minSeconds: 1,
    });
  } catch (err) {
    // best-effort: the countdown keeps whatever it was armed with.
    logCrash(err, { service: "notifications", op: "reconcilePostMealDelivery" });
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
  } catch (err) {
    // nothing pending
    logCrash(err, { service: "notifications", op: "rearmLowFollowup" });
  }
  await Notifications.scheduleNotificationAsync({
    identifier: LOWFOLLOW_ID,
    content: {
      title: i18n.t("notifications.lowFollowTitle"),
      body: i18n.t("notifications.lowFollowBody"),
      data: { route: "lowFollowup" satisfies NotificationRoute },
      ...lowFollowupExtras,
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
  } catch (err) {
    // nothing pending
    logCrash(err, { service: "notifications", op: "cancelLowFollowup" });
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
 * This reaches the AlarmKit surfaces too, with no extra step: applyReminders
 * re-arms every row's alarm with freshly translated copy, and the post-meal
 * re-arm below goes through schedulePostMealAt, which is also what owns the
 * countdown timer's title and stop button.
 *
 * Best-effort and never throws: a failure leaves the old (still working, just
 * old-language) reminders in place.
 */
export async function rescheduleForLanguageChange(): Promise<void> {
  try {
    // The Android channel name is i18n too, and setting it again renames in place.
    await ensureAndroidChannel();
    // The basal quick action's own button title is i18n too - see
    // ensureNotificationCategories's doc comment.
    await ensureNotificationCategories();
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
          ...lowFollowupExtras,
        }
      );
      if (ok) kept.lowFollowup = ends.lowFollowup;
    }

    if (ends.trial != null && ends.trial > now) {
      const ok = await rearmOneOff(TRIAL_ID, (ends.trial - now) / 1000, trialEndingContent());
      if (ok) kept.trial = ends.trial;
    }

    if (ends.trialNudge != null) {
      if (ends.trialNudge > now) {
        const ok = await rearmOneOff(
          TRIAL_NUDGE_ID,
          (ends.trialNudge - now) / 1000,
          trialNudgeContent()
        );
        if (ok) kept.trialNudge = ends.trialNudge;
      } else {
        // Already delivered: kept only so reportTrialNudgeIfDelivered can still
        // report it once.
        kept.trialNudge = ends.trialNudge;
      }
    }

    await AsyncStorage.setItem(ONEOFF_ENDS_KEY, JSON.stringify(kept));
  } catch (err) {
    // best-effort; the previously scheduled reminders still fire as before
    logCrash(err, { service: "notifications", op: "languageChange" });
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
  } catch (err) {
    // nothing pending
    logCrash(err, { service: "notifications", op: "rearmOneOffCancel", id: identifier });
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
  } catch (err) {
    logCrash(err, { service: "notifications", op: "rearmOneOff", id: identifier });
    return false;
  }
}

