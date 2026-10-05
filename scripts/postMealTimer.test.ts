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
  postMealReminderPreview,
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
  postMealCardActions,
  POST_MEAL_OWN_MEAL_MS,
  isPostMealOwnMeal,
  decidePostMealAfterMealDelete,
  postMealWindowRestorable,
  postMealWindowSpanMinutes,
  startPostMealLate,
  POST_MEAL_MIN_MINUTES,
  POST_MEAL_MAX_MINUTES,
  POST_MEAL_LATE_MAX_MIN,
  POST_MEAL_WINDOW_MIN,
  clampPostMealWindowMinutes,
  POST_MEAL_CUSTOM_MIN_MINUTES,
  POST_MEAL_CUSTOM_MAX_MINUTES,
  parsePostMealLateInput,
  editPostMealLateDraft,
  stepPostMealLateDraft,
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

section("O. what the running card offers: log, restart, or nothing (device QA)");
{
  // Two device-QA findings, one rule. First: the card used to show "Log a meal"
  // AND "Restart for this meal" together, so right after logging a meal the
  // user faced two actions, one of which asked them to do what they had just
  // done. Second: even alone, "restart" is nonsense for the meal the countdown
  // was STARTED for - start the timer, log the meal from the card, come back
  // ten seconds later, and it offered to re-anchor onto a meal it was already
  // anchored to.
  const started = START;
  const before = started - 20 * MIN;
  const own = started + 5 * MIN;      // the countdown's own meal
  const later = started + 40 * MIN;   // a genuinely later one

  eq("the threshold is ten minutes", POST_MEAL_OWN_MEAL_MS, 10 * MIN);

  // 1. No meal at all since the countdown began: offer to log one.
  {
    const a = postMealCardActions({ meals: [], startedAt: started });
    eq("no meals -> log a meal", a.logMeal, true);
    eq("and no restart", a.restart, false);
    eq("with nothing to anchor to", a.restartMealId, null);
  }

  // 2. A meal logged well after the countdown started: a genuinely later meal,
  //    so the only open question is whether to move the countdown to it.
  {
    const a = postMealCardActions({
      meals: [{ id: "m1", loggedAtMs: later }],
      startedAt: started,
    });
    eq("a later meal -> restart", a.restart, true);
    eq("and 'log a meal' is GONE", a.logMeal, false);
    eq("anchored to that meal", a.restartMealId, "m1");
  }

  // 3. A meal logged BEFORE the countdown started belongs to an earlier window
  //    (or to nothing): re-anchoring onto it would move the countdown
  //    backwards, so the card behaves exactly as if no meal existed.
  {
    const a = postMealCardActions({
      meals: [{ id: "old", loggedAtMs: before }],
      startedAt: started,
    });
    eq("a pre-timer meal -> still 'log a meal'", a.logMeal, true);
    eq("no restart offered", a.restart, false);
    eq("and it is not a candidate", a.restartMealId, null);
  }

  // 4. The countdown's OWN meal: neither action. Logging one is already done,
  //    and restarting would re-anchor onto the meal it is anchored to.
  {
    const a = postMealCardActions({
      meals: [{ id: "own", loggedAtMs: own }],
      startedAt: started,
    });
    eq("the timer's own meal -> no restart", a.restart, false);
    eq("and no 'log a meal' either", a.logMeal, false);
    eq("nothing to anchor to", a.restartMealId, null);
  }

  // The exact boundary, from both sides.
  eq(
    "ten seconds after the start: the timer's own meal, no action",
    JSON.stringify(
      postMealCardActions({
        meals: [{ id: "m", loggedAtMs: started + 10_000 }],
        startedAt: started,
      })
    ),
    JSON.stringify({ logMeal: false, restart: false, restartMealId: null })
  );
  eq(
    "9 min 59 s: still the timer's own meal, no action",
    postMealCardActions({
      meals: [{ id: "m", loggedAtMs: started + 9 * MIN + 59_000 }],
      startedAt: started,
    }).restart,
    false
  );
  eq(
    "exactly 10 min: a later meal, restart offered",
    postMealCardActions({
      meals: [{ id: "m", loggedAtMs: started + POST_MEAL_OWN_MEAL_MS }],
      startedAt: started,
    }).restart,
    true
  );
  eq(
    "one ms under the threshold does not",
    postMealCardActions({
      meals: [{ id: "m", loggedAtMs: started + POST_MEAL_OWN_MEAL_MS - 1 }],
      startedAt: started,
    }).restart,
    false
  );
  // The old "logged_at === startedAt" special case folds into the same rule
  // rather than being handled separately.
  eq(
    "a meal stamped at the exact start is the timer's own meal",
    JSON.stringify(
      postMealCardActions({
        meals: [{ id: "m", loggedAtMs: started }],
        startedAt: started,
      })
    ),
    JSON.stringify({ logMeal: false, restart: false, restartMealId: null })
  );
  // One millisecond BEFORE the start is still this countdown's own meal: the
  // window is symmetric, because delay compensation anchors from the tap and
  // lands on either side of the meal (see section Q).
  eq(
    "one ms before the start is still the timer's own meal",
    JSON.stringify(
      postMealCardActions({
        meals: [{ id: "m", loggedAtMs: started - 1 }],
        startedAt: started,
      })
    ),
    JSON.stringify({ logMeal: false, restart: false, restartMealId: null })
  );
  // Far enough back, though, it belongs to an earlier window.
  eq(
    "a meal a full window earlier is a pre-timer meal",
    postMealCardActions({
      meals: [{ id: "m", loggedAtMs: started - POST_MEAL_OWN_MEAL_MS }],
      startedAt: started,
    }).logMeal,
    true
  );

  // The two flags are never both TRUE, over every shape a feed can take, and
  // the id agrees with the restart flag. (Both false is now a real state - the
  // action row is simply not drawn.)
  const feeds: { id: string; loggedAtMs: number }[][] = [
    [],
    [{ id: "old", loggedAtMs: before }],
    [{ id: "own", loggedAtMs: own }],
    [{ id: "later", loggedAtMs: later }],
    [{ id: "old", loggedAtMs: before }, { id: "later", loggedAtMs: later }],
    [{ id: "own", loggedAtMs: own }, { id: "later", loggedAtMs: later }],
    [{ id: "later", loggedAtMs: later }, { id: "own", loggedAtMs: own }],
    [{ id: "edge", loggedAtMs: started }],
    [{ id: "bad", loggedAtMs: NaN }],
  ];
  for (const meals of feeds) {
    const a = postMealCardActions({ meals, startedAt: started });
    ok(`never both actions for ${meals.length} meal(s)`, !(a.logMeal && a.restart));
    ok(
      "restartMealId agrees with the restart flag",
      a.restart === (a.restartMealId !== null)
    );
  }

  // A later meal alongside the timer's own one still offers the restart: the
  // NEWEST qualifying meal decides, whichever order the feed arrives in.
  eq(
    "own + later (newest-first) -> restart onto the later one",
    postMealCardActions({
      meals: [{ id: "later", loggedAtMs: later }, { id: "own", loggedAtMs: own }],
      startedAt: started,
    }).restartMealId,
    "later"
  );
  eq(
    "own + later (oldest-first) -> same answer",
    postMealCardActions({
      meals: [{ id: "own", loggedAtMs: own }, { id: "later", loggedAtMs: later }],
      startedAt: started,
    }).restartMealId,
    "later"
  );

  // A malformed timestamp can never become the anchor.
  eq(
    "a NaN timestamp is ignored",
    postMealCardActions({ meals: [{ id: "bad", loggedAtMs: NaN }], startedAt: started })
      .logMeal,
    true
  );

  // A backdated start ("I started eating a while ago") anchors the window in
  // the past: the meal that backdating describes is the timer's own meal, and a
  // meal logged well after it is a later one.
  const late = startPostMealLate({ minutesAgo: 45, now: START });
  if (late.kind === "start") {
    eq(
      "the backdated meal itself offers nothing",
      postMealCardActions({
        meals: [{ id: "meal", loggedAtMs: late.startedAt }],
        startedAt: late.startedAt,
      }).restart,
      false
    );
    eq(
      "a meal 40 min after a backdated start offers the restart",
      postMealCardActions({
        meals: [{ id: "m1", loggedAtMs: late.startedAt + 40 * MIN }],
        startedAt: late.startedAt,
      }).restart,
      true
    );
  }
}

