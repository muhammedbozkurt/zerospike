/**
 * lib/downsellGate.ts correctness harness (2.3.4's downsell-timing fix). No
 * jest, same standalone style as scripts/downsellDay7.test.ts.
 *
 * Run: npx tsx scripts/downsell.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import {
  DOWNSELL_MAX_SHOWS,
  DOWNSELL_REARM_MS,
  DOWNSELL_MIN_DISMISSALS,
  DOWNSELL_FIRST_SHOW_DELAY_MS,
  canShowDownsell,
  applyDownsellShown,
  applyPaywallDismissed,
  initialDownsellState,
  type DownsellState,
} from "../lib/downsellGate";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ": " + detail : ""}`);
  }
}
function eq<T>(name: string, actual: T, expected: T): void {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
function section(title: string): void {
  console.log(`\n${title}`);
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = new Date(2026, 8, 7, 10, 0, 0).getTime();

console.log("zerospike downsellGate test");

section("A. constants match the spec");
{
  eq("DOWNSELL_MAX_SHOWS", DOWNSELL_MAX_SHOWS, 2);
  eq("DOWNSELL_REARM_MS", DOWNSELL_REARM_MS, 7 * DAY);
  eq("DOWNSELL_MIN_DISMISSALS", DOWNSELL_MIN_DISMISSALS, 2);
  eq("DOWNSELL_FIRST_SHOW_DELAY_MS", DOWNSELL_FIRST_SHOW_DELAY_MS, DAY);
}

section("B. first paywall close -> canShowDownsell is false");
{
  const afterFirst = applyPaywallDismissed(initialDownsellState, NOW);
  eq("dismissCount", afterFirst.dismissCount, 1);
  eq("firstDismissAt stamped", afterFirst.firstDismissAt, NOW);
  ok("blocked on the first close", !canShowDownsell(afterFirst, NOW));
  ok("still blocked hours later", !canShowDownsell(afterFirst, NOW + 12 * HOUR));
}

section("C. two closes, less than 24h since the first -> false");
{
  let state = applyPaywallDismissed(initialDownsellState, NOW);
  state = applyPaywallDismissed(state, NOW + 1 * HOUR);
  eq("dismissCount", state.dismissCount, 2);
  eq("firstDismissAt stays the FIRST close", state.firstDismissAt, NOW);
  ok("blocked just under 24h", !canShowDownsell(state, NOW + 23 * HOUR + 59 * 60 * 1000));
}

section("D. two closes, 24h+ since the first -> true");
{
  let state = applyPaywallDismissed(initialDownsellState, NOW);
  state = applyPaywallDismissed(state, NOW + 2 * HOUR);
  ok("allowed exactly at 24h from the FIRST close", canShowDownsell(state, NOW + DAY));
  ok("allowed well past 24h", canShowDownsell(state, NOW + 3 * DAY));
}

section("E. old-shaped state (dismissCount/firstDismissAt absent) -> false, never throws");
{
  // Mirrors what getDownsellState() normalises a pre-2.3.4 blob to.
  const oldShape = { count: 0, lastShownAt: null, lastTrigger: null } as unknown as DownsellState;
  let threw = false;
  let result = true;
  try {
    result = canShowDownsell({ ...oldShape, dismissCount: 0, firstDismissAt: null }, NOW);
  } catch {
    threw = true;
  }
  ok("no throw", !threw);
  ok("reads as not-yet-eligible", !result);
}

section("F. once shown, the existing lifetime cap + re-arm cascade still applies unchanged");
{
  let state = applyPaywallDismissed(initialDownsellState, NOW);
  state = applyPaywallDismissed(state, NOW + 2 * HOUR);
  const eligibleAt = NOW + DAY;
  ok("eligible before the first show", canShowDownsell(state, eligibleAt));
  state = applyDownsellShown(state, "inapp", eligibleAt);
  eq("count after first show", state.count, 1);
  ok("blocked right after the first show (re-arm cooldown)", !canShowDownsell(state, eligibleAt + 1 * HOUR));
  ok("blocked just under the 7-day re-arm", !canShowDownsell(state, eligibleAt + DOWNSELL_REARM_MS - 1000));
  ok("allowed once the re-arm has elapsed", canShowDownsell(state, eligibleAt + DOWNSELL_REARM_MS));
  state = applyDownsellShown(state, "inapp", eligibleAt + DOWNSELL_REARM_MS);
  eq("count after second show", state.count, DOWNSELL_MAX_SHOWS);
  ok("lifetime cap reached -> never again", !canShowDownsell(state, eligibleAt + 100 * DAY));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
