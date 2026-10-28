/**
 * Sensor home card (G252-CGM-ELLE): the card's average and ring come from the
 * hand-entered readings when today's sensor coverage is below the Insights
 * threshold, and from the sensor otherwise. Runs the REAL SQL against node:sqlite
 * with the real v29 columns and indexes.
 * Run: npx tsx scripts/cgmHomeBasis.test.ts
 */
process.env.TZ = "Europe/Berlin";

import { DatabaseSync } from "node:sqlite";

import { pickHomeCardToday } from "../lib/cgm/homeBasis";
import { CGM_BASIS_MIN_COVERAGE, CGM_SLOT_MS } from "../lib/cgm/metrics";
import {
  CGM_MANUAL_RANGE_STATS_SQL,
  CGM_RANGE_STATS_SQL,
  CGM_SENSOR_TIMES_SQL,
  CGM_WINDOW_SQL,
  rangeStatsArgs,
  toRangeStats,
  windowArgs,
} from "../lib/db/cgmCurveSql";
import { V29_COLUMNS, V29_INDEXES } from "../lib/db/v29Sql";
import { cgmHomeState } from "../lib/homeEmpty";
import { todayRangeShare } from "../lib/homeEmpty";

let passed = 0;
let failed = 0;
function eq(name: string, got: unknown, want: unknown): void {
  if (JSON.stringify(got) === JSON.stringify(want)) passed++;
  else {
    failed++;
    console.log(`  FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

const NOW = new Date(2026, 9, 21, 12, 0, 0, 0).getTime();
const DAY_START = new Date(2026, 9, 21, 0, 0, 0, 0).getTime();
const BAND = { low: 70, high: 180 };
const SLOTS_TODAY = Math.ceil((NOW - DAY_START) / CGM_SLOT_MS);

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE sugar_logs (
    id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL, glucose_level_mgdl INTEGER NOT NULL,
    period_tag TEXT NOT NULL DEFAULT 'unset', source TEXT NOT NULL DEFAULT 'manual',
    logged_at TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', healthkit_uuid TEXT);
    CREATE TABLE meal_logs (id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL, sugar_log_id TEXT);
    CREATE INDEX idx_sugar_profile ON sugar_logs (profile_id, logged_at DESC);`);
  for (const c of V29_COLUMNS) db.exec(`ALTER TABLE sugar_logs ADD COLUMN ${c.name} ${c.type};`);
  for (const s of V29_INDEXES) db.exec(s);
  return db;
}

let seq = 0;
function sensor(db: DatabaseSync, atMs: number, mgdl: number, app = "com.dexcom"): void {
  db.prepare(
    "INSERT INTO sugar_logs (id, profile_id, glucose_level_mgdl, source, logged_at, source_app, is_cgm) VALUES (?, 'p1', ?, 'health', ?, ?, 1)"
  ).run(`s${++seq}`, mgdl, new Date(atMs).toISOString(), app);
}
function typed(db: DatabaseSync, atMs: number, mgdl: number): void {
  db.prepare(
    "INSERT INTO sugar_logs (id, profile_id, glucose_level_mgdl, source, logged_at, is_cgm) VALUES (?, 'p1', ?, 'manual', ?, 0)"
  ).run(`m${++seq}`, mgdl, new Date(atMs).toISOString());
}
/** A non-sensor mirror of a sensor value: another app, unlabelled, same value. */
function mirror(db: DatabaseSync, atMs: number, mgdl: number): void {
  db.prepare(
    "INSERT INTO sugar_logs (id, profile_id, glucose_level_mgdl, source, period_tag, logged_at, source_app, is_cgm) VALUES (?, 'p1', ?, 'health', 'unset', ?, 'com.apple.health', 0)"
  ).run(`t${++seq}`, mgdl, new Date(atMs).toISOString());
}
function sensorRun(db: DatabaseSync, slots: number, mgdl = 120): void {
  for (let k = 0; k < slots; k++) sensor(db, DAY_START + k * CGM_SLOT_MS + 30_000, mgdl);
}

function card(db: DatabaseSync) {
  const until = NOW + 60_000;
  const sensorStats = toRangeStats(
    db.prepare(CGM_RANGE_STATS_SQL).get(...rangeStatsArgs("p1", BAND, DAY_START, until)) as never
  );
  const manualStats = toRangeStats(
    db.prepare(CGM_MANUAL_RANGE_STATS_SQL).get(...rangeStatsArgs("p1", BAND, DAY_START, until)) as never
  );
  const times = (
    db.prepare(CGM_SENSOR_TIMES_SQL).all(...windowArgs("p1", DAY_START, until)) as { logged_at: string }[]
  ).map((r) => Date.parse(r.logged_at));
  return pickHomeCardToday({
    sensorTimesMs: times,
    dayStartMs: DAY_START,
    nowMs: NOW,
    sensor: sensorStats,
    manual: manualStats,
  });
}

console.log("1. zero sensor rows, one typed 110 (the repro)");
{
  const db = makeDb();
  typed(db, NOW - 60_000, 110);
  const c = card(db);
  eq("source is manual", c.source, "manual");
  eq("average is 110", c.stats.avgMgdl, 110);
  eq("count is 1", c.stats.count, 1);
  eq("not 'no reading today'", c.noReading, false);
  eq("ring fill: 110 is in the band", todayRangeShare(c.stats.count, c.stats.inRange), 100);
  eq(
    "the curve state is data (not waiting) with the typed point in the window",
    cgmHomeState({ loaded: true, latestAtMs: null, windowPoints: 1 }),
    "data"
  );
}

console.log("2. no reading of any kind today");
{
  const db = makeDb();
  const c = card(db);
  eq("source falls back to cgm", c.source, "cgm");
  eq("no reading today", c.noReading, true);
  eq("average null", c.stats.avgMgdl, null);
  eq(
    "waiting stays when nothing is in the window",
    cgmHomeState({ loaded: true, latestAtMs: null, windowPoints: 0 }),
    "waiting"
  );
}

console.log("3. enough sensor coverage: sensor wins, the typed reading stays out");
{
  const db = makeDb();
  sensorRun(db, SLOTS_TODAY, 120);
  typed(db, NOW - 120_000, 250);
  const c = card(db);
  eq("source is cgm", c.source, "cgm");
  eq("average ignores the typed 250", c.stats.avgMgdl, 120);
  eq("count is the sensor rows only", c.stats.count, SLOTS_TODAY);
}

console.log("4. the threshold: same constant as Insights, 50 percent of today's slots");
{
  eq("the shared constant is 0.5", CGM_BASIS_MIN_COVERAGE, 0.5);
  const half = Math.ceil(SLOTS_TODAY * CGM_BASIS_MIN_COVERAGE);
  const below = makeDb();
  sensorRun(below, half - 1, 120);
  typed(below, NOW - 60_000, 200);
  const b = card(below);
  eq("just below: manual", b.source, "manual");
  eq("just below: average is the typed value", b.stats.avgMgdl, 200);

  const at = makeDb();
  sensorRun(at, half, 120);
  typed(at, NOW - 60_000, 200);
  const a = card(at);
  eq("exactly at the threshold: cgm", a.source, "cgm");
  eq("at the threshold: sensor average", a.stats.avgMgdl, 120);
}

console.log("5. thin sensor coverage and nothing typed: the sensor rows stay");
{
  const db = makeDb();
  sensorRun(db, 3, 140);
  const c = card(db);
  eq("source cgm", c.source, "cgm");
  eq("sensor average", c.stats.avgMgdl, 140);
  eq("a reading exists today", c.noReading, false);
}

console.log("6. a non-sensor mirror of a sensor value is not counted");
{
  const db = makeDb();
  sensor(db, NOW - 10 * 60_000, 130);
  mirror(db, NOW - 10 * 60_000 + 5_000, 130);
  const none = card(db);
  eq("the mirror alone does not make a manual basis", none.source, "cgm");
  eq("sensor average is used", none.stats.avgMgdl, 130);

  typed(db, NOW - 60_000, 100);
  const c = card(db);
  eq("typed row counts, mirror does not", c.stats.count, 1);
  eq("average is the typed value only", c.stats.avgMgdl, 100);
  eq("source manual", c.source, "manual");
}

console.log("7. a typed value near a sensor value is never a twin");
{
  const db = makeDb();
  sensor(db, NOW - 10 * 60_000, 130);
  typed(db, NOW - 10 * 60_000 + 5_000, 130);
  const c = card(db);
  eq("typed row kept even at the same value and time", c.stats.count, 1);
  eq("source manual", c.source, "manual");
}

console.log("8. in-range share for manual readings");
{
  const db = makeDb();
  typed(db, NOW - 3 * 3600_000, 110);
  typed(db, NOW - 2 * 3600_000, 250);
  typed(db, NOW - 1 * 3600_000, 90);
  typed(db, NOW - 30 * 60_000, 60);
  const c = card(db);
  eq("count", c.stats.count, 4);
  eq("share of readings in the target band", todayRangeShare(c.stats.count, c.stats.inRange), 50);
}

console.log("9. the curve window leaves a sensor mirror out, keeps the typed reading");
{
  const db = makeDb();
  sensor(db, NOW - 20 * 60_000, 130);
  mirror(db, NOW - 20 * 60_000 + 5_000, 130);
  typed(db, NOW - 10 * 60_000, 105);
  const rows = db
    .prepare(CGM_WINDOW_SQL)
    .all(...windowArgs("p1", NOW - 3 * 3600_000, NOW)) as { glucose_level_mgdl: number; is_cgm: number }[];
  eq("window rows: the sensor row and the typed 105 only", rows.map((r) => [r.glucose_level_mgdl, r.is_cgm]), [
    [130, 1],
    [105, 0],
  ]);
}

console.log(failed === 0 ? `all ${passed} checks passed` : `${failed} FAILED, ${passed} passed`);
if (failed > 0) process.exit(1);