section("P. undo puts a re-anchored countdown back to the millisecond");
{
  // The restart is one tap and used to be irreversible, so it now carries an
  // undo toast (the pattern every other one-tap mutation on the dashboard
  // uses). The undo re-anchors to the ORIGINAL start, which only restores the
  // original end because the window length is fixed - this is what pins that.
  const now = START;
  const armed = startPostMealLate({ minutesAgo: 0, now });
  ok("a running timer to begin with", armed.kind === "start");
  if (armed.kind !== "start") throw new Error("unreachable");
  const original = { startedAt: armed.startedAt, endsAt: armed.endsAt };

  // Mis-tap: re-anchor onto a meal logged 40 minutes in.
  const mealAt = now + 40 * MIN;
  const moved = restartPostMealWindowAt({
    startedAt: mealAt,
    windowMin: POST_MEAL_WINDOW_MIN,
    now: mealAt,
  });
  eq("the restart armed", moved.kind, "restarted");
  if (moved.kind === "restarted") {
    ok("and really moved the end", moved.endsAt !== original.endsAt);
  }

  // Undo, a few seconds later: re-anchor back to the original start.
  const undone = restartPostMealWindowAt({
    startedAt: original.startedAt,
    windowMin: POST_MEAL_WINDOW_MIN,
    now: mealAt + 5_000,
  });
  eq("the undo armed", undone.kind, "restarted");
  if (undone.kind === "restarted") {
    eq("start restored exactly", undone.startedAt, original.startedAt);
    eq("end restored exactly", undone.endsAt, original.endsAt);
  }

  // Same for a BACKDATED window, which is the case where start and end are not
  // simply "now" and "now + window".
  const late = startPostMealLate({ minutesAgo: 45, now });
  if (late.kind === "start") {
    const back = restartPostMealWindowAt({
      startedAt: late.startedAt,
      windowMin: POST_MEAL_WINDOW_MIN,
      now: now + MIN,
    });
    if (back.kind === "restarted") {
      eq("backdated start restored", back.startedAt, late.startedAt);
      eq("backdated end restored", back.endsAt, late.endsAt);
    }
  }

  // If the original window ran out between the tap and the undo, there is
  // nothing to put back and the caller says so instead of arming a dead timer.
  const stale = restartPostMealWindowAt({
    startedAt: original.startedAt,
    windowMin: POST_MEAL_WINDOW_MIN,
    now: original.endsAt + MIN,
  });
  eq("an expired original cannot be restored", stale.kind, "elapsed");
}

