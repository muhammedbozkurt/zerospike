/**
 * lib/upcomingReminders.ts correctness harness (2.3.0's K2-A). No jest, same
 * standalone style as scripts/alarmSelect.test.ts / scripts/postMealTimer.test.ts.
 *
 * The properties under test: a reminder's next moment is the next WALL-CLOCK
 * occurrence of its own "HH:MM"; the list carries exactly the rows
 * applyReminders would actually schedule (same gates, same three-way alarm
 * AND); and a running post-meal window takes its place in the same ordering.
 *
 * Run: npx tsx scripts/upcomingReminders.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import {
  buildUpcoming,
  nextUpcoming,
  nextOccurrenceAt,
  type UpcomingInput,
  type UpcomingReminderRow,
} from "../lib/upcomingReminders";
import { alarmModeOf } from "../lib/alarmSelect";

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
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** A fixed local moment the whole file measures from: 2026-08-24 09:00 local. */
const NOW = new Date(2026, 7, 24, 9, 0, 0, 0).getTime();

function row(over: Partial<UpcomingReminderRow> = {}): UpcomingReminderRow {
  return {
    id: "r1",
    type: "glucose",
    label: null,
    time: "12:00",
    enabled: 1,
    alarm_enabled: 1,
    ...over,
  };
}

function input(over: Partial<UpcomingInput> = {}): UpcomingInput {
  return {
    rows: [],
    now: NOW,
    windowMs: DAY,
    granted: true,
    showsBasal: true,
    showsMeds: true,
    alarmKitAvailable: true,
    alarmAuthorized: true,
    ...over,
  };
}

/** The local wall-clock moment of hh:mm on the day `offsetDays` from NOW. */
function local(hh: number, mm: number, offsetDays = 0): number {
  const d = new Date(NOW);
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hh, mm, 0, 0);
  return d.getTime();
}

console.log("zerospike upcoming reminders test");

section("A. nextOccurrenceAt: today when still ahead, tomorrow once passed");
{
  eq("later today", nextOccurrenceAt("12:00", NOW), local(12, 0));
  eq("one minute from now", nextOccurrenceAt("09:01", NOW), local(9, 1));
  eq("one minute ago rolls to tomorrow", nextOccurrenceAt("08:59", NOW), local(8, 59, 1));
  // Exactly now counts as passed: this list is what is still AHEAD.
  eq("exactly now rolls to tomorrow", nextOccurrenceAt("09:00", NOW), local(9, 0, 1));
  eq("midnight rolls to tomorrow", nextOccurrenceAt("00:00", NOW), local(0, 0, 1));
  eq("last minute of today", nextOccurrenceAt("23:59", NOW), local(23, 59));
  // A malformed time must not produce NaN and silently drop a row somewhere
  // downstream; it falls back to midnight, exactly like parseHHMM's own
  // tolerant read in lib/services/notifications.ts.
  ok("a malformed time still yields a finite moment", Number.isFinite(nextOccurrenceAt("oops", NOW)));
}

section("B. rolling a day forward keeps the wall-clock time (DST safe)");
{
  // Advancing the DATE rather than adding 24h is what keeps 08:00 at 08:00
  // across a DST boundary. Checked structurally: the rolled moment reads back
  // as the same hour and minute on the local clock.
  const at = nextOccurrenceAt("08:00", NOW);
  const d = new Date(at);
  eq("hour preserved", d.getHours(), 8);
  eq("minute preserved", d.getMinutes(), 0);
}

section("C. only rows applyReminders would actually schedule");
{
  const rows = [
    row({ id: "on", time: "12:00" }),
    row({ id: "off", time: "13:00", enabled: 0 }),
    row({ id: "basal", type: "basal", time: "14:00" }),
    row({ id: "med", type: "med", time: "15:00" }),
  ];
  const all = buildUpcoming(input({ rows }));
  eq("three enabled rows, the disabled one dropped", all.length, 3);

  const noBasal = buildUpcoming(input({ rows, showsBasal: false }));
  ok(
    "basal hidden by the profile's insulin mode is dropped",
    !noBasal.some((i) => i.id === "basal")
  );
  eq("and nothing else is", noBasal.length, 2);

  const noMeds = buildUpcoming(input({ rows, showsMeds: false }));
  ok("oral-meds gate closed drops the med row", !noMeds.some((i) => i.id === "med"));

  ok("a disabled row never appears", !all.some((i) => i.id === "off"));

  eq(
    "master switch / permission off empties the reminder side",
    buildUpcoming(input({ rows, granted: false })).length,
    0
  );
}

