/**
 * The one decision that turns a reminder row into a real (AlarmKit) alarm
 * instead of a plain notification (2.2.0's A1 - see docs/alarmkit-2.2.0.md).
 * Pure and dependency-free, exactly like lib/postMealTimer.ts, so
 * scripts/alarmSelect.test.ts can exercise it under plain Node without any
 * Expo/React Native runtime - and so applyReminders in
 * lib/services/notifications.ts and any other future caller share ONE
 * definition instead of re-deriving the same three-way AND.
 *
 * All three inputs are resolved by the caller, never by this function: it has
 * no clock, no storage and no native calls of its own.
 */
export interface AlarmSelectionInput {
  /** The row's own opt-in (reminders.alarm_enabled = 1, schema v19). */
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