section("Q. the delay-compensation scenario from device QA (symmetric own-meal window)");
{
  // Reported: a meal logged at 13:46, the countdown then started with the
  // "15 minutes ago" delay compensation, and the card offering "Restart for the
  // 13:46 meal" for the very meal the timer was anchored to.
  //
  // Tracing it produced TWO distinct defects, only one of which matches the
  // screenshot - both are covered here.
  const MEAL = new Date(2026, 7, 25, 13, 46, 12).getTime();
  const OWN = POST_MEAL_OWN_MEAL_MS;

  // DEFECT 1, the one the symmetric window fixes. "I started eating a while
  // ago" anchors from the moment of the TAP minus the user's estimate, so the
  // anchor lands near the meal but on EITHER side of it. The old rule only
  // looked at meals at-or-after the anchor, so a meal a few seconds EARLIER was
  // dropped entirely and the card fell through to "log a meal" - asking the
  // user to record the meal they had just recorded.
  for (const anchorOffsetSec of [-20, -1, 0, 1, 20]) {
    const startedAt = MEAL + anchorOffsetSec * 1000;
    const a = postMealCardActions({ meals: [{ id: "m", loggedAtMs: MEAL }], startedAt });
    eq(`anchor ${anchorOffsetSec >= 0 ? "+" : ""}${anchorOffsetSec}s: no restart`, a.restart, false);
    eq(`anchor ${anchorOffsetSec >= 0 ? "+" : ""}${anchorOffsetSec}s: no 'log a meal'`, a.logMeal, false);
  }
  // The exact reported pair, both directions.
  {
    const before = postMealCardActions({
      meals: [{ id: "m", loggedAtMs: MEAL }],
      startedAt: new Date(2026, 7, 25, 13, 46, 20).getTime(),
    });
    eq("meal 13:46:00 vs anchor 13:46:20 -> no action", JSON.stringify(before), JSON.stringify({ logMeal: false, restart: false, restartMealId: null }));
    const after = postMealCardActions({
      meals: [{ id: "m", loggedAtMs: MEAL }],
      startedAt: new Date(2026, 7, 25, 13, 45, 40).getTime(),
    });
    eq("meal 13:46:00 vs anchor 13:45:40 -> no action", JSON.stringify(after), JSON.stringify({ logMeal: false, restart: false, restartMealId: null }));
  }

  // DEFECT 2, which the window does NOT hide, and deliberately so. The
  // screenshot is only reproducible when the user's own estimate was wrong:
  // tapping "15 minutes ago" five minutes after the meal puts the anchor a full
  // ten minutes BEFORE it. The countdown really is anchored ten minutes early,
  // and restarting really would fix it - so the offer is correct.
  {
    const tap = new Date(2026, 7, 25, 13, 51, 12).getTime();
    const late = startPostMealLate({ minutesAgo: 15, now: tap });
    ok("the late start arms", late.kind === "start");
    if (late.kind === "start") {
      eq("the anchor lands 10 min before the meal", (MEAL - late.startedAt) / MIN, 10);
      eq("and 105 minutes are left", Math.round(late.remainingMs / MIN), 105);
      const a = postMealCardActions({ meals: [{ id: "m", loggedAtMs: MEAL }], startedAt: late.startedAt });
      eq("a genuinely misplaced anchor still offers the restart", a.restart, true);
    }
  }

  // The boundary, from both sides and in both directions.
  eq("exactly +10 min -> restart", postMealCardActions({ meals: [{ id: "m", loggedAtMs: MEAL }], startedAt: MEAL - OWN }).restart, true);
  eq("one ms under +10 min -> no action", postMealCardActions({ meals: [{ id: "m", loggedAtMs: MEAL }], startedAt: MEAL - OWN + 1 }).restart, false);
  eq("exactly -10 min -> log a meal", postMealCardActions({ meals: [{ id: "m", loggedAtMs: MEAL }], startedAt: MEAL + OWN }).logMeal, true);
  eq("one ms under -10 min -> no action", postMealCardActions({ meals: [{ id: "m", loggedAtMs: MEAL }], startedAt: MEAL + OWN - 1 }).logMeal, false);
  eq("well before the anchor -> log a meal", postMealCardActions({ meals: [{ id: "m", loggedAtMs: MEAL }], startedAt: MEAL + 60 * MIN }).logMeal, true);

  // The own meal silences the card only while it is the NEWEST one. Eat again
  // mid-window and the newer meal takes over, exactly as before: the countdown
  // is now anchored to the wrong meal and moving it is the useful offer.
  {
    const a = postMealCardActions({
      meals: [
        { id: "own", loggedAtMs: MEAL },
        { id: "later", loggedAtMs: MEAL + 40 * MIN },
      ],
      startedAt: MEAL + 30_000,
    });
    eq("a genuinely later meal still wins over the own meal", a.restartMealId, "later");
  }
  // But an own meal that IS the newest keeps the card silent, whichever side of
  // the anchor it fell on.
  for (const offsetSec of [-30, 30]) {
    const a = postMealCardActions({
      meals: [{ id: "own", loggedAtMs: MEAL }],
      startedAt: MEAL + offsetSec * 1000,
    });
    eq(`newest is the own meal (${offsetSec}s) -> silent`, JSON.stringify(a), JSON.stringify({ logMeal: false, restart: false, restartMealId: null }));
  }

  // REGRESSION: the ordinary flow, with no delay compensation at all, is
  // unchanged - the plain "I started eating" tap anchors at now.
  {
    const now = new Date(2026, 7, 25, 13, 46, 12).getTime();
    const fresh = startPostMealLate({ minutesAgo: 0, now });
    ok("the plain tap arms", fresh.kind === "start");
    if (fresh.kind === "start") {
      eq("anchored at now", fresh.startedAt, now);
      eq("no meal yet -> log a meal", postMealCardActions({ meals: [], startedAt: fresh.startedAt }).logMeal, true);
      eq("the meal logged for it -> silent", postMealCardActions({ meals: [{ id: "m", loggedAtMs: now }], startedAt: fresh.startedAt }).restart, false);
      eq("a real second meal later -> restart", postMealCardActions({ meals: [{ id: "m2", loggedAtMs: now + 40 * MIN }], startedAt: fresh.startedAt }).restart, true);
    }
  }
}

