/**
 * lib/reminderPresets.ts correctness harness (2.3.0's K2-E). No jest, same
 * standalone style as scripts/alarmSelect.test.ts.
 *
 * The properties under test: every diabetes answer produces a layout (nobody
 * reaches the preview screen with an empty list), every layout is measurement
 * rows only, its times are real "HH:MM" points with no duplicates, and the
 * busiest one still leaves room under MAX_REMINDERS once a basal and a
 * medication row are added alongside it.
 *
 * Run: npx tsx scripts/reminderPresets.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import {
  dayBucketOf,
  planRowsToReplace,
  planRowsToWrite,
  presetFor,
  type DayBucket,
  type ReminderPreset,
} from "../lib/reminderPresets";
import type { DiabetesType } from "../lib/db/types";

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

/** Every member of the DiabetesType union, listed explicitly: adding a type to
 *  lib/db/types.ts without deciding its layout must fail to compile here. */
const ALL_TYPES: DiabetesType[] = [
  "type1",
  "type2",
  "gestational",
  "prediabetes",
  "unknown",
  "none",
];

/** Mirrors MAX_REMINDERS in lib/db/reminders.ts (which cannot be imported here:
 *  that module loads expo-sqlite). Asserted against the real value by the
 *  comment on the constant itself; the check below is about the layout's own
 *  size, not about re-testing the ceiling. */
const MAX_REMINDERS = 10;

const times = (rows: ReminderPreset[]): string => rows.map((r) => r.time).join(",");

console.log("zerospike reminder presets test");

section("A. every answer produces a usable layout");
{
  for (const type of ALL_TYPES) {
    const rows = presetFor(type);
    ok(`${type}: at least one row`, rows.length > 0);
    ok(`${type}: at most four rows`, rows.length <= 4);
    ok(
      `${type}: measurement rows only`,
      rows.every((r) => r.type === "glucose"),
      times(rows)
    );
  }
}

section("B. the documented times, exactly");
{
  eq("type1", times(presetFor("type1")), "07:30,12:30,18:30,22:30");
  eq("gestational", times(presetFor("gestational")), "07:30,10:00,14:00,20:30");
  eq("type2", times(presetFor("type2")), "08:00,13:00,21:00");
  eq("prediabetes", times(presetFor("prediabetes")), "08:00,13:00,20:00");
  eq("unknown", times(presetFor("unknown")), "08:00,13:00,20:00");
  eq("none", times(presetFor("none")), "08:00,13:00,20:00");
}

section("C. every time is a real HH:MM point");
{
  for (const type of ALL_TYPES) {
    for (const row of presetFor(type)) {
      const m = /^([0-9]{2}):([0-9]{2})$/.exec(row.time);
      ok(`${type} ${row.time}: zero-padded HH:MM`, m != null);
      if (!m) continue;
      const h = Number(m[1]);
      const min = Number(m[2]);
      ok(`${type} ${row.time}: hour in range`, h >= 0 && h <= 23);
      ok(`${type} ${row.time}: minute in range`, min >= 0 && min <= 59);
    }
  }
}

section("D. no layout repeats a time");
{
  // A duplicate would write two reminders for one moment - and onboarding's own
  // "skip a time this profile already has" guard would silently drop the second,
  // so the preview would promise a row that never appears.
  for (const type of ALL_TYPES) {
    const list = presetFor(type).map((r) => r.time);
    eq(`${type}: unique times`, new Set(list).size, list.length);
  }
}

section("E. times are in ascending order");
{
  for (const type of ALL_TYPES) {
    const list = presetFor(type).map((r) => r.time);
    eq(`${type}: sorted`, [...list].sort().join(","), list.join(","));
  }
}

section("F. the busiest layout leaves room for the other reminder kinds");
{
  const busiest = Math.max(...ALL_TYPES.map((t) => presetFor(t).length));
  eq("the busiest layout is four rows", busiest, 4);
  // Plus one basal row (syncBasalReminderRow) and one medication row
  // (onboarding's medReminder step) - the most any single profile can reach
  // straight out of onboarding.
  ok("still under the per-profile ceiling", busiest + 2 < MAX_REMINDERS);
}

section("G. each call returns its own rows");
{
  // The screen removes lines from its copy of the list; a shared array would
  // let one preview mutate the next one.
  const a = presetFor("type1");
  const b = presetFor("type1");
  ok("not the same array instance", a !== b);
  a.splice(0, 1);
  eq("removing from one does not touch the other", presetFor("type1").length, b.length);
}

