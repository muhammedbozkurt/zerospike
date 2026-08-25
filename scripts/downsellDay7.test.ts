/**
 * lib/day7Downsell.ts correctness harness (2.3.0's K3-3b). No jest, same
 * standalone style as scripts/alarmSelect.test.ts.
 *
 * The property under test: the day-7 offer is an AND of five independent
 * conditions, and it is a THIRD entry point into the same two lifetime shows,
 * never an extra one. Every condition is checked alone, so an edit that turns
 * one of them into an OR (or forgets the shared cap) fails loudly here instead
 * of quietly offering a discount to a paying user, offering nothing on an empty
 * offering, or showing a third downsell.
 *
 * The rule lives in a pure module precisely so this can run: the service that
 * wraps it (lib/services/downsell.ts) imports AsyncStorage and RevenueCat,
 * neither of which exists under Node.
 *
 * Run: npx tsx scripts/downsellDay7.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import {
  DAY7_DOWNSELL_AFTER_MS,
  DOWNSELL_MAX_SHOWS,
  day7LocalGate,
  shouldTriggerDay7,
  type Day7DownsellInput,
} from "../lib/day7Downsell";

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
  ok(name, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
function section(title: string): void {
  console.log(`\n${title}`);
}

const HOUR = 60 * 60 * 1000;
const ONBOARDED_AT = 1_700_000_000_000;

/** The only shape that fires: 7 days elapsed, free, unspent, real discount. */
const REARM = 7 * 24 * HOUR;

const DUE: Day7DownsellInput = {
  onboardedAtMs: ONBOARDED_AT,
  now: ONBOARDED_AT + DAY7_DOWNSELL_AFTER_MS,
  isPro: false,
  shownCount: 0,
  alreadyTriggered: false,
  hasRealDiscount: true,
  // No downsell has ever been shown, so the shared cooldown is not in play.
  lastShownAt: null,
  rearmMs: REARM,
};

console.log("zerospike day-7 downsell trigger test");

section("A. the constants are the ones the copy and the cap promise");
{
  eq("the delay is exactly 7 days", DAY7_DOWNSELL_AFTER_MS, 7 * 24 * HOUR);
  eq("the shared lifetime cap is still 2", DOWNSELL_MAX_SHOWS, 2);
}

section("B. the elapsed-time boundary");
{
  eq(
    "6 days 23 hours -> not yet",
    shouldTriggerDay7({ ...DUE, now: ONBOARDED_AT + DAY7_DOWNSELL_AFTER_MS - HOUR }),
    false
  );
  eq(
    "one millisecond short -> not yet",
    shouldTriggerDay7({ ...DUE, now: ONBOARDED_AT + DAY7_DOWNSELL_AFTER_MS - 1 }),
    false
  );
  eq("exactly 7 days -> due", shouldTriggerDay7(DUE), true);
  eq(
    "long overdue (30 days) -> still due",
    shouldTriggerDay7({ ...DUE, now: ONBOARDED_AT + 30 * 24 * HOUR }),
    true
  );
  // A clock the user moved backwards must not be read as "7 days have passed".
  eq(
    "clock behind the anchor -> not due",
    shouldTriggerDay7({ ...DUE, now: ONBOARDED_AT - 30 * 24 * HOUR }),
    false
  );
}

section("C. no anchor means no offer");
{
  eq("unknown onboarding date -> never", shouldTriggerDay7({ ...DUE, onboardedAtMs: null }), false);
  eq(
    "unknown date stays a no even when overdue by every other measure",
    shouldTriggerDay7({ ...DUE, onboardedAtMs: null, now: ONBOARDED_AT + 365 * 24 * HOUR }),
    false
  );
}

section("D. each blocker alone is enough to refuse a due offer");
{
  eq("Pro user -> no discount on their own subscription", shouldTriggerDay7({ ...DUE, isPro: true }), false);
  eq(
    "lifetime cap full (2 shows spent) -> no",
    shouldTriggerDay7({ ...DUE, shownCount: DOWNSELL_MAX_SHOWS }),
    false
  );
  eq(
    "over the cap (defensive, a stale count) -> no",
    shouldTriggerDay7({ ...DUE, shownCount: DOWNSELL_MAX_SHOWS + 1 }),
    false
  );
  eq("no real discount configured -> no", shouldTriggerDay7({ ...DUE, hasRealDiscount: false }), false);
  eq("already triggered once -> never again", shouldTriggerDay7({ ...DUE, alreadyTriggered: true }), false);
}

