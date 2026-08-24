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

import { presetFor, type ReminderPreset } from "../lib/reminderPresets";
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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
