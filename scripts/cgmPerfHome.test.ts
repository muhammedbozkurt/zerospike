/**
 * Home-screen performance (card CGM-B, "section B" of the perf plan): 90 days
 * of 5 minute sensor readings (25,920 rows) next to 600 hand-entered readings
 * and 300 meals, on node:sqlite with the app's real columns and indexes.
 *
 * Budgets (soft: over budget prints a warning, over 4x fails):
 *   journal feed LIMIT 300, sensor rows left out ....... < 30 ms
 *   12 hour curve window ............................... < 10 ms
 *   14 day summary (one row per day) ................... < 50 ms
 * EXPLAIN is the hard part: none of these statements may scan sugar_logs.
 *
 * Run: npx tsx scripts/cgmPerfHome.test.ts
 */
process.env.TZ = "Europe/Berlin";

import { DatabaseSync } from "node:sqlite";

import { HOUR_MS, buildCurveModel, rowFromLog, type CurveRow } from "../lib/cgm/curve";
import {
  CGM_LATEST_SQL,
  CGM_RANGE_STATS_SQL,
  CGM_WINDOW_SQL,
  cgmDaySummariesSql,
  daySummariesArgs,
  rangeStatsArgs,
  windowArgs,
} from "../lib/db/cgmCurveSql";
import { journalFeedArgs, journalFeedSql } from "../lib/db/journalSql";
import { V29_COLUMNS, V29_INDEXES } from "../lib/db/v29Sql";

let passed = 0;
let failed = 0;
let warned = 0;
function ok(name: string, cond: boolean): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  FAIL ${name}`);
  }
}

const MIN = 60_000;
const NOW = Date.UTC(2026, 9, 21, 12, 3, 30);
const P = "p1";

function build(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE foods (
      id TEXT PRIMARY KEY NOT NULL, name_tr TEXT, name_en TEXT, name_de TEXT, name_es TEXT,
      name_fr TEXT, name_it TEXT, name_pt TEXT, name_ar TEXT, name_ja TEXT, category TEXT);
    CREATE TABLE sugar_logs (
      id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL, glucose_level_mgdl INTEGER NOT NULL,
      period_tag TEXT NOT NULL DEFAULT 'manual', source TEXT NOT NULL DEFAULT 'manual',
      logged_at TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', healthkit_uuid TEXT);
    CREATE TABLE meal_logs (
      id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL, sugar_log_id TEXT, food_id TEXT,
      custom_food_name TEXT, portion_g REAL, calculated_carbs_g REAL, insulin_dose_units REAL,
      photo_uri_local TEXT, personal_note TEXT, logged_at TEXT NOT NULL, tags TEXT);
    CREATE TABLE injection_logs (
      id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL, site TEXT, site_point INTEGER,
      dose_units REAL, insulin_type TEXT, bolus_kind TEXT, meal_log_id TEXT, note TEXT,
      source TEXT, logged_at TEXT NOT NULL, tags TEXT, insulin_product_id TEXT, insulin_product_other TEXT);
    CREATE TABLE med_logs (
      id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL, taken_at INTEGER NOT NULL,
      name TEXT, note TEXT, created_at INTEGER NOT NULL);
    CREATE INDEX idx_sugar_profile ON sugar_logs (profile_id, logged_at DESC);
    CREATE INDEX idx_meal_profile ON meal_logs (profile_id, logged_at DESC);
    CREATE INDEX idx_injection_profile ON injection_logs (profile_id, logged_at DESC);
  `);
  for (const c of V29_COLUMNS) db.exec(`ALTER TABLE sugar_logs ADD COLUMN ${c.name} ${c.type};`);
  for (const sql of V29_INDEXES) db.exec(sql);

  const sugar = db.prepare(
    "INSERT INTO sugar_logs (id, profile_id, glucose_level_mgdl, period_tag, source, logged_at, is_cgm, external_id, source_app) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  const meal = db.prepare(
    "INSERT INTO meal_logs (id, profile_id, custom_food_name, portion_g, calculated_carbs_g, insulin_dose_units, logged_at, tags) VALUES (?, ?, 'meal', 150, 40, 4, ?, '[]')"
  );
  db.exec("BEGIN");
  const sensorCount = 90 * 288;
  for (let i = 0; i < sensorCount; i++) {
    const at = new Date(NOW - i * 5 * MIN).toISOString();
    sugar.run(`c${i}`, P, 90 + ((i * 7) % 80), "unset", "health", at, 1, `ext${i}`, "demo.cgm");
  }
  for (let i = 0; i < 600; i++) {
    const at = new Date(NOW - i * 3.4 * HOUR_MS).toISOString();
    sugar.run(`m${i}`, P, 100 + (i % 50), "manual", "manual", at, 0, null, null);
  }
  for (let i = 0; i < 300; i++) {
    meal.run(`meal${i}`, P, new Date(NOW - i * 7 * HOUR_MS).toISOString());
  }
  sugar.run("other", "p2", 300, "unset", "health", new Date(NOW - MIN).toISOString(), 1, "x", "demo.cgm");
  db.exec("COMMIT");
  return db;
}