section("D. the 24 hour window, and its edges");
{
  const rows = [row({ id: "soon", time: "12:00" }), row({ id: "late", time: "08:00" })];
  const items = buildUpcoming(input({ rows }));
  eq("both fit inside 24 hours", items.length, 2);

  // A shorter window keeps only what is genuinely near.
  const short = buildUpcoming(input({ rows, windowMs: 4 * HOUR }));
  eq("a 4 hour window keeps only today's 12:00", short.length, 1);
  eq("and it is the right one", short[0]?.id, "soon");

  // Exactly on the edge is INSIDE: `at > until` is what excludes.
  const edge = buildUpcoming(input({ rows: [row({ id: "edge", time: "12:00" })], windowMs: 3 * HOUR }));
  eq("a row exactly at the window edge is included", edge.length, 1);
}

section("D2. a day-long window is a DAY, not 24 hours (DST)");
{
  // The night a DST change hands an hour back, `now + 24h` reaches an hour PAST
  // tomorrow's same wall-clock time - and a reminder set for that hour lands in
  // the list twice, once for today and once for tomorrow. The window has to be
  // "this time tomorrow" on the clock instead.
  const rows = [row({ id: "a", time: "09:00" })];
  const items = buildUpcoming(input({ rows }));
  eq("a time equal to `now` appears exactly once", items.length, 1);
  eq("and it is tomorrow's occurrence", items[0]?.at, local(9, 0, 1));

  // The same property, stated without depending on the machine's own time
  // zone: nothing in the list may sit later than tomorrow's same wall clock.
  const horizon = (() => {
    const d = new Date(NOW);
    d.setDate(d.getDate() + 1);
    return d.getTime();
  })();
  const many = buildUpcoming(
    input({
      rows: ["00:00", "06:00", "09:00", "12:00", "18:00", "23:59"].map((time, i) =>
        row({ id: `r${i}`, time })
      ),
    })
  );
  ok(
    "no item is past this time tomorrow",
    many.every((i) => i.at <= horizon),
    JSON.stringify(many.map((i) => new Date(i.at).toString()))
  );
  eq("every distinct time appears once", new Set(many.map((i) => i.id)).size, many.length);

  // Shorter windows keep plain arithmetic - no date boundary is involved.
  eq(
    "a 4 hour window is still exactly four hours",
    buildUpcoming(input({ rows: [row({ id: "x", time: "13:01" })], windowMs: 4 * HOUR })).length,
    0
  );
}

section("E. ordering is by moment, ties broken stably");
{
  const rows = [
    row({ id: "c", time: "20:00" }),
    row({ id: "a", time: "10:00" }),
    row({ id: "b", time: "10:00" }),
    row({ id: "d", time: "08:00" }), // tomorrow
  ];
  const items = buildUpcoming(input({ rows }));
  eq("soonest first", items.map((i) => i.id).join(","), "a,b,c,d");
  const again = buildUpcoming(input({ rows: [...rows].reverse() }));
  eq("same order whatever the input order", again.map((i) => i.id).join(","), "a,b,c,d");
}

section("F. mode comes from alarmModeOf, never from the stored column");
{
  const rows = [row({ id: "wantsAlarm", alarm_enabled: 1 }), row({ id: "wantsNotif", alarm_enabled: 0, time: "12:30" })];

  const authorized = buildUpcoming(input({ rows }));
  eq("stored 1 + AlarmKit + authorized -> alarm", authorized[0]?.mode, "alarm");
  eq("stored 0 stays a notification", authorized[1]?.mode, "notification");

  for (const alarmKitAvailable of [true, false]) {
    for (const alarmAuthorized of [true, false]) {
      const got = buildUpcoming(input({ rows: [row({ alarm_enabled: 1 })], alarmKitAvailable, alarmAuthorized }));
      eq(
        `available=${alarmKitAvailable} authorized=${alarmAuthorized} agrees with alarmModeOf`,
        got[0]?.mode,
        alarmModeOf({ alarmEnabled: true, alarmKitAvailable, alarmAuthorized })
      );
    }
  }
  eq(
    "an unauthorized device never lists an alarm",
    buildUpcoming(input({ rows, alarmAuthorized: false })).every((i) => i.mode === "notification"),
    true
  );
}