section("H. dayBucketOf - the part of the day a preset row is named after");
{
  // Every boundary of every bucket, from both sides: the name a row is created
  // with comes from here, so an off-by-a-minute would silently rename a row.
  const cases: [string, DayBucket][] = [
    ["05:00", "morning"],
    ["07:30", "morning"],
    ["09:29", "morning"],
    ["09:30", "lateMorning"],
    ["10:00", "lateMorning"],
    ["11:29", "lateMorning"],
    ["11:30", "midday"],
    ["13:00", "midday"],
    ["13:59", "midday"],
    ["14:00", "afternoon"],
    ["17:59", "afternoon"],
    ["18:00", "evening"],
    ["21:00", "evening"],
    ["21:59", "evening"],
    ["22:00", "night"],
    ["23:00", "night"],
    ["00:00", "night"],
    ["04:00", "night"],
    ["04:59", "night"],
  ];
  for (const [time, want] of cases) eq(time, dayBucketOf(time), want);
  // The night bucket is the one that wraps past midnight; both ends of the wrap
  // have to land in it, and the minute after it must not.
  eq("the wrap ends at 05:00", dayBucketOf("05:00"), "morning");
  // A malformed time must still produce a name rather than crashing the setup.
  eq("garbage falls back to the midnight bucket", dayBucketOf("oops"), "night");
}

section("I. no layout produces two rows with the same name");
{
  // The whole point of naming rows after the day: a layout whose times shared a
  // bucket would create two reminders called the same thing.
  for (const type of ALL_TYPES) {
    const buckets = presetFor(type).map((r) => r.bucket);
    eq(`${type}: unique buckets`, new Set(buckets).size, buckets.length);
  }
  eq(
    "type1 spans morning to night",
    presetFor("type1").map((r) => r.bucket).join(","),
    "morning,midday,evening,night"
  );
  eq(
    "gestational uses the late-morning and afternoon slots",
    presetFor("gestational").map((r) => r.bucket).join(","),
    "morning,lateMorning,afternoon,evening"
  );
  eq(
    "type2 is morning, midday, evening",
    presetFor("type2").map((r) => r.bucket).join(","),
    "morning,midday,evening"
  );
  eq(
    "and so is the neutral layout",
    presetFor("unknown").map((r) => r.bucket).join(","),
    "morning,midday,evening"
  );
}

section("J. every preset row carries the bucket its own time falls in");
{
  // onboarding writes the row's name from `bucket`, so the two must never be
  // computed from different times.
  for (const type of ALL_TYPES) {
    for (const row of presetFor(type)) {
      eq(`${type} ${row.time}`, row.bucket, dayBucketOf(row.time));
    }
  }
}

section("K. what 'Set up this plan' actually writes (2.3.0's R1 - profile setup)");
{
  // The layout is now offered on TWO surfaces - the end of onboarding and the
  // setup screen a second (third, fifth) profile opens with - and both call the
  // same setUpReminderPlan. What the rows look like is pinned here so the
  // family's second profile can never quietly get a different deal from the
  // first: same delivery, same naming, same "not the user's own choice" mark.
  const labelFor = (b: DayBucket) => `label:${b}`;

  const rows = planRowsToWrite(presetFor("type1"), labelFor);
  eq("one row per previewed time", rows.length, presetFor("type1").length);
  for (const [i, row] of rows.entries()) {
    const preset = presetFor("type1")[i];
    eq(`row ${i} keeps its time`, row.time, preset.time);
    eq(`row ${i} is a measurement row`, row.type, "glucose");
    eq(`row ${i} is named after its part of the day`, row.label, labelFor(preset.bucket));
    eq(`row ${i} arrives switched on`, row.enabled, true);
    // The alarm is BORN on: schema v21's default, spelled out rather than left
    // implicit, so a profile added later rings exactly like the first one.
    eq(`row ${i} is armed as an alarm`, row.alarmEnabled, true);
    // And it is NOT recorded as the user's own delivery choice: an absent
    // alarmUserSet is what createReminder writes 0 for (lib/db/reminders.ts).
    ok(
      `row ${i} does not claim the user chose this delivery`,
      !Object.prototype.hasOwnProperty.call(row, "alarmUserSet")
    );
  }

  // A pruned preview writes only what is left, in order.
  const pruned = presetFor("type1").filter((r) => r.time !== "12:30");
  const prunedRows = planRowsToWrite(pruned, labelFor);
  ok("a removed line is not written", !prunedRows.some((r) => r.time === "12:30"));
  eq("and nothing else went with it", prunedRows.length, pruned.length);
  ok("an empty preview writes nothing", planRowsToWrite([], labelFor).length === 0);

  // Every type produces rows the same way - no path writes a differently
  // shaped row.
  for (const type of ALL_TYPES) {
    const all = planRowsToWrite(presetFor(type), labelFor);
    ok(`${type} writes rows`, all.length > 0);
    ok(`${type} rows are all glucose`, all.every((r) => r.type === "glucose"));
    ok(`${type} rows are all alarms`, all.every((r) => r.alarmEnabled === true));
  }
}

