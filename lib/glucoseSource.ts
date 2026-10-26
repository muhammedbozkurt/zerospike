/**
 * Where a sugar_logs row came from, and the one question every caller used to
 * answer on its own with `source !== 'health'`: did the user type this?
 *
 * That denylist treated any new source as the user's own, so a Nightscout row
 * would have been written back to Apple Health and counted as a first log. It is
 * an allowlist now: only 'manual' is user-entered.
 */

export const GLUCOSE_SOURCES = ["manual", "health", "nightscout"] as const;
export type GlucoseSource = (typeof GLUCOSE_SOURCES)[number];

export function isUserEntered(source: string | null | undefined): boolean {
  return source === "manual";
}

/** The same rule as a WHERE fragment (table alias optional). */
export const USER_ENTERED_SQL = "source = 'manual'";
