/**
 * Sensor-data performance gates. One section per card that owns a hot path:
 *
 *   A. (CGM-A2) the import planner: 26k samples against 26k stored readings,
 *      the size of a 90 day sensor backfill, under 2 seconds. The planner used
 *      to compare every sample with every stored row (O(n*m)), which took
 *      minutes at this size.
 *
 * Run: npx tsx scripts/cgmPerf.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import {
  planGlucoseImport,
  planHealthImport,
  type ExistingSugarReading,
  type HealthSugarSample,
  type PlanCandidate,
  type PlanExisting,
} from "../lib/db/healthImportSql";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  x ${name}${detail ? ": " + detail : ""}`);
  }
}
function eq<T>(name: string, actual: T, expected: T): void {
  ok(name, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
function section(t: string): void {
  console.log(`\n${t}`);
}

const BUDGET_MS = 2000;
const N = 26_000;
const T0 = Date.parse("2026-01-01T00:00:00.000Z");
const FIVE = 5 * 60_000;

function timed<T>(fn: () => T): { value: T; ms: number } {
  const t = Date.now();
  const value = fn();
  return { value, ms: Date.now() - t };
}

console.log("zerospike cgm perf test");

section("A. 26k samples x 26k stored readings plan in under 2 seconds");
{
  const stored: PlanExisting[] = Array.from({ length: N }, (_, i) => ({
    id: `row-${i}`,
    atMs: T0 + i * FIVE,
    mgdl: 100 + (i % 50),
    source: "health",
    sourceApp: "com.sensor.a",
    externalId: `ext-${i}`,
    isCgm: true,
  }));

  const again: PlanCandidate[] = stored.map((r) => ({
    atMs: r.atMs,
    mgdl: r.mgdl,
    source: r.source,
    sourceApp: r.sourceApp,
    externalId: r.externalId,
    isCgm: true,
  }));
  const a = timed(() => planGlucoseImport(again, stored));
  eq("a re-read of the same 26k readings inserts nothing", a.value.insert.length, 0);
  ok(`...in under ${BUDGET_MS} ms`, a.ms < BUDGET_MS, `${a.ms} ms`);

  const other: PlanCandidate[] = stored.map((r, i) => ({
    atMs: r.atMs + 150_000,
    mgdl: r.mgdl + 10,
    source: "nightscout",
    sourceApp: "ns",
    externalId: `ns-${i}`,
    isCgm: true,
  }));
  const b = timed(() => planGlucoseImport(other, stored));
  eq("26k readings of another source, none the same as a stored one, all land", b.value.insert.length, N);
  ok(`...in under ${BUDGET_MS} ms`, b.ms < BUDGET_MS, `${b.ms} ms`);

  const shuffled = [...other].sort((x, y) => (x.externalId! < y.externalId! ? -1 : 1));
  const c = timed(() => planGlucoseImport(shuffled, stored));
  eq("input order does not change the outcome", c.value.insert.length, N);
  ok(`...and an unsorted input is still under ${BUDGET_MS} ms`, c.ms < BUDGET_MS, `${c.ms} ms`);

  const minute: PlanCandidate[] = Array.from({ length: N * 5 }, (_, i) => ({
    atMs: T0 + i * 60_000,
    mgdl: 100 + (i % 50),
    source: "health",
    sourceApp: "com.sensor.b",
    externalId: `m-${i}`,
    isCgm: true,
  }));
  const d = timed(() => planGlucoseImport(minute, []));
  ok("a 130k-reading 1 minute stream is thinned to about a fifth", d.value.insert.length >= N - 5 && d.value.insert.length <= N + 5, `${d.value.insert.length}`);
  ok(`...in under ${BUDGET_MS} ms`, d.ms < BUDGET_MS, `${d.ms} ms`);

  const oldRows: ExistingSugarReading[] = stored.map((r) => ({
    logged_at: new Date(r.atMs).toISOString(),
    glucose_level_mgdl: r.mgdl,
  }));
  const plain: HealthSugarSample[] = stored.map((r) => ({
    logged_at: new Date(r.atMs + 60_000).toISOString(),
    glucose_level_mgdl: r.mgdl + 20,
    period_tag: "unset",
  }));
  const e = timed(() => planHealthImport(plain, oldRows));
  eq("the plain Health path (old 15 minute rule) keeps all 26k", e.value.length, N);
  ok(`...in under ${BUDGET_MS} ms`, e.ms < BUDGET_MS, `${e.ms} ms`);

  console.log(
    `  timings (ms): same-ids ${a.ms}, other source ${b.ms}, unsorted ${c.ms}, 1-minute stream ${d.ms}, plain path ${e.ms}`
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