section("L. replace, not merge - and only the measurement rows");
{
  // A profile added later is the case that makes this matter: unlike a fresh
  // onboarding run, it can already own a basal row (syncBasalReminderRow), a
  // medication row and custom ones by the time the layout is set up. Taking any
  // of those with it would delete reminders the user built by hand.
  const existing = [
    { id: "g1", type: "glucose" },
    { id: "b1", type: "basal" },
    { id: "m1", type: "med" },
    { id: "c1", type: "custom" },
    { id: "g2", type: "glucose" },
  ];
  const replaced = planRowsToReplace(existing);
  eq("both measurement rows go", replaced.length, 2);
  ok("the first one", replaced.includes("g1"));
  ok("the second one", replaced.includes("g2"));
  ok("the basal row stays", !replaced.includes("b1"));
  ok("the medication row stays", !replaced.includes("m1"));
  ok("the custom row stays", !replaced.includes("c1"));
  eq("an empty registry replaces nothing", planRowsToReplace([]).length, 0);
  eq(
    "a registry with no measurement rows replaces nothing",
    planRowsToReplace([{ id: "b1", type: "basal" }]).length,
    0
  );

  // The busiest layout, written over a profile that already carries the other
  // three kinds, still fits under MAX_REMINDERS (10, lib/db/reminders.ts):
  // 3 kept + 4 written = 7.
  const kept = existing.length - replaced.length;
  const written = planRowsToWrite(presetFor("type1"), (b) => b).length;
  ok(`${kept} kept + ${written} written stays under the cap`, kept + written <= 10);
}

section("M. one profile's layout never reaches another profile's rows (Z1a)");
{
  // The race this guards: the setup screen opens right after a profile switch,
  // and every await inside setUpReminderPlan is a chance for the ACTIVE profile
  // to change again (a caregiver on another surface, or this screen's own
  // cancel path). With the owner resolved per-call from "whoever is active",
  // half a layout could be filed under someone else - and the replace step,
  // which deletes by globally unique id, could delete the other profile's
  // measurement reminders outright. So the profile is carried explicitly.
  const labelFor = (b: DayBucket) => `label:${b}`;
  const DRAFT = "draft-profile";
  const OTHER = "previous-profile";

  // Every written row names its owner, so no insert can fall back to whatever
  // profile happens to be active by the time it runs.
  const rows = planRowsToWrite(presetFor("type2"), labelFor, DRAFT);
  ok("every row carries the draft's id", rows.every((r) => r.profileId === DRAFT));
  ok("and none carries anybody else's", !rows.some((r) => r.profileId === OTHER));
  // Omitted only where there is deliberately no id to give (onboarding's first
  // profile); the key is then absent rather than undefined-valued, so it cannot
  // overwrite a resolved owner.
  const unscoped = planRowsToWrite(presetFor("type2"), labelFor);
  ok(
    "no profile given leaves the key off entirely",
    unscoped.every((r) => !Object.prototype.hasOwnProperty.call(r, "profileId"))
  );

  // A list that turned out to hold BOTH profiles' rows - exactly what a switch
  // racing the read produces - must yield only the draft's own ids.
  const mixed = [
    { id: "draft-g1", type: "glucose", profile_id: DRAFT },
    { id: "other-g1", type: "glucose", profile_id: OTHER },
    { id: "draft-b1", type: "basal", profile_id: DRAFT },
    { id: "other-g2", type: "glucose", profile_id: OTHER },
    { id: "draft-g2", type: "glucose", profile_id: DRAFT },
    { id: "other-m1", type: "med", profile_id: OTHER },
  ];
  const scoped = planRowsToReplace(mixed, DRAFT);
  eq("only the draft's measurement rows", scoped.length, 2);
  ok("its first", scoped.includes("draft-g1"));
  ok("its second", scoped.includes("draft-g2"));
  ok("the other profile's rows are untouched", !scoped.some((id) => id.startsWith("other-")));
  ok("including its measurement rows", !scoped.includes("other-g1") && !scoped.includes("other-g2"));
  ok("and the draft's own basal row survives", !scoped.includes("draft-b1"));

  // A row whose owner cannot be read is left alone rather than assumed ours:
  // deleting on a guess is the failure this whole lock exists to prevent.
  const unknownOwner = [
    { id: "mystery", type: "glucose" },
    { id: "draft-g1", type: "glucose", profile_id: DRAFT },
  ];
  eq("an unowned row is not swept up", planRowsToReplace(unknownOwner, DRAFT).length, 1);
  ok(
    "only the row we can prove is ours",
    planRowsToReplace(unknownOwner, DRAFT).includes("draft-g1")
  );

  // Scoping the OTHER way round proves the filter is really reading the owner
  // rather than the position in the list.
  const otherScoped = planRowsToReplace(mixed, OTHER);
  eq("asking for the other profile returns only its rows", otherScoped.length, 2);
  ok("and none of the draft's", !otherScoped.some((id) => id.startsWith("draft-")));

  // No profile given keeps the old behaviour for the caller that has already
  // scoped its own read (onboarding), so nothing that used to work changes.
  eq("unscoped still replaces every measurement row", planRowsToReplace(mixed).length, 4);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
