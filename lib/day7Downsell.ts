/**
 * Downsell trigger rules, kept pure. No AsyncStorage and no RevenueCat here, so
 * the decision can be exercised under plain Node by
 * scripts/downsellDay7.test.ts; lib/services/downsell.ts is the only place that
 * reads the inputs, pays for the store round trips and writes the flags.
 */

/**
 * Lifetime show cap shared by EVERY downsell trigger (onboarding dismiss, the
 * re-armed in-app dismiss, and the day-7 offer below). Re-exported from
 * lib/services/downsell.ts, which is where the rest of the app reads it.
 */
export const DOWNSELL_MAX_SHOWS = 2;

/** How long after onboarding the once-per-lifetime day-7 offer becomes due. */
export const DAY7_DOWNSELL_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/** The half of the rule that costs nothing to evaluate (storage reads only). */
export interface Day7LocalInput {
  /** When onboarding finished, or null when no anchor has been stamped yet. */
  onboardedAtMs: number | null;
  now: number;
  /** Shows already spent from the shared lifetime counter. */
  shownCount: number;
  /** Whether the day-7 offer has been spent already (once per lifetime). */
  alreadyTriggered: boolean;
  /** When ANY downsell was last shown, or null if none ever was. The day-7
   *  offer honours the shared re-arm cooldown too (X10): two discount pages in
   *  the same week is what the cooldown exists to prevent, and a trigger that
   *  ignored it could land the day after an in-app one. */
  lastShownAt: number | null;
  /** The shared cooldown between any two downsells (DOWNSELL_REARM_MS). */
  rearmMs: number;
}

export interface Day7DownsellInput extends Day7LocalInput {
  isPro: boolean;
  hasRealDiscount: boolean;
}

/**
 * Everything decidable from local state alone. Split out so the caller can skip
 * the entitlement and offering lookups on the days the answer is already no.
 */
export function day7LocalGate(i: Day7LocalInput): boolean {
  if (i.alreadyTriggered) return false;
  if (i.shownCount >= DOWNSELL_MAX_SHOWS) return false;
  // The shared cooldown applies to this trigger like any other: a downsell
  // shown less than DOWNSELL_REARM_MS ago blocks it, so the seventh day cannot
  // stack a second discount page on top of a recent one.
  if (i.lastShownAt !== null && i.now - i.lastShownAt < i.rearmMs) return false;
  if (i.onboardedAtMs === null) return false;
  return i.now - i.onboardedAtMs >= DAY7_DOWNSELL_AFTER_MS;
}

/**
 * The full rule. A lifetime show is only ever spent on an offer that really is
 * cheaper, and never on someone who already holds the entitlement.
 */
export function shouldTriggerDay7(i: Day7DownsellInput): boolean {
  return day7LocalGate(i) && !i.isPro && i.hasRealDiscount;
}
