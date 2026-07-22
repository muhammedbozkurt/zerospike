/**
 * Schema v8 migration test.
 *
 * Builds a real v7-shaped database (including the dormant stock-tracking column
 * that only pre-R5 installs carry), seeds it with rows that DO NOT satisfy the
 * v8 CHECK constraints, runs the actual statements from lib/db/v8Sql.ts, and
 * asserts that every single row survived.
 *
 * The earlier migration used INSERT OR IGNORE and then dropped the source table,
 * so exactly these rows were destroyed. This test is what stops that returning.
 *
 * Run: npx tsx scripts/migration.test.ts
 */
import { DatabaseSync } from "node:sqlite";

import {
  V8_CARB_RANGE_UPDATE,
  V8_COPY_INJECTIONS,
  V8_CREATE_INJECTIONS,
  V8_DROP_OLD,
  V8_DROP_SCRATCH,
  V8_INDEX,
  V8_PROFILE_COLUMNS,
  V8_RENAME,
} from "../lib/db/v8Sql";

let passed = 0;
let failed = 0;

function eq(label: string, got: unknown, want: unknown): void {
  if (got === want) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${label}  — got ${String(got)}, want ${String(want)}`);
  }
}

function ok(label: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${label}${detail ? `  — ${detail}` : ""}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

/** A database shaped exactly like a pre-R5 install sitting at user_version 7. */
function makeV7Database(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE user_profiles (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      insulin_sensitivity_factor REAL NOT NULL DEFAULT 40,
      carb_ratio_breakfast REAL NOT NULL DEFAULT 10,
      carb_ratio_lunch REAL NOT NULL DEFAULT 12,
      carb_ratio_dinner REAL NOT NULL DEFAULT 12,
      target_fasting_max INTEGER NOT NULL DEFAULT 100,
      target_postmeal_max INTEGER NOT NULL DEFAULT 140,
      daily_carb_target_g INTEGER NOT NULL DEFAULT 200,
      glucose_unit TEXT NOT NULL DEFAULT 'mgdl',
      created_at TEXT NOT NULL
    );
    CREATE TABLE meal_logs (
      id TEXT PRIMARY KEY NOT NULL,
      profile_id TEXT NOT NULL,
      logged_at TEXT NOT NULL
    );
    -- The v7 injection table: no site_point, no source, and the dormant
    -- stock-tracking column with its dangling foreign key.
    CREATE TABLE injection_logs (
      id TEXT PRIMARY KEY NOT NULL,
      profile_id TEXT NOT NULL,
      site TEXT NOT NULL,
      pen_id TEXT,
      dose_units REAL,
      insulin_type TEXT,
      meal_log_id TEXT,
      note TEXT,
      logged_at TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]'
    );
  `);
  db.exec(
    `INSERT INTO user_profiles (id, name, daily_carb_target_g, created_at)
     VALUES ('p1', 'Me', 200, '2026-01-01T00:00:00.000Z');`
  );
  return db;
}

/** The real migration body, mirroring lib/db/index.ts migrateToV8. */
function runV8(db: DatabaseSync): void {
  const present = new Set(
    (db.prepare("PRAGMA table_info(user_profiles);").all() as { name: string }[]).map(
      (c) => c.name
    )
  );
  const missing = V8_PROFILE_COLUMNS.filter((c) => !present.has(c.name));

  db.exec("PRAGMA foreign_keys = OFF;");
  db.exec("BEGIN;");
  try {
    for (const col of missing) {
      db.exec(`ALTER TABLE user_profiles ADD COLUMN ${col.name} ${col.type};`);
    }
    if (missing.some((c) => c.name === "daily_carb_target_min_g")) {
      db.exec(V8_CARB_RANGE_UPDATE);
    }
    db.exec(V8_DROP_SCRATCH);
    db.exec(V8_CREATE_INJECTIONS);
    db.exec(V8_COPY_INJECTIONS);
    db.exec(V8_DROP_OLD);
    db.exec(V8_RENAME);
    db.exec(V8_INDEX);
    db.exec("COMMIT;");
  } catch (e) {
    db.exec("ROLLBACK;");
    throw e;
  } finally {
    db.exec("PRAGMA foreign_keys = ON;");
  }
}

console.log("zerospike schema v8 migration test");

