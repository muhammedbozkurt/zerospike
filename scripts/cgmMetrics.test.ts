/**
 * lib/cgm/metrics.ts + the CGM basis in lib/insights.ts: coverage by five-minute
 * slot, the 50 % switch to sensor readings, GMI only over enough coverage, the
 * periods-below-target grouping, and the logging streak counting sensor days.
 * Run: npx tsx scripts/cgmMetrics.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  BELOW_MIN_DURATION_MS,
  CGM_BASIS_MIN_COVERAGE,
  GMI_MIN_COVERAGE,
  belowTargetPeriods,
  cgmGmiEligible,
  gmiFromMean,
  selectGlucoseBasis,
  type GlucosePoint,
} from "../lib/cgm/metrics";
import {
  computeInsights,
  consecutiveLogDays,
  dailyAverages,
  trendVsPrevious,
  windowPercentiles,
} from "../lib/insights";
import { computeAgp } from "../lib/agp";
import { CGM_ACTIVITY_SQL, readCgmActivity } from "../lib/db/sugarRange";
import type { SugarLog } from "../lib/db/types";

const DAY = 86_400_000;
const MIN = 60_000;
const NOW = new Date(2026, 5, 10, 12, 0, 0).getTime();
Date.now = () => NOW;

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ": " + detail : ""}`);
  }
}
function near(name: string, got: number | null, want: number, eps = 0.01): void {
  ok(name, got != null && Math.abs(got - want) <= eps, `got ${got}, want ${want}`);
}
function section(t: string): void {
  console.log(`\n${t}`);
}

function sugar(iso: string, mgdl: number, source: string, isCgm: boolean): SugarLog & { is_cgm: number } {
  return {
    id: "",
    profile_id: "p1",
    glucose_level_mgdl: mgdl,
    period_tag: isCgm ? "unset" : "fasting",
    source,
    logged_at: iso,
    tags: [],
    healthkit_uuid: null,
    is_cgm: isCgm ? 1 : 0,
  };
}

/** A sensor stream from `fromMs` for `count` readings, `stepMin` apart. */
function stream(fromMs: number, count: number, stepMin: number, value: (i: number) => number, source = "health") {
  return Array.from({ length: count }, (_, i) =>
    sugar(new Date(fromMs + i * stepMin * MIN).toISOString(), value(i), source, true)
  );
}

section("A. coverage counts five-minute slots, not rows");
{
  const win = { start: NOW - 14 * DAY, end: NOW };
  const full = selectGlucoseBasis(stream(win.start, 14 * 288, 5, () => 110), win);
  near("a full 5-minute stream covers the window", full.coverage, 1, 0.001);
  const half = selectGlucoseBasis(stream(win.start, 7 * 288, 5, () => 110), win);
  near("half the window covered", half.coverage, 0.5, 0.001);
  const oneMin = selectGlucoseBasis(stream(NOW - 3 * DAY, 3 * 1440, 1, () => 110), win);
  near("a 1-minute stream counts once per slot (3 of 14 days)", oneMin.coverage, 3 / 14, 0.002);
  ok("1-minute coverage is not row count / expected (would be capped at 1)", oneMin.coverage < 0.25, String(oneMin.coverage));
  near("no sensor readings: zero coverage", selectGlucoseBasis([sugar(new Date(NOW - MIN).toISOString(), 100, "manual", false)], win).coverage, 0);
  ok("rows outside the window do not count", selectGlucoseBasis(stream(NOW - 40 * DAY, 288, 5, () => 100), win).cgmCount === 0);
}

