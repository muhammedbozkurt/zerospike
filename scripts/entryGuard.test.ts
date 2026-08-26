/**
 * lib/entryGuard.ts correctness harness. No jest, standalone style matching
 * scripts/postMealTimer.test.ts.
 *
 * Run: npx tsx scripts/entryGuard.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import { checkEntryGuards, GUARD_WINDOW_MS, EntryGuardInput } from "../lib/entryGuard";

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

const MIN = 60_000;
const HOUR = 60 * MIN;
/** Fixed clock so the suite never depends on when it runs. */
const NOW = new Date(2026, 7, 25, 6, 10, 0).getTime();
const iso = (ms: number): string => new Date(ms).toISOString();

console.log("zerospike entryGuard test");

section("A. overnight basal, second basal 3 h later -> recent_basal");
{
  const firstAt = NOW - 3 * HOUR;
  const input: EntryGuardInput = {
    now: NOW,
    entryKind: "injection",
    insulinType: "basal",
    recent: { injections: [{ id: "inj-1", logged_at: iso(firstAt), insulin_type: "basal", dose_units: 18 }] },
  };
  const notices = checkEntryGuards(input);
  eq("one notice", notices.length, 1);
  eq("kind", notices[0]?.kind, "recent_basal");
  eq("atIso is the first entry's own time", notices[0]?.atIso, iso(firstAt));
  eq("units carried through", notices[0]?.detail?.units, 18);
}

section("B. second basal 7 h later -> empty");
{
  const firstAt = NOW - 7 * HOUR;
  const notices = checkEntryGuards({
    now: NOW,
    entryKind: "injection",
    insulinType: "basal",
    recent: { injections: [{ id: "inj-1", logged_at: iso(firstAt), insulin_type: "basal", dose_units: 18 }] },
  });
  eq("empty", notices.length, 0);
}

section("C. bolus inside the basal window is not a basal match");
{
  const notices = checkEntryGuards({
    now: NOW,
    entryKind: "injection",
    insulinType: "basal",
    recent: { injections: [{ id: "inj-1", logged_at: iso(NOW - 1 * HOUR), insulin_type: "bolus", dose_units: 5 }] },
  });
  eq("empty", notices.length, 0);
}

section("D. bolus 30 min apart -> recent_bolus; 2 h apart -> empty");
{
  const near = checkEntryGuards({
    now: NOW,
    entryKind: "injection",
    insulinType: "bolus",
    recent: { injections: [{ id: "inj-1", logged_at: iso(NOW - 30 * MIN), insulin_type: "bolus", dose_units: 4 }] },
  });
  eq("30 min -> one notice", near.length, 1);
  eq("30 min -> kind", near[0]?.kind, "recent_bolus");
  eq("30 min -> units", near[0]?.detail?.units, 4);

  const far = checkEntryGuards({
    now: NOW,
    entryKind: "injection",
    insulinType: "bolus",
    recent: { injections: [{ id: "inj-1", logged_at: iso(NOW - 2 * HOUR), insulin_type: "bolus", dose_units: 4 }] },
  });
  eq("2 h -> empty", far.length, 0);
}

section("E. glucose 5 min apart -> recent_glucose; 20 min -> empty");
{
  const near = checkEntryGuards({
    now: NOW,
    entryKind: "glucose",
    recent: { glucose: [{ id: "g-1", logged_at: iso(NOW - 5 * MIN), valueText: "110" }] },
  });
  eq("5 min -> one notice", near.length, 1);
  eq("5 min -> kind", near[0]?.kind, "recent_glucose");
  eq("5 min -> valueText", near[0]?.detail?.valueText, "110");

  const far = checkEntryGuards({
    now: NOW,
    entryKind: "glucose",
    recent: { glucose: [{ id: "g-1", logged_at: iso(NOW - 20 * MIN), valueText: "110" }] },
  });
  eq("20 min -> empty", far.length, 0);
}

section("F. same foodKey 10 min -> recent_meal; different key / null key -> empty");
{
  const same = checkEntryGuards({
    now: NOW,
    entryKind: "meal",
    foodKey: "elma",
    foodName: "Elma",
    recent: { meals: [{ id: "m-1", logged_at: iso(NOW - 10 * MIN), foodKey: "elma", foodName: "Elma" }] },
  });
  eq("same key -> one notice", same.length, 1);
  eq("same key -> kind", same[0]?.kind, "recent_meal");
  eq("same key -> foodName", same[0]?.detail?.foodName, "Elma");

  const diff = checkEntryGuards({
    now: NOW,
    entryKind: "meal",
    foodKey: "elma",
    recent: { meals: [{ id: "m-1", logged_at: iso(NOW - 10 * MIN), foodKey: "armut", foodName: "Armut" }] },
  });
  eq("different key -> empty", diff.length, 0);

  const nullKey = checkEntryGuards({
    now: NOW,
    entryKind: "meal",
    foodKey: null,
    recent: { meals: [{ id: "m-1", logged_at: iso(NOW - 10 * MIN), foodKey: "elma", foodName: "Elma" }] },
  });
  eq("null key -> empty", nullKey.length, 0);
}

