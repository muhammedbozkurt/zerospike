/**
 * lib/downsellGate.ts correctness harness (2.4 paywall-exit rule: annual
 * selected + cancelled purchase or closed paywall => same-session offer once,
 * then 7-day cool-off and a lifetime cap of 2). No jest, same standalone style
 * as scripts/downsellDay7.test.ts.
 *
 * Run: npx tsx scripts/downsell.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import {
  DOWNSELL_MAX_SHOWS,
  DOWNSELL_REARM_MS,
  canShowDownsell,
  applyDownsellShown,
  applyPaywallDismissed,
  initialDownsellState,
  paywallExitLocalGate,
  shouldOfferDownsellOnPaywallExit,
  type DownsellState,
  type PaywallExitInput,
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

function exitInput(over: Partial<PaywallExitInput> = {}): PaywallExitInput {
  return {
    state: initialDownsellState,
    now: NOW,
    plan: "annual",
    isPro: false,
    shownThisSession: false,
    hasRealDiscount: true,
    ...over,
  };
}

section("A. constants match the spec");
{
  eq("DOWNSELL_MAX_SHOWS", DOWNSELL_MAX_SHOWS, 2);
  eq("DOWNSELL_REARM_MS", DOWNSELL_REARM_MS, 7 * DAY);
}

section("B. first paywall exit, annual selected, real discount -> offered in the same session");
{
  // Cancelled store purchase and a closed paywall reach the same decision.
  ok("fresh user, annual, real discount", shouldOfferDownsellOnPaywallExit(exitInput()));
  const afterClose = applyPaywallDismissed(initialDownsellState, NOW);
  ok(
    "the close just recorded does not block (no dismissal-count or 24h wait)",
    shouldOfferDownsellOnPaywallExit(exitInput({ state: afterClose }))
  );
}

section("C. no real store discount -> never offered");
{
  ok("hasRealDiscount false", !shouldOfferDownsellOnPaywallExit(exitInput({ hasRealDiscount: false })));
  ok("local gate alone is still open (store lookup decides)", paywallExitLocalGate(exitInput()));
}

section("D. other plan selected -> not offered");
{
  ok("monthly", !shouldOfferDownsellOnPaywallExit(exitInput({ plan: "monthly" })));
  ok("lifetime", !shouldOfferDownsellOnPaywallExit(exitInput({ plan: "lifetime" })));
}

section("E. already Pro -> never offered");
{
  ok("isPro", !shouldOfferDownsellOnPaywallExit(exitInput({ isPro: true })));
}

section("F. never twice in one session");
{
  ok("shownThisSession blocks", !shouldOfferDownsellOnPaywallExit(exitInput({ shownThisSession: true })));
  // Even after the 7-day cool-off has passed, the same session stays blocked.
  const shown = applyDownsellShown(initialDownsellState, "inapp", NOW);
  ok(
    "same session blocked even past the cool-off",
    !shouldOfferDownsellOnPaywallExit(
      exitInput({ state: shown, now: NOW + 8 * DAY, shownThisSession: true })
    )
  );
}

section("G. 7-day cool-off and lifetime cap of 2");
{
  const first = applyDownsellShown(initialDownsellState, "inapp", NOW);
  eq("count after first show", first.count, 1);
  const at = (ms: number) => exitInput({ state: first, now: NOW + ms });
  ok("blocked an hour later (new session)", !shouldOfferDownsellOnPaywallExit(at(1 * HOUR)));
  ok("blocked just under 7 days", !shouldOfferDownsellOnPaywallExit(at(DOWNSELL_REARM_MS - 1000)));
  ok("allowed at exactly 7 days", shouldOfferDownsellOnPaywallExit(at(DOWNSELL_REARM_MS)));
  const second = applyDownsellShown(first, "inapp", NOW + DOWNSELL_REARM_MS);
  eq("count after second show", second.count, DOWNSELL_MAX_SHOWS);
  ok(
    "lifetime cap reached -> never again",
    !shouldOfferDownsellOnPaywallExit(exitInput({ state: second, now: NOW + 100 * DAY }))
  );
}

section("H. the day-7 / winback trigger spends the same lifetime shows");
{
  const viaDay7 = applyDownsellShown(initialDownsellState, "day7", NOW);
  ok("a day7 show starts the cool-off for the paywall exit", !canShowDownsell(viaDay7, NOW + 1 * DAY));
  ok("and re-opens after 7 days", canShowDownsell(viaDay7, NOW + DOWNSELL_REARM_MS));
}

section("I. old-shaped state (dismissCount/firstDismissAt absent) never throws");
{
  const oldShape = { count: 0, lastShownAt: null, lastTrigger: null } as unknown as DownsellState;
  let threw = false;
  let result = false;
  try {
    result = shouldOfferDownsellOnPaywallExit(
      exitInput({ state: { ...oldShape, dismissCount: 0, firstDismissAt: null } })
    );
  } catch {
    threw = true;
  }
  ok("no throw", !threw);
  ok("reads as eligible, rule no longer depends on dismissal history", result);
}

section("J. paywall close bookkeeping");
{
  let state = applyPaywallDismissed(initialDownsellState, NOW);
  state = applyPaywallDismissed(state, NOW + HOUR);
  eq("dismissCount", state.dismissCount, 2);
  eq("firstDismissAt stays the FIRST close", state.firstDismissAt, NOW);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