// ── A. No row is ever dropped, however odd its values ────────────────────────
section("A. row preservation (the INSERT OR IGNORE data-loss path)");
{
  const db = makeV7Database();
  const insert = db.prepare(
    `INSERT INTO injection_logs
       (id, profile_id, site, pen_id, dose_units, insulin_type, meal_log_id, note, logged_at, tags)
     VALUES (?, 'p1', ?, ?, ?, ?, NULL, NULL, ?, '[]');`
  );
  // 1: ordinary row.
  insert.run("i1", "abdomen_left", "pen-a", 6, "bolus", "2026-07-01T08:00:00.000Z");
  // 2: a site value outside the v8 enum (an old build, or a hand-edited db).
  insert.run("i2", "belly", null, 4, "basal", "2026-07-01T09:00:00.000Z");
  // 3: an insulin_type outside basal/bolus.
  insert.run("i3", "thigh_left", null, 10, "rapid", "2026-07-01T10:00:00.000Z");
  // 4: no type recorded at all - a legitimate state, not a broken row.
  insert.run("i4", "arm_right", null, null, null, "2026-07-01T11:00:00.000Z");
  // 5: both fields wrong at once.
  insert.run("i5", "", null, 2, "", "2026-07-01T12:00:00.000Z");

  const before = (
    db.prepare("SELECT COUNT(*) AS c FROM injection_logs;").get() as { c: number }
  ).c;
  eq("fixture has 5 rows", before, 5);

  runV8(db);

  const after = (
    db.prepare("SELECT COUNT(*) AS c FROM injection_logs;").get() as { c: number }
  ).c;
  eq("all 5 rows survive the migration", after, 5);

  const rows = db
    .prepare("SELECT id, site, insulin_type, source, site_point FROM injection_logs ORDER BY id;")
    .all() as {
    id: string;
    site: string;
    insulin_type: string | null;
    source: string;
    site_point: number | null;
  }[];

  eq("valid site is preserved", rows[0].site, "abdomen_left");
  eq("invalid site is normalised, not dropped", rows[1].site, "abdomen_left");
  eq("valid insulin_type is preserved", rows[1].insulin_type, "basal");
  eq("invalid insulin_type becomes bolus", rows[2].insulin_type, "bolus");
  // NULL means "no type recorded". Inventing 'bolus' here would fabricate
  // active insulin out of nothing, so it must stay NULL.
  eq("null insulin_type stays null", rows[3].insulin_type, null);
  eq("empty site is normalised", rows[4].site, "abdomen_left");
  eq("empty insulin_type becomes bolus", rows[4].insulin_type, "bolus");
  eq("every row gets source=manual", rows.every((r) => r.source === "manual"), true);
  eq("older rows carry no rotation point", rows[0].site_point, null);

  const cols = new Set(
    (db.prepare("PRAGMA table_info(injection_logs);").all() as { name: string }[]).map(
      (c) => c.name
    )
  );
  ok("the dormant stock-tracking column is gone", !cols.has("pen_id"));
  ok("site_point exists", cols.has("site_point"));
  ok("source exists", cols.has("source"));
  db.close();
}

// ── B. Profile columns and the derived carb range ────────────────────────────
section("B. profile columns");
{
  const db = makeV7Database();
  runV8(db);
  const p = db.prepare("SELECT * FROM user_profiles WHERE id = 'p1';").get() as Record<
    string,
    unknown
  >;
  eq("target_fasting_min default", p.target_fasting_min, 80);
  eq("target_postmeal_min default", p.target_postmeal_min, 80);
  eq("hypo_threshold_mgdl default", p.hypo_threshold_mgdl, 70);
  eq("insulin_mode preserves pre-v8 behaviour", p.insulin_mode, "both");
  eq("diabetes_type starts unknown", p.diabetes_type, "unknown");
  // Existing users are not nagged about ratios they have been running on.
  eq("ratios_confirmed is 1 for existing users", p.ratios_confirmed, 1);
  // Derived from the profile's own single value (200 * 0.8).
  eq("carb range low end derived", p.daily_carb_target_min_g, 160);
  eq("carb range high end untouched", p.daily_carb_target_g, 200);
  eq("existing fasting max untouched", p.target_fasting_max, 100);
  eq("existing post-meal max untouched", p.target_postmeal_max, 140);
  db.close();
}

// ── C. Idempotence and crash recovery ────────────────────────────────────────
section("C. re-running and crash recovery");
{
  const db = makeV7Database();
  db.exec(
    `INSERT INTO injection_logs (id, profile_id, site, logged_at, tags)
     VALUES ('i1', 'p1', 'abdomen_left', '2026-07-01T08:00:00.000Z', '[]');`
  );
  runV8(db);
  // A leftover scratch table from a killed attempt must not double the rows.
  db.exec("CREATE TABLE injection_logs_v8 (id TEXT PRIMARY KEY NOT NULL);");
  db.exec("INSERT INTO injection_logs_v8 (id) VALUES ('stale');");
  runV8(db);
  const after = (
    db.prepare("SELECT COUNT(*) AS c FROM injection_logs;").get() as { c: number }
  ).c;
  eq("re-running keeps exactly one copy of the row", after, 1);
  db.close();
}

{
  // The transaction is the point: a failure part way through must leave the old
  // table intact rather than a database with no injection_logs at all.
  const db = makeV7Database();
  db.exec(
    `INSERT INTO injection_logs (id, profile_id, site, logged_at, tags)
     VALUES ('i1', 'p1', 'abdomen_left', '2026-07-01T08:00:00.000Z', '[]');`
  );
  db.exec("PRAGMA foreign_keys = OFF;");
  db.exec("BEGIN;");
  try {
    db.exec(V8_DROP_SCRATCH);
    db.exec(V8_CREATE_INJECTIONS);
    db.exec(V8_COPY_INJECTIONS);
    db.exec(V8_DROP_OLD);
    throw new Error("simulated crash before RENAME");
  } catch {
    db.exec("ROLLBACK;");
  }
  const tables = (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='injection_logs';")
      .all() as { name: string }[]
  ).length;
  eq("a crash mid-rebuild leaves injection_logs in place", tables, 1);
  const rows = (
    db.prepare("SELECT COUNT(*) AS c FROM injection_logs;").get() as { c: number }
  ).c;
  eq("and its rows intact", rows, 1);
  db.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