section("R. clampPostMealWindowMinutes - sanitizing a window length");
{
  eq("below the floor clamps up", clampPostMealWindowMinutes(4), 5);
  eq("above the ceiling clamps down", clampPostMealWindowMinutes(1441), 1440);
  eq("inside the range passes through", clampPostMealWindowMinutes(90), 90);
  // A corrupted value reads as "back to normal", not as "count down five
  // minutes" - the low end would be the worse failure mode of the two.
  eq("NaN falls back to the ordinary default, not the low bound", clampPostMealWindowMinutes(NaN), 120);
  eq("the floor", POST_MEAL_CUSTOM_MIN_MINUTES, 5);
  eq("the ceiling is a full day", POST_MEAL_CUSTOM_MAX_MINUTES, 1440);
}

section("T. a SELECTED window other than the default behaves exactly like the old fixed one did");
{
  // Everything below re-runs the fixed-120 shape of section M/I/J at a
  // user-selected 60-minute window, to pin that choosing a shorter length
  // does not change how the arithmetic itself works - only its span.
  const now = START;

  const fresh60 = startPostMealLate({ minutesAgo: 0, now, windowMin: 60 });
  eq("fresh at a 60 min window: armed", fresh60.kind, "start");
  if (fresh60.kind === "start") {
    eq("ends a full 60 min window later", fresh60.endsAt, now + 60 * MIN);
    eq("the whole window is left", fresh60.remainingMs / MIN, 60);
  }

  const late60 = startPostMealLate({ minutesAgo: 30, now, windowMin: 60 });
  eq("30 min late into a 60 min window: armed", late60.kind, "start");
  if (late60.kind === "start") {
    eq("half the window is left, same shape as 30-late-of-120 leaving 90", late60.remainingMs / MIN, 30);
  }

  // The same edges section M pins for the 120 min default, re-run at 60.
  eq(
    "one minute of a 60 min window left still arms",
    startPostMealLate({ minutesAgo: 59, now, windowMin: 60 }).kind,
    "start"
  );
  eq(
    "exactly a 60 min window ago: over",
    startPostMealLate({ minutesAgo: 60, now, windowMin: 60 }).kind,
    "elapsed"
  );
  eq(
    "longer ago than a 60 min window: over",
    startPostMealLate({ minutesAgo: 90, now, windowMin: 60 }).kind,
    "elapsed"
  );

  // restartPostMealWindowAt was already parametric (unchanged by this
  // feature); pinned here alongside the rest for the same 60 min window.
  const restarted60 = restartPostMealWindowAt({ startedAt: now, windowMin: 60, now: now + 40 * MIN });
  eq("restart at a 60 min window: armed", restarted60.kind, "restarted");
  if (restarted60.kind === "restarted") {
    eq("20 min left, the same shape as the 120 min case", restarted60.remainingMs / MIN, 20);
  }

  // clampPostMealMinutes's cap now follows the selected window instead of the
  // fixed constant; the one-argument call (no window given) is untouched.
  eq("a value inside a 60 min cap passes through", clampPostMealMinutes(30, 60), 30);
  eq("above a 60 min cap clamps to 60, not 120", clampPostMealMinutes(90, 60), 60);
  eq("the floor is unchanged by the window argument", clampPostMealMinutes(0, 60), POST_MEAL_MIN_MINUTES);
  eq(
    "omitting the window keeps the OLD one-argument behaviour (cap 120)",
    clampPostMealMinutes(150),
    POST_MEAL_WINDOW_MIN
  );

  // A wider selected window (180) also works, and a meal well past even that
  // wider span is still reported as over, not silently capped into "start".
  eq(
    "200 min before now, 180 min window: over",
    startPostMealLate({ minutesAgo: 200, now, windowMin: 180 }).kind,
    "elapsed"
  );
  const withinWider = startPostMealLate({ minutesAgo: 200, now, windowMin: 240 });
  eq("the same 200 min lateness fits inside a 240 min window", withinWider.kind, "start");
}

