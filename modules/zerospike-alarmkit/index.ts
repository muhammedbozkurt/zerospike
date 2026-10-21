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
    stopLabel: string,
    openLabel: string,
    route: string
  ): Promise<boolean>;
  scheduleOneShotAlarm(
    id: string,
    epochSeconds: number,
    label: string,
    stopLabel: string,
    openLabel: string,
    route: string
  ): Promise<boolean>;
  cancelAlarm(id: string): Promise<boolean>;
  listScheduledAlarmIds(): string[];
  /** Added after the first AlarmKit builds, so optional: a JS bundle can run
   *  against an older binary that has no such call. */
  cancelUnownedAlarms?(keepIds: string[]): Promise<number>;
  /** `{ route, alarmId? }` now. The bare-string shape is what earlier builds
   *  returned, and a JS bundle can be newer than the native binary it runs
   *  against (a reloaded dev build), so both are still accepted below. */
  takePendingAlarmRoute():
    | { route?: string; alarmId?: string }
    | string
    | null;
}

/** Where an alarm's "Open" button should land - the same vocabulary as
 *  NotificationRoute in lib/services/notifications.ts, so a tapped alarm and a
 *  tapped notification are routed by the same code. */
export type AlarmRoute = "postMeal" | "basal" | "med" | "glucose" | "custom";

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
 * naming convention of its own. `label`/`stopLabel`/`openLabel` must already be
 * localized: this module owns no copy, exactly like startPostMealActivity's
 * `title` in modules/zerospike-live-activity.
 *
 * `route` is where the alarm's "Open" button lands (2.3.0's K2-B), read back by
 * takePendingAlarmRoute below once the app comes forward.
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
  openLabel: string;
  route: AlarmRoute;
}): Promise<boolean> {
  try {
    return (
      (await native?.scheduleDailyAlarm(
        options.id,
        options.hour,
        options.minute,
        options.label,
        options.stopLabel,
        options.openLabel,
        options.route
      )) ?? false
    );
  } catch {
    return false;
  }
}

/**
 * Schedules a one-shot alarm for an absolute moment (`atMs`, epoch
 * milliseconds) - the end of a post-meal window (2.3.0's K2-F). Same contract
 * as scheduleDailyAlarm above in every respect: caller-owned identity string,
 * already-localized copy, false (never a throw) when AlarmKit is missing,
 * unauthorized or refuses the schedule, so lib/services/notifications.ts can
 * fall straight back to the notification it has always used.
 *
 * Alert-only on purpose - no AlarmKit countdown surface, so the app's own
 * PostMealActivity card stays on the lock screen in both delivery modes.
 *
 * Cancelled through the SAME cancelAlarm below, and visible to the same
 * listScheduledAlarmIds: the native module keeps one identity map for both
 * kinds of alarm.
 */
export async function scheduleOneShotAlarm(options: {
  id: string;
  atMs: number;
  label: string;
  stopLabel: string;
  openLabel: string;
  route: AlarmRoute;
}): Promise<boolean> {
  try {
    return (
      (await native?.scheduleOneShotAlarm(
        options.id,
        options.atMs / 1000,
        options.label,
        options.stopLabel,
        options.openLabel,
        options.route
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

/**
 * Cancels every AlarmKit alarm this app holds whose identity is not in
 * `keepIds` - including alarms the native identity map has lost track of
 * (an app reinstall wipes the map, not the system's alarms), which
 * listScheduledAlarmIds can never reveal. Returns how many were cancelled, or
 * null when nothing could be done: no AlarmKit, an older binary without this
 * call, or an AlarmKit error. Never throws.
 */
export async function cancelUnownedAlarms(
  keepIds: readonly string[]
): Promise<number | null> {
  try {
    if (!native?.cancelUnownedAlarms) return null;
    return await native.cancelUnownedAlarms([...keepIds]);
  } catch {
    return null;
  }
}

/** What an alarm's "Open" button left behind: where to land, and - when the
 *  ringing alarm knew it - the identity string it was scheduled under (JS's own
 *  "zerospike-alarm-<reminderId>", see alarmIdentifier in
 *  lib/services/notifications.ts). `alarmId` is null for an alarm armed by a
 *  build that predated it, which is the case app/_layout.tsx falls back to
 *  resolving by time. */
export type PendingAlarm = {
  route: AlarmRoute;
  alarmId: string | null;
};

/**
 * The alarm left behind by an "Open" tap, or null when none is waiting
 * (2.3.0's K2-B, since extended with the alarm's identity). READ-ONCE: the
 * native side clears the keys as it hands them over, so an alarm can only ever
 * be acted on for the foreground transition it belongs to. Synchronous, like
 * every other read here, so app/_layout.tsx can call it straight from an
 * AppState listener.
 *
 * The SINGLE point where the native payload is normalized: takePendingAlarmRoute
 * below is a view onto this, so no caller ever has to know that older native
 * builds hand back a bare route string.
 */
export function takePendingAlarmContext(): PendingAlarm | null {
  try {
    const pending = native?.takePendingAlarmRoute() ?? null;
    if (!pending) return null;
    if (typeof pending === "string") return { route: pending as AlarmRoute, alarmId: null };
    const route = typeof pending.route === "string" ? pending.route : "";
    if (!route) return null;
    const alarmId =
      typeof pending.alarmId === "string" && pending.alarmId.length > 0
        ? pending.alarmId
        : null;
    return { route: route as AlarmRoute, alarmId };
  } catch {
    return null;
  }
}

/** The route half of takePendingAlarmContext above, for callers that only need
 *  to know WHERE a pending alarm points - or, in completeOnboarding's case
 *  (lib/store/AppContext.tsx), only need the slot drained. Consumes the pending
 *  alarm exactly like the full read does: there is one slot, not two. */
export function takePendingAlarmRoute(): AlarmRoute | null {
  return takePendingAlarmContext()?.route ?? null;
}