section("G. timer running -> timer_running; timer already ended -> empty");
{
  const running = checkEntryGuards({
    now: NOW,
    entryKind: "post_meal_timer",
    runningTimerEndsAtIso: iso(NOW + 30 * MIN),
  });
  eq("running -> one notice", running.length, 1);
  eq("running -> kind", running[0]?.kind, "timer_running");
  eq("running -> atIso is the timer's end time", running[0]?.atIso, iso(NOW + 30 * MIN));

  const ended = checkEntryGuards({
    now: NOW,
    entryKind: "post_meal_timer",
    runningTimerEndsAtIso: iso(NOW - 10 * MIN),
  });
  eq("ended -> empty", ended.length, 0);
}

section("H. entry dated ahead -> future_dated; 2 min ahead -> empty");
{
  const ahead = checkEntryGuards({
    now: NOW,
    entryKind: "glucose",
    entryAtIso: iso(NOW + 10 * MIN),
  });
  eq("10 min ahead -> one notice", ahead.length, 1);
  eq("10 min ahead -> kind", ahead[0]?.kind, "future_dated");
  eq("10 min ahead -> atIso is the entry's own time", ahead[0]?.atIso, iso(NOW + 10 * MIN));

  const barely = checkEntryGuards({
    now: NOW,
    entryKind: "glucose",
    entryAtIso: iso(NOW + 2 * MIN),
  });
  eq("2 min ahead -> empty", barely.length, 0);
}

section("I. multiple conditions at once -> fixed order (future_dated first)");
{
  const entryAt = NOW + 10 * MIN;
  const notices = checkEntryGuards({
    now: NOW,
    entryKind: "injection",
    insulinType: "basal",
    entryAtIso: iso(entryAt),
    recent: { injections: [{ id: "inj-1", logged_at: iso(entryAt - 1 * HOUR), insulin_type: "basal", dose_units: 10 }] },
  });
  eq("two notices", notices.length, 2);
  eq("future_dated first", notices[0]?.kind, "future_dated");
  eq("recent_basal second", notices[1]?.kind, "recent_basal");
}

section("J. editing: record sharing entryAtIso's own instant is skipped ONLY via excludeId");
{
  const at = NOW;
  const notices = checkEntryGuards({
    now: NOW,
    entryKind: "injection",
    insulinType: "basal",
    entryAtIso: iso(at),
    excludeId: "inj-1",
    recent: { injections: [{ id: "inj-1", logged_at: iso(at), insulin_type: "basal", dose_units: 18 }] },
  });
  eq("self is excluded via excludeId -> empty", notices.length, 0);
}

section("K. multiple matches -> nearest one wins");
{
  const notices = checkEntryGuards({
    now: NOW,
    entryKind: "injection",
    insulinType: "basal",
    recent: {
      injections: [
        { id: "inj-1", logged_at: iso(NOW - 5 * HOUR), insulin_type: "basal", dose_units: 20 },
        { id: "inj-2", logged_at: iso(NOW - 1 * HOUR), insulin_type: "basal", dose_units: 18 },
        { id: "inj-3", logged_at: iso(NOW - 4 * HOUR), insulin_type: "basal", dose_units: 22 },
      ],
    },
  });
  eq("one notice", notices.length, 1);
  eq("nearest atIso", notices[0]?.atIso, iso(NOW - 1 * HOUR));
  eq("nearest units", notices[0]?.detail?.units, 18);
}

section("L. malformed ISO values do not throw and are skipped");
{
  let threw = false;
  let notices: ReturnType<typeof checkEntryGuards> = [];
  try {
    notices = checkEntryGuards({
      now: NOW,
      entryKind: "glucose",
      entryAtIso: "abc",
      recent: {
        glucose: [
          { id: "g-1", logged_at: "", valueText: "110" },
          { id: "g-2", logged_at: "abc", valueText: "120" },
        ],
      },
    });
  } catch {
    threw = true;
  }
  ok("no throw on bad entryAtIso / logged_at", !threw);
  eq("bad glucose records are skipped -> empty", notices.length, 0);

  let threw2 = false;
  let timerNotices: ReturnType<typeof checkEntryGuards> = [];
  try {
    timerNotices = checkEntryGuards({
      now: NOW,
      entryKind: "post_meal_timer",
      runningTimerEndsAtIso: null,
    });
  } catch {
    threw2 = true;
  }
  ok("no throw on null runningTimerEndsAtIso", !threw2);
  eq("null timer end -> empty", timerNotices.length, 0);
}

