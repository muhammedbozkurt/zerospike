/**
 * The alarm-facing decisions, kept pure: which delivery a reminder gets
 * (shouldUseAlarm / alarmModeOf, 2.2.0's A1 - see docs/alarmkit-2.2.0.md) and
 * whether the one-time upgrade tour may open (shouldOpenAlarmTour, 2.3.0's D).
 * Dependency-free, exactly like lib/postMealTimer.ts, so
 * scripts/alarmSelect.test.ts can exercise them under plain Node without any
 * Expo/React Native runtime - and so applyReminders in
 * lib/services/notifications.ts and any other future caller share ONE
 * definition instead of re-deriving the same three-way AND.
 *
 * Every input is resolved by the caller, never by these functions: they have
 * no clock, no storage and no native calls of their own.
 */
export interface AlarmSelectionInput {
  /** The stored delivery preference - reminders.alarm_enabled = 1 (schema v19,
   *  default-on since v21) for a reminder row, NotificationPrefs.postMealAlarm
   *  for the post-meal countdown. */
  alarmEnabled: boolean;
  /** modules/zerospike-alarmkit's isAlarmKitAvailable() - the OS itself
   *  supports AlarmKit (iOS 26+) and the native module is linked. */
  alarmKitAvailable: boolean;
  /** getAlarmAuthorizationStatus() === "authorized" - the user has actually
   *  granted the AlarmKit permission, not merely that it could be asked for. */
  alarmAuthorized: boolean;
}

/**
 * Whether THIS row should be armed as a real alarm rather than a notification.
 * Callers are expected to already have applied every other reminder gate
 * (master switch, OS notification permission, the row's own `enabled`, the
 * basal/med visibility gates) before calling this - `shouldUseAlarm` only ever
 * adds a FURTHER narrowing on top of an already-active row, it never widens
 * one back on. A row that fails this always falls back to the existing
 * notification path; the two are never both armed for the same row (see
 * applyReminders).
 */
export function shouldUseAlarm(input: AlarmSelectionInput): boolean {
  return input.alarmEnabled && input.alarmKitAvailable && input.alarmAuthorized;
}

/** How a row will actually be delivered, as a name a UI can draw. Exists so a
 *  badge can never claim "Alarm" for a row that would in fact ring as a
 *  notification: it reads the SAME three-way AND as shouldUseAlarm rather than
 *  looking at the stored preference alone (which is deliberately kept even on
 *  a device with no AlarmKit - see lib/db/reminders.ts). */
export function alarmModeOf(
  input: AlarmSelectionInput
): "alarm" | "notification" {
  return shouldUseAlarm(input) ? "alarm" : "notification";
}

/** Everything the one-time alarm tour (app/alarm-tour.tsx, 2.3.0's D) is
 *  allowed to depend on, resolved by app/_layout.tsx. */
export interface AlarmTourGateInput {
  /** The route gate in app/_layout.tsx has finished deciding the first screen. */
  routeSettled: boolean;
  /** The PERSISTED onboarding flag (AppContext's `onboarded`), never "the user
   *  happens not to be on /onboarding right now": the route gate reports
   *  settled the moment it has redirected INTO the onboarding flow, so
   *  `routeSettled` alone is true for someone who has not onboarded at all. */
  onboarded: boolean;
  /** isScreenshotMode() - a store capture must never be interrupted by it. */
  screenshotMode: boolean;
  /** modules/zerospike-alarmkit's isAlarmKitAvailable(). */
  alarmKitAvailable: boolean;
  /** hasSeenAlarmTour() - once ever, and completeOnboarding marks it seen so a
   *  fresh install is covered by onboarding instead. */
  tourSeen: boolean;
  /** How many reminder rows the active profile has: with none, the tour would
   *  announce a change to someone it did not change anything for. */
  reminderCount: number;
  /** NotificationPrefs.enabled - the app's own master reminder switch. */
  notificationsEnabled: boolean;
  /** getNotificationPermission() === "granted" - the OS actually lets anything
   *  reach the user. */
  notificationPermission: boolean;
}

/**
 * Whether the upgrade tour may be pushed on this launch. Deliberately narrow -
 * see each field above - and gathered into one predicate so a missing
 * condition is a test failure rather than something only a half-finished
 * install would ever reveal.
 *
 * The last two conditions are DELIVERY REALITY, not preference: with the master
 * switch off or the OS permission missing, nothing reaches this user at all, so
 * a tour explaining that their reminders now ring as alarms would describe
 * something that is not happening. It is also why app/_layout.tsx must not mark
 * the tour seen when this returns false (see hasSeenAlarmTour): the very same
 * user becomes the tour's real audience the moment they turn notifications back
 * on, and a consumed flag would have silently taken it away from them.
 */
export function shouldOpenAlarmTour(input: AlarmTourGateInput): boolean {
  return (
    input.routeSettled &&
    input.onboarded &&
    !input.screenshotMode &&
    input.alarmKitAvailable &&
    !input.tourSeen &&
    input.reminderCount > 0 &&
    input.notificationsEnabled &&
    input.notificationPermission
  );
}