section("U. startPostMealLate - the late-start input follows the SELECTED window, not a fixed 240 cap");
{
  // A wide custom window (1440 min): "I started eating 600 minutes ago" must
  // land 1440 minutes after the real meal, not be clamped at the old fixed
  // POST_MEAL_LATE_MAX_MIN (240) and land 20 hours out instead of 14.
  const now = START;
  const wide = startPostMealLate({ minutesAgo: 600, now, windowMin: 1440 });
  eq("wide window: armed", wide.kind, "start");
  if (wide.kind === "start") {
    eq("start is backdated by the full 600 minutes", wide.startedAt, now - 600 * MIN);
    eq("end is a full 1440 min window after the meal", wide.endsAt, now - 600 * MIN + 1440 * MIN);
    eq("840 minutes left, not clamped short", wide.remainingMs / MIN, 840);
  }

  // A narrower window (120 min): 300 minutes ago is well past it - elapsed.
  const narrow = startPostMealLate({ minutesAgo: 300, now, windowMin: 120 });
  eq("300 min ago, 120 min window: elapsed", narrow.kind, "elapsed");

  // windowMin omitted: the old one/two-argument behaviour (fixed 240 min
  // ceiling on minutesAgo, fixed 120 min window) is untouched.
  const legacy = startPostMealLate({ minutesAgo: 30, now });
  eq("legacy call: armed", legacy.kind, "start");
  if (legacy.kind === "start") {
    eq("legacy end is a full 120 min window after the meal", legacy.endsAt, now - 30 * MIN + POST_MEAL_WINDOW_MIN * MIN);
    eq("legacy remaining matches the old fixed shape", legacy.remainingMs / MIN, 90);
  }
  eq(
    "legacy call still caps minutesAgo at the fixed 240",
    startPostMealLate({ minutesAgo: 600, now }).kind,
    "elapsed"
  );
}

