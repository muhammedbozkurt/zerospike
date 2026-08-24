/**
 * lib/postMealTimer.ts correctness harness. No jest, same standalone style as
 * scripts/calc.test.ts.
 *
 * The property under test: the post-meal window belongs to the MEAL, not to the
 * moment the user pressed anything. The window itself is a fixed two hours
 * (2.3.0's G15), so what has to be right is WHERE it starts - a user logging 30
 * minutes late gets 90 minutes left, anchored to the meal.
 *
 * Run: npx tsx scripts/postMealTimer.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import {
  derivePostMealStart,
  formatPostMealRemaining,
  postMealElapsedFraction,
  decidePostMealAutoStart,
  restartPostMealWindowAt,
  POST_MEAL_MIN_SCHEDULE_MS,
  POST_MEAL_AUTO_START_TOLERANCE_MS,
  clampPostMealMinutes,
  clampPostMealLateMinutes,
  postMealWindowForProfile,
  startPostMealLate,
  POST_MEAL_MIN_MINUTES,
  POST_MEAL_MAX_MINUTES,
  POST_MEAL_LATE_MAX_MIN,
  POST_MEAL_WINDOW_MIN,
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

console.log("zerospike post-meal timer test");

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

  // Anchoring far enough in the past that the fresh window is already spent:
  // closed out, the same floor rule startPostMealLate applies.
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

section("J. clampPostMealMinutes - the one gate a countdown length passes");
{
  // 2.3.0's G15: the window is fixed, so what this now guards is the REMAINING
  // time a late start arms - never under five minutes, never more than the
  // window itself.
  eq("a chip value passes through", clampPostMealMinutes(90), 90);
  eq("the low bound is kept", clampPostMealMinutes(POST_MEAL_MIN_MINUTES), POST_MEAL_MIN_MINUTES);
  eq("the high bound is kept", clampPostMealMinutes(POST_MEAL_MAX_MINUTES), POST_MEAL_MAX_MINUTES);
  eq("below the low bound clamps up", clampPostMealMinutes(1), POST_MEAL_MIN_MINUTES);
  eq("zero clamps up", clampPostMealMinutes(0), POST_MEAL_MIN_MINUTES);
  eq("negative clamps up", clampPostMealMinutes(-45), POST_MEAL_MIN_MINUTES);
  eq("above the high bound clamps down", clampPostMealMinutes(1000), POST_MEAL_MAX_MINUTES);
  eq("the high bound IS the window", POST_MEAL_MAX_MINUTES, POST_MEAL_WINDOW_MIN);
  eq("a fraction rounds to the nearest minute", clampPostMealMinutes(89.4), 89);
  eq("and rounds half up", clampPostMealMinutes(89.5), 90);
  // A NaN would arm a countdown that can never fire; the floor is the only safe
  // answer, and it is deliberately not 0.
  eq("NaN falls back to the low bound", clampPostMealMinutes(NaN), POST_MEAL_MIN_MINUTES);
  eq("Infinity falls back to the low bound", clampPostMealMinutes(Infinity), POST_MEAL_MIN_MINUTES);
  ok(
    "the range is exactly five minutes up to the whole window",
    POST_MEAL_MIN_MINUTES === 5 && POST_MEAL_MAX_MINUTES === POST_MEAL_WINDOW_MIN
  );
}

section("L. clampPostMealLateMinutes - how far back the meal may be moved");
{
  eq("a chip value passes through", clampPostMealLateMinutes(15), 15);
  eq("zero is allowed (the ordinary tap)", clampPostMealLateMinutes(0), 0);
  eq("negative clamps to zero: the meal cannot be ahead", clampPostMealLateMinutes(-5), 0);
  eq("the far end is kept", clampPostMealLateMinutes(POST_MEAL_LATE_MAX_MIN), POST_MEAL_LATE_MAX_MIN);
  eq("past it clamps back", clampPostMealLateMinutes(500), POST_MEAL_LATE_MAX_MIN);
  ok(
    "the range reaches PAST the window, so 'too late' is reachable",
    POST_MEAL_LATE_MAX_MIN > POST_MEAL_WINDOW_MIN
  );
  eq("a fraction rounds", clampPostMealLateMinutes(12.6), 13);
  eq("NaN is treated as no delay", clampPostMealLateMinutes(NaN), 0);
}

section("M. startPostMealLate - the window belongs to the MEAL");
{
  // The ordinary tap: nothing is backdated, the full window is ahead.
  const now = START;
  const fresh = startPostMealLate({ minutesAgo: 0, now });
  eq("fresh: armed", fresh.kind, "start");
  if (fresh.kind === "start") {
    eq("starts now", fresh.startedAt, now);
    eq("ends a full window later", fresh.endsAt, now + POST_MEAL_WINDOW_MIN * MIN);
    eq("the whole window is left", fresh.remainingMs / MIN, POST_MEAL_WINDOW_MIN);
  }

  // Logging 30 minutes late: the check still lands two hours after the MEAL,
  // which is 90 minutes from now - not 120.
  const late = startPostMealLate({ minutesAgo: 30, now });
  eq("late: armed", late.kind, "start");
  if (late.kind === "start") {
    eq("the start is backdated to the meal", late.startedAt, now - 30 * MIN);
    eq("the end is a window after the MEAL", late.endsAt, now - 30 * MIN + POST_MEAL_WINDOW_MIN * MIN);
    eq("so 90 minutes are left, not 120", late.remainingMs / MIN, 90);
    // The progress bar and the Live Activity read the same pair, so all three
    // agree about how much of the window is already behind.
    eq("elapsed fraction matches the real meal", postMealElapsedFraction(late, now), 0.25);
  }

  // The last minute that still arms, and the first that does not.
  const edge = startPostMealLate({ minutesAgo: POST_MEAL_WINDOW_MIN - 1, now });
  eq("one minute of window left still arms", edge.kind, "start");
  if (edge.kind === "start") eq("with that one minute", edge.remainingMs / MIN, 1);

  // Past the window there is nothing to count: no timer, and the screen says so.
  eq("exactly a window ago: over", startPostMealLate({ minutesAgo: 120, now }).kind, "elapsed");
  eq("longer ago: over", startPostMealLate({ minutesAgo: 125, now }).kind, "elapsed");
  eq("much longer ago: over", startPostMealLate({ minutesAgo: 600, now }).kind, "elapsed");
  // Under the scheduler floor counts as over, the same rule every other
  // re-timing in this file uses.
  eq(
    "119.5 minutes ago rounds to the whole window: over",
    startPostMealLate({ minutesAgo: 119.5, now }).kind,
    "elapsed"
  );
  eq(
    "the far end of the input range is over too",
    startPostMealLate({ minutesAgo: POST_MEAL_LATE_MAX_MIN, now }).kind,
    "elapsed"
  );
  // A garbage input can never arm a NaN countdown.
  const bad = startPostMealLate({ minutesAgo: NaN, now });
  eq("NaN behaves like no delay", bad.kind, "start");
  if (bad.kind === "start") eq("full window", bad.remainingMs / MIN, POST_MEAL_WINDOW_MIN);
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

section("N. logging a meal mid-countdown vs. pressing 'restart for this meal'");
{
  // The contract behind 2.3.0's G15 card, pinned end to end rather than one
  // helper at a time: a RUNNING countdown is re-measured only when the user
  // asks for it. Reported as "logging a meal seems to reset the remaining time
  // to 120" - what the two paths do to `endsAt` is the whole difference, so
  // both are asserted on the same running window.
  const now = START;
  const armed = startPostMealLate({ minutesAgo: 0, now });
  ok("the scenario starts with a running timer", armed.kind === "start");
  if (armed.kind !== "start") throw new Error("unreachable");
  const running = { startedAt: armed.startedAt, endsAt: armed.endsAt };

  // 40 minutes in, the user logs a meal. Every meal-logging path in the app
  // funnels into schedulePostMealReminder, which asks this and does NOTHING
  // else when the answer is "active" (lib/services/notifications.ts).
  const mealAt = now + 40 * MIN;
  eq(
    "a meal logged mid-countdown is not an auto-start",
    decidePostMealAutoStart({ timerActive: true, loggedAtMs: mealAt, now: mealAt }),
    "active"
  );
  // Which is what makes these three true: nothing moved, so the card is still
  // counting the ORIGINAL window and is 1/3 of the way along it.
  eq("the end did not move", running.endsAt, armed.endsAt);
  eq("the start did not move", running.startedAt, now);
  eq("80 minutes are left, not 120", (running.endsAt - mealAt) / MIN, 80);
  eq("and the bar is a third full", postMealElapsedFraction(running, mealAt), 1 / 3);

  // Only the explicit action re-anchors it, and it re-anchors to the MEAL, not
  // to the moment the button was pressed: the card offers this exactly because
  // the meal above deliberately did not move anything.
  const restarted = restartPostMealWindowAt({
    startedAt: mealAt,
    windowMin: POST_MEAL_WINDOW_MIN,
    now: mealAt + 5 * MIN,
  });
  eq("restart arms", restarted.kind, "restarted");
  if (restarted.kind === "restarted") {
    ok("the end DID move", restarted.endsAt !== running.endsAt);
    eq("to a full window after the meal", restarted.endsAt, mealAt + POST_MEAL_WINDOW_MIN * MIN);
    eq("anchored to the meal, not to the tap", restarted.startedAt, mealAt);
    eq("so 115 minutes are left, not 120", restarted.remainingMs / MIN, 115);
  }

  // The window is fixed, so end minus start is POST_MEAL_WINDOW_MIN on every
  // path - which is why the card draws the feature name alone and lets the
  // live countdown carry the number (the bracketed "(120 min)" beside a "120
  // min" countdown was the same fact printed twice).
  eq("fresh window span", (armed.endsAt - armed.startedAt) / MIN, POST_MEAL_WINDOW_MIN);
  const late = startPostMealLate({ minutesAgo: 45, now });
  if (late.kind === "start") {
    eq("backdated window span", (late.endsAt - late.startedAt) / MIN, POST_MEAL_WINDOW_MIN);
  }
  if (restarted.kind === "restarted") {
    eq(
      "restarted window span",
      (restarted.endsAt - restarted.startedAt) / MIN,
      POST_MEAL_WINDOW_MIN
    );
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
