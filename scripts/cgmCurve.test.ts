/**
 * Sensor curve: data shaping, geometry, the SQL behind it, and the per-day
 * journal summary. Pure Node, the SQL runs against node:sqlite with the real
 * v29 columns and indexes.
 * Run: npx tsx scripts/cgmCurve.test.ts
 */
process.env.TZ = "Europe/Berlin";

import { DatabaseSync } from "node:sqlite";

import {
  CURVE_GAP_MS,
  DAY_BUCKET_MS,
  FREE_CGM_WINDOW_MS,
  HOUR_MS,
  buildCurveModel,
  cgmAgeLabel,
  cgmWindowNeedsPro,
  hourTicks,
  layoutCurve,
  localDayRange,
  niceYTicks,
  parseCurveHours,
  recentDayRanges,
  rowFromLog,
  type CurveRow,
} from "../lib/cgm/curve";
import { cgmDayEntry, cgmDaysForFilter, mergeCgmDays } from "../lib/cgm/daySummary";
import {
  CGM_LATEST_SQL,
  CGM_RANGE_STATS_SQL,
  CGM_WINDOW_SQL,
  cgmDaySummariesSql,
  daySummariesArgs,
  rangeStatsArgs,
  toDaySummaries,
  toRangeStats,
  windowArgs,
} from "../lib/db/cgmCurveSql";
import { V29_COLUMNS, V29_INDEXES } from "../lib/db/v29Sql";
import { MGDL_PER_MMOL } from "../lib/glucose";

