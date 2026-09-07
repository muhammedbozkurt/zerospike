/**
 * "First value" paywall trigger, kept pure and dependency-free (same reason
 * as lib/day7Downsell.ts / lib/downsellGate.ts) so scripts/afterLogsPaywall.
 * test.ts can exercise it under plain Node.
 *
 * 2.3.4 moved the paywall off the end of onboarding (0/16 trials in the 24
 * Ağu - 7 Eyl window) and onto the dashboard, opening once a profile's own
 * log count first reaches AFTER_LOGS_THRESHOLD - after the user has actually
 * logged something, not before. See lib/services/afterLogsPaywall.ts for the
 * AsyncStorage-backed one-shot gate (armed at onboarding completion, so a
 * pre-2.3.4 install with a long history is grandfathered rather than shown a
 * paywall out of nowhere on update) that calls this.
 */
export const AFTER_LOGS_THRESHOLD = 3;

export interface AfterLogsPaywallInput {
  /**
   * The VISIBLE log count - what the user themselves would count as their own
   * entries, read live from the journal (no separate counter is kept for it).
   * The caller (app/(tabs)/index.tsx) MUST read this with
   * `excludeCalculatorInjections: true` (lib/db/journal.ts getJournal), the
   * same option the dashboard's own list uses: a meal logged through the
   * calculator with a dose also silently writes a second, source='calculator'
   * injection row (app/calculator.tsx) that the user never sees as a separate
   * entry. Passing the raw (unfiltered) count would let that one action spend
   * two of the three logs this function is counting.
   */
  logCount: number;
  /** True once the one-shot has already been spent (shown, or grandfathered
   *  for a pre-2.3.4 install) - see lib/services/afterLogsPaywall.ts. */
  alreadyTriggered: boolean;
  isProUser: boolean;
}

export function shouldTriggerAfterLogsPaywall(input: AfterLogsPaywallInput): boolean {
  return (
    !input.alreadyTriggered &&
    !input.isProUser &&
    input.logCount >= AFTER_LOGS_THRESHOLD
  );
}
