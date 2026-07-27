/**
 * lib/mealResponse.ts correctness harness. No jest — same standalone style as
 * scripts/calc.test.ts.
 *
 * Run: npx tsx scripts/mealResponse.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import {
  computeMealResponse,
  MEAL_RESPONSE_HOURS,
  type MealResponseMealInput,
  type MealResponseReadingInput,
} from "../lib/mealResponse";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? "  — " + detail : ""}`);
  }
}
function eq<T>(name: string, actual: T, expected: T): void {
  ok(name, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
function section(title: string): void {
  console.log(`\n${title}`);
}

const P = {
  target_fasting_min: 80,
  target_fasting_max: 100,
  target_postmeal_min: 80,
  target_postmeal_max: 140,
  hypo_threshold_mgdl: 70,
};

const START = "2026-07-01T08:00:00.000Z";
const startMs = new Date(START).getTime();
const at = (min: number) => new Date(startMs + min * 60_000).toISOString();

const meal = (id: string, sugarLogId: string | null = null): MealResponseMealInput => ({
  id,
  logged_at: START,
  sugar_log_id: sugarLogId,
});

const reading = (id: string, min: number, mgdl: number): MealResponseReadingInput => ({
  id,
  logged_at: at(min),
  glucose_level_mgdl: mgdl,
});

console.log("zerospike meal response test");
eq("MEAL_RESPONSE_HOURS is 3", MEAL_RESPONSE_HOURS, 3);

// ── A. Window boundary ───────────────────────────────────────────────────────
section("A. window boundary (3h01 falls outside, 3h00 inside)");
{
  const readings = [
    reading("r1", 0, 100),
    reading("r2", 60, 150),
    reading("r3", 180, 130), // exactly at the 3h edge — included
    reading("r4", 181, 999), // 3h01 — excluded (and would blow up peak if not)
  ];
  const res = computeMealResponse(meal("m1"), readings, P);
  ok("result is not null", res !== null);
  eq("curve excludes the 3h01 reading", res?.curve.length, 3);
  eq("peak is 150, not the excluded 999", res?.peak, 150);
}

// ── B. Baseline selection ────────────────────────────────────────────────────
section("B. baseline selection (linked > 45-min-before > null)");
{
  // Linked reading wins even though a closer unlinked one exists before start.
  const readings = [
    reading("linked", -100, 90), // outside the 45-min lookback, but it's the linked one
    reading("before", -10, 105), // inside the lookback, would win if not for the link
    reading("r1", 30, 140),
    reading("r2", 60, 160),
  ];
  const res = computeMealResponse(meal("m2", "linked"), readings, P);
  eq("linked reading wins as baseline", res?.baseline, 90);
  eq("delta uses the linked baseline (160-90)", res?.delta, 70);
}
{
  // No link: nearest (= latest) reading within 45 min before wins.
  const readings = [
    reading("far", -40, 95),
    reading("near", -5, 110), // closer to start — this one wins
    reading("r1", 30, 140),
    reading("r2", 60, 150),
  ];
  const res = computeMealResponse(meal("m3"), readings, P);
  eq("nearest before-start reading wins baseline", res?.baseline, 110);
}
{
  // No link, nothing within 45 min before → baseline null, curve still exists.
  const readings = [
    reading("tooFar", -60, 95), // outside the 45-min lookback
    reading("r1", 10, 140),
    reading("r2", 90, 160),
  ];
  const res = computeMealResponse(meal("m4"), readings, P);
  ok("result still returned (curve stands alone)", res !== null);
  eq("baseline is null with no candidate", res?.baseline, null);
  eq("delta is null without a baseline", res?.delta, null);
  eq("peak is still computed", res?.peak, 160);
}

// ── C. Peak / time-to-peak ───────────────────────────────────────────────────
section("C. peak + timeToPeakMin");
{
  const readings = [
    reading("r0", 0, 100),
    reading("r1", 45, 210),
    reading("r2", 90, 180),
    reading("r3", 150, 130),
  ];
  const res = computeMealResponse(meal("m5", "r0"), readings, P);
  eq("baseline from linked r0", res?.baseline, 100);
  eq("peak is 210", res?.peak, 210);
  eq("timeToPeakMin is 45", res?.timeToPeakMin, 45);
  eq("delta is 110", res?.delta, 110);
}

// ── D. Two-hour read-out ─────────────────────────────────────────────────────
section("D. twoHourValue (nearest to +120min within [90,150])");
{
  const readings = [
    reading("r0", 0, 100),
    reading("r1", 95, 150), // 25 min from 120
    reading("r2", 118, 140), // 2 min from 120 — closest
    reading("r3", 145, 135), // 25 min from 120
  ];
  const res = computeMealResponse(meal("m6", "r0"), readings, P);
  eq("nearest-to-120 reading picked", res?.twoHourValue, 140);
}
{
  // Nothing falls in [90,150] → null, not a wrong guess from outside the window.
  const readings = [reading("r0", 0, 100), reading("r1", 30, 150), reading("r2", 170, 140)];
  const res = computeMealResponse(meal("m7", "r0"), readings, P);
  eq("no candidate in [90,150] -> null", res?.twoHourValue, null);
}

// ── E. Band distribution (the user's own post-meal range) ───────────────────
section("E. band distribution");
{
  // Range is 80-140, hypo 70. Values: 60 (low), 100 (in), 130 (in), 200 (high).
  const readings = [
    reading("r0", 0, 60),
    reading("r1", 30, 100),
    reading("r2", 60, 130),
    reading("r3", 90, 200),
  ];
  const res = computeMealResponse(meal("m8"), readings, P);
  eq("lowPct 25", res?.band.lowPct, 25);
  eq("inRangePct 50", res?.band.inRangePct, 50);
  eq("highPct 25", res?.band.highPct, 25);
}

// ── F. Insufficient data -> null ─────────────────────────────────────────────
section("F. insufficient data");
{
  const res0 = computeMealResponse(meal("m9"), [], P);
  eq("zero readings -> null", res0, null);
  const res1 = computeMealResponse(meal("m10"), [reading("r0", 30, 140)], P);
  eq("one reading in window -> null", res1, null);
  // A reading exists but it's outside the window entirely.
  const res2 = computeMealResponse(meal("m11"), [reading("r0", 400, 140)], P);
  eq("only out-of-window readings -> null", res2, null);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