section("G. the running post-meal window takes its place in the same list");
{
  const rows = [row({ id: "r", time: "12:00" })];
  const items = buildUpcoming(
    input({ rows, postMealEndsAt: NOW + 90 * MIN, postMealAlarm: true })
  );
  eq("two items", items.length, 2);
  eq("the countdown sorts before the 12:00 reminder", items[0]?.kind, "postMeal");
  eq("it carries a fixed id", items[0]?.id, "postMeal");
  eq("and its own delivery mode", items[0]?.mode, "alarm");
  eq(
    "its mode follows the preference, not the rows",
    buildUpcoming(input({ rows, postMealEndsAt: NOW + 90 * MIN, postMealAlarm: false }))[0]?.mode,
    "notification"
  );
  eq(
    "an elapsed countdown is not listed",
    buildUpcoming(input({ postMealEndsAt: NOW - MIN })).length,
    0
  );
  eq(
    "no countdown running, nothing added",
    buildUpcoming(input({ postMealEndsAt: null })).length,
    0
  );
  eq(
    "one beyond the window is not listed",
    buildUpcoming(input({ postMealEndsAt: NOW + 2 * DAY })).length,
    0
  );
  // The countdown is delivered by AlarmKit when the user chose that, so it does
  // NOT depend on the notification permission the reminder rows are gated on.
  eq(
    "it survives granted=false (the screen hides the card instead)",
    buildUpcoming(input({ rows, granted: false, postMealEndsAt: NOW + 30 * MIN })).length,
    1
  );
}

section("H. rows carry what the caller needs to name them");
{
  const items = buildUpcoming(
    input({ rows: [row({ id: "x", type: "custom", label: "Akşam yürüyüşü", time: "19:00" })] })
  );
  eq("type is passed through", items[0]?.type, "custom");
  eq("label is passed through", items[0]?.label, "Akşam yürüyüşü");
  eq("kind marks it a reminder", items[0]?.kind, "reminder");
  const postMeal = buildUpcoming(input({ postMealEndsAt: NOW + MIN }))[0];
  eq("the countdown carries no reminder type", postMeal?.type, undefined);
}

section("I. nextUpcoming - the single item the dashboard line shows");
{
  // Nothing set up: the dashboard shows no line at all rather than an empty one.
  eq("no rows, no countdown -> null", nextUpcoming(input()), null);

  // Permission (or the master switch) off: the reminders are not going to
  // arrive, so the line must not claim they will.
  const rows = [row({ id: "a", time: "12:00" }), row({ id: "b", time: "18:00" })];
  eq("gated off -> null", nextUpcoming(input({ rows, granted: false })), null);

  // The ordinary case: the soonest reminder, with everything the line draws.
  const first = nextUpcoming(input({ rows }));
  eq("the soonest one", first?.id, "a");
  eq("carries its type", first?.type, "glucose");
  eq("and its delivery", first?.mode, "alarm");
  eq("and its moment", first?.at, local(12, 0));

  // A running post-meal countdown that ends before the next reminder takes the
  // line, exactly as it takes the top of the list.
  const withTimer = nextUpcoming(
    input({ rows, postMealEndsAt: NOW + 30 * MIN, postMealAlarm: true })
  );
  eq("the countdown wins when it is sooner", withTimer?.kind, "postMeal");
  eq("with its own delivery", withTimer?.mode, "alarm");

  // ...and does not when it is not.
  eq(
    "a later countdown does not displace the reminder",
    nextUpcoming(input({ rows, postMealEndsAt: NOW + 8 * HOUR }))?.id,
    "a"
  );

  // The countdown alone still fills the line (it needs no reminder rows).
  eq(
    "a countdown with no reminders at all",
    nextUpcoming(input({ postMealEndsAt: NOW + 30 * MIN }))?.kind,
    "postMeal"
  );

  // Same head as the list: one computation, two surfaces.
  eq(
    "identical to buildUpcoming's first item",
    nextUpcoming(input({ rows, postMealEndsAt: NOW + 30 * MIN }))?.id,
    buildUpcoming(input({ rows, postMealEndsAt: NOW + 30 * MIN }))[0]?.id
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
