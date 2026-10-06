/**
 * What the paywall does about the trial's reminders once the store has spoken.
 * Pure, so the decision is tested on its own: the paywall reads the store
 * (purchases.ts), hands the answer to trialSettleAction and carries out the
 * action it gets back. Nothing here reads the offer that was on screen, except
 * as a last resort for a trial length the store did not give.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The store's verdict on a completed purchase, the shape purchases.ts's
 * trialAfterPurchase returns (kept as its own type so this file stays free of
 * the service's native imports). An entitlement the purchase only found again
 * (PurchaseOutcome.recovered) arrives as "running" while a trial is active and
 * as "none" otherwise, never as "started".
 */
export type TrialVerdict =
  | { kind: "started"; endsAt: number | null; daysLeft: number | null }
  | { kind: "running" }
  | { kind: "none" };

export type TrialSettleInput =
  | {
      restored: true;
      /** The store's trial state right after the restore; null when nothing is known about a trial. */
      trialStatus: { active: boolean } | null;
    }
  | {
      restored: false;
      trial: TrialVerdict;
      /** The trial length the offer showed. Only used when the store reported no length of its own. */
      offerDays: number;
      now: number;
    };

export interface TrialSettleAction {
  /** Report trial_started. */
  logTrialStarted: boolean;
  /**
   * The moment the trial turns into the first charge (epoch ms), which the
   * ending reminder is timed from: scheduleTrialEndingReminder fires it its lead
   * before this. It is the store's own expiry, so the reminder follows the real
   * end of the trial; a length counted from `now` only stands in when the store
   * gave no expiry. Null: arm nothing.
   */
  scheduleReminderAt: number | null;
  /** Length in days of the trial that just started, which the day-1 nudge is gated on. Null when none started. */
  trialDays: number | null;
  /** Take the pending ending reminder (and the day-1 nudge) down. */
  cancelReminder: boolean;
}

/**
 * - started: a new trial. It is reported and its reminder armed from the store's
 *   expiry.
 * - running: an already-owned recovery while a trial is active. That trial is not
 *   new and its reminder is not ours to touch, so nothing happens.
 * - none: no trial is running (a paid period, a failed purchase). A reminder an
 *   earlier trial left behind no longer applies.
 * - restored: a restore can bring back a trial that is still running, and its
 *   reminder stands. A restored entitlement with no trial in it (lifetime, a paid
 *   subscription) retires a reminder an earlier trial left behind.
 */
export function trialSettleAction(input: TrialSettleInput): TrialSettleAction {
  if (input.restored) {
    return {
      logTrialStarted: false,
      scheduleReminderAt: null,
      trialDays: null,
      cancelReminder: input.trialStatus?.active !== true,
    };
  }
  const { trial } = input;
  switch (trial.kind) {
    case "started": {
      const trialDays = trial.daysLeft ?? input.offerDays;
      return {
        logTrialStarted: true,
        scheduleReminderAt: trial.endsAt ?? input.now + trialDays * DAY_MS,
        trialDays,
        cancelReminder: false,
      };
    }
    case "running":
      return {
        logTrialStarted: false,
        scheduleReminderAt: null,
        trialDays: null,
        cancelReminder: false,
      };
    case "none":
      return {
        logTrialStarted: false,
        scheduleReminderAt: null,
        trialDays: null,
        cancelReminder: true,
      };
  }
}