section("B. 50 % switch and manual rows");
{
  const win = { start: NOW - 2 * DAY, end: NOW };
  const manual = [
    sugar(new Date(NOW - 3 * 3600_000).toISOString(), 250, "manual", false),
    sugar(new Date(NOW - 9 * 3600_000).toISOString(), 250, "manual", false),
  ];
  // 2 days = 576 slots; 287 slots is just under half, 288 exactly half.
  const under = selectGlucoseBasis([...manual, ...stream(win.start + MIN, 287, 5, () => 100)], win);
  ok("below 50 %: every reading is the basis", under.kind === "all" && under.readings.length === 289, `${under.kind} ${under.readings.length}`);
  const at = selectGlucoseBasis([...manual, ...stream(win.start + MIN, 288, 5, () => 100)], win);
  ok("exactly 50 %: the sensor is the basis", at.kind === "cgm" && at.coverage === CGM_BASIS_MIN_COVERAGE, `${at.kind} ${at.coverage}`);
  ok("CGM basis leaves the manual rows out", at.readings.length === 288 && at.readings.every((r) => r.glucose_level_mgdl === 100));
  ok("the other readings are still counted", at.otherCount === 2 && at.all.length === 290);

  const rows = [...manual, ...stream(win.start + MIN, 288, 5, () => 100)];
  const data = computeInsights(rows, [], [], 2, { low: 70, high: 180 });
  near("TIR over the sensor only (manual 250s dropped)", data.inRangePct, 100);
  near("average over the sensor only", data.avgGlucose, 100);
  ok("basis is reported", data.basis === "cgm" && data.cgmReadings === 288 && data.manualReadings === 2);
  near("coverage percent is exposed", data.cgmCoverage, 50, 0.01);
  const low = computeInsights([...manual, ...stream(win.start + MIN, 287, 5, () => 100)], [], [], 2, { low: 70, high: 180 });
  ok("below 50 %: manual rows count again", low.basis === "manual" && low.readings === 289 && (low.inRangePct ?? 0) < 100);
  ok("below 50 %: the coverage is still reported", low.cgmCoverage != null && low.cgmCoverage < 50);
  const none = computeInsights(manual, [], [], 2, { low: 70, high: 180 });
  ok("no sensor rows: no coverage figure", none.cgmCoverage === null && none.cgmReadings === 0 && none.basis === "manual");
}

section("C. period averages stay on hand-entered rows");
{
  const win0 = NOW - 14 * DAY;
  const fasting = sugar(new Date(NOW - 2 * DAY).toISOString(), 90, "manual", false);
  const rows = [fasting, ...stream(win0, 14 * 288, 5, () => 140)];
  const data = computeInsights(rows, [], [], 14, { low: 70, high: 180 });
  ok("CGM basis", data.basis === "cgm");
  near("fasting average from the user's own row", data.avgFasting, 90);
  near("average from the sensor", data.avgGlucose, 140);
}

section("D. GMI needs a long enough window, well covered");
{
  near("GMI formula", gmiFromMean(100), 3.31 + 2.392, 1e-9);
  const w14 = { start: NOW - 14 * DAY, end: NOW };
  const mk = (days: number, covered: number) =>
    stream(NOW - days * DAY, Math.ceil(days * 288 * covered), 5, () => 120);
  const g = (days: number, covered: number) =>
    computeInsights(mk(days, covered), [], [], days, { low: 70, high: 180 }).gmi;
  ok("14 days, 100 %: GMI shown", g(14, 1) != null);
  near("GMI value from the sensor mean", g(14, 1), gmiFromMean(120), 1e-9);
  ok("14 days at 70 %: shown", g(14, GMI_MIN_COVERAGE) != null);
  ok("14 days at 69 %: hidden", g(14, 0.69) === null);
  ok("7 days at 100 %: hidden (window too short)", g(7, 1) === null);
  ok("30 days at 100 %: shown", g(30, 1) != null);
  const mixed = (days: number, covered: number) => {
    const rows = mk(days, covered);
    for (let d = 0; d < days; d++) rows.push(sugar(new Date(NOW - d * DAY - 3600_000).toISOString(), 100, "manual", false));
    return computeInsights(rows, [], [], days, { low: 70, high: 180 });
  };
  ok("30 days, 45 % sensor + fingersticks: GMI hidden (was shown from the mix)", mixed(30, 0.45).gmi === null);
  ok("30 days, 60 % sensor + fingersticks: GMI hidden (below 70 %)", mixed(30, 0.6).gmi === null);
  ok("30 days, 30 % sensor + fingersticks: GMI hidden", mixed(30, 0.3).gmi === null);
  ok("30 days, 90 % sensor + fingersticks: GMI shown", mixed(30, 0.9).gmi != null);
  ok("eligibility: manual basis never", !cgmGmiEligible({ kind: "all", coverage: 1 }, w14));
  ok("eligibility: 13-day custom range hidden", !cgmGmiEligible({ kind: "cgm", coverage: 1 }, { start: NOW - 13 * DAY, end: NOW }));
  ok("eligibility: 14-day pick ending 23:59 shown", cgmGmiEligible({ kind: "cgm", coverage: 1 }, { start: NOW - 14 * DAY + 1, end: NOW }));
}