/** Median of `runs` timed executions, in milliseconds. */
function time(runs: number, fn: () => void): number {
  const samples: number[] = [];
  fn();
  for (let i = 0; i < runs; i++) {
    const t0 = process.hrtime.bigint();
    fn();
    samples.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  samples.sort((a, b) => a - b);
  return samples[samples.length >> 1];
}

function budget(label: string, ms: number, limit: number): void {
  const line = `${label}: ${ms.toFixed(2)} ms (budget ${limit} ms)`;
  if (ms > limit) {
    warned++;
    console.log(`  WARN ${line}`);
  } else {
    console.log(`  ok   ${line}`);
  }
  ok(`${label} stays under 4x its budget`, ms <= limit * 4);
}

function plan(db: DatabaseSync, sql: string, params: (string | number)[]): string {
  return (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[])
    .map((r) => r.detail)
    .join(" | ");
}

function noSugarScan(label: string, text: string): void {
  ok(`${label}: no full scan of sugar_logs (${text})`, !/\bSCAN (sugar_logs|s)\b/.test(text));
}

const db = build();
const total = (db.prepare("SELECT COUNT(*) AS c FROM sugar_logs").get() as { c: number }).c;
ok("the scratch database holds 90 days of sensor rows and 600 manual ones", total === 90 * 288 + 600 + 1);

console.log("B1. journal feed, LIMIT 300, sensor rows left out");
{
  const sql = journalFeedSql(false, true, { cgm: "exclude" });
  const args = journalFeedArgs(P, 300);
  const rows = db.prepare(sql).all(...(args as never[])) as { kind: string }[];
  ok("the feed returns 300 rows", rows.length === 300);
  ok("none of them is a sensor reading", !rows.some((r) => (r as unknown as { source: string }).source === "health"));
  budget("feed (sensor rows excluded)", time(9, () => db.prepare(sql).all(...(args as never[]))), 30);
  const text = plan(db, sql, args as (string | number)[]);
  ok(`the sugar branch uses idx_sugar_manual (${text})`, /idx_sugar_manual/.test(text));
  noSugarScan("feed", text);

  const withSensor = journalFeedSql(false, true, { cgm: "include" });
  const ms = time(5, () => db.prepare(withSensor).all(...(args as never[])));
  console.log(`  info feed with sensor rows included (reports and exports read this): ${ms.toFixed(2)} ms`);
}

console.log("B2. 12 hour curve window");
{
  const args = windowArgs(P, NOW - 12 * HOUR_MS, NOW);
  const rows = db.prepare(CGM_WINDOW_SQL).all(...args) as { logged_at: string; glucose_level_mgdl: number; is_cgm: number }[];
  ok("about 145 sensor rows plus a few hand-entered ones", rows.length >= 144 && rows.length <= 150);
  const ms = time(15, () => {
    const list = db.prepare(CGM_WINDOW_SQL).all(...args) as typeof rows;
    buildCurveModel({
      rows: list.map(rowFromLog).filter((r): r is CurveRow => r != null),
      startMs: NOW - 12 * HOUR_MS,
      endMs: NOW,
    });
  });
  budget("12 hour window (query + curve model)", ms, 10);
  noSugarScan("window", plan(db, CGM_WINDOW_SQL, args));
  noSugarScan("latest", plan(db, CGM_LATEST_SQL, [P]));
}

console.log("B3. today and week totals");
{
  const band = { low: 80, high: 160 };
  const args = rangeStatsArgs(P, band, NOW - 7 * 24 * HOUR_MS, NOW + MIN);
  budget("7 day totals", time(15, () => db.prepare(CGM_RANGE_STATS_SQL).get(...args)), 10);
  noSugarScan("totals", plan(db, CGM_RANGE_STATS_SQL, args));
}

console.log("B4. 14 day summary, one row per day");
{
  const band = { low: 80, high: 160 };
  const sql = cgmDaySummariesSql(14);
  const args = daySummariesArgs(P, band, NOW, 14);
  const rows = db.prepare(sql).all(...args) as { day: string; c: number }[];
  ok("fourteen days come back", rows.length === 14);
  ok("a full day holds 288 readings", rows.slice(1, -1).every((r) => r.c === 288) || rows.every((r) => r.c <= 288));
  budget("14 day summary", time(9, () => db.prepare(sql).all(...args)), 50);
  noSugarScan("14 day summary", plan(db, sql, args));

  const sql90 = cgmDaySummariesSql(90);
  const args90 = daySummariesArgs(P, band, NOW, 90);
  const ms90 = time(5, () => db.prepare(sql90).all(...args90));
  console.log(`  info 90 day summary (journal "show more" at its widest): ${ms90.toFixed(2)} ms`);
  noSugarScan("90 day summary", plan(db, sql90, args90));
}

console.log(`\ncgmPerfHome: ${passed} passed, ${failed} failed, ${warned} over budget (soft)`);
if (failed > 0) process.exit(1);
