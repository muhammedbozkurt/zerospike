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
  decidePostMealAutoStart,
  restartPostMealWindowAt,
  POST_MEAL_MIN_SCHEDULE_MS,
  POST_MEAL_AUTO_START_TOLERANCE_MS,
  clampPostMealMinutes,
  postMealWindowForProfile,
  POST_MEAL_MIN_MINUTES,
  POST_MEAL_MAX_MINUTES,
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

section("H. decidePostMealAutoStart - a running timer is never touched by a meal log");
{
  // (a) SIFIRLAMA KURALI: a timer already running is left alone, no matter how
  // close or far the new meal's own logged_at is - even a meal logged exactly
  // "now" must not restart it.
  eq(
    "active timer, meal logged right now",
    decidePostMealAutoStart({ timerActive: true, loggedAtMs: START, now: START }),
    "active"
  );
  eq(
    "active timer, meal backdated by hours",
    decidePostMealAutoStart({ timerActive: true, loggedAtMs: START - 3 * 60 * MIN, now: START }),
    "active"
  );
  eq(
    "active timer, meal logged slightly in the future (clock skew)",
    decidePostMealAutoStart({ timerActive: true, loggedAtMs: START + MIN, now: START }),
    "active"
  );
}

section("H. decidePostMealAutoStart - idle, logged close to now: starts as before");
{
  // (b) no timer running: a meal logged right now arms it, same as the
  // pre-existing auto-start behaviour.
  eq(
    "idle, logged this instant",
    decidePostMealAutoStart({ timerActive: false, loggedAtMs: START, now: START }),
    "start"
  );
  eq(
    "idle, logged a few seconds ago (save latency)",
    decidePostMealAutoStart({ timerActive: false, loggedAtMs: START - 5_000, now: START }),
    "start"
  );
  eq(
    "idle, exactly at the tolerance boundary still starts",
    decidePostMealAutoStart({
      timerActive: false,
      loggedAtMs: START - POST_MEAL_AUTO_START_TOLERANCE_MS,
      now: START,
    }),
    "start"
  );
  eq("tolerance constant", POST_MEAL_AUTO_START_TOLERANCE_MS, 5 * MIN);
}

section("H. decidePostMealAutoStart - idle, but the record is backdated: no auto-start");
{
  // (d) writing up an earlier meal (last night's dinner, logged today) must not
  // arm a countdown that fires relative to right now.
  eq(
    "idle, one second past the tolerance",
    decidePostMealAutoStart({
      timerActive: false,
      loggedAtMs: START - POST_MEAL_AUTO_START_TOLERANCE_MS - 1_000,
      now: START,
    }),
    "backdated"
  );
  eq(
    "idle, logged hours ago",
    decidePostMealAutoStart({ timerActive: false, loggedAtMs: START - 6 * 60 * MIN, now: START }),
    "backdated"
  );
  // A timer already running always wins over a backdated record too - "active"
  // is checked first, so there is nothing left to decide about how old the
  // meal is.
  eq(
    "active timer beats a backdated record",
    decidePostMealAutoStart({ timerActive: true, loggedAtMs: START - 6 * 60 * MIN, now: START }),
    "active"
  );
}