section("P17. deleting a meal ends the countdown that meal armed");
{
  // The bug from device QA: a meal is logged, the post-meal countdown starts
  // from it, the user deletes the meal, and the card goes on counting down to a
  // check on a meal that no longer exists. The countdown is an automatic
  // consequence of the record, so it dies with the record.
  const MEAL = START;
  const OWN = POST_MEAL_OWN_MEAL_MS;

  // The predicate itself, symmetric on both sides of the anchor.
  ok("the meal at the anchor is its own", isPostMealOwnMeal(MEAL, MEAL));
  ok("nine minutes after the anchor is still its own", isPostMealOwnMeal(MEAL + 9 * MIN, MEAL));
  ok("nine minutes before the anchor is still its own", isPostMealOwnMeal(MEAL - 9 * MIN, MEAL));
  ok("exactly ten minutes out is NOT its own", !isPostMealOwnMeal(MEAL + OWN, MEAL));
  ok("exactly ten minutes back is NOT its own", !isPostMealOwnMeal(MEAL - OWN, MEAL));
  ok("an unreadable moment is never its own", !isPostMealOwnMeal(NaN, MEAL));

  // THE reported case: the only meal the countdown was about is deleted.
  eq(
    "the countdown's own meal deleted, nothing left -> end",
    decidePostMealAfterMealDelete({
      startedAt: MEAL,
      deletedMealsMs: [MEAL],
      remainingMealsMs: [],
    }),
    "end"
  );

  // The auto-start tolerance (up to five minutes between the meal moment and
  // the arm) sits INSIDE the own-meal band, so the ordinary log-then-delete
  // always lands on "end" rather than falling through a gap between the two.
  eq(
    "armed five minutes after the meal, then deleted -> end",
    decidePostMealAfterMealDelete({
      startedAt: MEAL + 5 * MIN,
      deletedMealsMs: [MEAL],
      remainingMealsMs: [],
    }),
    "end"
  );

  // A DIFFERENT meal being deleted must not touch a running countdown.
  eq(
    "an unrelated earlier meal deleted -> keep",
    decidePostMealAfterMealDelete({
      startedAt: MEAL,
      deletedMealsMs: [MEAL - 90 * MIN],
      remainingMealsMs: [MEAL],
    }),
    "keep"
  );
  eq(
    "a later second helping deleted -> keep",
    decidePostMealAfterMealDelete({
      startedAt: MEAL,
      deletedMealsMs: [MEAL + 40 * MIN],
      remainingMealsMs: [MEAL],
    }),
    "keep"
  );
  eq(
    "yesterday's dinner written up and then deleted -> keep",
    decidePostMealAfterMealDelete({
      startedAt: MEAL,
      deletedMealsMs: [MEAL - 20 * 60 * MIN],
      remainingMealsMs: [MEAL],
    }),
    "keep"
  );

  // Two helpings minutes apart both belong to this window: removing one leaves
  // the countdown with a meal to be about.
  eq(
    "one of two meals in the same window deleted -> keep",
    decidePostMealAfterMealDelete({
      startedAt: MEAL,
      deletedMealsMs: [MEAL],
      remainingMealsMs: [MEAL + 4 * MIN],
    }),
    "keep"
  );
  eq(
    "both meals in the window deleted -> end",
    decidePostMealAfterMealDelete({
      startedAt: MEAL,
      deletedMealsMs: [MEAL, MEAL + 4 * MIN],
      remainingMealsMs: [],
    }),
    "end"
  );
  // A surviving meal that is NOT this window's own cannot keep it alive.
  eq(
    "only a far-away meal survives -> end",
    decidePostMealAfterMealDelete({
      startedAt: MEAL,
      deletedMealsMs: [MEAL],
      remainingMealsMs: [MEAL + 45 * MIN, MEAL - 3 * 60 * MIN],
    }),
    "end"
  );

  // "I started eating" with no meal recorded for it is nobody's consequence:
  // deleting some other meal leaves it exactly where it is.
  eq(
    "a hand-armed countdown, an unrelated meal deleted -> keep",
    decidePostMealAfterMealDelete({
      startedAt: MEAL,
      deletedMealsMs: [MEAL - 3 * 60 * MIN],
      remainingMealsMs: [],
    }),
    "keep"
  );

  // A non-meal delete (a reading, an injection, a medication) reaches the
  // decision with no meals at all and can never end a countdown.
  eq(
    "no meals deleted -> keep",
    decidePostMealAfterMealDelete({
      startedAt: MEAL,
      deletedMealsMs: [],
      remainingMealsMs: [MEAL],
    }),
    "keep"
  );

  // The card and the delete now answer "is this the countdown's own meal" with
  // the SAME predicate, so they can never disagree about one meal.
  const silent = postMealCardActions({ meals: [{ id: "m", loggedAtMs: MEAL }], startedAt: MEAL });
  ok(
    "the card says silent exactly where the delete says end",
    !silent.logMeal &&
      !silent.restart &&
      decidePostMealAfterMealDelete({
        startedAt: MEAL,
        deletedMealsMs: [MEAL],
        remainingMealsMs: [],
      }) === "end"
  );
}