section("E. one show still left under the cap is allowed");
{
  eq("1 of 2 shows spent -> due", shouldTriggerDay7({ ...DUE, shownCount: 1 }), true);
}

section("F. it really is an AND: only the all-clear input fires");
{
  // Exhaustive over the five booleans-in-effect (elapsed, free, under the cap,
  // unspent, real discount), so an accidental OR anywhere is caught.
  for (const elapsed of [true, false]) {
    for (const isPro of [true, false]) {
      for (const underCap of [true, false]) {
        for (const alreadyTriggered of [true, false]) {
          for (const hasRealDiscount of [true, false]) {
            const input: Day7DownsellInput = {
              onboardedAtMs: ONBOARDED_AT,
              now: ONBOARDED_AT + (elapsed ? DAY7_DOWNSELL_AFTER_MS : HOUR),
              isPro,
              shownCount: underCap ? 0 : DOWNSELL_MAX_SHOWS,
              alreadyTriggered,
              hasRealDiscount,
            };
            eq(
              `elapsed=${elapsed} pro=${isPro} underCap=${underCap} spent=${alreadyTriggered} discount=${hasRealDiscount}`,
              shouldTriggerDay7(input),
              elapsed && !isPro && underCap && !alreadyTriggered && hasRealDiscount
            );
          }
        }
      }
    }
  }
}

section("G. the local gate is the store-free half of the same rule");
{
  // The service only pays for the entitlement / offering round trips once this
  // half already holds, so it must never be STRICTER than the full rule.
  const local = {
    onboardedAtMs: DUE.onboardedAtMs,
    now: DUE.now,
    shownCount: DUE.shownCount,
    alreadyTriggered: DUE.alreadyTriggered,
  };
  eq("due input passes the local gate", day7LocalGate(local), true);
  eq(
    "the local gate ignores Pro and the discount (it cannot see them)",
    day7LocalGate(local),
    shouldTriggerDay7({ ...DUE, isPro: false, hasRealDiscount: true })
  );
  eq("not elapsed -> local gate already refuses", day7LocalGate({ ...local, now: ONBOARDED_AT }), false);
  eq(
    "cap full -> local gate already refuses",
    day7LocalGate({ ...local, shownCount: DOWNSELL_MAX_SHOWS }),
    false
  );
  eq("already spent -> local gate already refuses", day7LocalGate({ ...local, alreadyTriggered: true }), false);
  eq("no anchor -> local gate already refuses", day7LocalGate({ ...local, onboardedAtMs: null }), false);
}

section("F. the shared re-arm cooldown applies to this trigger too (X10)");
{
  // Two discount pages in the same week is exactly what DOWNSELL_REARM_MS
  // exists to prevent, and the seventh day can easily land right after an
  // in-app downsell. Without this the user could get one on Monday from the
  // in-app trigger and another on Tuesday from day 7.
  const shownRecently = DUE.now - HOUR;
  eq(
    "a downsell an hour ago blocks it",
    shouldTriggerDay7({ ...DUE, lastShownAt: shownRecently }),
    false
  );
  eq(
    "one millisecond inside the cooldown still blocks it",
    shouldTriggerDay7({ ...DUE, lastShownAt: DUE.now - REARM + 1 }),
    false
  );
  eq(
    "exactly the cooldown ago lets it through",
    shouldTriggerDay7({ ...DUE, lastShownAt: DUE.now - REARM }),
    true
  );
  eq(
    "well past the cooldown lets it through",
    shouldTriggerDay7({ ...DUE, lastShownAt: DUE.now - 30 * 24 * HOUR }),
    true
  );
  eq(
    "never shown before lets it through",
    shouldTriggerDay7({ ...DUE, lastShownAt: null }),
    true
  );
  // The local gate carries the same rule, so the caller can skip the
  // entitlement and offering lookups on a day the cooldown already says no.
  eq(
    "the local gate blocks it too, before any store lookup",
    day7LocalGate({ ...DUE, lastShownAt: shownRecently }),
    false
  );
  // The cooldown does not RESCUE an otherwise-blocked case.
  eq(
    "cooldown clear but already spent -> still no",
    shouldTriggerDay7({ ...DUE, lastShownAt: null, alreadyTriggered: true }),
    false
  );
  eq(
    "cooldown clear but the lifetime cap is full -> still no",
    shouldTriggerDay7({ ...DUE, lastShownAt: null, shownCount: DOWNSELL_MAX_SHOWS }),
    false
  );
  eq(
    "cooldown clear but not yet day 7 -> still no",
    shouldTriggerDay7({ ...DUE, lastShownAt: null, now: ONBOARDED_AT + HOUR }),
    false
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