section("M. backdated entry: window is measured from the entry's own time");
{
  const yesterday22 = new Date(2026, 7, 24, 22, 0, 0).getTime();
  const yesterday23 = new Date(2026, 7, 24, 23, 0, 0).getTime();
  const notices = checkEntryGuards({
    now: NOW,
    entryKind: "injection",
    insulinType: "basal",
    entryAtIso: iso(yesterday23),
    recent: { injections: [{ id: "inj-1", logged_at: iso(yesterday22), insulin_type: "basal", dose_units: 12 }] },
  });
  eq("one notice", notices.length, 1);
  eq("kind", notices[0]?.kind, "recent_basal");
  eq("atIso", notices[0]?.atIso, iso(yesterday22));
}

section("N. excludeId matches a record in-window -> that record is skipped, even though its timestamp differs from entryAtIso");
{
  const notices = checkEntryGuards({
    now: NOW,
    entryKind: "injection",
    insulinType: "basal",
    excludeId: "inj-1",
    recent: {
      injections: [{ id: "inj-1", logged_at: iso(NOW - 1 * HOUR), insulin_type: "basal", dose_units: 18 }],
    },
  });
  eq("own record (by id) excluded -> empty", notices.length, 0);
}

section("O. no excludeId, same instant but a DIFFERENT id -> a real duplicate, notice fires");
{
  // Millisecond equality is NOT identity: Android's InlineDateTimePicker zeroes
  // seconds, so two genuinely separate injections entered in the same minute
  // carry the exact same ISO timestamp. Without excludeId there is nothing to
  // say this record is the one being edited, so the guard must fire - this is
  // precisely the double-entry it exists to catch.
  const at = NOW;
  const notices = checkEntryGuards({
    now: NOW,
    entryKind: "injection",
    insulinType: "basal",
    entryAtIso: iso(at),
    recent: { injections: [{ id: "inj-9", logged_at: iso(at), insulin_type: "basal", dose_units: 18 }] },
  });
  eq("same-instant, different id -> notice fires", notices.length, 1);
  eq("kind", notices[0]?.kind, "recent_basal");
  eq("atIso", notices[0]?.atIso, iso(at));
}

section("P. excludeId set but absent from the list -> nothing changes");
{
  const firstAt = NOW - 3 * HOUR;
  const notices = checkEntryGuards({
    now: NOW,
    entryKind: "injection",
    insulinType: "basal",
    excludeId: "some-other-record",
    recent: { injections: [{ id: "inj-1", logged_at: iso(firstAt), insulin_type: "basal", dose_units: 18 }] },
  });
  eq("unrelated excludeId -> notice still fires", notices.length, 1);
  eq("kind", notices[0]?.kind, "recent_basal");
  eq("atIso", notices[0]?.atIso, iso(firstAt));
}

section("Q. multiple records share the excluded id -> all of them are skipped");
{
  const notices = checkEntryGuards({
    now: NOW,
    entryKind: "injection",
    insulinType: "basal",
    excludeId: "inj-dup",
    recent: {
      injections: [
        { id: "inj-dup", logged_at: iso(NOW - 1 * HOUR), insulin_type: "basal", dose_units: 18 },
        { id: "inj-dup", logged_at: iso(NOW - 2 * HOUR), insulin_type: "basal", dose_units: 20 },
      ],
    },
  });
  eq("both duplicate-id records excluded -> empty", notices.length, 0);

  // A THIRD record with a different id, further away, still surfaces once the
  // two same-id ones are out of the running - excludeId only removes its own
  // matches, it does not blank the whole candidate list.
  const withOther = checkEntryGuards({
    now: NOW,
    entryKind: "injection",
    insulinType: "basal",
    excludeId: "inj-dup",
    recent: {
      injections: [
        { id: "inj-dup", logged_at: iso(NOW - 1 * HOUR), insulin_type: "basal", dose_units: 18 },
        { id: "inj-dup", logged_at: iso(NOW - 2 * HOUR), insulin_type: "basal", dose_units: 20 },
        { id: "inj-other", logged_at: iso(NOW - 3 * HOUR), insulin_type: "basal", dose_units: 22 },
      ],
    },
  });
  eq("one notice from the non-excluded record", withOther.length, 1);
  eq("atIso is the non-excluded record's own time", withOther[0]?.atIso, iso(NOW - 3 * HOUR));
  eq("units from the non-excluded record", withOther[0]?.detail?.units, 22);
}

section("window constants match the spec");
{
  eq("recent_basal", GUARD_WINDOW_MS.recent_basal, 6 * HOUR);
  eq("recent_bolus", GUARD_WINDOW_MS.recent_bolus, 90 * MIN);
  eq("recent_glucose", GUARD_WINDOW_MS.recent_glucose, 10 * MIN);
  eq("recent_meal", GUARD_WINDOW_MS.recent_meal, 30 * MIN);
  eq("future_dated", GUARD_WINDOW_MS.future_dated, 5 * MIN);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