section("P17b. an undo only re-arms a window that still has time in it");
{
  // The reason this is decided PURELY, before anything is called: the other
  // way to re-arm a stored window cancels unconditionally once it finds the
  // window elapsed, and by then the user may have armed a fresh countdown.
  // An undo with nothing to restore must therefore make no call at all.
  const w = { startedAt: START, endsAt: START + 120 * MIN };

  eq("the span is read from the window's own pair", postMealWindowSpanMinutes(w), 120);
  eq(
    "a backdated window keeps its real span",
    postMealWindowSpanMinutes({ startedAt: START - 30 * MIN, endsAt: START + 90 * MIN }),
    120
  );
  eq(
    "a degenerate pair never becomes a zero-length window",
    postMealWindowSpanMinutes({ startedAt: START, endsAt: START }),
    1
  );
  eq(
    "an inverted pair never becomes a zero-length window",
    postMealWindowSpanMinutes({ startedAt: START, endsAt: START - 10 * MIN }),
    1
  );

  ok("restorable right after it was ended", postMealWindowRestorable(w, START + MIN));
  ok("restorable with an hour left", postMealWindowRestorable(w, START + 60 * MIN));
  ok(
    "NOT restorable once the end has passed",
    !postMealWindowRestorable(w, START + 121 * MIN)
  );
  ok(
    "NOT restorable exactly at the end",
    !postMealWindowRestorable(w, START + 120 * MIN)
  );
  // Shares the scheduler floor with every other re-timing: under a minute left
  // cannot be placed at its real moment, so it is over rather than rounded up.
  ok(
    "NOT restorable with half a minute left (the scheduler floor)",
    !postMealWindowRestorable(w, START + 120 * MIN - POST_MEAL_MIN_SCHEDULE_MS / 2)
  );
  ok(
    "restorable with exactly the floor left",
    postMealWindowRestorable(w, START + 120 * MIN - POST_MEAL_MIN_SCHEDULE_MS)
  );
  // The window an undo puts back keeps its ORIGINAL end, so a countdown ended
  // one minute in comes back with 119 minutes, not a fresh 120.
  const plan = restartPostMealWindowAt({
    startedAt: w.startedAt,
    windowMin: postMealWindowSpanMinutes(w),
    now: START + MIN,
  });
  eq("an undo lands on the original end", plan.kind === "restarted" ? plan.endsAt : -1, w.endsAt);
  eq(
    "an undo does not hand back a fresh full window",
    plan.kind === "restarted" ? plan.remainingMs / MIN : -1,
    119
  );
}

section("typed late-start minutes are armed verbatim, never swapped for a preset");
{
  const PRESETS = [5, 10, 15, 20, 30];
  for (const typed of [1, 7, 12, 25, 45, 90, 119]) {
    const r = parsePostMealLateInput(String(typed));
    eq(`"${typed}" is taken as typed`, r.kind === "ok" ? r.minutes : -1, typed);
    eq(`"${typed}" is not flagged as clamped`, r.kind === "ok" ? r.clamped : null, false);
    const plan = startPostMealLate({ minutesAgo: r.kind === "ok" ? r.minutes : -1, now: 1_000_000 });
    eq(
      `"${typed}" backdates the start by exactly that many minutes`,
      plan.kind === "start" ? (1_000_000 - plan.startedAt) / MIN : -1,
      typed
    );
  }
  ok("a typed 45 is not any preset", !PRESETS.includes(45));
  eq("comma decimal is read as a whole number", parsePostMealLateInput("12,4").kind === "ok" ? (parsePostMealLateInput("12,4") as { minutes: number }).minutes : -1, 12);
  eq("empty text arms nothing", parsePostMealLateInput("").kind, "empty");
  eq("blank text arms nothing", parsePostMealLateInput("  ").kind, "empty");
  eq("lone separator arms nothing", parsePostMealLateInput(",").kind, "empty");
  const over = parsePostMealLateInput("999");
  eq("over the reach is capped at the maximum", over.kind === "ok" ? over.minutes : -1, POST_MEAL_LATE_MAX_MIN);
  eq("over the reach is flagged", over.kind === "ok" ? over.clamped : null, true);
  const zero = parsePostMealLateInput("0");
  eq("zero means 'just now'", zero.kind === "ok" ? zero.minutes : -1, 0);
  eq("Arabic-Indic digits read as the same number", parsePostMealLateInput("٤٥").kind === "ok" ? (parsePostMealLateInput("٤٥") as { minutes: number }).minutes : -1, 45);
}