section("I. restartPostMealWindowAt - the deliberate reset (button + dashboard action)");
{
  // (c) "Yemeğe başladım" (and the dashboard's "restart for this meal" action)
  // always re-anchors to the GIVEN moment and computes a brand new window from
  // it - it does not carry over an old timer's own remaining time. An old timer
  // armed at START (120 min window, 90 min already gone - only 30 min left on
  // IT) is superseded by a newer meal logged 5 min ago: restarting from that
  // newer meal's own moment leaves ~115 min, not the old timer's 30.
  const oldMealStart = START;
  const newMealStart = START + 85 * MIN;
  const now = START + 90 * MIN;
  const r = restartPostMealWindowAt({ startedAt: newMealStart, windowMin: 120, now });
  eq("kind", r.kind, "restarted");
  if (r.kind === "restarted") {
    eq("starts at the NEW meal's own moment", r.startedAt, newMealStart);
    eq("ends a full window after the new anchor", r.endsAt, newMealStart + 120 * MIN);
    eq("~115 min left, not the old timer's 30", r.remainingMs / MIN, 115);
  }
  // What the OLD timer alone would have had left, for contrast.
  const oldTimerRemaining = (oldMealStart + 120 * MIN - now) / MIN;
  eq("old timer's own remaining was only 30 min", oldTimerRemaining, 30);

  // A settings-driven retime instead (unchanged behaviour, section A/B): the
  // anchor stays put and only the ELAPSED time against it is preserved - a
  // fundamentally different operation from restarting at a new anchor above.
  const preserving = retimePostMealWindow({
    startedAt: oldMealStart,
    currentEndsAt: oldMealStart + 120 * MIN,
    nextWindowMin: 150,
    now,
  });
  if (preserving.kind === "retimed") {
    eq("retime keeps the OLD anchor", preserving.startedAt, oldMealStart);
    eq("retime keeps only what the old window has left", preserving.remainingMs / MIN, 60);
  }

  // Anchoring far enough in the past that the fresh window is already spent:
  // closed out, same floor rule as retimePostMealWindow.
  const stale = restartPostMealWindowAt({
    startedAt: START,
    windowMin: 90,
    now: START + 90 * MIN,
  });
  eq("anchored past its own window: elapsed", stale.kind, "elapsed");

  eq(
    "30 s short of the schedule floor: elapsed",
    restartPostMealWindowAt({ startedAt: START, windowMin: 90, now: START + 89.5 * MIN }).kind,
    "elapsed"
  );
  eq(
    "exactly at the floor still restarts",
    restartPostMealWindowAt({ startedAt: START, windowMin: 90, now: START + 89 * MIN }).kind,
    "restarted"
  );
}

section("J. clampPostMealMinutes - the one gate a hand-picked length passes");
{
  // 2.3.0's K2-C: the duration sheet and startPostMealTimer(minutes) both route
  // through this, so a length can never reach the scheduler unrounded or out of
  // range whichever surface picked it.
  eq("a chip value passes through", clampPostMealMinutes(90), 90);
  eq("the low bound is kept", clampPostMealMinutes(POST_MEAL_MIN_MINUTES), POST_MEAL_MIN_MINUTES);
  eq("the high bound is kept", clampPostMealMinutes(POST_MEAL_MAX_MINUTES), POST_MEAL_MAX_MINUTES);
  eq("below the low bound clamps up", clampPostMealMinutes(1), POST_MEAL_MIN_MINUTES);
  eq("zero clamps up", clampPostMealMinutes(0), POST_MEAL_MIN_MINUTES);
  eq("negative clamps up", clampPostMealMinutes(-45), POST_MEAL_MIN_MINUTES);
  eq("above the high bound clamps down", clampPostMealMinutes(1000), POST_MEAL_MAX_MINUTES);
  eq("a fraction rounds to the nearest minute", clampPostMealMinutes(89.4), 89);
  eq("and rounds half up", clampPostMealMinutes(89.5), 90);
  // A NaN would arm a countdown that can never fire; the floor is the only safe
  // answer, and it is deliberately not 0.
  eq("NaN falls back to the low bound", clampPostMealMinutes(NaN), POST_MEAL_MIN_MINUTES);
  eq("Infinity falls back to the low bound", clampPostMealMinutes(Infinity), POST_MEAL_MIN_MINUTES);
  ok("the range covers every settings preset", POST_MEAL_MIN_MINUTES <= 60 && POST_MEAL_MAX_MINUTES >= 150);
}

section("K. postMealWindowForProfile - whose countdown is this");
{
  // The rule the dashboard card, the reminders screen's upcoming list and the
  // post-meal deep link all read, so a caregiver never sees one profile's
  // countdown presented as another's (2.3.0's K2-A brought the third caller).
  const owned = { startedAt: START, endsAt: START + 90 * MIN, profileId: "p1" };
  const orphan = { startedAt: START, endsAt: START + 90 * MIN };

  eq("its owner sees it", postMealWindowForProfile(owned, "p1"), owned);
  eq("another profile does not", postMealWindowForProfile(owned, "p2"), null);
  eq("no active profile at all does not", postMealWindowForProfile(owned, null), null);
  eq("nor undefined", postMealWindowForProfile(owned, undefined), null);
  // A timer with no recorded owner predates the lock: it stays visible to
  // whoever is looking, exactly as it did before.
  eq("an unowned timer shows for anyone", postMealWindowForProfile(orphan, "p2"), orphan);
  eq("and with no active profile", postMealWindowForProfile(orphan, null), orphan);
  eq("no timer, nothing to show", postMealWindowForProfile(null, "p1"), null);
  // Never a copy: callers compare identity to decide whether to re-render.
  ok("returns the SAME object, not a clone", postMealWindowForProfile(owned, "p1") === owned);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