let passed = 0;
let failed = 0;
function eq(name: string, got: unknown, want: unknown): void {
  if (JSON.stringify(got) === JSON.stringify(want)) passed++;
  else {
    failed++;
    console.log(`  FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}
function ok(name: string, cond: boolean): void {
  eq(name, cond, true);
}

const MIN = 60_000;
const NOW = Date.UTC(2026, 9, 21, 12, 3, 30);

function sensorRows(fromMs: number, toMs: number, stepMs: number, value: (i: number) => number): CurveRow[] {
  const out: CurveRow[] = [];
  let i = 0;
  for (let t = fromMs; t <= toMs; t += stepMs) out.push({ atMs: t, mgdl: value(i++), isCgm: true });
  return out;
}

console.log("A. window size, buckets and medians");
{
  const startMs = Math.ceil((NOW - 12 * HOUR_MS) / (5 * MIN)) * (5 * MIN);
  const five = sensorRows(startMs, NOW, 5 * MIN, (i) => 100 + (i % 7));
  const m = buildCurveModel({ rows: five, startMs, endMs: NOW });
  ok("12 hours of 5 minute readings is at most 144 points", m.cgm.length <= 144 && m.cgm.length >= 143);
  eq("one segment when nothing is missing", m.segments.length, 1);

  const oneMin = sensorRows(startMs, NOW, MIN, () => 120);
  const dense = buildCurveModel({ rows: oneMin, startMs, endMs: NOW });
  ok("720 one-minute readings still give at most 144 points", dense.cgm.length <= 144);

  // The bucket median, not the mean and not the last value.
  const bucketStart = Math.floor(NOW / (5 * MIN)) * (5 * MIN) - 10 * (5 * MIN);
  const rows: CurveRow[] = [100, 101, 102, 190, 103].map((v, i) => ({
    atMs: bucketStart + i * MIN,
    mgdl: v,
    isCgm: true,
  }));
  const median = buildCurveModel({ rows, startMs: bucketStart - HOUR_MS, endMs: NOW });
  eq("five 1-minute values in one bucket keep the median", median.cgm.map((p) => p.mgdl), [102]);

  const even = buildCurveModel({
    rows: [100, 110].map((v, i) => ({ atMs: bucketStart + i * MIN, mgdl: v, isCgm: true })),
    startMs: bucketStart - HOUR_MS,
    endMs: NOW,
  });
  eq("an even count averages the two middle values", even.cgm.map((p) => p.mgdl), [105]);

  const outside = buildCurveModel({
    rows: [{ atMs: startMs - 1, mgdl: 300, isCgm: true }, { atMs: NOW + 1, mgdl: 300, isCgm: true }],
    startMs,
    endMs: NOW,
  });
  eq("readings outside the window are ignored", outside.cgm.length, 0);

  const partial = buildCurveModel({ rows: sensorRows(startMs, startMs + 3 * HOUR_MS, 5 * MIN, () => 100), startMs, endMs: startMs + 3 * HOUR_MS });
  ok("every point is inside the window", partial.cgm.every((p) => p.t >= startMs && p.t <= startMs + 3 * HOUR_MS));
  ok("points are oldest first", partial.cgm.every((p, i, a) => i === 0 || a[i - 1].t < p.t));
}

console.log("B. gaps break the line");
{
  const base = Date.UTC(2026, 9, 21, 6, 0, 0);
  const rows = [
    ...sensorRows(base, base + 30 * MIN, 5 * MIN, () => 110),
    ...sensorRows(base + 30 * MIN + 20 * MIN, base + 60 * MIN, 5 * MIN, () => 115),
  ];
  const m = buildCurveModel({ rows, startMs: base - HOUR_MS, endMs: base + 2 * HOUR_MS });
  eq("a 20 minute hole splits the line in two", m.segments.length, 2);
  const tenMin = buildCurveModel({
    rows: [{ atMs: base, mgdl: 100, isCgm: true }, { atMs: base + 10 * MIN, mgdl: 101, isCgm: true }],
    startMs: base - HOUR_MS,
    endMs: base + HOUR_MS,
  });
  eq("one missing 5 minute reading keeps the line whole", tenMin.segments.length, 1);
  const at15 = buildCurveModel({
    rows: [{ atMs: base, mgdl: 100, isCgm: true }, { atMs: base + 15 * MIN, mgdl: 101, isCgm: true }],
    startMs: base - HOUR_MS,
    endMs: base + HOUR_MS,
  });
  eq("exactly 15 minutes apart is still one line", at15.segments.length, 1);
  ok("the gap limit is 15 minutes", CURVE_GAP_MS === 15 * MIN);

  const geo = layoutCurve(m, { width: 300, height: 150, padL: 36, padR: 8, padT: 10, padB: 20 }, { low: 70, high: 180 }, "mgdl");
  eq("two segments make two paths", geo.paths.length, 2);

  const lone = buildCurveModel({
    rows: [{ atMs: base, mgdl: 100, isCgm: true }, { atMs: base + 40 * MIN, mgdl: 105, isCgm: true }],
    startMs: base - HOUR_MS,
    endMs: base + HOUR_MS,
  });
  const loneGeo = layoutCurve(lone, { width: 300, height: 150, padL: 36, padR: 8, padT: 10, padB: 20 }, null, "mgdl");
  eq("two single points draw as dots, not as a line", [loneGeo.paths.length, loneGeo.dots.length], [0, 2]);
}

console.log("C. hand-entered readings stay separate");
{
  const base = Date.UTC(2026, 9, 21, 6, 0, 0);
  const rows: CurveRow[] = [
    ...sensorRows(base, base + 60 * MIN, 5 * MIN, () => 110),
    { atMs: base + 22 * MIN, mgdl: 131, isCgm: false },
  ];
  const m = buildCurveModel({ rows, startMs: base - HOUR_MS, endMs: base + 2 * HOUR_MS });
  eq("the manual reading is not in the line", m.cgm.some((p) => p.mgdl === 131), false);
  eq("it is kept as its own mark", m.manual, [{ t: base + 22 * MIN, mgdl: 131 }]);
  eq("it still counts for the axis range", m.maxMgdl, 131);
  const geo = layoutCurve(m, { width: 300, height: 150, padL: 36, padR: 8, padT: 10, padB: 20 }, { low: 70, high: 180 }, "mgdl");
  eq("and is laid out as a mark", geo.manual.length, 1);
}

console.log("D. mmol axis uses the display unit");
{
  const ticks = niceYTicks(60, 250, "mmol");
  ok("mmol ticks are whole or half mmol steps", ticks.every((t) => Math.abs((t / MGDL_PER_MMOL) * 2 - Math.round((t / MGDL_PER_MMOL) * 2)) < 1e-6));
  ok("at most five ticks", ticks.length <= 5 && ticks.length >= 2);
  const mg = niceYTicks(60, 250, "mgdl");
  ok("mg/dL ticks are round tens", mg.every((t) => t % 10 === 0) && mg.length <= 5);
  const base = Date.UTC(2026, 9, 21, 6, 0, 0);
  const m = buildCurveModel({
    rows: sensorRows(base, base + 60 * MIN, 5 * MIN, () => 108),
    startMs: base,
    endMs: base + 2 * HOUR_MS,
  });
  const geo = layoutCurve(m, { width: 300, height: 150, padL: 36, padR: 8, padT: 10, padB: 20 }, { low: 70, high: 180 }, "mmol");
  ok("labels are mmol/L numbers", geo.yTicks.every((t) => Number(t.label) > 0 && Number(t.label) < 30));
  const mgGeo = layoutCurve(m, { width: 300, height: 150, padL: 36, padR: 8, padT: 10, padB: 20 }, { low: 70, high: 180 }, "mgdl");
  ok("labels are mg/dL numbers", mgGeo.yTicks.every((t) => Number(t.label) >= 40));
  ok("the target band is laid out", geo.band != null && geo.band.h > 0);
}

console.log("E. DST: day ranges and ticks follow the local clock");
{
  const spring = localDayRange("2026-03-29")!;
  const fall = localDayRange("2026-10-25")!;
  const normal = localDayRange("2026-06-10")!;
  eq("spring-forward day is 23 hours", (spring.hiMs - spring.loMs) / HOUR_MS, 23);
  eq("fall-back day is 25 hours", (fall.hiMs - fall.loMs) / HOUR_MS, 25);
  eq("an ordinary day is 24 hours", (normal.hiMs - normal.loMs) / HOUR_MS, 24);

  const rows = sensorRows(spring.loMs, spring.hiMs - 1, 10 * MIN, () => 105);
  const m = buildCurveModel({ rows, startMs: spring.loMs, endMs: spring.hiMs, bucketMs: DAY_BUCKET_MS });
  eq("the 23 hour day has 138 ten-minute points", m.cgm.length, 138);
  const fallRows = sensorRows(fall.loMs, fall.hiMs - 1, 10 * MIN, () => 105);
  const fm = buildCurveModel({ rows: fallRows, startMs: fall.loMs, endMs: fall.hiMs, bucketMs: DAY_BUCKET_MS });
  eq("the 25 hour day has 150 ten-minute points", fm.cgm.length, 150);
  eq("one segment across the change", fm.segments.length, 1);

  const ticks = hourTicks(spring.loMs, spring.hiMs, 6);
  eq("6-hourly ticks on the spring day are local 0, 6, 12, 18", ticks.map((t) => new Date(t).getHours()), [0, 6, 12, 18]);
  const hourly = hourTicks(spring.loMs, spring.hiMs, 1);
  eq("no hour is doubled on the spring day", new Set(hourly).size, hourly.length);
  eq("the skipped 02:00 hour has no tick", hourly.length, 23);
  const fallHourly = hourTicks(fall.loMs, fall.hiMs, 1);
  eq("no hour is doubled on the fall day", new Set(fallHourly).size, fallHourly.length);

  const days = recentDayRanges(Date.UTC(2026, 9, 26, 10, 0, 0), 3);
  eq("recent days are newest first", days.map((d) => d.dayKey), ["2026-10-26", "2026-10-25", "2026-10-24"]);
  eq("the DST day inside the list is 25 hours", (days[1].hiMs - days[1].loMs) / HOUR_MS, 25);
  eq("days are contiguous", days[0].loMs, days[1].hiMs);
}

console.log("F. the free 24 hours and the age label");
{
  ok("a window ending now is free", !cgmWindowNeedsPro(NOW, NOW));
  ok("a day that ended 23 hours ago is free", !cgmWindowNeedsPro(NOW - 23 * HOUR_MS, NOW));
  ok("a day that ended 25 hours ago is Pro", cgmWindowNeedsPro(NOW - 25 * HOUR_MS, NOW));
  eq("the free span is 24 hours", FREE_CGM_WINDOW_MS, 24 * HOUR_MS);
  const labels = { hourShort: "sa", minuteShort: "dk", agoTemplate: "{{t}} önce" };
  eq("4 minutes", cgmAgeLabel(NOW - 4 * MIN - 20_000, NOW, labels), "4 dk önce");
  eq("an hour and five", cgmAgeLabel(NOW - 65 * MIN, NOW, labels), "1 sa 5 dk önce");
  eq("a future timestamp reads as 0", cgmAgeLabel(NOW + 5 * MIN, NOW, labels), "0 dk önce");
  eq("hours default to 6", parseCurveHours(null), 6);
  eq("12 is accepted", parseCurveHours("12"), 12);
  eq("24 is not a choice", parseCurveHours("24"), 6);
}

console.log("G. the SQL on a scratch database (real v29 columns and indexes)");
{
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE sugar_logs (
    id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL, glucose_level_mgdl INTEGER NOT NULL,
    period_tag TEXT NOT NULL DEFAULT 'manual', source TEXT NOT NULL DEFAULT 'manual',
    logged_at TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', healthkit_uuid TEXT);
    CREATE INDEX idx_sugar_profile ON sugar_logs (profile_id, logged_at DESC);`);
  for (const c of V29_COLUMNS) db.exec(`ALTER TABLE sugar_logs ADD COLUMN ${c.name} ${c.type};`);
  for (const sql of V29_INDEXES) db.exec(sql);

  const insert = db.prepare(
    "INSERT INTO sugar_logs (id, profile_id, glucose_level_mgdl, source, logged_at, is_cgm) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const now = Date.UTC(2026, 9, 21, 12, 0, 0);
  db.exec("BEGIN");
  let n = 0;
  for (let i = 0; i < 288 * 3; i++) {
    const at = new Date(now - i * 5 * MIN).toISOString();
    insert.run(`c${n++}`, "p1", 100 + (i % 60), "health", at, 1);
  }
  insert.run("m1", "p1", 131, "manual", new Date(now - 30 * MIN).toISOString(), 0);
  insert.run("o1", "p2", 200, "health", new Date(now - 10 * MIN).toISOString(), 1);
  db.exec("COMMIT");

  const win = db.prepare(CGM_WINDOW_SQL).all(...windowArgs("p1", now - 12 * HOUR_MS, now)) as {
    logged_at: string; glucose_level_mgdl: number; is_cgm: number;
  }[];
  eq("the 12 hour window holds 145 sensor rows plus the manual one", win.length, 146);
  ok("rows come oldest first", win.every((r, i) => i === 0 || win[i - 1].logged_at <= r.logged_at));
  ok("another profile's rows never show", !win.some((r) => r.glucose_level_mgdl === 200));
  const rows = win.map(rowFromLog).filter((r): r is CurveRow => r != null);
  eq("the manual row keeps its flag", rows.filter((r) => !r.isCgm).length, 1);
  const model = buildCurveModel({ rows, startMs: Math.ceil((now - 12 * HOUR_MS) / (5 * MIN)) * 5 * MIN, endMs: now });
  ok("and the model is at most 144 points", model.cgm.length <= 144);

  const latest = db.prepare(CGM_LATEST_SQL).all("p1") as { logged_at: string }[];
  eq("the latest query returns six, newest first", [latest.length, latest[0].logged_at], [6, new Date(now).toISOString()]);

  const band = { low: 80, high: 160 };
  const stats = toRangeStats(
    db.prepare(CGM_RANGE_STATS_SQL).get(...rangeStatsArgs("p1", band, now - 24 * HOUR_MS, now + MIN)) as never
  );
  eq("24 hours of sensor rows are counted without the manual one", stats.count, 289);
  ok("the average and in-range share are real numbers", stats.avgMgdl != null && stats.inRange > 0 && stats.inRange <= stats.count);
  const empty = toRangeStats(db.prepare(CGM_RANGE_STATS_SQL).get(...rangeStatsArgs("p3", band, 0, now)) as never);
  eq("no rows is a clean zero", empty, { count: 0, avgMgdl: null, inRange: 0 });

  const dayCount = 4;
  const sql = cgmDaySummariesSql(dayCount);
  const args = daySummariesArgs("p1", band, now, dayCount);
  const summaries = toDaySummaries(db.prepare(sql).all(...args) as never);
  eq("72 hours of data touch four local days", summaries.length, 4);
  eq("newest first", summaries[0].dayKey > summaries[1].dayKey, true);
  eq("every row lands in exactly one day", summaries.reduce((s, d) => s + d.count, 0), 288 * 3);
  ok("no day counts more than 288 five-minute readings", summaries.every((d) => d.count <= 288));
  const entries = summaries.map(cgmDayEntry);
  ok("the share is 0..100", entries.every((e) => e.inRangePct >= 0 && e.inRangePct <= 100));

  for (const [label, text, params] of [
    ["window", CGM_WINDOW_SQL, windowArgs("p1", 0, now)],
    ["latest", CGM_LATEST_SQL, ["p1"]],
    ["stats", CGM_RANGE_STATS_SQL, rangeStatsArgs("p1", band, 0, now)],
    ["day summaries", sql, args],
  ] as const) {
    const plan = (db.prepare(`EXPLAIN QUERY PLAN ${text}`).all(...(params as (string | number)[])) as { detail: string }[])
      .map((r) => r.detail)
      .join(" | ");
    ok(`${label}: no full table scan (${plan})`, !/\bSCAN (sugar_logs|s)\b(?! USING)/i.test(plan) && /idx_sugar/.test(plan));
  }
}

console.log("H. the journal folds sensor readings into one row per day");
{
  const feed = [
    { id: "a", kind: "meal", logged_at: "2026-10-21T10:00:00.000Z" },
    { id: "b", kind: "glucose", logged_at: "2026-10-21T08:00:00.000Z" },
    { id: "c", kind: "meal", logged_at: "2026-10-20T10:00:00.000Z" },
  ];
  const days = [
    cgmDayEntry({ dayKey: "2026-10-21", count: 120, avgMgdl: 130, inRange: 90, lastAt: "2026-10-21T09:00:00.000Z" }),
    cgmDayEntry({ dayKey: "2026-10-20", count: 288, avgMgdl: 138, inRange: 213, lastAt: "2026-10-20T21:55:00.000Z" }),
  ];
  const merged = mergeCgmDays(feed, days);
  eq("the summary sits at the day's last reading", merged.map((e) => e.id), ["a", "2026-10-21", "b", "2026-10-20", "c"]);
  eq("one summary row per day", merged.filter((e) => e.kind === "cgmday").length, 2);
  eq("the feed's own rows are untouched", merged.filter((e) => e.kind !== "cgmday").map((e) => e.id), ["a", "b", "c"]);
  ok("the list stays newest first", merged.every((e, i, a) => i === 0 || a[i - 1].logged_at >= e.logged_at));
  eq("no days leaves the feed as it was", mergeCgmDays(feed, []).map((e) => e.id), ["a", "b", "c"]);
  eq("only summaries gives the summaries", mergeCgmDays([], days).length, 2);
  eq("share rounds", days[1].inRangePct, 74);
  eq("summary rows belong to the all list", cgmDaysForFilter("all"), true);
  eq("and the glucose list", cgmDaysForFilter("glucose"), true);
  eq("not to meals, injections or medication", ["meal", "injection", "med"].some(cgmDaysForFilter), false);
}

console.log(`\ncgmCurve: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