section("E. manual-only users are unchanged");
{
  const rows: SugarLog[] = [];
  for (let d = 0; d < 20; d++) rows.push(sugar(new Date(NOW - d * DAY - 3600_000).toISOString(), 100 + d, "manual", false));
  const data = computeInsights(rows, [], [], 30, { low: 70, high: 180 });
  ok("manual basis", data.basis === "manual" && data.cgmReadings === 0);
  ok("readings = rows in window", data.readings === 20);
  ok("legacy GMI rule still applies (>=14 readings over 14 days)", data.gmi != null);
}

section("F. trend, percentiles, daily averages, AGP follow the basis");
{
  const win0 = NOW - 14 * DAY;
  const rows = [
    sugar(new Date(NOW - 1 * DAY).toISOString(), 300, "manual", false),
    ...stream(win0, 14 * 288, 5, () => 100),
  ];
  const wp = windowPercentiles(rows, 14);
  ok("percentiles ignore the manual 300", wp != null && wp.p95 === 100 && wp.n === 14 * 288, JSON.stringify(wp));
  const days = dailyAverages(rows, 14);
  ok("daily averages ignore the manual 300", days.every((d) => d.avg === 100), JSON.stringify(days.map((d) => d.avg)));
  const agp = computeAgp(rows, 14);
  ok("AGP ignores the manual 300", agp.totalReadings === 14 * 288 && agp.bands.every((b) => b.p95 === 100));
  // previous window has only 10 % sensor coverage: it falls back to all its rows
  const prev = [
    sugar(new Date(NOW - 20 * DAY).toISOString(), 200, "manual", false),
    ...stream(NOW - 28 * DAY, 100, 5, () => 200),
  ];
  const trend = trendVsPrevious([...rows, ...prev], 14, { low: 70, high: 180 });
  near("trend compares each window on its own basis", trend.avgDelta, 100 - 200, 0.001);
}

section("G. periods below the target");
{
  const t0 = NOW - 6 * 3600_000;
  const at = (min: number, v: number) => ({ logged_at: new Date(t0 + min * MIN).toISOString(), glucose_level_mgdl: v });
  const pts: GlucosePoint[] = [
    at(0, 100),
    at(5, 65), at(10, 60), at(15, 58), at(20, 62), at(25, 69),
    at(30, 100),
    at(60, 60), at(65, 62),
    at(70, 100),
    at(120, 66), at(135, 64), at(150, 60),
    at(155, 100),
  ];
  const periods = belowTargetPeriods(pts, 70);
  ok("two periods qualify, the 5-minute dip does not", periods.length === 2, JSON.stringify(periods));
  ok("newest first", periods[0].startMs > periods[1].startMs);
  ok("first period is 20 min, lowest 58", periods[1].minutes === 20 && periods[1].lowest === 58, JSON.stringify(periods[1]));
  ok("gaps of 15 minutes join a period", periods[0].minutes === 30 && periods[0].lowest === 60, JSON.stringify(periods[0]));
  ok("the minimum is 15 minutes", BELOW_MIN_DURATION_MS === 15 * MIN);
  const gap = belowTargetPeriods([at(0, 60), at(16, 60), at(32, 60)], 70);
  ok("a gap over 15 minutes splits readings into separate (too short) periods", gap.length === 0);
  const dense = Array.from({ length: 120 }, (_, i) => at(i, 60));
  ok("a dense stream is one row, not 120", belowTargetPeriods(dense, 70).length === 1);
}

