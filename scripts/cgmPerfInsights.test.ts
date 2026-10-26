/**
 * Perf section C of the CGM plan: ninety days of five-minute sensor readings
 * (25 920 rows) through the REAL statements (lib/db/sugarRange.ts on node:sqlite)
 * and the REAL metric functions. Insights' data path (lean read + computeInsights
 * + computeAgp) must stay under 400 ms; the plan must use the sensor index.
 *
 * Run: npx tsx scripts/cgmPerfInsights.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import { DatabaseSync } from "node:sqlite";

import { computeAgp } from "../lib/agp";
import { computeInsights, dailyAverages, trendVsPrevious, windowPercentiles } from "../lib/insights";
import { bestDayAndStreaks, cvTrend, hourBandAverages, weeklyComparison } from "../lib/insightsPro";
import { glucosePointsSql, readCgmActivity, readGlucosePoints, readInsightsSugar } from "../lib/db/sugarRange";
import { V29_COLUMNS, V29_INDEXES } from "../lib/db/v29Sql";

const DAY = 86_400_000;
const NOW = new Date(2026, 5, 10, 12, 0, 0).getTime();
Date.now = () => NOW;
const BUDGET_MS = 400;

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ": " + detail : ""}`);
  }
}

const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE sugar_logs (
  id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL, glucose_level_mgdl INTEGER NOT NULL,
  period_tag TEXT NOT NULL DEFAULT 'unset', source TEXT NOT NULL DEFAULT 'manual',
  logged_at TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', healthkit_uuid TEXT);`);
for (const col of V29_COLUMNS) db.exec(`ALTER TABLE sugar_logs ADD COLUMN ${col.name} ${col.type};`);
db.exec("CREATE INDEX idx_sugar_profile ON sugar_logs (profile_id, logged_at DESC);");
for (const stmt of V29_INDEXES) db.exec(stmt);

const insert = db.prepare(
  "INSERT INTO sugar_logs (id, profile_id, glucose_level_mgdl, period_tag, source, logged_at, tags, is_cgm) VALUES (?,?,?,?,?,?,?,?)"
);
db.exec("BEGIN");
let n = 0;
const COUNT = 90 * 288;
for (let i = 0; i < COUNT; i++) {
  const at = NOW - (COUNT - i) * 300_000;
  const v = 105 + Math.round(40 * Math.sin(i / 17) + 15 * Math.sin(i / 3));
  insert.run(`c${n++}`, "p1", Math.max(45, v), "unset", "health", new Date(at).toISOString(), "[]", 1);
}
for (let d = 0; d < 90; d++) {
  for (const h of [7, 13, 19]) {
    insert.run(`m${n++}`, "p1", 100 + ((d * 13 + h) % 80), "fasting", "manual", new Date(NOW - d * DAY - (12 - h) * 3_600_000).toISOString(), "[]", 0);
  }
}
insert.run(`o${n++}`, "p2", 100, "unset", "health", new Date(NOW - 60_000).toISOString(), "[]", 1);
db.exec("COMMIT");

const reader = {
  getAllAsync: async <T>(sql: string, params: (string | number | null)[] = []) =>
    db.prepare(sql).all(...(params as never[])) as T[],
};
const range = { start: NOW - 90 * DAY, end: NOW };

function plan(sql: string, params: unknown[]): string {
  return (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...(params as never[])) as { detail: string }[])
    .map((r) => r.detail)
    .join(" | ");
}

async function main(): Promise<void> {
  console.log("cgm perf, section C: insights data path");

  const cgmPlan = plan(glucosePointsSql(true, "cgm"), ["p1", new Date(range.start).toISOString(), new Date(range.end).toISOString()]);
  ok("sensor read uses the sensor index, no table scan", /idx_sugar_cgm/.test(cgmPlan) && !/SCAN sugar_logs(?! USING)/.test(cgmPlan), cgmPlan);
  const allPlan = plan(glucosePointsSql(true, "all"), ["p1", new Date(range.start).toISOString(), new Date(range.end).toISOString()]);
  ok("full read is an index range, not a table scan", /USING (COVERING )?INDEX/.test(allPlan), allPlan);

  // The spec path: lean read + computeInsights + computeAgp.
  const timings: number[] = [];
  let insights: ReturnType<typeof computeInsights> | null = null;
  let agpTotal = 0;
  for (let run = 0; run < 3; run++) {
    const t0 = performance.now();
    const rows = await readInsightsSugar(reader, "p1", range);
    insights = computeInsights(rows, [], [], 90, { low: 70, high: 180 }, range);
    const agp = computeAgp(rows, 90, range);
    agpTotal = agp.totalReadings;
    timings.push(performance.now() - t0);
  }
  timings.sort((a, b) => a - b);
  const median = timings[1];
  console.log(`  read + computeInsights + computeAgp (90 days, ${COUNT} sensor rows): ${timings.map((t) => t.toFixed(0)).join(" / ")} ms`);
  ok(`read + computeInsights + computeAgp < ${BUDGET_MS} ms (median of 3)`, median < BUDGET_MS, `${median.toFixed(0)} ms`);
  ok("insights ran on the sensor stream", insights != null && insights.basis === "cgm" && insights.cgmReadings === COUNT, JSON.stringify(insights && { b: insights.basis, n: insights.cgmReadings }));
  ok("AGP pooled every sensor reading", agpTotal === COUNT, String(agpTotal));
  ok("coverage is full", insights != null && insights.cgmCoverage != null && insights.cgmCoverage > 99, String(insights?.cgmCoverage));
  ok("GMI is shown over 90 days", insights != null && insights.gmi != null);

  // The lean read alone, as the spec names it.
  const t1 = performance.now();
  const points = await readGlucosePoints(reader, "p1", range, "all");
  const readMs = performance.now() - t1;
  // 90 days x 3 hand-entered rows, minus the two stamped later today than "now".
  ok("lean read returns every row of the span for this profile", points.length === COUNT + 268, String(points.length));
  ok("lean rows carry only the four columns plus the parsed time", Object.keys(points[0]).sort().join(",") === "glucose_level_mgdl,is_cgm,logged_at,source,t");
  console.log(`  listGlucosePoints alone: ${readMs.toFixed(0)} ms`);
  ok("lean read alone < 250 ms", readMs < 250, `${readMs.toFixed(0)} ms`);

  // Everything else the screen computes from the same rows, in one go.
  const rows = await readInsightsSugar(reader, "p1", range);
  const t2 = performance.now();
  windowPercentiles(rows, 90, range);
  dailyAverages(rows, 90, range);
  trendVsPrevious(rows, 90, { low: 70, high: 180 }, range);
  weeklyComparison(rows, NOW, "monday");
  hourBandAverages(rows, 90, range);
  bestDayAndStreaks(rows, undefined, NOW);
  cvTrend(rows, NOW, "monday");
  const restMs = performance.now() - t2;
  console.log(`  the screen's other figures: ${restMs.toFixed(0)} ms`);
  ok("the rest of the screen's figures < 400 ms", restMs < BUDGET_MS, `${restMs.toFixed(0)} ms`);

  const t3 = performance.now();
  const stamps = await readCgmActivity(reader, "p1", new Date(NOW - 60 * DAY).toISOString());
  const actMs = performance.now() - t3;
  ok("streak activity: one stamp per quarter hour of 60 days", stamps.length >= 60 * 96 - 1 && stamps.length <= 60 * 96 + 1, String(stamps.length));
  ok("streak activity < 100 ms", actMs < 100, `${actMs.toFixed(0)} ms`);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
