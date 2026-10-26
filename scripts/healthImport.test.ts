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
  planGlucoseImport,
  planHealthImport,
  SUGAR_DEDUP_WINDOW_MINUTES,
  type ExistingSugarReading,
  type HealthSugarSample,
  type PlanCandidate,
  type PlanExisting,
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
  const sqlSrc = readFileSync(
    join(import.meta.dirname, "..", "lib", "db", "healthImportSql.ts"),
    "utf8"
  );
  ok(
    "insertHealthSugarLogs' existing-rows query no longer filters source = 'health'",
    !/source = 'health'/.test(logsSrc) && !/source = 'health'/.test(sqlSrc)
  );
  ok(
    "insertHealthSugarLogs routes its insert decision through the shared planner",
    /importHealthSamples\(db, profileId, samples, uuid\)/.test(logsSrc) &&
      /planGlucoseImport\(rows, existing, tombstones\)/.test(sqlSrc)
  );
}

section(
  "K. pickTagForHour is gone from lib/services/health.ts (3b regression), and every " +
    "health provider tags its own imports (AH provider-split regression)"
);
{
  const healthSrc = readFileSync(
    join(import.meta.dirname, "..", "lib", "services", "health.ts"),
    "utf8"
  );
  ok("no pickTagForHour left in health.ts", !/pickTagForHour/.test(healthSrc));
  // AH moved the read paths out of health.ts and into one file per provider
  // (healthAppleKit.ts, healthConnect.ts, healthMock.ts), health.ts itself no
  // longer calls autoPeriodTagFor at all - so the call is counted per provider
  // file instead of in the facade, one read path each.
  ok(
    "autoPeriodTagFor is no longer called from health.ts itself",
    !/autoPeriodTagFor/.test(healthSrc)
  );
  const providerFiles = ["healthAppleKit.ts", "healthConnect.ts", "healthMock.ts"];
  for (const file of providerFiles) {
    const providerSrc = readFileSync(
      join(import.meta.dirname, "..", "lib", "services", file),
      "utf8"
    );
    eq(
      `${file} tags its imported samples via autoPeriodTagFor("health_import", {}) exactly once`,
      (providerSrc.match(/autoPeriodTagFor\("health_import", \{\}\)/g) ?? []).length,
      1
    );
  }
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

// ── CGM-A2: the sensor-aware planner ─────────────────────────────────────

const T = Date.parse("2026-03-01T10:00:00.000Z");
const cand = (
  minutes: number,
  mgdl: number,
  over: Partial<PlanCandidate> = {}
): PlanCandidate => ({
  atMs: T + minutes * 60_000,
  mgdl,
  source: "health",
  sourceApp: "com.sensor.a",
  externalId: `x-${minutes}-${mgdl}-${over.sourceApp ?? "a"}`,
  isCgm: true,
  ...over,
});
const row = (minutes: number, mgdl: number, over: Partial<PlanExisting> = {}): PlanExisting => ({
  id: `r-${minutes}-${mgdl}`,
  atMs: T + minutes * 60_000,
  mgdl,
  source: "health",
  sourceApp: "com.sensor.a",
  externalId: `e-${minutes}`,
  isCgm: true,
  ...over,
});

section("M. a flat stretch of a sensor keeps every real reading");
{
  const flat = [cand(0, 110), cand(5, 110), cand(10, 110), cand(15, 110)];
  eq("four equal readings 5 min apart all land", planGlucoseImport(flat, []).insert.length, 4);
  const legacy = planHealthImport(
    flat.map((c) => sample(c.mgdl, new Date(c.atMs).toISOString())),
    []
  );
  eq("the same values as plain Health samples keep the old 15 minute rule", legacy.length, 1);
  eq("equal readings next to a stored sensor row still land", planGlucoseImport([cand(5, 110)], [row(0, 110)]).insert.length, 1);
}

section("N. another source's copy of the same reading: 150 s and 1 mg/dL");
{
  const stored = [row(0, 110, { source: "nightscout", sourceApp: "ns", externalId: "n1" })];
  eq("100 s apart, same value: skipped", planGlucoseImport([cand(100 / 60, 110)], stored).insert.length, 0);
  eq("100 s apart, 1 mg/dL off (mmol rounding): skipped", planGlucoseImport([cand(100 / 60, 111)], stored).insert.length, 0);
  eq("exactly 150 s apart: skipped", planGlucoseImport([cand(150 / 60, 110)], stored).insert.length, 0);
  eq("151 s apart: a different reading", planGlucoseImport([cand(151 / 60, 110)], stored).insert.length, 1);
  eq("2 mg/dL off: a different reading", planGlucoseImport([cand(1, 112)], stored).insert.length, 1);
  const twoApps = planGlucoseImport(
    [cand(0, 100, { sourceApp: "com.sensor.a" }), cand(0.5, 101, { sourceApp: "com.sensor.b" })],
    []
  );
  eq("two apps of the same batch: first in stays", twoApps.insert.length, 1);
  eq("and it is the earlier one", twoApps.insert[0], 0);
}

section("O. a typed row is never touched and blocks its sensor twin");
{
  const typed = row(0, 150, { source: "manual", sourceApp: null, externalId: null, isCgm: false });
  const plan = planGlucoseImport([cand(1, 150, { externalId: "u9" })], [typed]);
  eq("the sensor copy of a typed reading is not added", plan.insert.length, 0);
  eq("the typed row is not taken over", plan.own.length, 0);
  eq("a different value minutes later is added", planGlucoseImport([cand(3, 170)], [typed]).insert.length, 1);
  const manualOnly = planGlucoseImport([cand(0.2, 150, { source: "manual", externalId: "u1" })], [typed]);
  eq("a manual candidate never takes over a manual row", manualOnly.own.length, 0);
}

section("P. an old Health row without an id is taken over, not doubled");
{
  const old = row(0, 120, { externalId: null, sourceApp: null, isCgm: false });
  const plan = planGlucoseImport([cand(0.5, 120, { externalId: "u1" })], [old]);
  eq("nothing inserted", plan.insert.length, 0);
  eq("the old row is the one updated", plan.own.map((o) => o.existingId).join(","), old.id);
  const far = planGlucoseImport([cand(10, 120, { externalId: "u1" })], [old]);
  eq("10 minutes away it is a different reading", far.insert.length, 1);
  eq("and takes nothing over", far.own.length, 0);
  const two = planGlucoseImport([cand(0.2, 120, { externalId: "u1" }), cand(0.4, 120, { externalId: "u2" })], [old]);
  eq("one old row is taken over once", two.own.length, 1);
  const otherSource = row(0, 120, { source: "nightscout", externalId: null, sourceApp: null });
  eq("a Health candidate does not take a Nightscout row over", planGlucoseImport([cand(0.2, 120, { externalId: "u3" })], [otherSource]).own.length, 0);
}

section("Q. a 1 minute stream is thinned to about 5 minutes");
{
  const minute = Array.from({ length: 61 }, (_, i) => cand(i, 100 + (i % 7)));
  const plan = planGlucoseImport(minute, []);
  const kept = plan.insert.map((i) => minute[i].atMs);
  eq("61 minute readings keep 13", kept.length, 13);
  ok("kept readings are at least 270 s apart", kept.every((t, i) => i === 0 || t - kept[i - 1] >= 270_000));
  eq("the first reading is kept", kept[0], minute[0].atMs);
  const again = planGlucoseImport(minute, []);
  eq("deterministic: the same input gives the same plan", JSON.stringify(again.insert), JSON.stringify(plan.insert));
  const shuffled = [...minute].reverse();
  const rev = planGlucoseImport(shuffled, []);
  eq("input order does not matter", rev.insert.map((i) => shuffled[i].atMs).join(","), kept.join(","));
  const next = planGlucoseImport([cand(61, 100), cand(65, 100)], [row(60, 100)]);
  eq("against the last stored row: 1 min later skipped, 5 min later kept", next.insert.length, 1);
}

section("R. the same id is the same reading, per source");
{
  const stored = [row(0, 100, { externalId: "same" })];
  eq("the same source and id: skipped", planGlucoseImport([cand(30, 140, { externalId: "same" })], stored).insert.length, 0);
  eq("another source may reuse the id", planGlucoseImport([cand(30, 140, { externalId: "same", source: "nightscout", sourceApp: "ns" })], stored).insert.length, 1);
  eq("the same id twice in one batch: one row", planGlucoseImport([cand(30, 140, { externalId: "dup" }), cand(60, 150, { externalId: "dup" })], []).insert.length, 1);
}

section("S. non-sensor readings keep the 15 minute rule, but not against sensor rows");
{
  const meter = (m: number, v: number) => cand(m, v, { isCgm: false, sourceApp: "com.meter", externalId: `m-${m}` });
  eq("same value 10 min after a stored finger-stick: skipped", planGlucoseImport([meter(10, 130)], [row(0, 130, { isCgm: false, sourceApp: "com.meter", externalId: "q" })]).insert.length, 0);
  eq("same value 10 min after a SENSOR row: kept", planGlucoseImport([meter(10, 130)], [row(0, 130)]).insert.length, 1);
  eq("same value within 150 s of a sensor row of another app: skipped", planGlucoseImport([meter(1, 130)], [row(0, 130)]).insert.length, 0);
}

section("T. tombstones: a sensor reading is matched tightly, others by the old rule");
{
  const gone = [{ atMs: T, mgdl: 110 }];
  eq("a sensor reading 60 s from a removed one: skipped", planGlucoseImport([cand(1, 110)], [], gone).insert.length, 0);
  eq("a sensor reading 10 min later with the same value: kept", planGlucoseImport([cand(10, 110)], [], gone).insert.length, 1);
  eq("a plain sample 10 min later with the same value: skipped (old rule)", planGlucoseImport([cand(10, 110, { isCgm: false, externalId: null })], [], gone).insert.length, 0);
}

section("U. the import writes the new columns and never a typed row");
{
  const sqlSrc = readFileSync(join(import.meta.dirname, "..", "lib", "db", "healthImportSql.ts"), "utf8");
  ok("the insert carries source_app, external_id and is_cgm", /source_app, external_id, is_cgm/.test(sqlSrc.replace(/\s+/g, " ").replace(/, \s*/g, ", ")) || /source_app,\s*\n?\s*external_id, is_cgm/.test(sqlSrc));
  ok("a take-over never updates a typed row", /WHERE id = \? AND source <> 'manual' AND external_id IS NULL/.test(sqlSrc));
  ok("a source delete excludes typed rows in the statement", /source = \? AND source <> 'manual'/.test(sqlSrc));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