section("H. the streak counts days the sensor fed the journal");
{
  const day = (offset: number, hour: number) => {
    const d = new Date(NOW);
    d.setDate(d.getDate() - offset);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  };
  const manual = [day(0, 8), day(1, 8)];
  ok("manual days alone", consecutiveLogDays(manual) === 2);
  const cgm = [day(2, 3), day(3, 22), day(4, 12)];
  ok("sensor days extend the streak", consecutiveLogDays(manual, cgm) === 5);
  ok("a gap still ends it", consecutiveLogDays(manual, [day(3, 12)]) === 2);
  ok("sensor days only", consecutiveLogDays([], [day(0, 2), day(1, 2), day(2, 2)]) === 3);
  ok("yesterday is enough, as before", consecutiveLogDays([], [day(1, 2), day(2, 2)]) === 2);
}

section("I. the activity query returns one stamp per quarter hour");
async function activity(): Promise<void> {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE sugar_logs (id TEXT PRIMARY KEY, profile_id TEXT, glucose_level_mgdl INTEGER, source TEXT, logged_at TEXT, is_cgm INTEGER NOT NULL DEFAULT 0);`);
  const ins = db.prepare("INSERT INTO sugar_logs (id, profile_id, glucose_level_mgdl, source, logged_at, is_cgm) VALUES (?,?,?,?,?,?)");
  let n = 0;
  for (let i = 0; i < 288 * 2; i++) ins.run(`c${n++}`, "p1", 100, "health", new Date(NOW - i * 5 * MIN).toISOString(), 1);
  ins.run(`m${n++}`, "p1", 100, "manual", new Date(NOW - 30 * DAY).toISOString(), 0);
  ins.run(`o${n++}`, "p2", 100, "health", new Date(NOW - 5 * MIN).toISOString(), 1);
  const reader = { getAllAsync: async <T>(sql: string, params: unknown[] = []) => db.prepare(sql).all(...(params as never[])) as T[] };
  const stamps = await readCgmActivity(reader, "p1", new Date(NOW - 10 * DAY).toISOString());
  ok("one stamp per quarter hour over two days", stamps.length === 2 * 96 || stamps.length === 2 * 96 + 1, String(stamps.length));
  ok("only this profile's sensor rows", stamps.every((s) => typeof s === "string"));
  ok("the statement groups by hour and quarter", CGM_ACTIVITY_SQL.includes("GROUP BY"));
}

section("J. the Insights screen reads sensor data uncapped and keeps the percentile scale left to right");
{
  const src = readFileSync(join(__dirname, "..", "app/insights.tsx"), "utf8");
  ok("no 2000-row cap on the sensor stream", src.includes("listInsightsSugar(activeProfile.id, fetchRange)") && !/listSugarLogs\(/.test(src));
  const at = src.indexOf("Percentile band summary");
  const block = src.slice(at, at + 1800);
  ok("percentile scale is locked low to high (row-reverse under RTL)", /I18nManager\.isRTL \? "row-reverse" : "row"/.test(block));
  ok("sensor basis swaps the readings count for coverage", src.includes('t("cgmInsights.coverage")') && src.includes("basisLine(t, Platform.OS, data)"));
  ok("GMI from the sensor is named by its abbreviation", src.includes('"cgmInsights.gmiLabel"') && src.includes('"cgmInsights.gmiNote"'));
}

activity().then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
