/**
 * lib/periodTag.ts correctness harness. No jest, same standalone style as
 * scripts/postMealTimer.test.ts.
 *
 * The property under test: a Health import never gets a guessed period tag -
 * an imported reading is an observation, not a prediction about when it was
 * taken relative to a meal (see lib/periodTag.ts's own header).
 *
 * Run: npx tsx scripts/periodTag.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import { PERIOD_TAGS, autoPeriodTagFor } from "../lib/periodTag";
import type { PeriodTag } from "../lib/db/types";

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

console.log("zerospike periodTag test");

section("A. health_import is always unset, whatever opts says");
{
  eq("no opts", autoPeriodTagFor("health_import"), "unset");
  eq(
    "an explicit tag is ignored",
    autoPeriodTagFor("health_import", { explicit: "bedtime" }),
    "unset"
  );
  eq(
    "an hour is ignored too",
    autoPeriodTagFor("health_import", { hour: 7 }),
    "unset"
  );
  eq(
    "both explicit and hour together are still ignored",
    autoPeriodTagFor("health_import", { hour: 23, explicit: "fasting" }),
    "unset"
  );
}

section("B. manual_entry: explicit wins, fasting is the default");
{
  eq("no opts falls back to fasting", autoPeriodTagFor("manual_entry"), "fasting");
  eq(
    "an explicit choice is kept",
    autoPeriodTagFor("manual_entry", { explicit: "post_meal_2h" }),
    "post_meal_2h"
  );
  eq(
    "explicit 'manual' is kept, not overridden",
    autoPeriodTagFor("manual_entry", { explicit: "manual" }),
    "manual"
  );
  eq(
    "a null explicit still falls back to fasting",
    autoPeriodTagFor("manual_entry", { explicit: null }),
    "fasting"
  );
  eq(
    "hour has no effect on manual_entry",
    autoPeriodTagFor("manual_entry", { hour: 23 }),
    "fasting"
  );
}

section("C. widget_quick_add follows the same rule as manual_entry");
{
  eq("no opts falls back to fasting", autoPeriodTagFor("widget_quick_add"), "fasting");
  eq(
    "an explicit choice is kept",
    autoPeriodTagFor("widget_quick_add", { explicit: "bedtime" }),
    "bedtime"
  );
  eq(
    "a null explicit still falls back to fasting",
    autoPeriodTagFor("widget_quick_add", { explicit: null }),
    "fasting"
  );
}

section("D. backdated: explicit if picked, unset otherwise - no clock guess");
{
  eq("no opts falls back to unset, not a clock guess", autoPeriodTagFor("backdated"), "unset");
  eq(
    "an explicit choice is kept",
    autoPeriodTagFor("backdated", { explicit: "pre_meal" }),
    "pre_meal"
  );
  eq(
    "a null explicit still falls back to unset",
    autoPeriodTagFor("backdated", { explicit: null }),
    "unset"
  );
  eq(
    "hour has no effect on backdated either",
    autoPeriodTagFor("backdated", { hour: 3 }),
    "unset"
  );
}

section("E. PERIOD_TAGS is the selectable set, and unset is never in it");
{
  eq("exactly the 5 selectable tags, in order", PERIOD_TAGS.join(","),
    "fasting,pre_meal,post_meal_2h,bedtime,manual");
  ok("unset is not selectable", !PERIOD_TAGS.includes("unset" as PeriodTag));
  eq("no duplicates", new Set(PERIOD_TAGS).size, PERIOD_TAGS.length);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
