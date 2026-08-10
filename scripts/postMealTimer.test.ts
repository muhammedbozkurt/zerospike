/**
 * lib/postMealTimer.ts correctness harness. No jest, same standalone style as
 * scripts/calc.test.ts.
 *
 * The property under test: the post-meal window belongs to the MEAL, not to the
 * moment the user changed the preference. Shortening 120 to 90 with 10 minutes
 * behind must leave 80 minutes, not 90 and not the old 120.
 *
 * Run: npx tsx scripts/postMealTimer.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import {
  derivePostMealStart,
  formatPostMealRemaining,
  postMealElapsedFraction,
  retimePostMealWindow,
  POST_MEAL_MIN_SCHEDULE_MS,
} from "../lib/postMealTimer";

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

const MIN = 60_000;
/** Fixed clock, so nothing here depends on when the suite runs. */
const START = 1_800_000_000_000;

/** A timer armed at START for `windowMin`, re-measured `elapsedMin` in. */
function retime(windowMin: number, elapsedMin: number, nextWindowMin: number) {
  return retimePostMealWindow({
    startedAt: START,
    currentEndsAt: START + windowMin * MIN,
    nextWindowMin,
    now: START + elapsedMin * MIN,
  });
}

console.log("zerospike post-meal timer test");

section("A. shortening the window keeps the elapsed time");
{
  // The reported bug: 120 min timer, 10 min in, moved to 90 -> 80 min left.
  const r = retime(120, 10, 90);
  eq("kind", r.kind, "retimed");
  if (r.kind === "retimed") {
    eq("start is untouched", r.startedAt, START);
    eq("ends 90 min after the meal", r.endsAt, START + 90 * MIN);
    eq("80 min left", r.remainingMs / MIN, 80);
  }
}

section("B. lengthening the window");
{
  const r = retime(90, 10, 150);
  eq("kind", r.kind, "retimed");
  if (r.kind === "retimed") {
    eq("ends 150 min after the meal", r.endsAt, START + 150 * MIN);
    eq("140 min left", r.remainingMs / MIN, 140);
  }
  // A window lengthened past its old end must revive the countdown, not resume
  // from the moment of the change.
  const late = retime(90, 85, 120);
  eq("late lengthen retimes", late.kind, "retimed");
  if (late.kind === "retimed") eq("35 min left", late.remainingMs / MIN, 35);
}

section("C. more elapsed than the new window: the timer is over");
{
  // 120 min timer, 100 min in, moved to 90: the moment it described has passed.
  const r = retime(120, 100, 90);
  eq("kind", r.kind, "elapsed");
  if (r.kind === "elapsed") eq("end is in the past", r.endsAt < START + 100 * MIN, true);

  // Exactly on the boundary counts as over too - nothing is fired for it.
  eq("exact boundary", retime(120, 90, 90).kind, "elapsed");

  // Under the scheduler floor: cannot be placed at its real moment, so it is
  // closed out rather than rounded up to a minute.
  eq("30 s short of the floor", retime(120, 89.5, 90).kind, "elapsed");
  eq("floor constant", POST_MEAL_MIN_SCHEDULE_MS, 60_000);
  eq("exactly at the floor still schedules", retime(120, 89, 90).kind, "retimed");
}

section("D. the same window is a no-op");
{
  const r = retime(120, 10, 120);
  eq("kind", r.kind, "unchanged");
  if (r.kind === "unchanged") eq("end is where it was", r.endsAt, START + 120 * MIN);
}

section("E. a timer with no recorded start");
{
  // Persisted before the start moment was stored: it is recovered from the end
  // and the window the timer was armed with, so re-timing behaves identically.
  const endsAt = START + 120 * MIN;
  eq("derived start", derivePostMealStart(endsAt, 120), START);
  const r = retimePostMealWindow({
    startedAt: derivePostMealStart(endsAt, 120),
    currentEndsAt: endsAt,
    nextWindowMin: 90,
    now: START + 10 * MIN,
  });
  eq("kind", r.kind, "retimed");
  if (r.kind === "retimed") eq("80 min left", r.remainingMs / MIN, 80);
}

section("F. elapsed fraction reads the timer's own window");
{
  const w = { startedAt: START, endsAt: START + 120 * MIN };
  eq("fresh", postMealElapsedFraction(w, START), 0);
  eq("halfway", postMealElapsedFraction(w, START + 60 * MIN), 0.5);
  eq("done", postMealElapsedFraction(w, START + 120 * MIN), 1);
  eq("clamped past the end", postMealElapsedFraction(w, START + 200 * MIN), 1);
  eq("clamped before the start", postMealElapsedFraction(w, START - MIN), 0);
  // Shortened mid-flight: the bar jumps forward because the window really is
  // shorter now, instead of being measured against a length that no longer runs.
  const shortened = { startedAt: START, endsAt: START + 90 * MIN };
  eq("after shortening", postMealElapsedFraction(shortened, START + 45 * MIN), 0.5);
  eq("degenerate window", postMealElapsedFraction({ startedAt: START, endsAt: START }, START), 1);
}

section("G. countdown formatting is unchanged");
{
  eq("2 h reads in minutes", formatPostMealRemaining(120 * MIN).value, 120);
  eq("minutes round up", formatPostMealRemaining(61_000).value, 2);
  eq("under a minute switches to seconds", formatPostMealRemaining(59_000).seconds, true);
  eq("zero", formatPostMealRemaining(0).value, 0);
  eq("negative clamps", formatPostMealRemaining(-5_000).value, 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