section("late-start field edits: draft, cap flag, chip handoff");
{
  const e = (t: string) => editPostMealLateDraft(t);
  eq("empty field stays empty, no cap", JSON.stringify(e("")), JSON.stringify({ draft: "", capped: false, fromChip: false }));
  eq("12,5 keeps its text, no cap", JSON.stringify(e("12,5")), JSON.stringify({ draft: "12,5", capped: false, fromChip: false }));
  eq("12,5 arms as a whole number, not 125", (parsePostMealLateInput("12,5") as { minutes: number }).minutes, 13);
  eq("999 is replaced by the maximum and flagged", JSON.stringify(e("999")), JSON.stringify({ draft: String(POST_MEAL_LATE_MAX_MIN), capped: true, fromChip: false }));
  eq("0 is kept", JSON.stringify(e("0")), JSON.stringify({ draft: "0", capped: false, fromChip: false }));
  eq("typing after a chip leaves chip mode", e("20").fromChip, false);
  eq("typed 20 arms 20", (parsePostMealLateInput(e("20").draft) as { minutes: number }).minutes, 20);
  const up = stepPostMealLateDraft(POST_MEAL_LATE_MAX_MIN, 5);
  eq("+ past the maximum stays at the maximum", up.draft, String(POST_MEAL_LATE_MAX_MIN));
  eq("+ past the maximum reports the cap", up.capped, true);
  eq("+ below the maximum does not report a cap", stepPostMealLateDraft(235, 5).capped, false);
  eq("+ from empty starts from zero", stepPostMealLateDraft(null, 5).draft, "5");
  eq("- never goes below zero", stepPostMealLateDraft(3, -5).draft, "0");
}

section("sheet sequences: what gets armed is always what the field shows");
{
  type S = { draft: string };
  const chip = (_: S, m: number): S => ({ draft: String(m) });
  const type = (_: S, text: string): S => ({ draft: editPostMealLateDraft(text).draft });
  const armed = (st: S): number | null => {
    const r = parsePostMealLateInput(st.draft);
    return r.kind === "ok" ? r.minutes : null;
  };
  let st: S = { draft: "5" };
  st = type(st, "");
  eq("cleared field arms nothing", armed(st), null);
  st = type(st, "25");
  eq("cleared then 25 arms 25", armed(st), 25);
  st = type({ draft: "5" }, "525");
  eq("5 then appended 25 shows 525 and arms the 240 cap, field shows 240", [armed(st), st.draft].join("/"), "240/240");
  st = type(chip({ draft: "5" }, 10), "45");
  eq("chip 10 then typed 45 arms 45", armed(st), 45);
  st = type({ draft: "5" }, "45");
  eq("typed 45 arms 45 with or without blur", armed(st), 45);
  st = type(chip({ draft: "5" }, 30), "");
  eq("chip then cleared arms nothing", armed(st), null);
  st = stepPostMealLateDraft(armed({ draft: "45" }), 5);
  eq("step from typed 45 arms 50", String(armed({ draft: st.draft })), "50");
}

section("reminder preview");
{
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);
  const p45 = postMealReminderPreview(45, now);
  eq("45 min ago: 75 min left", p45?.leftMin, 75);
  eq("45 min ago: lands 2 h after the meal began", p45 ? p45.atMs - now : null, 75 * 60_000);
  eq("0 min ago: full window", postMealReminderPreview(0, now)?.leftMin, 120);
  eq("119 min ago: 1 min left", postMealReminderPreview(119, now)?.leftMin, 1);
  eq("120 min ago: no preview", postMealReminderPreview(120, now), null);
  eq("240 min ago: no preview", postMealReminderPreview(240, now), null);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

// ---- exact-timing helpers (Android: SCHEDULE_EXACT_ALARM off by default) ----
{
  const { isExactTimingError, postMealTimingNotice } = require("../lib/postMealTimer");
  const check = (c: boolean, m: string) => {
    if (!c) {
      console.log("FAIL " + m);
      process.exit(1);
    }
  };
  check(isExactTimingError(new Error("java.lang.SecurityException: Caller needs SCHEDULE_EXACT_ALARM")), "exact err detected");
  check(!isExactTimingError(new Error("network down")), "other err ignored");
  check(!isExactTimingError(undefined), "undefined ignored");
  check(postMealTimingNotice({ platform: "ios", authStatus: "denied", deliveryMissed: true, alarmPref: false }) === "none", "ios silent");
  check(postMealTimingNotice({ platform: "android", authStatus: "authorized", deliveryMissed: false, alarmPref: true }) === "none", "authorized silent");
  check(postMealTimingNotice({ platform: "android", authStatus: "unavailable", deliveryMissed: false, alarmPref: true }) === "none", "unavailable silent");
  check(postMealTimingNotice({ platform: "android", authStatus: "notDetermined", deliveryMissed: false, alarmPref: true }) === "exactTiming", "fresh install hints");
  check(postMealTimingNotice({ platform: "android", authStatus: "authorized", deliveryMissed: true, alarmPref: false }) === "exactTiming", "missed delivery hints");
  check(postMealTimingNotice({ platform: "android", authStatus: "notDetermined", deliveryMissed: false, alarmPref: false }) === "none", "no pref, no prompt");
  console.log("exact timing helpers ok");
}
