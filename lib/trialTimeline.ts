import { computeInsights, rangeFromWindow, type TirBand } from "./insights";
import type { SugarLog } from "./db/types";
import { isUserEntered } from "./glucoseSource";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The trial-ending reminder fires this many days before the first charge. */
export const TRIAL_REMINDER_LEAD_DAYS = 2;

/** Used when the store reports no usable trial length. */
export const DEFAULT_TRIAL_DAYS = 7;

/** Delay of the one-off "bring in your history" nudge after a trial starts. */
export const TRIAL_NUDGE_DELAY_MS = 24 * 60 * 60 * 1000;

/** The paywall's personal line looks at this many days of the user's own log. */
export const PERSONAL_WINDOW_DAYS = 14;

/** Fewer own readings than this say nothing, so the personal line stays hidden. */
export const PERSONAL_MIN_READINGS = 3;

/**
 * Days until the ending reminder fires, counted from the trial start. Zero or
 * negative means the trial is too short to leave room for it: nothing is armed.
 * Not sanitized on purpose, so a bad length can never schedule a reminder.
 */
export function trialReminderFireInDays(trialDays: number): number {
  return trialDays - TRIAL_REMINDER_LEAD_DAYS;
}

export function trialReminderArmed(trialDays: number): boolean {
  return trialReminderFireInDays(trialDays) > 0;
}

/**
 * The moment the ending reminder fires for a trial that really ends at
 * `trialEndsAt` (epoch ms): the store's own expiry, so the reminder follows the
 * actual end of the trial and not a length counted from whenever the app looked.
 */
export function trialReminderFireAt(trialEndsAt: number): number {
  return trialEndsAt - TRIAL_REMINDER_LEAD_DAYS * DAY_MS;
}

/**
 * What the OS says about notification permission, as lib/services/notifications
 * reports it (kept as its own union so this file stays free of native imports).
 */
export type ReminderPermission =
  | "granted"
  | "denied"
  | "deniedPermanently"
  | "undetermined"
  | "unavailable";

/**
 * Whether the paywall may promise an ending reminder. Two things take the
 * promise away before the purchase: the app's own notification switch, and an
 * OS refusal the system will not ask about again. A state the OS may still ask
 * about (never asked, or a refusal with a retry left) keeps it, because the
 * purchase raises the prompt; a probe that failed does not, since nothing could
 * be verified.
 */
export function trialReminderDeliverable(input: {
  notificationsEnabled: boolean;
  permission: ReminderPermission;
}): boolean {
  if (!input.notificationsEnabled) return false;
  return input.permission !== "deniedPermanently" && input.permission !== "unavailable";
}

export type TimelineKind = "today" | "reminder" | "charge";

export interface TimelineRow {
  kind: TimelineKind;
  /** Days after the trial starts: 0 is today, the charge row sits on the trial length. */
  day: number;
}

function wholeTrialDays(trialDays: number): number {
  return Number.isFinite(trialDays) && trialDays >= 1
    ? Math.floor(trialDays)
    : DEFAULT_TRIAL_DAYS;
}

/**
 * The paywall's trial timeline: today, the reminder (only when one will really
 * be armed, see trialReminderArmed, and can be delivered, see
 * trialReminderDeliverable) and the first charge. The reminder row is dropped
 * for a short trial or a muted app instead of promising a notification that
 * never comes.
 */
export function buildTrialTimeline(
  trialDays: number,
  reminderDeliverable = true
): TimelineRow[] {
  const n = wholeTrialDays(trialDays);
  const rows: TimelineRow[] = [{ kind: "today", day: 0 }];
  if (reminderDeliverable && trialReminderArmed(n)) {
    rows.push({ kind: "reminder", day: trialReminderFireInDays(n) });
  }
  rows.push({ kind: "charge", day: n });
  return rows;
}

/** Monthly equivalent of the annual price, null when the price is unusable. */
export function perMonthPrice(annualPrice: number | null | undefined): number | null {
  if (annualPrice == null || !Number.isFinite(annualPrice) || annualPrice <= 0) return null;
  return annualPrice / 12;
}

/**
 * Whether to arm the 24-hour "connect Health" nudge for a trial that just
 * started. Needs a trial long enough for it to land before the end, a Health
 * source this device can actually use, and nothing connected yet.
 */
export function shouldScheduleTrialNudge(input: {
  trialDays: number;
  healthAvailable: boolean;
  healthConnected: boolean;
}): boolean {
  return (
    Number.isFinite(input.trialDays) &&
    Math.floor(input.trialDays) >= 2 &&
    input.healthAvailable &&
    !input.healthConnected
  );
}

export interface PersonalSummary {
  readings: number;
  avgMgdl: number;
  /** Share of those readings inside the target band, 0..100. */
  inRangePct: number;
}

/**
 * The paywall's personal line: the user's own manual readings of the last
 * PERSONAL_WINDOW_DAYS. Health imports are left out (the line speaks about what
 * the user logged), and it is null until there are enough readings to mean
 * something. Figures come from computeInsights, so they agree with Insights.
 */
export function personalSummary(
  logs: SugarLog[],
  band: TirBand,
  now: number
): PersonalSummary | null {
  const own = logs.filter((l) => isUserEntered(l.source));
  const ins = computeInsights(
    own,
    [],
    [],
    PERSONAL_WINDOW_DAYS,
    band,
    rangeFromWindow(PERSONAL_WINDOW_DAYS, now)
  );
  if (
    ins.readings < PERSONAL_MIN_READINGS ||
    ins.avgGlucose == null ||
    ins.inRangePct == null
  ) {
    return null;
  }
  return {
    readings: ins.readings,
    avgMgdl: ins.avgGlucose,
    inRangePct: ins.inRangePct,
  };
}
