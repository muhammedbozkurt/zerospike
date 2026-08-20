import { requireOptionalNativeModule } from "expo-modules-core";

/**
 * JS side of the AlarmKit bridge (2.2.0's A1): turns a reminder row's opt-in
 * ("Play as alarm") into a real, system-level daily alarm on iOS 26+, instead
 * of a plain notification. See docs/alarmkit-2.2.0.md for the full feature
 * spec and lib/services/notifications.ts's applyReminders for where this is
 * actually wired into the reminder lifecycle.
 *
 * `requireOptionalNativeModule` returns null in Expo Go and in any build made
 * before `npx expo prebuild` linked the module - exactly like
 * modules/zerospike-live-activity - so every call below is a no-op there. That
 * is deliberate: an AlarmKit alarm is a convenience layered ON TOP of the
 * regular notification (see notifications.ts's alarm-vs-notification branch),
 * and losing it must never stop a reminder from firing at all.
 */
export type AlarmAuthorizationStatus =
  | "authorized"
  | "denied"
  | "notDetermined"
  /** No AlarmKit at all (iOS < 26, Android, or the native module is not
   *  linked yet). Distinct from "denied": nothing has been asked, and nothing
   *  ever will be, on this device. */
  | "unavailable";

interface AlarmKitNativeModule {
  isAvailable(): boolean;
  getAuthorizationStatus(): AlarmAuthorizationStatus;
  requestAuthorization(): Promise<AlarmAuthorizationStatus>;
  scheduleDailyAlarm(
    id: string,
    hour: number,
    minute: number,
    label: string,
    stopLabel: string
  ): Promise<boolean>;
  cancelAlarm(id: string): Promise<boolean>;
  listScheduledAlarmIds(): string[];
}

const native = requireOptionalNativeModule<AlarmKitNativeModule>(
  "ZerospikeAlarmKit"
);

/** True only when the OS itself supports AlarmKit (iOS 26+). Says nothing
 *  about authorization - see getAlarmAuthorizationStatus/requestAlarmAuthorization
 *  - and nothing about a specific reminder's own opt-in, which lives in
 *  reminders.alarm_enabled (schema v19). The "Play as alarm" row in
 *  components/ReminderEditSheet.tsx is hidden entirely when this is false. */
export function isAlarmKitAvailable(): boolean {
  try {
    return native?.isAvailable() ?? false;
  } catch {
    return false;
  }
}

/** Reads AlarmKit authorization WITHOUT prompting. Synchronous on the native
 *  side (a plain property read), kept synchronous here too. */
export function getAlarmAuthorizationStatus(): AlarmAuthorizationStatus {
  try {
    return native?.getAuthorizationStatus() ?? "unavailable";
  } catch {
    return "unavailable";
  }
}

/** Prompts for AlarmKit authorization and reports the real outcome - the
 *  AlarmKit counterpart of requestNotificationPermission in
 *  lib/services/notifications.ts. Never throws: a failed prompt (or no
 *  AlarmKit at all) reports "unavailable" rather than surfacing an error out
 *  of a settings toggle. */
export async function requestAlarmAuthorization(): Promise<AlarmAuthorizationStatus> {
  try {
    return (await native?.requestAuthorization()) ?? "unavailable";
  } catch {
    return "unavailable";
  }
}

/**
 * Schedules (or re-arms) a daily-repeating AlarmKit alarm. `id` is the
 * caller's own fully-formed identity string (see alarmIdentifier in
 * lib/services/notifications.ts, mirroring that file's own
 * "zerospike-rem-<id>" notification identifiers) - this module carries no
 * naming convention of its own. `label`/`stopLabel` must already be
 * localized: this module owns no copy, exactly like startPostMealActivity's
 * `title` in modules/zerospike-live-activity.
 *
 * Returns false (never throws) on anything that stops the alarm from being
 * set: no AlarmKit, not authorized, or an AlarmKit-side scheduling error - the
 * caller falls back to the plain notification path on false, so a reminder is
 * never silently lost.
 */
export async function scheduleDailyAlarm(options: {
  id: string;
  hour: number;
  minute: number;
  label: string;
  stopLabel: string;
}): Promise<boolean> {
  try {
    return (
      (await native?.scheduleDailyAlarm(
        options.id,
        options.hour,
        options.minute,
        options.label,
        options.stopLabel
      )) ?? false
    );
  } catch {
    return false;
  }
}

/** Cancels one alarm by its identity string. Best-effort, like every other
 *  cancel* in lib/services/notifications.ts: an id AlarmKit no longer knows
 *  about is not an error. */
export async function cancelAlarm(id: string): Promise<void> {
  try {
    await native?.cancelAlarm(id);
  } catch {
    // best-effort; nothing pending under this id either way
  }
}

/** Every identity string this module currently has an AlarmKit alarm
 *  scheduled under. Used for the orphan sweep in applyReminders, the same way
 *  it reads getAllScheduledNotificationsAsync() for the "zerospike-rem-"
 *  prefix. Empty (never throws) when AlarmKit is unavailable. */
export function listScheduledAlarmIds(): string[] {
  try {
    return native?.listScheduledAlarmIds() ?? [];
  } catch {
    return [];
  }
}
