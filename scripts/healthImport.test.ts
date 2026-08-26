/**
 * lib/db/healthImportSql.ts's planHealthImport correctness harness (2.3.1's
 * P3, TRACE-V DEBUG). No jest, same standalone style as
 * scripts/postMealTimer.test.ts.
 *
 * The bug this pins (3d): a Health sync's dedupe only ever compared against
 * PREVIOUSLY IMPORTED rows (source = 'health'), so a manual entry the user
 * typed for a measurement they also had in Apple Health was invisible to it -
 * write-back off, log it by hand, sync, and the journal got the same reading
 * twice. The fix: every existing reading counts, matched the same way the
 * calculator already dedupes a typed reading (findMatchingSugarLog): same
 * value (mg/dL, exact), within SUGAR_DEDUP_WINDOW_MINUTES.
 *
 * planHealthImport is the pure decision function insertHealthSugarLogs's SQL
 * call is built on, so it is what is under test here - no DB required.
 * lib/db/healthImportSql.ts holds it (not lib/db/logs.ts) precisely so it
 * imports nothing from expo-sqlite/react-native and this file can run under
 * plain tsx - the same reason journalSql.ts and the vNSql migration modules
 * are split out of lib/db/index.ts.
 *
 * Run: npx tsx scripts/healthImport.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  planHealthImport,
  SUGAR_DEDUP_WINDOW_MINUTES,
  type ExistingSugarReading,
  type HealthSugarSample,
} from "../lib/db/healthImportSql";

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

console.log("zerospike health import dedupe test");

const BASE = "2026-01-15T09:00:00.000Z"; // 09:00 UTC
function minutesAfter(iso: string, min: number): string {
  return new Date(Date.parse(iso) + min * 60_000).toISOString();
}
function sample(mgdl: number, at: string): HealthSugarSample {
  return { glucose_level_mgdl: mgdl, period_tag: "unset", logged_at: at };
}
function existingRow(mgdl: number, at: string): ExistingSugarReading {
  return { glucose_level_mgdl: mgdl, logged_at: at };
}

eq("dedupe window is 15 minutes", SUGAR_DEDUP_WINDOW_MINUTES, 15);

section("A. same value + same minute, existing row is MANUAL -> skipped");
{
  // ExistingSugarReading carries no `source`: it is the same shape whether the
  // matching row is a manual entry or a previous import, which is the whole
  // point of the fix - a manual row now blocks the duplicate too.
  const existing = [existingRow(100, BASE)];
  const result = planHealthImport([sample(100, BASE)], existing);
  eq("nothing inserted", result.length, 0);
}

section("B. same value, 10 min apart, existing row is MANUAL -> skipped");
{
  const existing = [existingRow(100, BASE)];
  const result = planHealthImport([sample(100, minutesAfter(BASE, 10))], existing);
  eq("nothing inserted (inside the 15 min window)", result.length, 0);
}

section("C. same value, 20 min apart -> inserted");
{
  const existing = [existingRow(100, BASE)];
  const at = minutesAfter(BASE, 20);
  const result = planHealthImport([sample(100, at)], existing);
  eq("inserted (outside the 15 min window)", result.length, 1);
  eq("the inserted sample is the new one", result[0]?.logged_at, at);
}

section("D. different value, same minute -> inserted (two real readings)");
{
  const existing = [existingRow(95, BASE)];
  const result = planHealthImport([sample(180, BASE)], existing);
  eq("inserted (95 and 180 are not the same measurement)", result.length, 1);
  eq("value preserved", result[0]?.glucose_level_mgdl, 180);
}

section("E. same value + same minute, existing row is HEALTH -> skipped (regression)");
{
  // Mechanically identical to A - ExistingSugarReading does not carry a
  // source, so this locks that removing the old `source = 'health'` filter
  // did not stop a previously-imported row from blocking its own re-import.
  const existing = [existingRow(100, BASE)];
  const result = planHealthImport([sample(100, BASE)], existing);
  eq("nothing inserted", result.length, 0);
}

section("F. two identical samples in the same batch -> one inserted");
{
  const result = planHealthImport([sample(100, BASE), sample(100, BASE)], []);
  eq("only one survives", result.length, 1);
}

section("G. every inserted row keeps the period_tag it was given (unset)");
{
  const result = planHealthImport([sample(140, minutesAfter(BASE, 30))], []);
  eq("inserted", result.length, 1);
  eq("period_tag is unset", result[0]?.period_tag, "unset");
}

section("H. an inserted row never carries a healthkit_uuid");
{
  // HealthSugarSample has no healthkit_uuid field at all (structural
  // guarantee), and the INSERT statement in insertHealthSugarLogs never binds
  // one, so the column stays at its schema default (NULL) for every imported
  // row. Locked at the source level since no DB runs in this harness.
  const planSrc = readFileSync(
    join(import.meta.dirname, "..", "lib", "db", "healthImportSql.ts"),
    "utf8"
  );
  const sampleShapeMatch = planSrc.match(
    /export interface HealthSugarSample \{[\s\S]*?\n\}/
  );
  ok("HealthSugarSample interface found", !!sampleShapeMatch);
  ok(
    "HealthSugarSample carries no healthkit_uuid",
    !!sampleShapeMatch && !/healthkit_uuid/.test(sampleShapeMatch[0])
  );
  const logsSrc = readFileSync(
    join(import.meta.dirname, "..", "lib", "db", "logs.ts"),
    "utf8"
  );
  const insertMatch = logsSrc.match(
    /INSERT INTO sugar_logs[\s\S]*?VALUES[\s\S]*?;`/
  );
  ok("the health-import INSERT statement was found", !!insertMatch);
  ok(
    "and it never sets healthkit_uuid",
    !!insertMatch && !/healthkit_uuid/.test(insertMatch[0])
  );
}

section("I. an empty sample list inserts nothing");
{
  eq("empty in, empty out", planHealthImport([], [existingRow(100, BASE)]).length, 0);
  eq("empty in, no existing either", planHealthImport([], []).length, 0);
}

section("J. the old source-scoped dedupe query is gone (regression)");
{
  const logsSrc = readFileSync(
    join(import.meta.dirname, "..", "lib", "db", "logs.ts"),
    "utf8"
  );
  ok(
    "insertHealthSugarLogs' existing-rows query no longer filters source = 'health'",
    !/source = 'health'/.test(logsSrc)
  );
  ok(
    "insertHealthSugarLogs routes its insert decision through planHealthImport",
    /planHealthImport\(samples, existing\)/.test(logsSrc)
  );
}

section("K. pickTagForHour is gone from lib/services/health.ts (3b regression)");
{
  const healthSrc = readFileSync(
    join(import.meta.dirname, "..", "lib", "services", "health.ts"),
    "utf8"
  );
  ok("no pickTagForHour left in health.ts", !/pickTagForHour/.test(healthSrc));
  ok(
    "both read paths tag imported samples via autoPeriodTagFor(\"health_import\", ...)",
    (healthSrc.match(/autoPeriodTagFor\("health_import", \{\}\)/g) ?? []).length === 2
  );
}

section("L. deleteGlucoseFromHealth is never called with a health-import row's uuid (SILME lock)");
{
  // insertHealthSugarLogs' INSERT never binds healthkit_uuid (see H above), so
  // deleteSugarLog's `row?.healthkit_uuid ?? null` is always null for a
  // source: 'health' row, and deleteGlucoseFromHealth's own `if (!uuid) return`
  // guard makes that call a no-op. Locked here as a comment requirement so the
  // guard is not "simplified" away later.
  const healthSrc = readFileSync(
    join(import.meta.dirname, "..", "lib", "services", "health.ts"),
    "utf8"
  );
  ok(
    "deleteGlucoseFromHealth documents the health-import no-op",
    /LOCKED: only ever called with the healthkit_uuid of a row THIS app wrote/.test(
      healthSrc
    )
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
