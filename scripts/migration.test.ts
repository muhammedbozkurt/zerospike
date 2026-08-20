/**
 * Schema v8/v9/v10/v11/v12/v13/v14/v15/v16/v17/v18 migration test.
 *
 * Builds a real v7-shaped (or v8-shaped) database, seeds it with rows that
 * exercise the edge cases, runs the REAL migrateToV8..V18 functions from
 * lib/db/migrations.ts (R10 FAZ 4, no hand-copied re-implementation), and
 * asserts every row survives and every shape is correct.
 *
 * lib/db/migrations.ts is written against expo-sqlite's async API
 * (execAsync / getAllAsync / withTransactionAsync); `adapt()` below is a thin
 * wrapper so those same functions run unmodified against node:sqlite's
 * synchronous DatabaseSync here: glue, not a second implementation.
 * lib/db/remindersBridge.ts (the v17 legacy-reminders bridge) additionally
 * calls getFirstAsync/runAsync, which adapt() also wraps for the same reason.
 *
 * Run: npx tsx scripts/migration.test.ts
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  migrateToV8,
  migrateToV9,
  migrateToV10,
  migrateToV11,
  migrateToV12,
  migrateToV13,
  migrateToV14,
  migrateToV15,
  migrateToV16,
  migrateToV17,
  migrateToV18,
  migrateToV19,
  stampSchemaVersion,
} from "../lib/db/migrations";
import { V13_CREATE } from "../lib/db/v13Sql";
import { V14_CREATE, V14_READ_META, V14_WRITE_META } from "../lib/db/v14Sql";
import {
  SEED_CATALOG_VERSION,
  SEED_CATALOG_VERSION_KEY,
  selectMissingFoods,
} from "../lib/db/seedVersion";
import { SEED_FOODS } from "../lib/db/seed";
import {
  V8_DROP_SCRATCH,
  V8_CREATE_INJECTIONS,
  V8_COPY_INJECTIONS,
  V8_DROP_OLD,
} from "../lib/db/v8Sql";
import { V9_DROP_SCRATCH, V9_CREATE_INJECTIONS, V9_COPY_INJECTIONS, V9_DROP_OLD } from "../lib/db/v9Sql";
import {
  V11_DROP_SCRATCH,
  V11_CREATE_INJECTIONS,
  V11_COPY_INJECTIONS,
  V11_DROP_OLD,
} from "../lib/db/v11Sql";
import { V15_ADD_BOLUS_KIND, V15_PROFILE_COLUMNS } from "../lib/db/v15Sql";
import { V16_ADD_ORAL_MEDS_ENABLED, V16_CREATE } from "../lib/db/v16Sql";
import { V17_CREATE } from "../lib/db/v17Sql";
import { V18_CREATE, V18_SEED_FROM_MED_LOGS } from "../lib/db/v18Sql";
import { V19_REMINDERS_COLUMNS } from "../lib/db/v19Sql";
import {
  adoptOrphanReminders,
  bridgeLegacyReminders,
  REMINDERS_BRIDGE_KEY,
  REMINDERS_PROFILE_SCOPE_KEY,
  type LegacyReminderPrefs,
} from "../lib/db/remindersBridge";

let passed = 0;
let failed = 0;

function eq(label: string, got: unknown, want: unknown): void {
  if (got === want) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${label}: got ${String(got)}, want ${String(want)}`);
  }
}

function ok(label: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${label}${detail ? `: ${detail}` : ""}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

/**
 * Wraps a node:sqlite DatabaseSync so it satisfies the subset of expo-sqlite's
 * SQLiteDatabase interface the real migration functions call. Every method is
 * a synchronous node:sqlite call wrapped in a resolved Promise.
 */
function adapt(db: DatabaseSync) {
  return {
    execAsync: async (sql: string) => {
      db.exec(sql);
    },
    getAllAsync: async (sql: string, params: unknown[] = []) => {
      return db.prepare(sql).all(...(params as never[]));
    },
    // Only bridgeLegacyReminders (lib/db/remindersBridge.ts) calls these two;
    // none of the migrateToV* functions do.
    getFirstAsync: async (sql: string, params: unknown[] = []) => {
      return db.prepare(sql).get(...(params as never[]));
    },
    runAsync: async (sql: string, params: unknown[] = []) => {
      db.prepare(sql).run(...(params as never[]));
    },
    withTransactionAsync: async (fn: () => Promise<void>) => {
      db.exec("BEGIN;");
      try {
        await fn();
        db.exec("COMMIT;");
      } catch (e) {
        db.exec("ROLLBACK;");
        throw e;
      }
    },
    // deno-lint/tsc: only the members above are ever called by
    // migrateToV8..V18 / bridgeLegacyReminders; the rest of expo-sqlite's
    // surface is unused here.
  } as unknown as Parameters<typeof migrateToV8>[0];
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

/** A database shaped like a v9/v10 install: the widened site CHECK, site NOT NULL. */
function makeV9InjectionDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE user_profiles (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE meal_logs (id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL, logged_at TEXT NOT NULL);
    CREATE TABLE injection_logs (
      id TEXT PRIMARY KEY NOT NULL,
      profile_id TEXT NOT NULL,
      site TEXT NOT NULL
        CHECK (site IN ('abdomen_left','abdomen_right','abdomen_left_upper',
                        'abdomen_right_upper','abdomen_left_lower','abdomen_right_lower',
                        'thigh_left','thigh_right','arm_left','arm_right',
                        'buttock_left','buttock_right')),
      site_point INTEGER CHECK (site_point IS NULL OR site_point BETWEEN 1 AND 4),
      dose_units REAL,
      insulin_type TEXT CHECK (insulin_type IN ('basal','bolus')),
      meal_log_id TEXT,
      note TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      logged_at TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]'
    );
  `);
  db.exec(
    `INSERT INTO user_profiles (id, name, created_at) VALUES ('p1', 'Me', '2026-01-01T00:00:00.000Z');`
  );
  return db;
}

/** A database shaped like a v8 install: injection_logs with the v8 site CHECK. */
function makeV8InjectionDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE user_profiles (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE meal_logs (id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL, logged_at TEXT NOT NULL);
    CREATE TABLE injection_logs (
      id TEXT PRIMARY KEY NOT NULL,
      profile_id TEXT NOT NULL,
      site TEXT NOT NULL
        CHECK (site IN ('abdomen_left','abdomen_right','thigh_left','thigh_right',
                        'arm_left','arm_right','buttock_left','buttock_right')),
      site_point INTEGER CHECK (site_point IS NULL OR site_point BETWEEN 1 AND 4),
      dose_units REAL,
      insulin_type TEXT CHECK (insulin_type IN ('basal','bolus')),
      meal_log_id TEXT,
      note TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      logged_at TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]'
    );
  `);
  db.exec(
    `INSERT INTO user_profiles (id, name, created_at) VALUES ('p1', 'Me', '2026-01-01T00:00:00.000Z');`
  );
  return db;
}

/**
 * A database shaped like a v11 install: every table v12 indexes, with the
 * referential actions those indexes serve declared exactly as in the app schema
 * and NO index on any child column (which is the state v12 exists to fix).
 */
function makeV12Database(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE user_profiles (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE foods (
      id TEXT PRIMARY KEY NOT NULL,
      name_tr TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'other',
      is_custom INTEGER NOT NULL DEFAULT 0,
      source TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE sugar_logs (
      id TEXT PRIMARY KEY NOT NULL,
      profile_id TEXT NOT NULL,
      glucose_level_mgdl INTEGER NOT NULL,
      logged_at TEXT NOT NULL,
      FOREIGN KEY (profile_id) REFERENCES user_profiles (id) ON DELETE CASCADE
    );
    CREATE TABLE meal_logs (
      id TEXT PRIMARY KEY NOT NULL,
      profile_id TEXT NOT NULL,
      sugar_log_id TEXT,
      food_id TEXT,
      logged_at TEXT NOT NULL,
      FOREIGN KEY (profile_id) REFERENCES user_profiles (id) ON DELETE CASCADE,
      FOREIGN KEY (sugar_log_id) REFERENCES sugar_logs (id) ON DELETE SET NULL,
      FOREIGN KEY (food_id) REFERENCES foods (id) ON DELETE SET NULL
    );
    CREATE TABLE favorites (
      id TEXT PRIMARY KEY NOT NULL,
      profile_id TEXT NOT NULL,
      food_id TEXT NOT NULL,
      UNIQUE (profile_id, food_id),
      FOREIGN KEY (profile_id) REFERENCES user_profiles (id) ON DELETE CASCADE,
      FOREIGN KEY (food_id) REFERENCES foods (id) ON DELETE CASCADE
    );
    CREATE TABLE injection_logs (
      id TEXT PRIMARY KEY NOT NULL,
      profile_id TEXT NOT NULL,
      meal_log_id TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      logged_at TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      FOREIGN KEY (profile_id) REFERENCES user_profiles (id) ON DELETE CASCADE,
      FOREIGN KEY (meal_log_id) REFERENCES meal_logs (id) ON DELETE SET NULL
    );
    CREATE INDEX idx_sugar_profile ON sugar_logs (profile_id, logged_at DESC);
    CREATE INDEX idx_meal_profile ON meal_logs (profile_id, logged_at DESC);
    CREATE INDEX idx_injection_profile ON injection_logs (profile_id, logged_at DESC);
  `);
  db.exec(
    `INSERT INTO user_profiles (id, name, created_at) VALUES ('p1', 'Me', '2026-01-01T00:00:00.000Z');`
  );
  return db;
}

/**
 * A database shaped like a v12 install: the full meal_logs (no meal_template_id
 * yet), foods, and two profiles so the per-profile guarantees can be checked.
 */
function makeV13Database(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE user_profiles (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE foods (
      id TEXT PRIMARY KEY NOT NULL,
      name_tr TEXT NOT NULL,
      name_en TEXT NOT NULL DEFAULT '',
      carb_100g REAL NOT NULL DEFAULT 0,
      category TEXT NOT NULL DEFAULT 'other',
      is_custom INTEGER NOT NULL DEFAULT 0,
      source TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE sugar_logs (
      id TEXT PRIMARY KEY NOT NULL,
      profile_id TEXT NOT NULL,
      glucose_level_mgdl INTEGER NOT NULL,
      logged_at TEXT NOT NULL,
      FOREIGN KEY (profile_id) REFERENCES user_profiles (id) ON DELETE CASCADE
    );
    CREATE TABLE meal_logs (
      id TEXT PRIMARY KEY NOT NULL,
      profile_id TEXT NOT NULL,
      sugar_log_id TEXT,
      food_id TEXT,
      custom_food_name TEXT,
      portion_g REAL NOT NULL DEFAULT 0,
      calculated_carbs_g REAL NOT NULL DEFAULT 0,
      insulin_dose_units REAL NOT NULL DEFAULT 0,
      photo_uri_local TEXT,
      personal_note TEXT,
      logged_at TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      FOREIGN KEY (profile_id) REFERENCES user_profiles (id) ON DELETE CASCADE,
      FOREIGN KEY (sugar_log_id) REFERENCES sugar_logs (id) ON DELETE SET NULL,
      FOREIGN KEY (food_id) REFERENCES foods (id) ON DELETE SET NULL
    );
    CREATE INDEX idx_meal_profile ON meal_logs (profile_id, logged_at DESC);
    CREATE INDEX idx_meal_food ON meal_logs (food_id);
  `);
  db.exec(
    `INSERT INTO user_profiles (id, name, created_at) VALUES
       ('p1', 'Me', '2026-01-01T00:00:00.000Z'),
       ('p2', 'Kid', '2026-01-02T00:00:00.000Z');
     INSERT INTO foods (id, name_tr, name_en, carb_100g, is_custom, created_at) VALUES
       ('f1', 'Ekmek', 'Bread', 48.5, 0, '2026-01-01T00:00:00.000Z'),
       ('f2', 'Kendi ekmegim', '', 20, 1, '2026-01-01T00:00:00.000Z');`
  );
  return db;
}

/**
 * A database shaped like a v13 install: the full foods table with a catalog
 * already seeded in it, plus the rows a real user accumulates - their own foods,
 * a cached barcode result, an edited catalog row - so the top-up can be held to
 * its promise of never touching any of them.
 *
 * The seeded rows are the FIRST `seeded` foods of the real catalog, which is
 * what an install from an older release actually has: an early slice of the same
 * array, missing everything added since.
 */
function makeV14Database(seeded: number): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE user_profiles (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE foods (
      id TEXT PRIMARY KEY NOT NULL,
      name_tr TEXT NOT NULL,
      name_en TEXT NOT NULL DEFAULT '',
      name_de TEXT NOT NULL DEFAULT '',
      name_es TEXT NOT NULL DEFAULT '',
      name_fr TEXT NOT NULL DEFAULT '',
      aliases_json TEXT NOT NULL DEFAULT '[]',
      category TEXT NOT NULL DEFAULT 'other',
      barcode TEXT,
      carb_100g REAL NOT NULL DEFAULT 0,
      glycemic_index INTEGER NOT NULL DEFAULT 0,
      glycemic_load INTEGER NOT NULL DEFAULT 0,
      portion_size_g REAL NOT NULL DEFAULT 100,
      brand_name TEXT,
      custom_notes TEXT,
      is_custom INTEGER NOT NULL DEFAULT 0,
      source TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_foods_category ON foods (is_custom, category);
  `);
  db.exec(
    `INSERT INTO user_profiles (id, name, created_at) VALUES ('p1', 'Me', '2026-01-01T00:00:00.000Z');`
  );

  const insert = db.prepare(
    `INSERT INTO foods (id, name_tr, name_en, name_de, name_es, name_fr, category,
                        carb_100g, glycemic_index, glycemic_load, portion_size_g,
                        is_custom, source, barcode, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '2026-01-01T00:00:00.000Z');`
  );
  SEED_FOODS.slice(0, seeded).forEach((f, i) => {
    insert.run(
      `seed-${i}`,
      f.tr,
      f.en,
      f.de,
      f.es,
      f.fr,
      f.cat,
      f.carb,
      f.gi,
      Math.round((f.gi * f.carb) / 100),
      f.portion ?? 100,
      0,
      null,
      null
    );
  });
  return db;
}

/**
 * A database shaped like a v14 install: every user_profiles column through v8
 * (nothing was added to it in v9-v14), and injection_logs in its v11 shape
 * (nullable site, no bolus_kind yet).
 */
function makeV14FullDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE user_profiles (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      insulin_sensitivity_factor REAL NOT NULL DEFAULT 40,
      carb_ratio_breakfast REAL NOT NULL DEFAULT 10,
      carb_ratio_lunch REAL NOT NULL DEFAULT 12,
      carb_ratio_dinner REAL NOT NULL DEFAULT 12,
      target_fasting_min INTEGER NOT NULL DEFAULT 80,
      target_fasting_max INTEGER NOT NULL DEFAULT 100,
      target_postmeal_min INTEGER NOT NULL DEFAULT 80,
      target_postmeal_max INTEGER NOT NULL DEFAULT 140,
      hypo_threshold_mgdl INTEGER NOT NULL DEFAULT 70,
      daily_carb_target_g INTEGER NOT NULL DEFAULT 200,
      daily_carb_target_min_g INTEGER NOT NULL DEFAULT 160,
      glucose_unit TEXT NOT NULL DEFAULT 'mgdl',
      diabetes_type TEXT NOT NULL DEFAULT 'unknown',
      insulin_mode TEXT NOT NULL DEFAULT 'both',
      ratios_confirmed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE injection_logs (
      id TEXT PRIMARY KEY NOT NULL,
      profile_id TEXT NOT NULL,
      site TEXT,
      site_point INTEGER CHECK (site_point IS NULL OR site_point BETWEEN 1 AND 4),
      dose_units REAL,
      insulin_type TEXT CHECK (insulin_type IN ('basal','bolus')),
      meal_log_id TEXT,
      note TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
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

/**
 * A database shaped like a v15 install: every user_profiles column through v15
 * (the insulin product catalog columns already present), and injection_logs with
 * bolus_kind. Nothing v16 adds yet - no med_logs table, no oral_meds_enabled.
 */
function makeV15Database(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE user_profiles (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      insulin_sensitivity_factor REAL NOT NULL DEFAULT 40,
      carb_ratio_breakfast REAL NOT NULL DEFAULT 10,
      carb_ratio_lunch REAL NOT NULL DEFAULT 12,
      carb_ratio_dinner REAL NOT NULL DEFAULT 12,
      target_fasting_min INTEGER NOT NULL DEFAULT 80,
      target_fasting_max INTEGER NOT NULL DEFAULT 100,
      target_postmeal_min INTEGER NOT NULL DEFAULT 80,
      target_postmeal_max INTEGER NOT NULL DEFAULT 140,
      hypo_threshold_mgdl INTEGER NOT NULL DEFAULT 70,
      daily_carb_target_g INTEGER NOT NULL DEFAULT 200,
      daily_carb_target_min_g INTEGER NOT NULL DEFAULT 160,
      glucose_unit TEXT NOT NULL DEFAULT 'mgdl',
      diabetes_type TEXT NOT NULL DEFAULT 'unknown',
      insulin_mode TEXT NOT NULL DEFAULT 'both',
      ratios_confirmed INTEGER NOT NULL DEFAULT 0,
      basal_daily_units REAL,
      basal_insulin_id TEXT,
      bolus_insulin_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE injection_logs (
      id TEXT PRIMARY KEY NOT NULL,
      profile_id TEXT NOT NULL,
      site TEXT,
      site_point INTEGER CHECK (site_point IS NULL OR site_point BETWEEN 1 AND 4),
      dose_units REAL,
      insulin_type TEXT CHECK (insulin_type IN ('basal','bolus')),
      meal_log_id TEXT,
      note TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      logged_at TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      bolus_kind TEXT
    );
  `);
  db.exec(
    `INSERT INTO user_profiles
       (id, name, daily_carb_target_g, basal_daily_units, basal_insulin_id, created_at)
     VALUES ('p1', 'Me', 200, 20, 'glargine-u100', '2026-01-01T00:00:00.000Z');`
  );
  return db;
}

/** Column name → its PRAGMA table_info row, for shape assertions. */
function columns(db: DatabaseSync, table: string): Map<string, Record<string, unknown>> {
  const rows = db.prepare(`PRAGMA table_info(${table});`).all() as Record<
    string,
    unknown
  >[];
  return new Map(rows.map((r) => [String(r.name), r]));
}

function indexNames(db: DatabaseSync): Set<string> {
  return new Set(
    (
      db.prepare("SELECT name FROM sqlite_master WHERE type='index';").all() as {
        name: string;
      }[]
    ).map((r) => r.name)
  );
}

/** True when the statement is refused (a CHECK / NOT NULL / foreign key). */
function refused(db: DatabaseSync, sql: string): boolean {
  try {
    db.exec(sql);
    return false;
  } catch {
    return true;
  }
}

async function main() {
  console.log("zerospike schema v8/v9/v10/v11/v12/v13 migration test");

  // ── A. No row is ever dropped, however odd its values ──────────────────────
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

    await migrateToV8(adapt(db));

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

  // ── B. Profile columns and the derived carb range ───────────────────────────
  section("B. profile columns");
  {
    const db = makeV7Database();
    await migrateToV8(adapt(db));
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

  // ── C. Idempotence and crash recovery ───────────────────────────────────────
  section("C. re-running and crash recovery");
  {
    const db = makeV7Database();
    db.exec(
      `INSERT INTO injection_logs (id, profile_id, site, logged_at, tags)
       VALUES ('i1', 'p1', 'abdomen_left', '2026-07-01T08:00:00.000Z', '[]');`
    );
    await migrateToV8(adapt(db));
    // A leftover scratch table from a killed attempt must not double the rows.
    db.exec("CREATE TABLE injection_logs_v8 (id TEXT PRIMARY KEY NOT NULL);");
    db.exec("INSERT INTO injection_logs_v8 (id) VALUES ('stale');");
    await migrateToV8(adapt(db));
    const after = (
      db.prepare("SELECT COUNT(*) AS c FROM injection_logs;").get() as { c: number }
    ).c;
    eq("re-running keeps exactly one copy of the row", after, 1);
    db.close();
  }

  {
    // The transaction is the point: a failure part way through must leave the old
    // table intact rather than a database with no injection_logs at all. Drives
    // the same real V8_* statements the migration uses, not a copy.
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

  // ── D. v9: abdomen quadrants (legacy sites preserved, new sites accepted) ────
  section("D. v9 abdomen quadrants");
  {
    const db = makeV8InjectionDb();
    const insert = db.prepare(
      `INSERT INTO injection_logs
         (id, profile_id, site, site_point, dose_units, insulin_type, meal_log_id, note, source, logged_at, tags)
       VALUES (?, 'p1', ?, ?, ?, ?, NULL, NULL, 'manual', ?, '[]');`
    );
    // Legacy general-abdomen rows (with and without a rotation point) + another site.
    insert.run("i1", "abdomen_left", 3, 6, "bolus", "2026-07-01T08:00:00.000Z");
    insert.run("i2", "abdomen_right", null, 4, "basal", "2026-07-01T09:00:00.000Z");
    insert.run("i3", "thigh_left", 2, 10, "bolus", "2026-07-01T10:00:00.000Z");

    eq(
      "fixture has 3 rows",
      (db.prepare("SELECT COUNT(*) AS c FROM injection_logs;").get() as { c: number }).c,
      3
    );

    await migrateToV9(adapt(db));

    const after = (
      db.prepare("SELECT COUNT(*) AS c FROM injection_logs;").get() as { c: number }
    ).c;
    eq("all 3 rows survive v9", after, 3);

    const rows = db
      .prepare("SELECT id, site, site_point FROM injection_logs ORDER BY id;")
      .all() as { id: string; site: string; site_point: number | null }[];
    // Legacy values are NEVER rewritten into a quadrant - copied verbatim.
    eq("legacy abdomen_left preserved verbatim", rows[0].site, "abdomen_left");
    eq("legacy abdomen_right preserved verbatim", rows[1].site, "abdomen_right");
    eq("legacy rotation point preserved", rows[0].site_point, 3);
    eq("other site preserved", rows[2].site, "thigh_left");

    // The new quadrant values are now accepted by the widened CHECK.
    let acceptedNew = true;
    try {
      db.exec(
        `INSERT INTO injection_logs (id, profile_id, site, logged_at, tags)
         VALUES ('i4', 'p1', 'abdomen_left_upper', '2026-07-02T08:00:00.000Z', '[]');`
      );
    } catch {
      acceptedNew = false;
    }
    ok("v9 accepts the new abdomen_left_upper quadrant", acceptedNew);

    // A genuinely off-list value is still rejected.
    let rejectedGarbage = false;
    try {
      db.exec(
        `INSERT INTO injection_logs (id, profile_id, site, logged_at, tags)
         VALUES ('i5', 'p1', 'elbow', '2026-07-02T09:00:00.000Z', '[]');`
      );
    } catch {
      rejectedGarbage = true;
    }
    ok("v9 still rejects an unknown site", rejectedGarbage);
    db.close();
  }

  // ── E. v9 idempotency + crash recovery (mirrors the v8 C section) ───────────
  section("E. v9 idempotency + crash recovery");
  {
    const db = makeV8InjectionDb();
    db.exec(
      `INSERT INTO injection_logs (id, profile_id, site, logged_at, tags)
       VALUES ('i1', 'p1', 'abdomen_left', '2026-07-01T08:00:00.000Z', '[]');`
    );
    await migrateToV9(adapt(db));
    // A leftover scratch table from a killed attempt must not double the rows.
    db.exec("CREATE TABLE injection_logs_v9 (id TEXT PRIMARY KEY NOT NULL);");
    db.exec("INSERT INTO injection_logs_v9 (id) VALUES ('stale');");
    await migrateToV9(adapt(db));
    eq(
      "re-running v9 keeps exactly one copy of the row",
      (db.prepare("SELECT COUNT(*) AS c FROM injection_logs;").get() as { c: number }).c,
      1
    );
    db.close();
  }
  {
    const db = makeV8InjectionDb();
    db.exec(
      `INSERT INTO injection_logs (id, profile_id, site, logged_at, tags)
       VALUES ('i1', 'p1', 'abdomen_left', '2026-07-01T08:00:00.000Z', '[]');`
    );
    db.exec("PRAGMA foreign_keys = OFF;");
    db.exec("BEGIN;");
    try {
      db.exec(V9_DROP_SCRATCH);
      db.exec(V9_CREATE_INJECTIONS);
      db.exec(V9_COPY_INJECTIONS);
      db.exec(V9_DROP_OLD);
      throw new Error("simulated crash before RENAME");
    } catch {
      db.exec("ROLLBACK;");
    }
    const tables = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='injection_logs';")
        .all() as { name: string }[]
    ).length;
    eq("a crash mid v9-rebuild leaves injection_logs in place", tables, 1);
    eq(
      "and its rows intact",
      (db.prepare("SELECT COUNT(*) AS c FROM injection_logs;").get() as { c: number }).c,
      1
    );
    db.close();
  }

  // ── F. v10: sugar_logs.healthkit_uuid (add column, rows + values preserved) ─
  section("F. v10 sugar_logs.healthkit_uuid");
  {
    const db = new DatabaseSync(":memory:");
    db.exec(
      `CREATE TABLE sugar_logs (
         id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL,
         glucose_level_mgdl INTEGER NOT NULL, period_tag TEXT NOT NULL DEFAULT 'manual',
         source TEXT NOT NULL DEFAULT 'manual', logged_at TEXT NOT NULL,
         tags TEXT NOT NULL DEFAULT '[]');`
    );
    db.exec(
      `INSERT INTO sugar_logs (id, profile_id, glucose_level_mgdl, period_tag, source, logged_at, tags)
       VALUES ('s1','p1',112,'manual','manual','2026-07-24T10:00:00.000Z','[]');`
    );
    await migrateToV10(adapt(db));

    const cols = (
      db.prepare("PRAGMA table_info(sugar_logs);").all() as { name: string }[]
    ).map((c) => c.name);
    ok("v10 adds the healthkit_uuid column", cols.includes("healthkit_uuid"));

    const row = db.prepare("SELECT * FROM sugar_logs WHERE id='s1';").get() as {
      glucose_level_mgdl: number;
      healthkit_uuid: string | null;
    };
    eq("the existing row survives v10", row.glucose_level_mgdl, 112);
    eq("healthkit_uuid defaults to NULL", row.healthkit_uuid, null);

    db.exec("UPDATE sugar_logs SET healthkit_uuid='HK-1' WHERE id='s1';");
    eq(
      "healthkit_uuid can be recorded",
      (
        db.prepare("SELECT healthkit_uuid AS u FROM sugar_logs WHERE id='s1';").get() as {
          u: string | null;
        }
      ).u,
      "HK-1"
    );

    // Re-running is a guarded no-op (older build at v10 / fresh v10 schema), and it
    // must not wipe the value or duplicate the row.
    await migrateToV10(adapt(db));
    eq(
      "re-running v10 keeps the recorded value",
      (
        db.prepare("SELECT healthkit_uuid AS u FROM sugar_logs WHERE id='s1';").get() as {
          u: string | null;
        }
      ).u,
      "HK-1"
    );
    eq(
      "still exactly one row after v10 re-run",
      (db.prepare("SELECT COUNT(*) AS c FROM sugar_logs;").get() as { c: number }).c,
      1
    );
    db.close();
  }

  // ── G. v11: injection_logs.site becomes nullable ────────────────────────────
  section("G. v11 nullable injection site");
  {
    const db = makeV9InjectionDb();
    const insert = db.prepare(
      `INSERT INTO injection_logs
         (id, profile_id, site, site_point, dose_units, insulin_type, meal_log_id, note, source, logged_at, tags)
       VALUES (?, 'p1', ?, ?, ?, ?, NULL, NULL, ?, ?, '[]');`
    );
    insert.run("i1", "abdomen_left", 3, 6, "bolus", "manual", "2026-07-01T08:00:00.000Z");
    insert.run("i2", "abdomen_left_upper", null, 4, "basal", "manual", "2026-07-01T09:00:00.000Z");
    insert.run("i3", "thigh_right", 1, 5, "bolus", "calculator", "2026-07-01T10:00:00.000Z");

    // A pre-v11 build could not store a null site at all.
    let rejectedNullBefore = false;
    try {
      db.exec(
        `INSERT INTO injection_logs (id, profile_id, site, logged_at, tags)
         VALUES ('i0', 'p1', NULL, '2026-07-01T07:00:00.000Z', '[]');`
      );
    } catch {
      rejectedNullBefore = true;
    }
    ok("v10 shape refuses a null site", rejectedNullBefore);

    await migrateToV11(adapt(db));

    eq(
      "all 3 rows survive v11",
      (db.prepare("SELECT COUNT(*) AS c FROM injection_logs;").get() as { c: number }).c,
      3
    );
    const rows = db
      .prepare("SELECT id, site, site_point, source FROM injection_logs ORDER BY id;")
      .all() as {
      id: string;
      site: string | null;
      site_point: number | null;
      source: string;
    }[];
    eq("site preserved verbatim", rows[0].site, "abdomen_left");
    eq("retired quadrant preserved verbatim", rows[1].site, "abdomen_left_upper");
    eq("rotation point preserved", rows[0].site_point, 3);
    eq("source preserved", rows[2].source, "calculator");

    // The whole point of the rebuild: a dose with no region can now be recorded.
    let acceptedNull = true;
    try {
      db.exec(
        `INSERT INTO injection_logs (id, profile_id, site, site_point, logged_at, tags)
         VALUES ('i4', 'p1', NULL, NULL, '2026-07-02T08:00:00.000Z', '[]');`
      );
    } catch {
      acceptedNull = false;
    }
    ok("v11 accepts a null site", acceptedNull);
    eq(
      "the region-less row is stored as NULL",
      (
        db.prepare("SELECT site FROM injection_logs WHERE id='i4';").get() as {
          site: string | null;
        }
      ).site,
      null
    );

    // An off-list value is still rejected: nullable is not "anything goes".
    let rejectedGarbage = false;
    try {
      db.exec(
        `INSERT INTO injection_logs (id, profile_id, site, logged_at, tags)
         VALUES ('i5', 'p1', 'elbow', '2026-07-02T09:00:00.000Z', '[]');`
      );
    } catch {
      rejectedGarbage = true;
    }
    ok("v11 still rejects an unknown site", rejectedGarbage);
    db.close();
  }
  {
    const db = makeV9InjectionDb();
    db.exec(
      `INSERT INTO injection_logs (id, profile_id, site, logged_at, tags)
       VALUES ('i1', 'p1', 'abdomen_left', '2026-07-01T08:00:00.000Z', '[]');`
    );
    await migrateToV11(adapt(db));
    // A leftover scratch table from a killed attempt must not double the rows.
    db.exec("CREATE TABLE injection_logs_v11 (id TEXT PRIMARY KEY NOT NULL);");
    db.exec("INSERT INTO injection_logs_v11 (id) VALUES ('stale');");
    await migrateToV11(adapt(db));
    eq(
      "re-running v11 keeps exactly one copy of the row",
      (db.prepare("SELECT COUNT(*) AS c FROM injection_logs;").get() as { c: number }).c,
      1
    );
    db.close();
  }
  {
    const db = makeV9InjectionDb();
    db.exec(
      `INSERT INTO injection_logs (id, profile_id, site, logged_at, tags)
       VALUES ('i1', 'p1', 'abdomen_left', '2026-07-01T08:00:00.000Z', '[]');`
    );
    db.exec("PRAGMA foreign_keys = OFF;");
    db.exec("BEGIN;");
    try {
      db.exec(V11_DROP_SCRATCH);
      db.exec(V11_CREATE_INJECTIONS);
      db.exec(V11_COPY_INJECTIONS);
      db.exec(V11_DROP_OLD);
      throw new Error("simulated crash before RENAME");
    } catch {
      db.exec("ROLLBACK;");
    }
    const tables = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='injection_logs';")
        .all() as { name: string }[]
    ).length;
    eq("a crash mid v11-rebuild leaves injection_logs in place", tables, 1);
    eq(
      "and its rows intact",
      (db.prepare("SELECT COUNT(*) AS c FROM injection_logs;").get() as { c: number }).c,
      1
    );
    db.close();
  }

  // ── H. v12: foreign-key child indexes (pure DDL, rows untouched) ────────────
  section("H. v12 foreign-key child indexes");
  {
    const db = makeV12Database();
    db.exec(
      `INSERT INTO sugar_logs (id, profile_id, glucose_level_mgdl, logged_at)
         VALUES ('s1', 'p1', 120, '2026-07-01T08:00:00.000Z');
       INSERT INTO foods (id, name_tr, is_custom, category, created_at)
         VALUES ('f1', 'Ekmek', 0, 'bakery', '2026-01-01T00:00:00.000Z');
       INSERT INTO meal_logs (id, profile_id, sugar_log_id, food_id, logged_at)
         VALUES ('m1', 'p1', 's1', 'f1', '2026-07-01T08:05:00.000Z');
       INSERT INTO favorites (id, profile_id, food_id) VALUES ('fv1', 'p1', 'f1');
       INSERT INTO injection_logs (id, profile_id, meal_log_id, logged_at, tags)
         VALUES ('i1', 'p1', 'm1', '2026-07-01T08:06:00.000Z', '[]');`
    );

    await migrateToV12(adapt(db));

    const indexNames = new Set(
      (
        db
          .prepare("SELECT name FROM sqlite_master WHERE type='index';")
          .all() as { name: string }[]
      ).map((r) => r.name)
    );
    for (const name of [
      "idx_meal_sugar_log",
      "idx_meal_food",
      "idx_favorites_food",
      "idx_injection_meal_log",
      "idx_foods_category",
    ]) {
      ok(`v12 creates ${name}`, indexNames.has(name));
    }

    // Every index must actually be USED by the delete path it exists for -
    // an index the planner ignores is not a fix.
    const planFor = (sql: string): string =>
      (
        db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[]
      )
        .map((r) => r.detail)
        .join(" | ");
    ok(
      "the meal_log_id lookup uses its index",
      planFor(
        "SELECT * FROM injection_logs WHERE meal_log_id = 'm1' AND source = 'calculator';"
      ).includes("idx_injection_meal_log")
    );
    ok(
      "the per-category catalog query uses its index",
      planFor(
        "SELECT * FROM foods WHERE is_custom = 0 AND category = 'bakery';"
      ).includes("idx_foods_category")
    );

    // Pure DDL: no row was read, rewritten or dropped.
    eq(
      "no meal row is touched",
      (db.prepare("SELECT COUNT(*) AS c FROM meal_logs;").get() as { c: number }).c,
      1
    );
    const meal = db
      .prepare("SELECT sugar_log_id, food_id FROM meal_logs WHERE id='m1';")
      .get() as { sugar_log_id: string; food_id: string };
    eq("the meal keeps its reading reference", meal.sugar_log_id, "s1");
    eq("the meal keeps its food reference", meal.food_id, "f1");
    eq(
      "the injection keeps its meal reference",
      (
        db.prepare("SELECT meal_log_id FROM injection_logs WHERE id='i1';").get() as {
          meal_log_id: string;
        }
      ).meal_log_id,
      "m1"
    );

    // Idempotent: a second run (or an install that already had these from a
    // fresh schema) must not throw and must not duplicate anything.
    let reran = true;
    try {
      await migrateToV12(adapt(db));
    } catch {
      reran = false;
    }
    ok("v12 is safe to re-run", reran);
    eq(
      "re-running v12 creates no duplicate index",
      (
        db
          .prepare(
            "SELECT COUNT(*) AS c FROM sqlite_master WHERE type='index' AND name='idx_meal_food';"
          )
          .get() as { c: number }
      ).c,
      1
    );

    // And the referential actions those indexes serve still behave.
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec("DELETE FROM foods WHERE id = 'f1';");
    eq(
      "deleting a food still nulls the meal's food_id",
      (
        db.prepare("SELECT food_id FROM meal_logs WHERE id='m1';").get() as {
          food_id: string | null;
        }
      ).food_id,
      null
    );
    eq(
      "and still cascades the favorite away",
      (db.prepare("SELECT COUNT(*) AS c FROM favorites;").get() as { c: number }).c,
      0
    );
    db.exec("DELETE FROM meal_logs WHERE id = 'm1';");
    eq(
      "deleting a meal still nulls the injection's meal_log_id",
      (
        db.prepare("SELECT meal_log_id FROM injection_logs WHERE id='i1';").get() as {
          meal_log_id: string | null;
        }
      ).meal_log_id,
      null
    );
    db.close();
  }

  // ── I. v13: meal templates (create-only + one nullable ADD COLUMN) ──────────
  section("I. v13 meal templates: data preservation");
  {
    const db = makeV13Database();
    // Three meals covering the shapes that exist: a catalogue food, a typed name,
    // and one with every optional column filled in.
    db.exec(
      `INSERT INTO sugar_logs (id, profile_id, glucose_level_mgdl, logged_at)
         VALUES ('s1', 'p1', 132, '2026-07-01T07:55:00.000Z');
       INSERT INTO meal_logs
         (id, profile_id, sugar_log_id, food_id, custom_food_name, portion_g,
          calculated_carbs_g, insulin_dose_units, photo_uri_local, personal_note,
          logged_at, tags)
       VALUES
         ('m1', 'p1', 's1', 'f1', NULL, 50, 24.3, 2.5, NULL, NULL,
          '2026-07-01T08:00:00.000Z', '[]'),
         ('m2', 'p1', NULL, NULL, 'Pilav', 180, 62.4, 5, NULL, 'az tuzlu',
          '2026-07-01T13:00:00.000Z', '["sport"]'),
         ('m3', 'p2', NULL, 'f2', NULL, 0, 0, 0, 'file:///photo.jpg', NULL,
          '2026-07-02T20:00:00.000Z', '[]');`
    );

    const before = db
      .prepare("SELECT * FROM meal_logs ORDER BY id;")
      .all() as Record<string, unknown>[];
    eq("fixture has 3 meals", before.length, 3);

    await migrateToV13(adapt(db));

    const after = db.prepare("SELECT * FROM meal_logs ORDER BY id;").all() as Record<
      string,
      unknown
    >[];
    eq("all 3 meals survive v13", after.length, 3);
    let identical = true;
    for (let i = 0; i < before.length; i++) {
      for (const key of Object.keys(before[i])) {
        if (before[i][key] !== after[i][key]) {
          identical = false;
          console.error(
            `  ✗ meal ${String(before[i].id)}.${key}: ${String(before[i][key])} → ${String(
              after[i][key]
            )}`
          );
        }
      }
    }
    ok("every pre-existing meal column is byte-for-byte unchanged", identical);
    ok(
      "and every migrated meal reads as not-from-a-template",
      after.every((r) => r.meal_template_id === null)
    );
    eq(
      "the reading is untouched",
      (db.prepare("SELECT COUNT(*) AS c FROM sugar_logs;").get() as { c: number }).c,
      1
    );

    section("I2. v13 schema shape");
    const mealCols = columns(db, "meal_logs");
    ok("meal_logs gains meal_template_id", mealCols.has("meal_template_id"));
    eq("it is nullable", mealCols.get("meal_template_id")?.notnull, 0);
    eq("with no default", mealCols.get("meal_template_id")?.dflt_value, null);
    // No foreign key on it, on purpose: a record must outlive its template, and a
    // column inside a foreign key cannot be dropped in SQLite (the v8 lesson).
    const mealFks = db
      .prepare("PRAGMA foreign_key_list(meal_logs);")
      .all() as { from: string }[];
    ok(
      "and carries no foreign key",
      !mealFks.some((f) => f.from === "meal_template_id")
    );
    // The rebuild that v13 deliberately avoids would have re-created these.
    eq(
      "meal_logs was not rebuilt (its indexes are still the originals)",
      indexNames(db).has("idx_meal_profile") && indexNames(db).has("idx_meal_food"),
      true
    );

    const tplCols = columns(db, "meal_templates");
    for (const name of [
      "id",
      "profile_id",
      "name",
      "slot",
      "sort_order",
      "use_count",
      "last_used_at",
      "created_at",
    ]) {
      ok(`meal_templates.${name} exists`, tplCols.has(name));
    }
    eq("slot is nullable", tplCols.get("slot")?.notnull, 0);
    eq("last_used_at is nullable", tplCols.get("last_used_at")?.notnull, 0);
    eq("use_count defaults to 0", String(tplCols.get("use_count")?.dflt_value), "0");

    const itemCols = columns(db, "meal_template_items");
    for (const name of [
      "id",
      "template_id",
      "food_id",
      "name_snapshot",
      "carb_100g_snapshot",
      "portion_g",
      "carbs_g_fixed",
      "sort_order",
    ]) {
      ok(`meal_template_items.${name} exists`, itemCols.has(name));
    }
    eq("food_id is nullable (the catalogue row can go away)", itemCols.get("food_id")?.notnull, 0);
    eq("name_snapshot is NOT NULL (the fallback name)", itemCols.get("name_snapshot")?.notnull, 1);
    eq("carbs_g_fixed is nullable", itemCols.get("carbs_g_fixed")?.notnull, 0);

    const idx = indexNames(db);
    ok("the profile/order index exists", idx.has("idx_meal_templates_profile"));
    ok("the per-template item index exists", idx.has("idx_meal_template_items_template"));

    // The item read is "one template, in item order" and must use its index.
    const plan = (
      db
        .prepare(
          "EXPLAIN QUERY PLAN SELECT * FROM meal_template_items WHERE template_id = 't1' ORDER BY sort_order;"
        )
        .all() as { detail: string }[]
    )
      .map((r) => r.detail)
      .join(" | ");
    ok("reading one template's items uses its index", plan.includes("idx_meal_template_items_template"));

    section("I3. v13 idempotence");
    db.exec(
      `INSERT INTO meal_templates (id, profile_id, name, slot, sort_order, use_count, last_used_at, created_at)
         VALUES ('t1', 'p1', 'Sabah rutini', 'breakfast', 0, 3, '2026-07-28T07:00:00.000Z', '2026-07-01T00:00:00.000Z');
       INSERT INTO meal_template_items
         (id, template_id, food_id, name_snapshot, carb_100g_snapshot, portion_g, carbs_g_fixed, sort_order)
         VALUES ('i1', 't1', 'f1', 'Ekmek', 48.5, 50, NULL, 0);`
    );
    let reran = true;
    try {
      await migrateToV13(adapt(db));
      await migrateToV13(adapt(db));
    } catch (e) {
      reran = false;
      console.error(`  ✗ re-running v13 threw: ${String(e)}`);
    }
    ok("v13 is safe to re-run", reran);
    eq(
      "re-running keeps exactly one template",
      (db.prepare("SELECT COUNT(*) AS c FROM meal_templates;").get() as { c: number }).c,
      1
    );
    eq(
      "and its items",
      (db.prepare("SELECT COUNT(*) AS c FROM meal_template_items;").get() as { c: number }).c,
      1
    );
    eq(
      "and does not duplicate the added column",
      (db.prepare("PRAGMA table_info(meal_logs);").all() as { name: string }[]).filter(
        (c) => c.name === "meal_template_id"
      ).length,
      1
    );
    eq(
      "and leaves the use counter alone",
      (db.prepare("SELECT use_count AS c FROM meal_templates WHERE id='t1';").get() as {
        c: number;
      }).c,
      3
    );
    db.close();
  }

  section("I4. v13 lifecycle: profiles, templates, foods, logged meals");
  {
    const db = makeV13Database();
    await migrateToV13(adapt(db));
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec(
      `INSERT INTO meal_templates (id, profile_id, name, slot, sort_order, use_count, last_used_at, created_at)
         VALUES ('t1', 'p1', 'Sabah rutini', 'breakfast', 0, 1, '2026-07-28T07:00:00.000Z', '2026-07-01T00:00:00.000Z'),
                ('t2', 'p2', 'Okul kahvaltisi', NULL, 0, 0, NULL, '2026-07-01T00:00:00.000Z');
       INSERT INTO meal_template_items
         (id, template_id, food_id, name_snapshot, carb_100g_snapshot, portion_g, carbs_g_fixed, sort_order)
         VALUES ('i1', 't1', 'f2', 'Kendi ekmegim', 20, 100, NULL, 0),
                ('i2', 't1', NULL, 'Cay', 0, 200, 0, 1),
                ('i3', 't2', 'f1', 'Ekmek', 48.5, 40, NULL, 0);
       INSERT INTO meal_logs
         (id, profile_id, sugar_log_id, food_id, custom_food_name, portion_g,
          calculated_carbs_g, insulin_dose_units, logged_at, tags, meal_template_id)
         VALUES ('m1', 'p1', NULL, NULL, 'Sabah rutini', 300, 20, 2, '2026-07-28T07:05:00.000Z', '[]', 't1');`
    );

    // Deleting a template deletes the RECIPE and nothing else. The meal that was
    // logged from it keeps every value, including the provenance id (which is why
    // that column has no foreign key).
    db.exec("DELETE FROM meal_templates WHERE id = 't1';");
    eq(
      "deleting a template cascades its items away",
      (
        db
          .prepare("SELECT COUNT(*) AS c FROM meal_template_items WHERE template_id='t1';")
          .get() as { c: number }
      ).c,
      0
    );
    const meal = db.prepare("SELECT * FROM meal_logs WHERE id='m1';").get() as
      | Record<string, unknown>
      | undefined;
    ok("the meal logged from it is NOT deleted", meal != null);
    eq("it keeps its name", meal?.custom_food_name, "Sabah rutini");
    eq("it keeps its carbs", meal?.calculated_carbs_g, 20);
    eq("it keeps its dose", meal?.insulin_dose_units, 2);
    eq("and still records where it came from", meal?.meal_template_id, "t1");
    eq(
      "the other profile's template is untouched",
      (db.prepare("SELECT COUNT(*) AS c FROM meal_templates WHERE profile_id='p2';").get() as {
        c: number;
      }).c,
      1
    );

    // Losing the catalogue row nulls the LINK and leaves the snapshot intact: the
    // item still knows what it was and what it counted for.
    db.exec("DELETE FROM foods WHERE id = 'f1';");
    const orphan = db
      .prepare("SELECT * FROM meal_template_items WHERE id='i3';")
      .get() as Record<string, unknown>;
    eq("deleting a food nulls the item's food_id", orphan.food_id, null);
    eq("the name snapshot survives", orphan.name_snapshot, "Ekmek");
    eq("the carb snapshot survives", orphan.carb_100g_snapshot, 48.5);
    eq("the portion survives", orphan.portion_g, 40);
    eq(
      "and the item itself is never deleted",
      (db.prepare("SELECT COUNT(*) AS c FROM meal_template_items;").get() as { c: number }).c,
      1
    );

    // Profile isolation: one profile's templates go with that profile, the other's
    // stay. (The unfiltered-DELETE class of bug, enforced by the schema.)
    db.exec(
      `INSERT INTO meal_templates (id, profile_id, name, slot, sort_order, use_count, last_used_at, created_at)
         VALUES ('t3', 'p1', 'Aksam', 'dinner', 1, 0, NULL, '2026-07-02T00:00:00.000Z');
       INSERT INTO meal_template_items
         (id, template_id, food_id, name_snapshot, carb_100g_snapshot, portion_g, carbs_g_fixed, sort_order)
         VALUES ('i4', 't3', NULL, 'Corba', 8, 250, NULL, 0);`
    );
    db.exec("DELETE FROM user_profiles WHERE id = 'p1';");
    eq(
      "deleting a profile takes its templates",
      (db.prepare("SELECT COUNT(*) AS c FROM meal_templates WHERE profile_id='p1';").get() as {
        c: number;
      }).c,
      0
    );
    eq(
      "and their items",
      (db.prepare("SELECT COUNT(*) AS c FROM meal_template_items WHERE template_id='t3';").get() as {
        c: number;
      }).c,
      0
    );
    eq(
      "while the other profile keeps its own",
      (db.prepare("SELECT COUNT(*) AS c FROM meal_templates WHERE profile_id='p2';").get() as {
        c: number;
      }).c,
      1
    );
    eq(
      "and its items",
      (db.prepare("SELECT COUNT(*) AS c FROM meal_template_items WHERE template_id='t2';").get() as {
        c: number;
      }).c,
      1
    );
    db.close();
  }

  section("I5. v13 constraints");
  {
    const db = makeV13Database();
    await migrateToV13(adapt(db));
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec(
      `INSERT INTO meal_templates (id, profile_id, name, slot, sort_order, use_count, last_used_at, created_at)
         VALUES ('t1', 'p1', 'Sabah rutini', 'breakfast', 0, 0, NULL, '2026-07-01T00:00:00.000Z');`
    );

    // slot is nullable (a snack template has none) but only the three real slots
    // are valid: there is no snack ratio to dose a fourth one with.
    ok(
      "a slot-less template is accepted",
      !refused(
        db,
        `INSERT INTO meal_templates (id, profile_id, name, slot, sort_order, use_count, last_used_at, created_at)
           VALUES ('t2', 'p1', 'Ara', NULL, 1, 0, NULL, '2026-07-01T00:00:00.000Z');`
      )
    );
    ok(
      "slot='snack' is refused (no such carb ratio exists)",
      refused(
        db,
        `INSERT INTO meal_templates (id, profile_id, name, slot, sort_order, use_count, last_used_at, created_at)
           VALUES ('t3', 'p1', 'Ara', 'snack', 2, 0, NULL, '2026-07-01T00:00:00.000Z');`
      )
    );
    ok(
      "so is any other slot value",
      refused(
        db,
        `INSERT INTO meal_templates (id, profile_id, name, slot, sort_order, use_count, last_used_at, created_at)
           VALUES ('t4', 'p1', 'Ara', 'brunch', 3, 0, NULL, '2026-07-01T00:00:00.000Z');`
      )
    );
    ok(
      "a template must belong to a profile that exists",
      refused(
        db,
        `INSERT INTO meal_templates (id, profile_id, name, slot, sort_order, use_count, last_used_at, created_at)
           VALUES ('t5', 'ghost', 'Ara', NULL, 4, 0, NULL, '2026-07-01T00:00:00.000Z');`
      )
    );

    // An item cannot be anonymous: without a food_id AND without a name there is
    // nothing to show and nothing to fall back on.
    ok(
      "an item with no food and an empty name is refused",
      refused(
        db,
        `INSERT INTO meal_template_items
           (id, template_id, food_id, name_snapshot, carb_100g_snapshot, portion_g, carbs_g_fixed, sort_order)
           VALUES ('x1', 't1', NULL, '', 0, 100, NULL, 0);`
      )
    );
    ok(
      "whitespace is not a name either",
      refused(
        db,
        `INSERT INTO meal_template_items
           (id, template_id, food_id, name_snapshot, carb_100g_snapshot, portion_g, carbs_g_fixed, sort_order)
           VALUES ('x2', 't1', NULL, '   ', 0, 100, NULL, 0);`
      )
    );
    ok(
      "a NULL name is refused",
      refused(
        db,
        `INSERT INTO meal_template_items
           (id, template_id, food_id, name_snapshot, carb_100g_snapshot, portion_g, carbs_g_fixed, sort_order)
           VALUES ('x3', 't1', NULL, NULL, 0, 100, NULL, 0);`
      )
    );
    ok(
      "a typed-name item (no food) is accepted",
      !refused(
        db,
        `INSERT INTO meal_template_items
           (id, template_id, food_id, name_snapshot, carb_100g_snapshot, portion_g, carbs_g_fixed, sort_order)
           VALUES ('x4', 't1', NULL, 'Pilav', 28, 180, NULL, 0);`
      )
    );
    ok(
      "an item must belong to a template that exists",
      refused(
        db,
        `INSERT INTO meal_template_items
           (id, template_id, food_id, name_snapshot, carb_100g_snapshot, portion_g, carbs_g_fixed, sort_order)
           VALUES ('x5', 'ghost', NULL, 'Pilav', 28, 180, NULL, 0);`
      )
    );
    // meal_logs.meal_template_id is provenance, NOT a reference: an id whose
    // template is gone must still be storable, or a template delete could not
    // leave the meals it wrote behind.
    ok(
      "a meal can name a template that no longer exists",
      !refused(
        db,
        `INSERT INTO meal_logs
           (id, profile_id, sugar_log_id, food_id, custom_food_name, portion_g,
            calculated_carbs_g, insulin_dose_units, logged_at, tags, meal_template_id)
           VALUES ('m9', 'p1', NULL, NULL, 'Silinmis sablon', 100, 10, 1,
                   '2026-07-28T07:00:00.000Z', '[]', 'gone-forever');`
      )
    );
    db.close();
  }

  section("I6. v13 fresh install equivalence");
  {
    // A migrated install and a brand-new one have to end up the same shape. Both
    // run the SAME exported statements (lib/db/index.ts createSchemaV1 loops over
    // V13_CREATE, migrateToV13 loops over the same array), so the check is that
    // the migrated database really has everything that array creates, plus the
    // source pins below for the parts createSchemaV1 declares itself.
    const migrated = makeV13Database();
    await migrateToV13(adapt(migrated));

    const fresh = new DatabaseSync(":memory:");
    fresh.exec(
      `CREATE TABLE user_profiles (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL);
       CREATE TABLE foods (id TEXT PRIMARY KEY NOT NULL, name_tr TEXT NOT NULL, carb_100g REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL);`
    );
    for (const statement of V13_CREATE) fresh.exec(statement);

    for (const table of ["meal_templates", "meal_template_items"]) {
      const a = [...columns(migrated, table).keys()].join(",");
      const b = [...columns(fresh, table).keys()].join(",");
      eq(`${table} has the same columns as a fresh install`, a, b);
      eq(
        `${table} has the same DDL as a fresh install`,
        (
          migrated
            .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?;")
            .get(table) as { sql: string }
        ).sql,
        (
          fresh
            .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?;")
            .get(table) as { sql: string }
        ).sql
      );
    }
    for (const name of [
      "idx_meal_templates_profile",
      "idx_meal_template_items_template",
    ]) {
      ok(`a fresh install also gets ${name}`, indexNames(fresh).has(name));
    }
    migrated.close();
    fresh.close();

    const indexSrc = readFileSync(
      join(import.meta.dirname, "..", "lib", "db", "index.ts"),
      "utf8"
    );
    ok(
      "the v12 → v13 step runs the real migration",
      /currentVersion < 13\)\s*\{\s*await migrateToV13\(db\);/.test(indexSrc)
    );
    ok(
      "a fresh install declares meal_logs.meal_template_id itself",
      /meal_template_id TEXT,/.test(indexSrc)
    );
    ok(
      "and creates the template tables from the same V13_CREATE statements",
      /for \(const statement of V13_CREATE\)/.test(indexSrc)
    );
  }

  section("I7. v14 schema shape and idempotence");
  {
    const db = makeV14Database(20);
    const before = (
      db.prepare("SELECT COUNT(*) AS c FROM foods;").get() as { c: number }
    ).c;

    await migrateToV14(adapt(db));

    ok(
      "app_meta exists",
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='app_meta';")
        .get() !== undefined
    );
    const metaCols = columns(db, "app_meta");
    ok("app_meta.key exists", metaCols.has("key"));
    ok("app_meta.value exists", metaCols.has("value"));
    eq("key is the primary key", metaCols.get("key")?.pk, 1);
    eq("value is NOT NULL", metaCols.get("value")?.notnull, 1);
    eq(
      "v14 touches no food row",
      (db.prepare("SELECT COUNT(*) AS c FROM foods;").get() as { c: number }).c,
      before
    );

    let reran = true;
    try {
      await migrateToV14(adapt(db));
      await migrateToV14(adapt(db));
    } catch (e) {
      reran = false;
      console.error(`  ✗ re-running v14 threw: ${String(e)}`);
    }
    ok("v14 is safe to re-run", reran);

    // The stored value survives a re-run: the migration creates, it never clears.
    db.prepare(V14_WRITE_META).run(SEED_CATALOG_VERSION_KEY, "7");
    await migrateToV14(adapt(db));
    eq(
      "a re-run does not wipe a stored value",
      (db.prepare(V14_READ_META).get(SEED_CATALOG_VERSION_KEY) as { value: string }).value,
      "7"
    );
    eq(
      "and a re-written key stays a single row",
      (db.prepare("SELECT COUNT(*) AS c FROM app_meta;").get() as { c: number }).c,
      1
    );
    db.close();
  }

  section("I8. the catalog top-up reaches an install that already exists");
  {
    // An install from an older release: an early slice of the catalog and none of
    // what was added since.
    const OLD = 400;
    const db = makeV14Database(OLD);
    await migrateToV14(adapt(db));

    eq("no version is recorded yet", readCatalogVersion(db), 0);
    const inserted = runTopUp(db);
    eq(
      "every food the install was missing is inserted",
      inserted,
      SEED_FOODS.length - OLD
    );
    eq(
      "so the catalog is whole",
      (db.prepare("SELECT COUNT(*) AS c FROM foods;").get() as { c: number }).c,
      SEED_FOODS.length
    );
    eq("and the version is recorded", readCatalogVersion(db), SEED_CATALOG_VERSION);

    // Names, not row counts: the right foods have to be there.
    const names = new Set(
      (db.prepare("SELECT name_en FROM foods;").all() as { name_en: string }[]).map(
        (r) => r.name_en
      )
    );
    ok(
      "every catalog food is present by name",
      SEED_FOODS.every((f) => names.has(f.en))
    );
    // A topped-up row is indistinguishable from a first-launch one, so nothing
    // downstream has to know which release a food arrived in.
    eq(
      "topped-up rows are catalog rows (not custom, no source)",
      (
        db
          .prepare("SELECT COUNT(*) AS c FROM foods WHERE is_custom = 0 AND source IS NULL;")
          .get() as { c: number }
      ).c,
      SEED_FOODS.length
    );
    ok(
      "every topped-up row carries its category, its carbs and its portion",
      (
        db
          .prepare(
            `SELECT COUNT(*) AS c FROM foods
              WHERE category = 'other' OR TRIM(name_en) = '' OR TRIM(name_de) = ''
                 OR TRIM(name_es) = '' OR TRIM(name_fr) = '' OR portion_size_g <= 0;`
          )
          .get() as { c: number }
      ).c === 0
    );

    section("I9. and does nothing at all the next time");
    const again = runTopUp(db);
    eq("a second run inserts nothing", again, 0);
    eq(
      "the catalog is still exactly one copy",
      (db.prepare("SELECT COUNT(*) AS c FROM foods;").get() as { c: number }).c,
      SEED_FOODS.length
    );
    const dupes = db
      .prepare(
        "SELECT name_en, COUNT(*) AS c FROM foods GROUP BY LOWER(name_en) HAVING c > 1;"
      )
      .all() as { name_en: string; c: number }[];
    eq("no food appears twice", dupes.length, 0);
    db.close();
  }

  section("I10. the top-up never touches what the user owns");
  {
    const OLD = 300;
    const db = makeV14Database(OLD);
    await migrateToV14(adapt(db));

    // Three things a real install has that the catalog must not disturb: the
    // user's own food, a barcode result cached from Open Food Facts, and a
    // catalog row they corrected by hand.
    db.exec(
      `INSERT INTO foods (id, name_tr, name_en, name_de, name_es, name_fr, category,
                          carb_100g, glycemic_index, glycemic_load, portion_size_g,
                          is_custom, source, barcode, custom_notes, created_at)
       VALUES ('mine', 'Anneannemin böreği', 'Grandmothers borek', 'Grandmothers borek',
               'Grandmothers borek', 'Grandmothers borek', 'dishes', 31, 60, 19, 180, 1,
               NULL, NULL, 'yarim porsiyon', '2026-02-02T00:00:00.000Z'),
              ('scanned', 'Kepekli gevrek', 'Bran flakes', 'Bran flakes', 'Bran flakes',
               'Bran flakes', 'staples', 67, 0, 0, 40, 0, 'off', '4009233001234', NULL,
               '2026-02-02T00:00:00.000Z');`
    );
    // A catalog food the user edited: same name, their carb value.
    db.exec("UPDATE foods SET carb_100g = 99 WHERE id = 'seed-0';");

    // And the case that actually costs them something: they typed in, months ago,
    // a food this release ships. Theirs has to win.
    const shipped = SEED_FOODS[OLD + 5];
    db.exec(
      `INSERT INTO foods (id, name_tr, name_en, name_de, name_es, name_fr, category,
                          carb_100g, glycemic_index, glycemic_load, portion_size_g,
                          is_custom, source, barcode, created_at)
       VALUES ('collide', ${quote(shipped.tr)}, ${quote(shipped.en)}, ${quote(shipped.en)},
               ${quote(shipped.en)}, ${quote(shipped.en)}, 'other', 12, 0, 0, 77, 1,
               NULL, NULL, '2026-02-02T00:00:00.000Z');`
    );

    const mineBefore = db.prepare("SELECT * FROM foods WHERE id = 'mine';").get();
    const scannedBefore = db.prepare("SELECT * FROM foods WHERE id = 'scanned';").get();
    const editedBefore = db.prepare("SELECT * FROM foods WHERE id = 'seed-0';").get();
    const collideBefore = db.prepare("SELECT * FROM foods WHERE id = 'collide';").get();

    const inserted = runTopUp(db);
    eq(
      "the shipped food the user already typed in is skipped",
      inserted,
      SEED_FOODS.length - OLD - 1
    );

    eq(
      "the user's own food is byte-for-byte unchanged",
      JSON.stringify(db.prepare("SELECT * FROM foods WHERE id = 'mine';").get()),
      JSON.stringify(mineBefore)
    );
    eq(
      "the cached barcode result is byte-for-byte unchanged",
      JSON.stringify(db.prepare("SELECT * FROM foods WHERE id = 'scanned';").get()),
      JSON.stringify(scannedBefore)
    );
    eq(
      "an edited catalog row keeps the user's correction",
      JSON.stringify(db.prepare("SELECT * FROM foods WHERE id = 'seed-0';").get()),
      JSON.stringify(editedBefore)
    );
    eq(
      "and their version of the shipped food is the one that survives",
      JSON.stringify(db.prepare("SELECT * FROM foods WHERE id = 'collide';").get()),
      JSON.stringify(collideBefore)
    );
    eq(
      "so that food is not listed twice",
      (
        db
          .prepare("SELECT COUNT(*) AS c FROM foods WHERE LOWER(name_en) = LOWER(?);")
          .get(shipped.en) as { c: number }
      ).c,
      1
    );
    eq(
      "the custom-food count is untouched",
      (db.prepare("SELECT COUNT(*) AS c FROM foods WHERE is_custom = 1;").get() as {
        c: number;
      }).c,
      2
    );
    db.close();
  }

  section("I11. selectMissingFoods, the rule the top-up runs on");
  {
    eq(
      "an empty database is missing the whole catalog",
      selectMissingFoods(SEED_FOODS, []).length,
      SEED_FOODS.length
    );
    eq(
      "a current database is missing nothing",
      selectMissingFoods(
        SEED_FOODS,
        SEED_FOODS.map((f) => f.en)
      ).length,
      0
    );
    eq(
      "casing is not a difference",
      selectMissingFoods(
        SEED_FOODS,
        SEED_FOODS.map((f) => f.en.toUpperCase())
      ).length,
      0
    );
    eq(
      "neither is surrounding whitespace",
      selectMissingFoods(
        SEED_FOODS,
        SEED_FOODS.map((f) => `  ${f.en}  `)
      ).length,
      0
    );
    eq(
      "a null or blank stored name matches nothing",
      selectMissingFoods(SEED_FOODS, [null, undefined, "", "   "]).length,
      SEED_FOODS.length
    );
    eq(
      "an unrelated name does not hide a catalog food",
      selectMissingFoods(SEED_FOODS, ["something nobody ships"]).length,
      SEED_FOODS.length
    );
    // The identity the whole mechanism rests on: two catalog foods sharing an
    // English name would make one of them permanently unreachable by the top-up.
    const enKeys = new Set(SEED_FOODS.map((f) => f.en.trim().toLowerCase()));
    eq(
      "every catalog food has a distinct English name",
      enKeys.size,
      SEED_FOODS.length
    );
  }

  section("I12. v14 fresh install equivalence");
  {
    const migrated = makeV14Database(0);
    await migrateToV14(adapt(migrated));

    const fresh = new DatabaseSync(":memory:");
    for (const statement of V14_CREATE) fresh.exec(statement);

    eq(
      "app_meta has the same columns as a fresh install",
      [...columns(migrated, "app_meta").keys()].join(","),
      [...columns(fresh, "app_meta").keys()].join(",")
    );
    eq(
      "app_meta has the same DDL as a fresh install",
      (
        migrated
          .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='app_meta';")
          .get() as { sql: string }
      ).sql,
      (
        fresh
          .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='app_meta';")
          .get() as { sql: string }
      ).sql
    );
    migrated.close();
    fresh.close();

    const indexSrc = readFileSync(
      join(import.meta.dirname, "..", "lib", "db", "index.ts"),
      "utf8"
    );
    // SCHEMA_VERSION itself has since moved past v14 (see L3, "SCHEMA_VERSION is 16");
    // this section only checks the v13 → v14 step and the fresh-install shape.
    ok(
      "the v13 → v14 step runs the real migration",
      /currentVersion < 14\)\s*\{\s*await migrateToV14\(db\);/.test(indexSrc)
    );
    ok(
      "a fresh install creates app_meta from the same V14_CREATE statements",
      /for \(const statement of V14_CREATE\)/.test(indexSrc)
    );
    ok(
      "and every launch ends by syncing the catalog",
      /await syncSeedCatalog\(db, seededNow\);/.test(indexSrc)
    );
    // The top-up must never be able to reach a row: INSERT is the only verb it
    // is allowed, and this is the check that notices if that ever changes.
    const sync = /async function syncSeedCatalog[\s\S]*?\n\}/.exec(indexSrc)?.[0] ?? "";
    ok("syncSeedCatalog exists", sync.length > 0);
    ok(
      "and contains no UPDATE or DELETE of any kind",
      !/\bUPDATE\b|\bDELETE\b/i.test(sync),
      sync.slice(0, 200)
    );
  }

  section("J. v15 insulin catalog columns");
  {
    const db = makeV14FullDatabase();
    db.exec(
      `INSERT INTO injection_logs
         (id, profile_id, site, dose_units, insulin_type, source, logged_at, tags)
       VALUES ('i1', 'p1', 'abdomen_left', 6, 'bolus', 'manual', '2026-07-01T08:00:00.000Z', '[]');`
    );

    await migrateToV15(adapt(db));

    const profileCols = columns(db, "user_profiles");
    for (const col of V15_PROFILE_COLUMNS) {
      ok(`user_profiles gains ${col.name}`, profileCols.has(col.name));
      eq(`${col.name} is nullable`, profileCols.get(col.name)?.notnull, 0);
      eq(`${col.name} has no default`, profileCols.get(col.name)?.dflt_value, null);
    }
    const injectionCols = columns(db, "injection_logs");
    ok("injection_logs gains bolus_kind", injectionCols.has("bolus_kind"));
    eq("bolus_kind is nullable", injectionCols.get("bolus_kind")?.notnull, 0);
    eq("bolus_kind has no default", injectionCols.get("bolus_kind")?.dflt_value, null);

    const profile = db
      .prepare("SELECT * FROM user_profiles WHERE id='p1';")
      .get() as Record<string, unknown>;
    eq("the existing profile survives v15", profile.name, "Me");
    eq("its untouched columns are unchanged", profile.daily_carb_target_g, 200);
    eq("its new columns default to NULL", profile.basal_daily_units, null);
    eq("basal_insulin_id defaults to NULL", profile.basal_insulin_id, null);
    eq("bolus_insulin_id defaults to NULL", profile.bolus_insulin_id, null);

    const injection = db
      .prepare("SELECT * FROM injection_logs WHERE id='i1';")
      .get() as Record<string, unknown>;
    eq("the existing injection survives v15", injection.dose_units, 6);
    eq("its insulin_type is unchanged", injection.insulin_type, "bolus");
    eq("its new bolus_kind defaults to NULL", injection.bolus_kind, null);

    // No CHECK on bolus_kind: validation of the stored value is TS-side
    // (lib/db/types.ts parseBolusKind), because ADD COLUMN cannot carry a CHECK
    // without a table rebuild.
    ok(
      "bolus_kind accepts a value with no CHECK constraint",
      !refused(
        db,
        "UPDATE injection_logs SET bolus_kind = 'correction' WHERE id='i1';"
      )
    );
    eq(
      "and the value is actually stored",
      (
        db.prepare("SELECT bolus_kind AS b FROM injection_logs WHERE id='i1';").get() as {
          b: string | null;
        }
      ).b,
      "correction"
    );

    section("J2. v15 idempotence");
    let reran = true;
    try {
      await migrateToV15(adapt(db));
      await migrateToV15(adapt(db));
    } catch (e) {
      reran = false;
      console.error(`  ✗ re-running v15 threw: ${String(e)}`);
    }
    ok("v15 is safe to re-run", reran);
    for (const col of ["basal_daily_units", "basal_insulin_id", "bolus_insulin_id"]) {
      eq(
        `re-running does not duplicate user_profiles.${col}`,
        (db.prepare("PRAGMA table_info(user_profiles);").all() as { name: string }[]).filter(
          (c) => c.name === col
        ).length,
        1
      );
    }
    eq(
      "re-running does not duplicate injection_logs.bolus_kind",
      (db.prepare("PRAGMA table_info(injection_logs);").all() as { name: string }[]).filter(
        (c) => c.name === "bolus_kind"
      ).length,
      1
    );
    eq(
      "re-running keeps the stored bolus_kind value",
      (
        db.prepare("SELECT bolus_kind AS b FROM injection_logs WHERE id='i1';").get() as {
          b: string | null;
        }
      ).b,
      "correction"
    );
    eq(
      "still exactly one profile",
      (db.prepare("SELECT COUNT(*) AS c FROM user_profiles;").get() as { c: number }).c,
      1
    );
    eq(
      "still exactly one injection",
      (db.prepare("SELECT COUNT(*) AS c FROM injection_logs;").get() as { c: number }).c,
      1
    );
    db.close();
  }

  section("J3. v15 statements and fresh-install equivalence");
  {
    eq(
      "V15_PROFILE_COLUMNS adds exactly the three documented columns",
      V15_PROFILE_COLUMNS.map((c) => c.name).join(","),
      "basal_daily_units,basal_insulin_id,bolus_insulin_id"
    );
    ok(
      "V15_ADD_BOLUS_KIND adds injection_logs.bolus_kind",
      /ALTER TABLE injection_logs ADD COLUMN bolus_kind TEXT;/.test(
        V15_ADD_BOLUS_KIND
      )
    );
    // v11's rebuild DDL is deliberately left untouched: it only replays the
    // historical v10 → v11 shape mid-chain, and migrateToV15's ALTER (which runs
    // later in the same chain) is what actually adds bolus_kind for a device
    // migrating from before v11. See lib/db/v11Sql.ts / lib/db/migrations.ts.
    ok(
      "v11's injection_logs rebuild DDL does not itself carry bolus_kind",
      !V11_CREATE_INJECTIONS.includes("bolus_kind")
    );

    const indexSrc = readFileSync(
      join(import.meta.dirname, "..", "lib", "db", "index.ts"),
      "utf8"
    );
    // SCHEMA_VERSION itself has since moved past v15 (see L3, "SCHEMA_VERSION is 16");
    // this section only checks the v14 → v15 step and the fresh-install shape.
    ok(
      "the v14 → v15 step runs the real migration",
      /currentVersion < 15\)\s*\{\s*await migrateToV15\(db\);/.test(indexSrc)
    );
    ok(
      "a fresh install declares the three profile columns itself",
      /basal_daily_units REAL,\s*\n\s*basal_insulin_id TEXT,\s*\n\s*bolus_insulin_id TEXT,/.test(
        indexSrc
      )
    );
    ok(
      "a fresh install declares injection_logs.bolus_kind itself",
      /bolus_kind TEXT,/.test(indexSrc)
    );
  }

  // ── L. v16 oral medication tracking ─────────────────────────────────────────
  section("L. v16 oral medication tracking");
  {
    const db = makeV15Database();
    db.exec(
      `INSERT INTO injection_logs
         (id, profile_id, site, dose_units, insulin_type, source, logged_at, tags, bolus_kind)
       VALUES ('i1', 'p1', 'abdomen_left', 6, 'bolus', 'manual', '2026-07-01T08:00:00.000Z', '[]', 'meal');`
    );

    await migrateToV16(adapt(db));

    ok(
      "med_logs table exists",
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='med_logs';")
        .get() !== undefined
    );
    const medCols = columns(db, "med_logs");
    for (const name of ["id", "profile_id", "taken_at", "name", "note", "created_at"]) {
      ok(`med_logs.${name} exists`, medCols.has(name));
    }
    eq("taken_at is NOT NULL", medCols.get("taken_at")?.notnull, 1);
    eq("name is nullable", medCols.get("name")?.notnull, 0);
    eq("note is nullable", medCols.get("note")?.notnull, 0);
    eq("created_at is NOT NULL", medCols.get("created_at")?.notnull, 1);
    // No CHECK on name and no dose column at all: the app stores what the user
    // writes and never names a substance, a dose or a schedule of its own.
    ok("med_logs carries no dose column", !medCols.has("dose"));

    const medFks = db.prepare("PRAGMA foreign_key_list(med_logs);").all() as {
      from: string;
    }[];
    ok(
      "med_logs.profile_id carries a foreign key",
      medFks.some((f) => f.from === "profile_id")
    );

    const idx = indexNames(db);
    ok("the per-profile feed index exists", idx.has("idx_med_profile"));
    ok("the taken_at range index exists", idx.has("idx_med_taken_at"));

    const profileCols = columns(db, "user_profiles");
    ok("user_profiles gains oral_meds_enabled", profileCols.has("oral_meds_enabled"));
    eq("oral_meds_enabled is NOT NULL", profileCols.get("oral_meds_enabled")?.notnull, 1);
    eq(
      "oral_meds_enabled defaults to 0",
      String(profileCols.get("oral_meds_enabled")?.dflt_value),
      "0"
    );

    // Existing rows survive untouched: v16 is create-only plus one guarded
    // ADD COLUMN, so nothing already stored is read or rewritten.
    const profile = db
      .prepare("SELECT * FROM user_profiles WHERE id='p1';")
      .get() as Record<string, unknown>;
    eq("the existing profile survives v16", profile.name, "Me");
    eq("its v15 columns are unchanged", profile.basal_insulin_id, "glargine-u100");
    eq("its new flag defaults to off", profile.oral_meds_enabled, 0);

    const injection = db
      .prepare("SELECT * FROM injection_logs WHERE id='i1';")
      .get() as Record<string, unknown>;
    eq("the existing injection survives v16", injection.dose_units, 6);
    eq("its bolus_kind is unchanged", injection.bolus_kind, "meal");

    // The whole point of the migration: an entry can now be recorded, with or
    // without a name (the fastest way to log is refusing nothing).
    db.exec(
      `INSERT INTO med_logs (id, profile_id, taken_at, name, note, created_at)
       VALUES ('med1', 'p1', 1753603200000, 'Metformin', 'sabah', 1753603200000);`
    );
    eq(
      "a medication entry can be stored",
      (db.prepare("SELECT COUNT(*) AS c FROM med_logs;").get() as { c: number }).c,
      1
    );
    ok(
      "an entry with no name is still accepted",
      !refused(
        db,
        `INSERT INTO med_logs (id, profile_id, taken_at, created_at)
         VALUES ('med2', 'p1', 1753606800000, 1753606800000);`
      )
    );

    // The foreign key actually does something: losing the profile takes its
    // medication log with it, the same as every other per-profile table.
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec("DELETE FROM user_profiles WHERE id = 'p1';");
    eq(
      "deleting a profile cascades its med_logs away",
      (db.prepare("SELECT COUNT(*) AS c FROM med_logs;").get() as { c: number }).c,
      0
    );
    db.close();
  }

  section("L2. v16 idempotence");
  {
    const db = makeV15Database();
    await migrateToV16(adapt(db));
    db.exec(
      `INSERT INTO med_logs (id, profile_id, taken_at, name, note, created_at)
       VALUES ('med1', 'p1', 1753603200000, 'Metformin', NULL, 1753603200000);`
    );
    db.exec("UPDATE user_profiles SET oral_meds_enabled = 1 WHERE id = 'p1';");

    let reran = true;
    try {
      await migrateToV16(adapt(db));
      await migrateToV16(adapt(db));
    } catch (e) {
      reran = false;
      console.error(`  ✗ re-running v16 threw: ${String(e)}`);
    }
    ok("v16 is safe to re-run", reran);
    eq(
      "re-running does not duplicate user_profiles.oral_meds_enabled",
      (db.prepare("PRAGMA table_info(user_profiles);").all() as { name: string }[]).filter(
        (c) => c.name === "oral_meds_enabled"
      ).length,
      1
    );
    eq(
      "re-running keeps the stored flag value",
      (
        db.prepare("SELECT oral_meds_enabled AS o FROM user_profiles WHERE id='p1';").get() as {
          o: number;
        }
      ).o,
      1
    );
    eq(
      "re-running keeps the recorded entry",
      (db.prepare("SELECT COUNT(*) AS c FROM med_logs;").get() as { c: number }).c,
      1
    );
    eq(
      "and its name intact",
      (db.prepare("SELECT name AS n FROM med_logs WHERE id='med1';").get() as { n: string })
        .n,
      "Metformin"
    );
    eq(
      "still exactly one profile",
      (db.prepare("SELECT COUNT(*) AS c FROM user_profiles;").get() as { c: number }).c,
      1
    );
    db.close();
  }

  section("L3. v16 statements and fresh-install equivalence");
  {
    ok(
      "V16_ADD_ORAL_MEDS_ENABLED adds user_profiles.oral_meds_enabled",
      /ALTER TABLE user_profiles ADD COLUMN oral_meds_enabled INTEGER NOT NULL DEFAULT 0;/.test(
        V16_ADD_ORAL_MEDS_ENABLED
      )
    );
    ok(
      "V16_CREATE declares med_logs",
      V16_CREATE.some((s) => /CREATE TABLE IF NOT EXISTS med_logs/.test(s))
    );
    ok(
      "V16_CREATE declares both med_logs indexes",
      V16_CREATE.some((s) => /idx_med_profile/.test(s)) &&
        V16_CREATE.some((s) => /idx_med_taken_at/.test(s))
    );

    const indexSrc = readFileSync(
      join(import.meta.dirname, "..", "lib", "db", "index.ts"),
      "utf8"
    );
    // SCHEMA_VERSION itself has since moved past v16 (see M3, "SCHEMA_VERSION is
    // 17"); this section only checks the v15 → v16 step and the fresh-install shape.
    ok(
      "the v15 → v16 step runs the real migration",
      /currentVersion < 16\)\s*\{\s*await migrateToV16\(db\);/.test(indexSrc)
    );
    ok(
      "a fresh install declares oral_meds_enabled itself",
      /oral_meds_enabled INTEGER NOT NULL DEFAULT 0,/.test(indexSrc)
    );
    ok(
      "and creates med_logs from the same V16_CREATE statements",
      /for \(const statement of V16_CREATE\)/.test(indexSrc)
    );

    // A migrated v15 database and a brand-new install end up with the identical
    // med_logs shape - the same test I6/I12 run for meal_templates and app_meta.
    const migrated = makeV15Database();
    await migrateToV16(adapt(migrated));

    const fresh = new DatabaseSync(":memory:");
    fresh.exec(
      `CREATE TABLE user_profiles (id TEXT PRIMARY KEY NOT NULL, created_at TEXT NOT NULL);`
    );
    for (const statement of V16_CREATE) fresh.exec(statement);

    eq(
      "med_logs has the same columns as a fresh install",
      [...columns(migrated, "med_logs").keys()].join(","),
      [...columns(fresh, "med_logs").keys()].join(",")
    );
    eq(
      "med_logs has the same DDL as a fresh install",
      (
        migrated
          .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='med_logs';")
          .get() as { sql: string }
      ).sql,
      (
        fresh
          .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='med_logs';")
          .get() as { sql: string }
      ).sql
    );
    for (const name of ["idx_med_profile", "idx_med_taken_at"]) {
      ok(`a fresh install also gets ${name}`, indexNames(fresh).has(name));
    }
    migrated.close();
    fresh.close();
  }

  // ── M. v17 reminders registry ───────────────────────────────────────────────
  section("M. v17 reminders registry: schema shape");
  {
    const db = makeV15Database();
    await migrateToV16(adapt(db));
    await migrateToV17(adapt(db));

    ok(
      "reminders table exists",
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='reminders';")
        .get() !== undefined
    );
    const cols = columns(db, "reminders");
    for (const name of ["id", "type", "label", "time", "enabled", "sort", "created_at"]) {
      ok(`reminders.${name} exists`, cols.has(name));
    }
    eq("type is NOT NULL", cols.get("type")?.notnull, 1);
    eq("label is nullable", cols.get("label")?.notnull, 0);
    eq("time is NOT NULL", cols.get("time")?.notnull, 1);
    eq("enabled is NOT NULL", cols.get("enabled")?.notnull, 1);
    eq("enabled defaults to 1", String(cols.get("enabled")?.dflt_value), "1");
    eq("sort is NOT NULL", cols.get("sort")?.notnull, 1);
    eq("sort defaults to 0", String(cols.get("sort")?.dflt_value), "0");
    eq("created_at is NOT NULL", cols.get("created_at")?.notnull, 1);
    // Device-level, not per-profile - like NotificationPrefs: no profile_id and
    // no foreign key at all, unlike med_logs / injection_logs / meal_logs.
    ok("reminders carries no profile_id column", !cols.has("profile_id"));
    ok(
      "and no foreign key",
      (db.prepare("PRAGMA foreign_key_list(reminders);").all() as unknown[]).length === 0
    );

    ok("the sort index exists", indexNames(db).has("idx_reminders_sort"));

    // The CHECK is enforced, not just documentation.
    const insertType = (type: string) =>
      !refused(
        db,
        `INSERT INTO reminders (id, type, label, time, enabled, sort, created_at)
         VALUES ('${type}-row', '${type}', NULL, '08:00', 1, 0, 1);`
      );
    ok("type='glucose' is accepted", insertType("glucose"));
    ok("type='med' is accepted", insertType("med"));
    ok("type='basal' is accepted", insertType("basal"));
    ok("type='custom' is accepted", insertType("custom"));
    ok(
      "an unknown type is refused",
      refused(
        db,
        `INSERT INTO reminders (id, type, label, time, enabled, sort, created_at)
         VALUES ('bogus-row', 'bogus', NULL, '08:00', 1, 0, 1);`
      )
    );
    eq("four rows accepted, one refused", count(db, "reminders"), 4);

    // A custom reminder's label is exactly what the user typed; the built-in
    // three carry none (their copy comes from i18n at schedule time - see
    // reminderContent in lib/services/notifications.ts).
    db.exec("UPDATE reminders SET label = 'Vitamin D' WHERE id = 'custom-row';");
    eq(
      "a custom row keeps its label",
      (
        db.prepare("SELECT label AS l FROM reminders WHERE id='custom-row';").get() as {
          l: string;
        }
      ).l,
      "Vitamin D"
    );
    db.close();
  }

  section("M2. v17 idempotence");
  {
    const db = makeV15Database();
    await migrateToV16(adapt(db));
    await migrateToV17(adapt(db));
    db.exec(
      `INSERT INTO reminders (id, type, label, time, enabled, sort, created_at)
       VALUES ('r1', 'basal', NULL, '22:00', 1, 0, 1753603200000);`
    );

    let reran = true;
    try {
      await migrateToV17(adapt(db));
      await migrateToV17(adapt(db));
    } catch (e) {
      reran = false;
      console.error(`  ✗ re-running v17 threw: ${String(e)}`);
    }
    ok("v17 is safe to re-run", reran);
    eq(
      "re-running keeps exactly one copy of the sort index",
      (
        db
          .prepare(
            "SELECT COUNT(*) AS c FROM sqlite_master WHERE type='index' AND name='idx_reminders_sort';"
          )
          .get() as { c: number }
      ).c,
      1
    );
    eq("re-running keeps the recorded row", count(db, "reminders"), 1);
    eq(
      "and its value intact",
      (
        db.prepare("SELECT time AS t FROM reminders WHERE id='r1';").get() as {
          t: string;
        }
      ).t,
      "22:00"
    );
    db.close();
  }

  section("M3. v17 statements and fresh-install equivalence");
  {
    ok(
      "V17_CREATE declares reminders",
      V17_CREATE.some((s) => /CREATE TABLE IF NOT EXISTS reminders/.test(s))
    );
    ok(
      "V17_CREATE declares the sort index",
      V17_CREATE.some((s) => /idx_reminders_sort/.test(s))
    );

    const indexSrc = readFileSync(
      join(import.meta.dirname, "..", "lib", "db", "index.ts"),
      "utf8"
    );
    // SCHEMA_VERSION itself has since moved past v17 (see N3, "SCHEMA_VERSION is
    // 18"); this section only checks the v16 → v17 step and the fresh-install shape.
    ok(
      "the v16 → v17 step runs the real migration",
      /currentVersion < 17\)\s*\{\s*await migrateToV17\(db\);/.test(indexSrc)
    );
    ok(
      "and creates reminders from the same V17_CREATE statements",
      /for \(const statement of V17_CREATE\)/.test(indexSrc)
    );

    // A migrated v16 database and a brand-new install end up with the identical
    // reminders shape - the same test L3/I12 run for med_logs and app_meta.
    const migrated = makeV15Database();
    await migrateToV16(adapt(migrated));
    await migrateToV17(adapt(migrated));

    const fresh = new DatabaseSync(":memory:");
    for (const statement of V17_CREATE) fresh.exec(statement);

    eq(
      "reminders has the same columns as a fresh install",
      [...columns(migrated, "reminders").keys()].join(","),
      [...columns(fresh, "reminders").keys()].join(",")
    );
    eq(
      "reminders has the same DDL as a fresh install",
      (
        migrated
          .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='reminders';")
          .get() as { sql: string }
      ).sql,
      (
        fresh
          .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='reminders';")
          .get() as { sql: string }
      ).sql
    );
    ok(
      "a fresh install also gets idx_reminders_sort",
      indexNames(fresh).has("idx_reminders_sort")
    );
    migrated.close();
    fresh.close();
  }

  // ── M4. The legacy-reminders bridge (lib/db/remindersBridge.ts) ─────────────
  // The pure function itself, run against a node:sqlite scratch database exactly
  // like every migrateToV* above - not a hand-copied re-implementation.
  section("M4. the legacy-reminders bridge (remindersBridgedV1)");
  {
    const legacyPrefs = (
      over: Partial<LegacyReminderPrefs> = {}
    ): LegacyReminderPrefs => ({
      basal: true,
      basalTime: "22:00",
      med: false,
      medTime: "09:00",
      glucose: true,
      glucoseTime: "08:00",
      ...over,
    });

    function makeBridgeDatabase(): DatabaseSync {
      const db = new DatabaseSync(":memory:");
      for (const statement of V14_CREATE) db.exec(statement);
      for (const statement of V17_CREATE) db.exec(statement);
      // bridgeLegacyReminders is only ever called (lib/db/reminders.ts's
      // applyLegacyRemindersBridge, from lib/services/notifications.ts) once
      // the app's own database has already run the full migration chain, so
      // the reminders table it sees always has schema v19's profile_id column
      // by then - this scratch db matches that real precondition.
      for (const col of V19_REMINDERS_COLUMNS) {
        db.exec(`ALTER TABLE reminders ADD COLUMN ${col.name} ${col.type};`);
      }
      return db;
    }

    // Only the legacy reminders that were actually ON get a row, in order, with
    // their legacy time carried over verbatim and no label (the built-in three
    // get their copy from i18n, not from this table).
    {
      const db = makeBridgeDatabase();
      const ids = ["seed-a", "seed-b", "seed-c"];
      let n = 0;
      const ran = await bridgeLegacyReminders(
        adapt(db),
        legacyPrefs(),
        () => ids[n++],
        () => 1_753_600_000_000
      );
      ok("the first run seeds the table", ran);
      eq(
        "only the two ON legacy reminders get a row (basal + glucose, not med)",
        count(db, "reminders"),
        2
      );
      const rows = db
        .prepare(
          "SELECT id, type, label, time, enabled, sort, created_at FROM reminders ORDER BY sort;"
        )
        .all() as {
        id: string;
        type: string;
        label: string | null;
        time: string;
        enabled: number;
        sort: number;
        created_at: number;
      }[];
      eq("basal comes first, in legacy order", rows[0].type, "basal");
      eq("with the legacy basalTime carried over", rows[0].time, "22:00");
      eq("basal is enabled", rows[0].enabled, 1);
      eq("basal has no label (i18n owns its copy)", rows[0].label, null);
      eq("basal sorts at 0", rows[0].sort, 0);
      eq(
        "basal's created_at came from the injected clock",
        rows[0].created_at,
        1_753_600_000_000
      );
      eq("glucose comes second", rows[1].type, "glucose");
      eq("with the legacy glucoseTime carried over", rows[1].time, "08:00");
      eq("glucose sorts at 1, right after basal", rows[1].sort, 1);
      ok("and med (which was OFF) never got a row", !rows.some((r) => r.type === "med"));

      const flag = db.prepare(V14_READ_META).get(REMINDERS_BRIDGE_KEY) as
        | { value: string }
        | undefined;
      eq("the bridge marks itself done", flag?.value, "true");

      // Calling again - even with DIFFERENT prefs - must not seed a second time.
      const ranAgain = await bridgeLegacyReminders(
        adapt(db),
        legacyPrefs({ med: true }),
        () => "should-never-be-used",
        () => 2_000_000_000_000
      );
      ok("a second call reports it did nothing", !ranAgain);
      eq("and inserts no further rows", count(db, "reminders"), 2);
      db.close();
    }

    // Nothing was ON: the bridge still runs exactly once and marks itself done,
    // it just has nothing to seed.
    {
      const db = makeBridgeDatabase();
      const ran = await bridgeLegacyReminders(
        adapt(db),
        legacyPrefs({ basal: false, med: false, glucose: false }),
        () => "unused"
      );
      ok("a bridge with nothing ON still reports it ran", ran);
      eq("and creates no row", count(db, "reminders"), 0);
      const flag = db.prepare(V14_READ_META).get(REMINDERS_BRIDGE_KEY) as
        | { value: string }
        | undefined;
      eq("but still marks itself done", flag?.value, "true");

      const ranAgain = await bridgeLegacyReminders(
        adapt(db),
        legacyPrefs(),
        () => "should-not-run"
      );
      ok("so a later call with real settings ON still does nothing", !ranAgain);
      eq("the table stays empty", count(db, "reminders"), 0);
      db.close();
    }

    // Atomicity: a failure part-way through must leave neither a seeded row
    // without the flag (which would duplicate it on retry) nor the flag set
    // without its rows.
    {
      const db = makeBridgeDatabase();
      db.exec("BEGIN;");
      try {
        db.prepare(
          `INSERT INTO reminders (id, type, label, time, enabled, sort, created_at)
           VALUES ('r1', 'basal', NULL, '22:00', 1, 0, 1);`
        ).run();
        throw new Error("simulated crash before the app_meta write");
      } catch {
        db.exec("ROLLBACK;");
      }
      eq("a crash mid-bridge leaves no row behind", count(db, "reminders"), 0);
      ok(
        "and the flag unset",
        db.prepare(V14_READ_META).get(REMINDERS_BRIDGE_KEY) === undefined
      );

      // The real bridge, run afterwards, still works correctly.
      let recoverN = 0;
      const recoverIds = ["r1b", "r1c"];
      const ran = await bridgeLegacyReminders(
        adapt(db),
        legacyPrefs(),
        () => recoverIds[recoverN++]
      );
      ok("the real bridge recovers cleanly", ran);
      eq("and seeds normally", count(db, "reminders"), 2);
      db.close();
    }
  }

  // ── N. v18 meds registry ────────────────────────────────────────────────────
  // Every case below builds a v17-shaped database with makeV15Database + the
  // REAL migrateToV16/V17, so migrateToV18 (the meds table's own step) runs
  // against exactly what a real install has at that point - including med_logs.
  section("N. v18 meds registry: schema shape");
  {
    const db = makeV15Database();
    await migrateToV16(adapt(db));
    await migrateToV17(adapt(db));
    await migrateToV18(adapt(db));

    ok(
      "meds table exists",
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='meds';")
        .get() !== undefined
    );
    const cols = columns(db, "meds");
    for (const name of ["id", "profile_id", "name", "last_used_at", "created_at"]) {
      ok(`meds.${name} exists`, cols.has(name));
    }
    eq("profile_id is NOT NULL", cols.get("profile_id")?.notnull, 1);
    eq("name is NOT NULL", cols.get("name")?.notnull, 1);
    eq("last_used_at is NOT NULL", cols.get("last_used_at")?.notnull, 1);
    eq("created_at is NOT NULL", cols.get("created_at")?.notnull, 1);

    ok("the profile index exists", indexNames(db).has("idx_meds_profile"));

    // The foreign key to user_profiles, ON DELETE CASCADE like med_logs.
    const fks = db.prepare("PRAGMA foreign_key_list(meds);").all() as {
      table: string;
      from: string;
      to: string;
      on_delete: string;
    }[];
    eq("meds has exactly one foreign key", fks.length, 1);
    ok(
      "it references user_profiles.id and cascades on delete",
      fks[0]?.table === "user_profiles" &&
        fks[0]?.from === "profile_id" &&
        fks[0]?.to === "id" &&
        fks[0]?.on_delete === "CASCADE"
    );

    // The UNIQUE(profile_id, name) constraint is enforced, not just documented.
    db.exec(
      `INSERT INTO meds (id, profile_id, name, last_used_at, created_at)
       VALUES ('m1', 'p1', 'Metformin', 1, 1);`
    );
    ok(
      "the same name twice for the same profile is refused",
      refused(
        db,
        `INSERT INTO meds (id, profile_id, name, last_used_at, created_at)
         VALUES ('m2', 'p1', 'Metformin', 2, 2);`
      )
    );
    ok(
      "the same name for a DIFFERENT profile is accepted (not globally unique)",
      !refused(
        db,
        `INSERT INTO user_profiles (id, name, created_at) VALUES ('p2', 'Someone else', '2026-01-01T00:00:00.000Z');
         INSERT INTO meds (id, profile_id, name, last_used_at, created_at)
         VALUES ('m3', 'p2', 'Metformin', 3, 3);`
      )
    );
    db.close();
  }

  section("N2. v18 idempotence (table + stamp)");
  {
    const db = makeV15Database();
    await migrateToV16(adapt(db));
    await migrateToV17(adapt(db));
    await migrateToV18(adapt(db));
    db.exec(
      `INSERT INTO meds (id, profile_id, name, last_used_at, created_at)
       VALUES ('m1', 'p1', 'Metformin', 1000, 1000);`
    );

    let reran = true;
    try {
      await migrateToV18(adapt(db));
      await migrateToV18(adapt(db));
    } catch (e) {
      reran = false;
      console.error(`  ✗ re-running v18 threw: ${String(e)}`);
    }
    ok("v18 is safe to re-run", reran);
    eq(
      "re-running keeps exactly one copy of the profile index",
      (
        db
          .prepare(
            "SELECT COUNT(*) AS c FROM sqlite_master WHERE type='index' AND name='idx_meds_profile';"
          )
          .get() as { c: number }
      ).c,
      1
    );
    eq("re-running keeps the recorded row", count(db, "meds"), 1);
    eq(
      "and its value intact",
      (
        db.prepare("SELECT last_used_at AS t FROM meds WHERE id='m1';").get() as {
          t: number;
        }
      ).t,
      1000
    );
    eq("migrateToV18 stamps 18", readUserVersion(db), 18);
    db.close();
  }

  section("N3. v18 statements and fresh-install equivalence");
  {
    ok(
      "V18_CREATE declares meds",
      V18_CREATE.some((s) => /CREATE TABLE IF NOT EXISTS meds/.test(s))
    );
    ok(
      "V18_CREATE declares the profile index",
      V18_CREATE.some((s) => /idx_meds_profile/.test(s))
    );
    ok(
      "V18_SEED_FROM_MED_LOGS reads distinct names from med_logs",
      /FROM med_logs/.test(V18_SEED_FROM_MED_LOGS) &&
        /GROUP BY profile_id, name/.test(V18_SEED_FROM_MED_LOGS)
    );

    const indexSrc = readFileSync(
      join(import.meta.dirname, "..", "lib", "db", "index.ts"),
      "utf8"
    );
    // SCHEMA_VERSION itself has since moved past v18 (see O3, "SCHEMA_VERSION
    // is 19"); this section only checks the v17 → v18 step and the meds shape.
    ok(
      "the v17 → v18 step runs the real migration",
      /currentVersion < 18\)\s*\{\s*await migrateToV18\(db\);/.test(indexSrc)
    );
    ok(
      "and creates meds from the same V18_CREATE statements",
      /for \(const statement of V18_CREATE\)/.test(indexSrc)
    );

    // A migrated v17 database and a brand-new install end up with the identical
    // meds shape - the same test M3/L3 run for reminders and med_logs. The fresh
    // install never seeds anything (there is no med_logs history yet), so only
    // the DDL is compared here.
    const migrated = makeV15Database();
    await migrateToV16(adapt(migrated));
    await migrateToV17(adapt(migrated));
    await migrateToV18(adapt(migrated));

    const fresh = new DatabaseSync(":memory:");
    fresh.exec(
      `CREATE TABLE user_profiles (id TEXT PRIMARY KEY NOT NULL, created_at TEXT NOT NULL);`
    );
    for (const statement of V18_CREATE) fresh.exec(statement);

    eq(
      "meds has the same columns as a fresh install",
      [...columns(migrated, "meds").keys()].join(","),
      [...columns(fresh, "meds").keys()].join(",")
    );
    eq(
      "meds has the same DDL as a fresh install",
      (
        migrated
          .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='meds';")
          .get() as { sql: string }
      ).sql,
      (
        fresh
          .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='meds';")
          .get() as { sql: string }
      ).sql
    );
    ok(
      "a fresh install also gets idx_meds_profile",
      indexNames(fresh).has("idx_meds_profile")
    );
    migrated.close();
    fresh.close();
  }

  section("N4. v18 seeds from med_logs' distinct names");
  {
    const db = makeV15Database();
    await migrateToV16(adapt(db));
    await migrateToV17(adapt(db));

    // A second profile, so the seed's GROUP BY profile_id, name is exercised
    // (not just profile_id, name across one profile).
    db.exec(
      `INSERT INTO user_profiles (id, name, created_at) VALUES ('p2', 'Someone else', '2026-01-01T00:00:00.000Z');`
    );

    // p1: 'Metformin' logged three times (taken_at 1000, 2000, 3000 - the seed
    // must pick 3000, not the first or a random one) and 'Insulin patch' once.
    // A blank name and a NULL name must never become a seed row. p2: the SAME
    // name 'Metformin' the first profile used, which must seed its OWN row
    // (the unique constraint is per profile, not global).
    db.exec(`
      INSERT INTO med_logs (id, profile_id, taken_at, name, note, created_at) VALUES
        ('ml1', 'p1', 1000, 'Metformin', NULL, 1000),
        ('ml2', 'p1', 3000, 'Metformin', NULL, 3000),
        ('ml3', 'p1', 2000, 'Metformin', NULL, 2000),
        ('ml4', 'p1', 4000, 'Insulin patch', NULL, 4000),
        ('ml5', 'p1', 5000, '', NULL, 5000),
        ('ml6', 'p1', 6000, NULL, NULL, 6000),
        ('ml7', 'p2', 7000, 'Metformin', NULL, 7000);
    `);

    await migrateToV18(adapt(db));

    eq(
      "exactly three seed rows (two distinct names for p1, one for p2)",
      count(db, "meds"),
      3
    );
    const p1Metformin = db
      .prepare("SELECT last_used_at AS t FROM meds WHERE profile_id='p1' AND name='Metformin';")
      .get() as { t: number } | undefined;
    ok("p1's Metformin row exists", p1Metformin !== undefined);
    eq(
      "and last_used_at is the MOST RECENT taken_at (3000), not the first or last inserted",
      p1Metformin?.t,
      3000
    );
    const p1Patch = db
      .prepare("SELECT last_used_at AS t FROM meds WHERE profile_id='p1' AND name='Insulin patch';")
      .get() as { t: number } | undefined;
    eq("p1's single-entry name seeds too", p1Patch?.t, 4000);
    ok(
      "the blank name never became a seed row",
      db.prepare("SELECT 1 FROM meds WHERE name='';").get() === undefined
    );
    const p2Metformin = db
      .prepare("SELECT last_used_at AS t FROM meds WHERE profile_id='p2' AND name='Metformin';")
      .get() as { t: number } | undefined;
    ok("p2 gets its own Metformin row (per-profile, not global)", p2Metformin !== undefined);
    eq("with its own last_used_at", p2Metformin?.t, 7000);

    // Double-run idempotency of the SEEDING statement itself: migrateToV18
    // stamps 18 in the SAME transaction as the seed (see its own doc comment
    // in ./migrations.ts), so in the real app this can only ever run again
    // before that transaction has committed - i.e. against the exact same
    // med_logs, never after a user has acted on the result. Re-running it here
    // pins exactly that: the same med_logs in, no new or duplicate rows out.
    await migrateToV18(adapt(db));
    await migrateToV18(adapt(db));
    eq("re-running the seed step inserts no duplicate rows", count(db, "meds"), 3);
    eq(
      "and every value is still exactly what the first run computed",
      (
        db
          .prepare(
            "SELECT last_used_at AS t FROM meds WHERE profile_id='p1' AND name='Metformin';"
          )
          .get() as { t: number }
      ).t,
      3000
    );
    db.close();
  }

  // ── O. v19 reminders.profile_id + reminders.alarm_enabled ──────────────────
  // Every case below builds a v18-shaped database with makeV15Database + the
  // REAL migrateToV16/V17/V18, so migrateToV19 (this step's own ALTERs) runs
  // against exactly what a real install has at that point - including whatever
  // rows already sat in the reminders table (the M-pattern used for v15/v17).
  section("O. v19 reminders: schema shape");
  {
    const db = makeV15Database();
    await migrateToV16(adapt(db));
    await migrateToV17(adapt(db));
    await migrateToV18(adapt(db));

    // A pre-v19 row, written with exactly the v17/v18 column list (no
    // profile_id, no alarm_enabled - those columns do not exist yet).
    db.exec(
      `INSERT INTO reminders (id, type, label, time, enabled, sort, created_at)
       VALUES ('legacy-basal', 'basal', NULL, '22:00', 1, 0, 1753600000000);`
    );

    await migrateToV19(adapt(db));

    const cols = columns(db, "reminders");
    ok("reminders.profile_id exists", cols.has("profile_id"));
    eq("profile_id is nullable", cols.get("profile_id")?.notnull, 0);
    eq("profile_id has no default", cols.get("profile_id")?.dflt_value, null);
    ok("reminders.alarm_enabled exists", cols.has("alarm_enabled"));
    eq("alarm_enabled is NOT NULL", cols.get("alarm_enabled")?.notnull, 1);
    eq("alarm_enabled defaults to 0", String(cols.get("alarm_enabled")?.dflt_value), "0");

    // No foreign key: unlike med_logs/meds/injection_logs, profile_id here
    // carries no FK (see ./v19Sql's own ownership note).
    ok(
      "profile_id carries no foreign key",
      (db.prepare("PRAGMA foreign_key_list(reminders);").all() as unknown[]).length === 0
    );

    // The pre-existing row survives untouched, and its two new columns
    // BACKFILL exactly as SQLite's ALTER TABLE ADD COLUMN promises: NULL for
    // the nullable one, the declared default for the NOT NULL one.
    const legacy = db
      .prepare("SELECT * FROM reminders WHERE id='legacy-basal';")
      .get() as Record<string, unknown>;
    eq("the pre-v19 row survives v19", legacy.time, "22:00");
    eq("its type is unchanged", legacy.type, "basal");
    eq("its new profile_id backfills to NULL (orphaned, not yet adopted)", legacy.profile_id, null);
    eq("its new alarm_enabled backfills to 0", legacy.alarm_enabled, 0);

    // Both columns accept real values with no CHECK stopping them (same
    // "ADD COLUMN cannot carry a CHECK without a rebuild" reasoning as v15's
    // bolus_kind - see J above).
    ok(
      "profile_id accepts a value",
      !refused(db, "UPDATE reminders SET profile_id = 'p1' WHERE id='legacy-basal';")
    );
    ok(
      "alarm_enabled accepts 1",
      !refused(db, "UPDATE reminders SET alarm_enabled = 1 WHERE id='legacy-basal';")
    );
    db.close();
  }

  section("O2. v19 idempotence");
  {
    const db = makeV15Database();
    await migrateToV16(adapt(db));
    await migrateToV17(adapt(db));
    await migrateToV18(adapt(db));
    await migrateToV19(adapt(db));
    db.exec(
      `INSERT INTO reminders (id, type, label, time, enabled, sort, created_at, profile_id, alarm_enabled)
       VALUES ('r1', 'glucose', NULL, '08:00', 1, 0, 1, 'p1', 0);`
    );

    let reran = true;
    try {
      await migrateToV19(adapt(db));
      await migrateToV19(adapt(db));
    } catch (e) {
      reran = false;
      console.error(`  ✗ re-running v19 threw: ${String(e)}`);
    }
    ok("v19 is safe to re-run", reran);
    for (const col of ["profile_id", "alarm_enabled"]) {
      eq(
        `re-running does not duplicate reminders.${col}`,
        (db.prepare("PRAGMA table_info(reminders);").all() as { name: string }[]).filter(
          (c) => c.name === col
        ).length,
        1
      );
    }
    eq("still exactly one reminder", count(db, "reminders"), 1);
    eq(
      "re-running keeps the stored profile_id intact",
      (
        db.prepare("SELECT profile_id AS p FROM reminders WHERE id='r1';").get() as {
          p: string | null;
        }
      ).p,
      "p1"
    );
    eq("migrateToV19 stamps 19", readUserVersion(db), 19);
    db.close();
  }

  section("O3. v19 statements and fresh-install equivalence");
  {
    eq(
      "V19_REMINDERS_COLUMNS adds exactly the two documented columns",
      V19_REMINDERS_COLUMNS.map((c) => c.name).join(","),
      "profile_id,alarm_enabled"
    );
    ok(
      "profile_id is a plain nullable TEXT with no default",
      V19_REMINDERS_COLUMNS.find((c) => c.name === "profile_id")?.type === "TEXT"
    );
    ok(
      "alarm_enabled is NOT NULL DEFAULT 0",
      V19_REMINDERS_COLUMNS.find((c) => c.name === "alarm_enabled")?.type ===
        "INTEGER NOT NULL DEFAULT 0"
    );

    const indexSrc = readFileSync(
      join(import.meta.dirname, "..", "lib", "db", "index.ts"),
      "utf8"
    );
    ok("SCHEMA_VERSION is 19", /const SCHEMA_VERSION = 19;/.test(indexSrc));
    ok(
      "the v18 → v19 step runs the real migration",
      /currentVersion < 19\)\s*\{\s*await migrateToV19\(db\);/.test(indexSrc)
    );
    ok(
      "and applies the same V19_REMINDERS_COLUMNS list on a fresh install",
      /for \(const col of V19_REMINDERS_COLUMNS\)/.test(indexSrc)
    );

    // A migrated v18 database and a brand-new install end up with the
    // identical reminders shape - the same test O/M3/N3 pattern, but here both
    // paths reach it through the SAME ALTER statements (not a shared CREATE),
    // since createSchemaV1 replays V19_REMINDERS_COLUMNS unconditionally right
    // after building the table from V17_CREATE (see lib/db/index.ts) - so the
    // DDL text itself should also match exactly, column-for-column, in the
    // same order.
    const migrated = makeV15Database();
    await migrateToV16(adapt(migrated));
    await migrateToV17(adapt(migrated));
    await migrateToV18(adapt(migrated));
    await migrateToV19(adapt(migrated));

    const fresh = new DatabaseSync(":memory:");
    for (const statement of V17_CREATE) fresh.exec(statement);
    for (const col of V19_REMINDERS_COLUMNS) {
      fresh.exec(`ALTER TABLE reminders ADD COLUMN ${col.name} ${col.type};`);
    }

    eq(
      "reminders has the same columns as a fresh install",
      [...columns(migrated, "reminders").keys()].join(","),
      [...columns(fresh, "reminders").keys()].join(",")
    );
    eq(
      "reminders has the same DDL as a fresh install",
      (
        migrated
          .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='reminders';")
          .get() as { sql: string }
      ).sql,
      (
        fresh
          .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='reminders';")
          .get() as { sql: string }
      ).sql
    );
    migrated.close();
    fresh.close();
  }

  // ── O4. bridgeLegacyReminders now scopes its seeds to a profile (v19) ──────
  section("O4. the legacy-reminders bridge assigns profile_id to what it seeds");
  {
    const legacyPrefs = (
      over: Partial<LegacyReminderPrefs> = {}
    ): LegacyReminderPrefs => ({
      basal: true,
      basalTime: "22:00",
      med: false,
      medTime: "09:00",
      glucose: true,
      glucoseTime: "08:00",
      ...over,
    });

    function makeV19BridgeDatabase(): DatabaseSync {
      const db = new DatabaseSync(":memory:");
      for (const statement of V14_CREATE) db.exec(statement);
      for (const statement of V17_CREATE) db.exec(statement);
      for (const col of V19_REMINDERS_COLUMNS) {
        db.exec(`ALTER TABLE reminders ADD COLUMN ${col.name} ${col.type};`);
      }
      return db;
    }

    // A fresh v19 install bridging for the first time: every seeded row
    // carries the active profile it was given, not NULL.
    {
      const db = makeV19BridgeDatabase();
      const ids = ["seed-a", "seed-b"];
      let n = 0;
      const ran = await bridgeLegacyReminders(
        adapt(db),
        legacyPrefs(),
        () => ids[n++],
        () => 1_753_600_000_000,
        "p1"
      );
      ok("the bridge still runs", ran);
      const rows = db
        .prepare("SELECT type, profile_id AS p FROM reminders ORDER BY sort;")
        .all() as { type: string; p: string | null }[];
      eq("basal and glucose are seeded", rows.length, 2);
      ok(
        "every seeded row carries the given profile - none orphaned",
        rows.every((r) => r.p === "p1")
      );
      db.close();
    }

    // The per-type dedupe check is scoped to the SAME profile it is given: a
    // basal row already written for profile p1 (by syncBasalReminderRow,
    // before the bridge ever runs - see ./reminders.ts) must block a
    // duplicate when the bridge is asked to seed for p1 too.
    {
      const db = makeV19BridgeDatabase();
      db.exec(
        `INSERT INTO reminders (id, type, label, time, enabled, sort, created_at, profile_id)
         VALUES ('own-basal', 'basal', NULL, '21:00', 1, 0, 1, 'p1');`
      );
      const ran = await bridgeLegacyReminders(
        adapt(db),
        legacyPrefs({ glucose: false }),
        () => "should-not-run-basal",
        undefined,
        "p1"
      );
      ok("the bridge still runs (the flag was never set on this scratch db)", ran);
      eq(
        "p1's own pre-existing basal row blocks the duplicate - no new row",
        count(db, "reminders"),
        1
      );
      db.close();
    }

    // ...but must NOT block a DIFFERENT profile from getting its own row: the
    // dedupe check is scoped per profile, not global (mirrors the meds
    // table's own per-profile UNIQUE constraint reasoning - see N above).
    {
      const db = makeV19BridgeDatabase();
      db.exec(
        `INSERT INTO reminders (id, type, label, time, enabled, sort, created_at, profile_id)
         VALUES ('own-basal', 'basal', NULL, '21:00', 1, 0, 1, 'p1');`
      );
      const ran = await bridgeLegacyReminders(
        adapt(db),
        legacyPrefs({ glucose: false }),
        () => "p2-basal-seed",
        undefined,
        "p2"
      );
      ok("the bridge runs for the second profile", ran);
      eq("p2 gets its own basal row alongside p1's", count(db, "reminders"), 2);
      const p2Row = db
        .prepare("SELECT profile_id AS p FROM reminders WHERE id='p2-basal-seed';")
        .get() as { p: string | null } | undefined;
      eq("and it is owned by p2, not p1", p2Row?.p, "p2");
      db.close();
    }
  }

  // ── O5. One-time profile-scope adoption (adoptOrphanReminders, v19) ────────
  section("O5. adoptOrphanReminders: one-time hand-off of orphaned rows");
  {
    function makeAdoptionDatabase(): DatabaseSync {
      const db = new DatabaseSync(":memory:");
      for (const statement of V14_CREATE) db.exec(statement);
      for (const statement of V17_CREATE) db.exec(statement);
      for (const col of V19_REMINDERS_COLUMNS) {
        db.exec(`ALTER TABLE reminders ADD COLUMN ${col.name} ${col.type};`);
      }
      return db;
    }

    // The core case: a device that has used the app since before v19 has real
    // rows with profile_id NULL (the ALTER's backfill). The first call with a
    // resolvable active profile adopts every one of them.
    {
      const db = makeAdoptionDatabase();
      db.exec(
        `INSERT INTO reminders (id, type, label, time, enabled, sort, created_at, profile_id) VALUES
           ('leg-basal', 'basal', NULL, '22:00', 1, 0, 1, NULL),
           ('leg-med', 'med', NULL, '09:00', 1, 1, 2, NULL),
           ('leg-custom', 'custom', 'Su iç', '12:00', 0, 2, 3, NULL);`
      );

      const ran = await adoptOrphanReminders(adapt(db), "p1");
      ok("the first call (with a profile) adopts and confirms", ran);
      const owners = db.prepare("SELECT DISTINCT profile_id AS p FROM reminders;").all() as {
        p: string | null;
      }[];
      eq("every orphaned row now belongs to the same one profile", owners.length, 1);
      eq("and it is the profile that was given", owners[0]?.p, "p1");
      const flag = db.prepare(V14_READ_META).get(REMINDERS_PROFILE_SCOPE_KEY) as
        | { value: string }
        | undefined;
      eq("the adoption marks itself done", flag?.value, "true");

      // A LATER call - even with a DIFFERENT profile - must not reassign
      // anything: the hand-off is a one-time event, not an ongoing sync.
      const ranAgain = await adoptOrphanReminders(adapt(db), "p2");
      ok("a second call reports the flag is (still) set", ranAgain);
      const stillOwner = db
        .prepare("SELECT profile_id AS p FROM reminders WHERE id='leg-basal';")
        .get() as { p: string | null };
      eq("rows already adopted into p1 stay with p1, never move to p2", stillOwner.p, "p1");
      db.close();
    }

    // No active profile yet: the hand-off must not guess, and must leave
    // itself retryable - the flag stays unset and the rows stay NULL.
    {
      const db = makeAdoptionDatabase();
      db.exec(
        `INSERT INTO reminders (id, type, label, time, enabled, sort, created_at, profile_id)
         VALUES ('leg-glucose', 'glucose', NULL, '08:00', 1, 0, 1, NULL);`
      );
      const ran = await adoptOrphanReminders(adapt(db), null);
      ok("a call with no active profile reports it could not run", !ran);
      eq(
        "the row stays orphaned",
        (
          db.prepare("SELECT profile_id AS p FROM reminders WHERE id='leg-glucose';").get() as {
            p: string | null;
          }
        ).p,
        null
      );
      ok(
        "and the flag stays unset, so a later call (once a profile exists) retries",
        db.prepare(V14_READ_META).get(REMINDERS_PROFILE_SCOPE_KEY) === undefined
      );

      // The real hand-off, run afterwards once a profile is resolvable, still
      // works correctly - nothing about the failed first attempt got stuck.
      const ranNow = await adoptOrphanReminders(adapt(db), "p1");
      ok("the real hand-off recovers cleanly once a profile exists", ranNow);
      eq(
        "and adopts the row that was waiting",
        (
          db.prepare("SELECT profile_id AS p FROM reminders WHERE id='leg-glucose';").get() as {
            p: string | null;
          }
        ).p,
        "p1"
      );
      db.close();
    }

    // A mixed table (some rows already owned - created after v19 by
    // createReminder - some still orphaned from before it): only the NULL
    // ones are touched, so an already-correct ownership is never overwritten.
    {
      const db = makeAdoptionDatabase();
      db.exec(
        `INSERT INTO reminders (id, type, label, time, enabled, sort, created_at, profile_id) VALUES
           ('owned-by-p2', 'glucose', NULL, '07:00', 1, 0, 1, 'p2'),
           ('orphan', 'basal', NULL, '22:00', 1, 1, 2, NULL);`
      );
      await adoptOrphanReminders(adapt(db), "p1");
      eq(
        "a row that already had an owner keeps it",
        (
          db.prepare("SELECT profile_id AS p FROM reminders WHERE id='owned-by-p2';").get() as {
            p: string | null;
          }
        ).p,
        "p2"
      );
      eq(
        "only the orphaned row is adopted, into the active profile",
        (
          db.prepare("SELECT profile_id AS p FROM reminders WHERE id='orphan';").get() as {
            p: string | null;
          }
        ).p,
        "p1"
      );
      db.close();
    }
  }

  // ── O6. deleteProfile cascades its reminders rows (schema v19) ─────────────
  // reminders.profile_id carries no foreign key (see O. above), so
  // lib/db/profiles.ts's deleteProfile runs its own DELETE FROM reminders
  // alongside DELETE FROM user_profiles. deleteProfile itself opens a real
  // expo-sqlite database this node:sqlite-backed test cannot import, so this
  // drives the exact same statement pair directly against a v19-shaped table.
  section("O6. deleteProfile cascades its reminders rows (schema v19)");
  {
    const db = new DatabaseSync(":memory:");
    db.exec(
      `CREATE TABLE user_profiles (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL);`
    );
    for (const statement of V17_CREATE) db.exec(statement);
    for (const col of V19_REMINDERS_COLUMNS) {
      db.exec(`ALTER TABLE reminders ADD COLUMN ${col.name} ${col.type};`);
    }
    db.exec(
      `INSERT INTO user_profiles (id, name, created_at) VALUES
         ('p1', 'Me', '2026-01-01T00:00:00.000Z'),
         ('p2', 'Kid', '2026-01-02T00:00:00.000Z');`
    );
    db.exec(
      `INSERT INTO reminders (id, type, label, time, enabled, sort, created_at, profile_id) VALUES
         ('r1', 'basal', NULL, '22:00', 1, 0, 1, 'p1'),
         ('r2', 'glucose', NULL, '08:00', 1, 1, 2, 'p1'),
         ('r3', 'custom', 'Su iç', '12:00', 1, 0, 3, 'p2');`
    );

    // The exact statement pair deleteProfile now runs.
    db.exec("DELETE FROM reminders WHERE profile_id = 'p1';");
    db.exec("DELETE FROM user_profiles WHERE id = 'p1';");

    eq(
      "the deleted profile's own reminders are gone",
      (
        db.prepare("SELECT COUNT(*) AS c FROM reminders WHERE profile_id='p1';").get() as {
          c: number;
        }
      ).c,
      0
    );
    eq(
      "the other profile's reminder is untouched",
      (
        db.prepare("SELECT COUNT(*) AS c FROM reminders WHERE profile_id='p2';").get() as {
          c: number;
        }
      ).c,
      1
    );
    eq(
      "the profile row itself is gone",
      (
        db.prepare("SELECT COUNT(*) AS c FROM user_profiles WHERE id='p1';").get() as {
          c: number;
        }
      ).c,
      0
    );
    db.close();
  }

  // ── K. The chain end to end, and the interruption it used to lose data to ──
  section("K1. the full chain from every start version keeps every row");
  for (const start of [1, 8, 9, 10, 11, 14] as ChainStart[]) {
    const db = makeChainDatabase(start);
    fillChainDatabase(db, start);
    const customFoodsBefore = (
      db
        .prepare("SELECT COUNT(*) AS c FROM foods WHERE is_custom = 1;")
        .get() as { c: number }
    ).c;

    await runChain(db);

    eq(`v${start}: ends at 17`, readUserVersion(db), 17);

    eq(`v${start}: both profiles survive`, count(db, "user_profiles"), 2);
    const p1 = db
      .prepare("SELECT * FROM user_profiles WHERE id='p1';")
      .get() as Record<string, unknown>;
    eq(`v${start}: profile name`, p1.name, "Ben");
    eq(`v${start}: sensitivity factor`, p1.insulin_sensitivity_factor, 45);
    eq(`v${start}: breakfast ratio`, p1.carb_ratio_breakfast, 9);
    eq(`v${start}: fasting max`, p1.target_fasting_max, 105);
    eq(`v${start}: carb target`, p1.daily_carb_target_g, 210);
    eq(`v${start}: profile reaches the v15 columns`, p1.basal_insulin_id, null);
    eq(`v${start}: profile reaches the v16 flag`, p1.oral_meds_enabled, 0);

    eq(`v${start}: all 3 readings survive`, count(db, "sugar_logs"), 3);
    const s1 = db.prepare("SELECT * FROM sugar_logs WHERE id='s1';").get() as Record<
      string,
      unknown
    >;
    eq(`v${start}: reading value`, s1.glucose_level_mgdl, 132);
    eq(`v${start}: reading period`, s1.period_tag, "fasting");
    // A v1 install had no tags column at all; the v4 → v5 step adds it with its
    // default, so there is nothing for the chain to carry across on that path.
    eq(`v${start}: reading tags`, s1.tags, start >= 5 ? '["sport"]' : "[]");

    eq(`v${start}: all 3 meals survive`, count(db, "meal_logs"), 3);
    const m1 = db.prepare("SELECT * FROM meal_logs WHERE id='m1';").get() as Record<
      string,
      unknown
    >;
    eq(`v${start}: meal carbs`, m1.calculated_carbs_g, 37.2);
    eq(`v${start}: meal dose`, m1.insulin_dose_units, 3.5);
    eq(`v${start}: meal note`, m1.personal_note, "az tuzlu");
    eq(`v${start}: meal keeps its food`, m1.food_id, "f-mine");

    eq(`v${start}: both favourites survive`, count(db, "favorites"), 2);
    eq(
      `v${start}: the user's own food survives`,
      (
        db
          .prepare("SELECT COUNT(*) AS c FROM foods WHERE is_custom = 1;")
          .get() as { c: number }
      ).c,
      customFoodsBefore
    );

    // injection_logs is the table the chain rebuilds three times over.
    const expectedInjections = start >= 8 ? 3 : 0;
    eq(
      `v${start}: injection rows preserved`,
      count(db, "injection_logs"),
      expectedInjections
    );
    if (start >= 8) {
      eq(`v${start}: inj1 site`, injectionField(db, "inj1", "site"), "abdomen_left");
      eq(`v${start}: inj1 rotation point`, injectionField(db, "inj1", "site_point"), 3);
      eq(`v${start}: inj1 dose`, injectionField(db, "inj1", "dose_units"), 6.5);
      eq(`v${start}: inj1 type`, injectionField(db, "inj1", "insulin_type"), "bolus");
      eq(`v${start}: inj1 source`, injectionField(db, "inj1", "source"), "manual");
      eq(`v${start}: inj1 note`, injectionField(db, "inj1", "note"), "sabah");
      eq(`v${start}: inj1 meal link`, injectionField(db, "inj1", "meal_log_id"), "m1");
      eq(`v${start}: inj1 tags`, injectionField(db, "inj1", "tags"), '["sport"]');
      eq(
        `v${start}: inj2 site preserved verbatim`,
        injectionField(db, "inj2", "site"),
        start >= 9 ? "abdomen_left_upper" : "abdomen_right"
      );
      eq(`v${start}: inj2 rotation point`, injectionField(db, "inj2", "site_point"), 1);
      eq(
        `v${start}: inj3 calculator source survives`,
        injectionField(db, "inj3", "source"),
        "calculator"
      );
      eq(
        `v${start}: inj3 site`,
        injectionField(db, "inj3", "site"),
        start >= 11 ? null : "arm_left"
      );
      eq(
        `v${start}: bolus_kind exists and reads NULL`,
        injectionField(db, "inj1", "bolus_kind"),
        null
      );
    }

    // The tables later steps introduce exist afterwards whatever the start was.
    const expectedTemplates = start >= 13 ? 2 : 0;
    eq(`v${start}: templates preserved`, count(db, "meal_templates"), expectedTemplates);
    eq(
      `v${start}: template items preserved`,
      count(db, "meal_template_items"),
      start >= 13 ? 3 : 0
    );
    ok(
      `v${start}: app_meta exists`,
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='app_meta';")
        .get() !== undefined
    );
    ok(
      `v${start}: med_logs exists`,
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='med_logs';")
        .get() !== undefined
    );
    eq(`v${start}: no medication logged yet`, count(db, "med_logs"), 0);
    ok(
      `v${start}: reminders table exists`,
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='reminders';")
        .get() !== undefined
    );
    // The migration chain itself never bridges anything - lib/db/migrations.ts
    // must not depend on the notifications service (see migrateToV17's own
    // doc comment) - so a chain-only run always ends with an empty registry.
    eq(`v${start}: no reminder seeded by the migration chain itself`, count(db, "reminders"), 0);
    if (start >= 14) {
      eq(
        `v${start}: the stored catalog version survives`,
        (
          db.prepare(V14_READ_META).get(SEED_CATALOG_VERSION_KEY) as {
            value: string;
          }
        ).value,
        "3"
      );
    }
    db.close();
  }

  section("K2. an interrupted chain must not replay the injection rebuilds");
  {
    // The regression for the loss this whole change exists to close. An install
    // that has not opened the app since v8 migrates, and the process is killed
    // after the last step committed but before the closing stamp on the last line
    // of initDatabase().
    const db = makeChainDatabase(8);
    fillChainDatabase(db, 8);

    await runChain(db, { stampFinal: false });

    // Before the fix this read 8: nothing between the first step and that final
    // line recorded anything, so the schema was v17 and the database said v8.
    eq(
      "each step stamped as it landed, so the version matches the schema",
      readUserVersion(db),
      17
    );

    // The user keeps using the app for weeks on that (v17) schema.
    db.exec(
      `INSERT INTO injection_logs
         (id, profile_id, site, site_point, dose_units, insulin_type, meal_log_id,
          note, source, logged_at, tags, bolus_kind)
       VALUES ('after1','p1','thigh_left',2,3.5,'bolus',NULL,NULL,'calculator','2026-08-01T12:00:00.000Z','[]','meal'),
              ('after2','p1',NULL,NULL,18,'basal',NULL,NULL,'manual','2026-08-01T22:00:00.000Z','[]',NULL);`
    );
    db.exec("UPDATE injection_logs SET bolus_kind = 'correction' WHERE id = 'inj1';");

    // Next cold start. It must pick up from 17, not replay v9 and v11.
    await runChain(db);

    eq("the next launch still ends at 17", readUserVersion(db), 17);
    eq(
      "no injection row is lost",
      count(db, "injection_logs"),
      5
    );
    eq(
      "a bolus recorded as a meal dose keeps its kind",
      injectionField(db, "after1", "bolus_kind"),
      "meal"
    );
    eq(
      "and its rotation point",
      injectionField(db, "after1", "site_point"),
      2
    );
    eq(
      "and the fact the calculator wrote it",
      injectionField(db, "after1", "source"),
      "calculator"
    );
    eq(
      "a correction recorded on an older row keeps its kind",
      injectionField(db, "inj1", "bolus_kind"),
      "correction"
    );
    eq(
      "and that row keeps its rotation point",
      injectionField(db, "inj1", "site_point"),
      3
    );
    eq(
      "a region-less basal row stays region-less",
      injectionField(db, "after2", "site"),
      null
    );
    db.close();
  }

  section("K3. v14 → v15 preserves two profiles' rows exactly");
  {
    const db = makeChainDatabase(14);
    fillChainDatabase(db, 14);
    const before = {
      user_profiles: snapshotRows(db, "user_profiles"),
      sugar_logs: snapshotRows(db, "sugar_logs"),
      meal_logs: snapshotRows(db, "meal_logs"),
      injection_logs: snapshotRows(db, "injection_logs"),
      favorites: snapshotRows(db, "favorites"),
      foods: snapshotRows(db, "foods"),
      meal_templates: snapshotRows(db, "meal_templates"),
      meal_template_items: snapshotRows(db, "meal_template_items"),
    };

    await migrateToV15(adapt(db));

    for (const [table, rows] of Object.entries(before)) {
      sameRows(table, rows, snapshotRows(db, table));
    }
    // Both profiles are still whole and still their own.
    eq(
      "p2 keeps its own ratio",
      (
        db
          .prepare("SELECT carb_ratio_lunch AS r FROM user_profiles WHERE id='p2';")
          .get() as { r: number }
      ).r,
      16
    );
    eq(
      "p2 keeps its own reading",
      (
        db
          .prepare("SELECT glucose_level_mgdl AS g FROM sugar_logs WHERE id='s3';")
          .get() as { g: number }
      ).g,
      96
    );
    eq("the stamp landed", readUserVersion(db), 15);
    db.close();
  }

  section("K4. a downgrade and a second upgrade keep what was recorded");
  {
    const db = makeChainDatabase(14);
    fillChainDatabase(db, 14);
    await runChain(db);

    db.exec("UPDATE injection_logs SET bolus_kind = 'correction' WHERE id = 'inj1';");
    db.exec(
      "UPDATE user_profiles SET basal_insulin_id = 'glargine-u100', basal_daily_units = 22 WHERE id = 'p1';"
    );

    // The user opens an older build (which stamps SCHEMA_VERSION back down), then
    // the current one again.
    db.exec("PRAGMA user_version = 14;");
    await runChain(db);

    eq("the chain lands on 17 again", readUserVersion(db), 17);
    eq(
      "the recorded bolus kind survives the round trip",
      injectionField(db, "inj1", "bolus_kind"),
      "correction"
    );
    eq(
      "so does the profile's insulin product",
      (
        db
          .prepare("SELECT basal_insulin_id AS b FROM user_profiles WHERE id='p1';")
          .get() as { b: string | null }
      ).b,
      "glargine-u100"
    );
    eq(
      "and its daily basal dose",
      (
        db
          .prepare("SELECT basal_daily_units AS u FROM user_profiles WHERE id='p1';")
          .get() as { u: number | null }
      ).u,
      22
    );
    eq(
      "bolus_kind is still a single column",
      (
        db.prepare("PRAGMA table_info(injection_logs);").all() as { name: string }[]
      ).filter((c) => c.name === "bolus_kind").length,
      1
    );
    eq("every injection row is still there", count(db, "injection_logs"), 3);
    db.close();
  }

  section("K5. a migrated user_profiles has a fresh install's columns");
  {
    const indexSrc = readFileSync(
      join(import.meta.dirname, "..", "lib", "db", "index.ts"),
      "utf8"
    );
    // The REAL fresh-install DDL, lifted out of createSchemaV1 rather than
    // retyped, so this cannot pass against a copy that has drifted.
    const freshDdl =
      /CREATE TABLE IF NOT EXISTS user_profiles \([\s\S]*?\n {4}\);/.exec(indexSrc)?.[0] ??
      "";
    ok("createSchemaV1's user_profiles DDL was found", freshDdl.length > 0);

    const migrated = makeChainDatabase(1);
    fillChainDatabase(migrated, 1);
    await runChain(migrated);

    const fresh = new DatabaseSync(":memory:");
    fresh.exec(freshDdl);

    const migratedOrder = [...columns(migrated, "user_profiles").keys()];
    const freshOrder = [...columns(fresh, "user_profiles").keys()];
    eq(
      "the column NAME SET is identical",
      [...migratedOrder].sort().join(","),
      [...freshOrder].sort().join(",")
    );
    // Column ORDER differs on purpose and always will: ALTER TABLE ADD COLUMN can
    // only append, so a migrated table carries its columns in the order the
    // releases added them. Nothing reads by position, so only the set matters.
    ok(
      "while the column ORDER differs, as appending migrations must leave it",
      migratedOrder.join(",") !== freshOrder.join(",")
    );
    migrated.close();
    fresh.close();
  }

  section("K6. every step stamps the version it reaches, inside its own step");
  {
    // Behavioural, not textual: run each migration and read the header back.
    const v8db = makeV7Database();
    await migrateToV8(adapt(v8db));
    eq("migrateToV8 stamps 8", readUserVersion(v8db), 8);
    v8db.close();

    const v9db = makeV8InjectionDb();
    await migrateToV9(adapt(v9db));
    eq("migrateToV9 stamps 9", readUserVersion(v9db), 9);
    v9db.close();

    const v10db = new DatabaseSync(":memory:");
    v10db.exec(
      `CREATE TABLE sugar_logs (id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL,
         glucose_level_mgdl INTEGER NOT NULL, logged_at TEXT NOT NULL);`
    );
    await migrateToV10(adapt(v10db));
    eq("migrateToV10 stamps 10", readUserVersion(v10db), 10);
    // The guarded no-op path has to stamp too, or an install that already had the
    // column would replay the chain from v9 on every single launch.
    v10db.exec("PRAGMA user_version = 9;");
    await migrateToV10(adapt(v10db));
    eq("and stamps 10 again when the column already exists", readUserVersion(v10db), 10);
    v10db.close();

    const v11db = makeV9InjectionDb();
    await migrateToV11(adapt(v11db));
    eq("migrateToV11 stamps 11", readUserVersion(v11db), 11);
    v11db.close();

    const v12db = makeV12Database();
    await migrateToV12(adapt(v12db));
    eq("migrateToV12 stamps 12", readUserVersion(v12db), 12);
    v12db.close();

    const v13db = makeV13Database();
    await migrateToV13(adapt(v13db));
    eq("migrateToV13 stamps 13", readUserVersion(v13db), 13);
    v13db.close();

    const v14db = makeV14Database(0);
    await migrateToV14(adapt(v14db));
    eq("migrateToV14 stamps 14", readUserVersion(v14db), 14);
    v14db.close();

    const v15db = makeV14FullDatabase();
    await migrateToV15(adapt(v15db));
    eq("migrateToV15 stamps 15", readUserVersion(v15db), 15);

    const v16db = makeV15Database();
    await migrateToV16(adapt(v16db));
    eq("migrateToV16 stamps 16", readUserVersion(v16db), 16);
    v16db.close();

    const v17db = makeV15Database();
    await migrateToV16(adapt(v17db));
    await migrateToV17(adapt(v17db));
    eq("migrateToV17 stamps 17", readUserVersion(v17db), 17);
    v17db.close();

    // The property the whole fix rests on: SQLite keeps user_version in the
    // database header, which is journalled, so a stamp written inside a
    // transaction is undone when that transaction is. A step that fails after
    // stamping therefore cannot leave a version claiming it succeeded.
    const rollbackTarget = adapt(v15db);
    v15db.exec("PRAGMA user_version = 9;");
    let threw = false;
    try {
      await rollbackTarget.withTransactionAsync(async () => {
        await stampSchemaVersion(rollbackTarget, 15);
        throw new Error("simulated kill mid-step");
      });
    } catch {
      threw = true;
    }
    ok("a step that fails after stamping is rolled back", threw);
    eq("and the version is not advanced", readUserVersion(v15db), 9);
    v15db.close();

    // The pre-v8 steps are inline DDL in lib/db/index.ts, replayed by runChain()
    // above. These pins are what keep that replay honest.
    const indexSrc = readFileSync(
      join(import.meta.dirname, "..", "lib", "db", "index.ts"),
      "utf8"
    );
    for (const version of [2, 3, 4, 5, 7]) {
      ok(
        `the pre-v8 chain stamps ${version}`,
        new RegExp(`await stampSchemaVersion\\(db, ${version}\\);`).test(indexSrc)
      );
    }
    // The foods.source step runs OUT of version order (seedFoods reads that
    // column), so stamping 6 there would tell the next launch that v2 → v5 had
    // run when they have not. The v6 → v7 step stamps 7 for both.
    const sourceStep =
      /currentVersion >= 1 && currentVersion < 6\) \{[\s\S]*?\n {2}\}/.exec(indexSrc)?.[0] ??
      "";
    ok("the out-of-order foods.source step was found", sourceStep.length > 0);
    ok("and it deliberately stamps nothing", !/stampSchemaVersion/.test(sourceStep));
    ok(
      "6 is never stamped anywhere",
      !/stampSchemaVersion\(db, 6\)/.test(indexSrc)
    );
    // The closing stamp stays: a fresh install runs no migrateToV*, so nothing
    // else would record a version on that path.
    ok(
      "the final stamp is still there for the fresh-install path",
      /await db\.execAsync\(`PRAGMA user_version = \$\{SCHEMA_VERSION\};`\);/.test(indexSrc)
    );
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

/** A SQL string literal, for the fixtures that build statements by hand. */
function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** The versions the end-to-end chain test starts from. */
type ChainStart = 1 | 8 | 9 | 10 | 11 | 14;

function readUserVersion(db: DatabaseSync): number {
  return (db.prepare("PRAGMA user_version;").get() as { user_version: number })
    .user_version;
}

const V8_SITE_SQL =
  "'abdomen_left','abdomen_right','thigh_left','thigh_right','arm_left','arm_right','buttock_left','buttock_right'";
const V9_SITE_SQL =
  "'abdomen_left','abdomen_right','abdomen_left_upper','abdomen_right_upper'," +
  "'abdomen_left_lower','abdomen_right_lower','thigh_left','thigh_right'," +
  "'arm_left','arm_right','buttock_left','buttock_right'";

/**
 * A database shaped exactly like a real install sitting at `version`: every table
 * that existed then, with every column it had then and none it did not. Built
 * from the migration history rather than from today's schema, so the chain that
 * runs over it is the chain a long-dormant install actually gets.
 */
function makeChainDatabase(version: ChainStart): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  const at = (from: number) => version >= from;

  const profile = [
    "id TEXT PRIMARY KEY NOT NULL",
    "name TEXT NOT NULL",
    "insulin_sensitivity_factor REAL NOT NULL DEFAULT 40",
    "carb_ratio_breakfast REAL NOT NULL DEFAULT 10",
    "carb_ratio_lunch REAL NOT NULL DEFAULT 12",
    "carb_ratio_dinner REAL NOT NULL DEFAULT 12",
    "target_fasting_max INTEGER NOT NULL DEFAULT 100",
    "target_postmeal_max INTEGER NOT NULL DEFAULT 140",
    "daily_carb_target_g INTEGER NOT NULL DEFAULT 200",
  ];
  if (at(3)) profile.push("glucose_unit TEXT NOT NULL DEFAULT 'mgdl'");
  if (at(8)) {
    profile.push(
      "target_fasting_min INTEGER NOT NULL DEFAULT 80",
      "target_postmeal_min INTEGER NOT NULL DEFAULT 80",
      "hypo_threshold_mgdl INTEGER NOT NULL DEFAULT 70",
      "daily_carb_target_min_g INTEGER NOT NULL DEFAULT 160",
      "diabetes_type TEXT NOT NULL DEFAULT 'unknown'",
      "insulin_mode TEXT NOT NULL DEFAULT 'both'",
      "ratios_confirmed INTEGER NOT NULL DEFAULT 1"
    );
  }
  profile.push("created_at TEXT NOT NULL");

  const foods = [
    "id TEXT PRIMARY KEY NOT NULL",
    "name_tr TEXT NOT NULL",
    "name_en TEXT NOT NULL DEFAULT ''",
    "name_de TEXT NOT NULL DEFAULT ''",
    "name_es TEXT NOT NULL DEFAULT ''",
    "name_fr TEXT NOT NULL DEFAULT ''",
    "aliases_json TEXT NOT NULL DEFAULT '[]'",
  ];
  if (at(2)) foods.push("category TEXT NOT NULL DEFAULT 'other'");
  foods.push(
    "barcode TEXT",
    "carb_100g REAL NOT NULL DEFAULT 0",
    "glycemic_index INTEGER NOT NULL DEFAULT 0",
    "glycemic_load INTEGER NOT NULL DEFAULT 0",
    "portion_size_g REAL NOT NULL DEFAULT 100",
    "brand_name TEXT",
    "custom_notes TEXT",
    "is_custom INTEGER NOT NULL DEFAULT 0"
  );
  if (at(6)) foods.push("source TEXT");
  foods.push("created_at TEXT NOT NULL");

  const sugar = [
    "id TEXT PRIMARY KEY NOT NULL",
    "profile_id TEXT NOT NULL",
    "glucose_level_mgdl INTEGER NOT NULL",
    "period_tag TEXT NOT NULL DEFAULT 'manual' CHECK (period_tag IN ('fasting','pre_meal','post_meal_2h','bedtime','manual'))",
    "source TEXT NOT NULL DEFAULT 'manual'",
    "logged_at TEXT NOT NULL",
  ];
  if (at(5)) sugar.push("tags TEXT NOT NULL DEFAULT '[]'");
  if (at(10)) sugar.push("healthkit_uuid TEXT");
  sugar.push(
    "FOREIGN KEY (profile_id) REFERENCES user_profiles (id) ON DELETE CASCADE"
  );

  const meals = [
    "id TEXT PRIMARY KEY NOT NULL",
    "profile_id TEXT NOT NULL",
    "sugar_log_id TEXT",
    "food_id TEXT",
    "custom_food_name TEXT",
    "portion_g REAL NOT NULL DEFAULT 0",
    "calculated_carbs_g REAL NOT NULL DEFAULT 0",
    "insulin_dose_units REAL NOT NULL DEFAULT 0",
    "photo_uri_local TEXT",
    "personal_note TEXT",
    "logged_at TEXT NOT NULL",
  ];
  if (at(5)) meals.push("tags TEXT NOT NULL DEFAULT '[]'");
  if (at(13)) meals.push("meal_template_id TEXT");
  meals.push(
    "FOREIGN KEY (profile_id) REFERENCES user_profiles (id) ON DELETE CASCADE",
    "FOREIGN KEY (sugar_log_id) REFERENCES sugar_logs (id) ON DELETE SET NULL",
    "FOREIGN KEY (food_id) REFERENCES foods (id) ON DELETE SET NULL"
  );

  db.exec(`
    CREATE TABLE user_profiles (${profile.join(", ")});
    CREATE TABLE foods (${foods.join(", ")});
    CREATE TABLE sugar_logs (${sugar.join(", ")});
    CREATE TABLE meal_logs (${meals.join(", ")});
    CREATE TABLE favorites (
      id TEXT PRIMARY KEY NOT NULL,
      profile_id TEXT NOT NULL,
      food_id TEXT NOT NULL,
      UNIQUE (profile_id, food_id),
      FOREIGN KEY (profile_id) REFERENCES user_profiles (id) ON DELETE CASCADE,
      FOREIGN KEY (food_id) REFERENCES foods (id) ON DELETE CASCADE
    );
    CREATE INDEX idx_sugar_profile ON sugar_logs (profile_id, logged_at DESC);
    CREATE INDEX idx_meal_profile ON meal_logs (profile_id, logged_at DESC);
  `);

  // injection_logs only exists from v4 on. Its CHECK and its NOT NULL are what
  // each rebuild in the chain exists to change, so the fixture carries the exact
  // shape of its own era.
  if (at(8)) {
    const siteList = at(9) ? V9_SITE_SQL : V8_SITE_SQL;
    const siteCol = at(11)
      ? `site TEXT CHECK (site IS NULL OR site IN (${siteList}))`
      : `site TEXT NOT NULL CHECK (site IN (${siteList}))`;
    db.exec(`
      CREATE TABLE injection_logs (
        id TEXT PRIMARY KEY NOT NULL,
        profile_id TEXT NOT NULL,
        ${siteCol},
        site_point INTEGER CHECK (site_point IS NULL OR site_point BETWEEN 1 AND 4),
        dose_units REAL,
        insulin_type TEXT CHECK (insulin_type IN ('basal','bolus')),
        meal_log_id TEXT,
        note TEXT,
        source TEXT NOT NULL DEFAULT 'manual',
        logged_at TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        FOREIGN KEY (profile_id) REFERENCES user_profiles (id) ON DELETE CASCADE,
        FOREIGN KEY (meal_log_id) REFERENCES meal_logs (id) ON DELETE SET NULL
      );
      CREATE INDEX idx_injection_profile ON injection_logs (profile_id, logged_at DESC);
    `);
  } else {
    // The dormant stock-tracking table the v6 → v7 step exists to drop.
    db.exec("CREATE TABLE insulin_pens (id TEXT PRIMARY KEY NOT NULL);");
  }

  if (at(13)) for (const statement of V13_CREATE) db.exec(statement);
  if (at(14)) for (const statement of V14_CREATE) db.exec(statement);

  db.exec(`PRAGMA user_version = ${version};`);
  return db;
}

/** The same user data in every fixture, written through the columns of its era. */
function fillChainDatabase(db: DatabaseSync, version: ChainStart): void {
  const at = (from: number) => version >= from;
  const tags = at(5);

  db.exec(
    `INSERT INTO user_profiles
       (id, name, insulin_sensitivity_factor, carb_ratio_breakfast, carb_ratio_lunch,
        carb_ratio_dinner, target_fasting_max, target_postmeal_max, daily_carb_target_g, created_at)
     VALUES ('p1', 'Ben', 45, 9, 11, 13, 105, 145, 210, '2026-01-01T00:00:00.000Z'),
            ('p2', 'Cocuk', 60, 14, 16, 16, 110, 150, 150, '2026-01-02T00:00:00.000Z');`
  );

  const foodCols = at(2)
    ? "(id, name_tr, name_en, category, carb_100g, is_custom, created_at)"
    : "(id, name_tr, name_en, carb_100g, is_custom, created_at)";
  const cat = at(2) ? "'bakery', " : "";
  const cat2 = at(2) ? "'dishes', " : "";
  db.exec(
    `INSERT INTO foods ${foodCols} VALUES
       ('f-seed', 'Ekmek', 'Bread', ${cat}48.5, 0, '2026-01-01T00:00:00.000Z'),
       ('f-mine', 'Anneannemin böreği', 'Grandmothers borek', ${cat2}31, 1, '2026-02-02T00:00:00.000Z');`
  );

  db.exec(
    `INSERT INTO sugar_logs
       (id, profile_id, glucose_level_mgdl, period_tag, source, logged_at${tags ? ", tags" : ""})
     VALUES ('s1','p1',132,'fasting','manual','2026-07-01T07:00:00.000Z'${tags ? `,'["sport"]'` : ""}),
            ('s2','p1',188,'post_meal_2h','manual','2026-07-01T14:00:00.000Z'${tags ? ",'[]'" : ""}),
            ('s3','p2',96,'bedtime','manual','2026-07-01T22:00:00.000Z'${tags ? ",'[]'" : ""});`
  );

  db.exec(
    `INSERT INTO meal_logs
       (id, profile_id, sugar_log_id, food_id, custom_food_name, portion_g,
        calculated_carbs_g, insulin_dose_units, photo_uri_local, personal_note,
        logged_at${tags ? ", tags" : ""})
     VALUES ('m1','p1','s1','f-mine',NULL,120,37.2,3.5,NULL,'az tuzlu','2026-07-01T07:05:00.000Z'${tags ? ",'[]'" : ""}),
            ('m2','p1',NULL,NULL,'Pilav',180,62.4,5,NULL,NULL,'2026-07-01T13:00:00.000Z'${tags ? `,'["sport"]'` : ""}),
            ('m3','p2',NULL,'f-mine',NULL,60,18.6,1.5,'file:///photo.jpg',NULL,'2026-07-02T20:00:00.000Z'${tags ? ",'[]'" : ""});`
  );

  db.exec(
    `INSERT INTO favorites (id, profile_id, food_id) VALUES
       ('fav1','p1','f-mine'), ('fav2','p2','f-mine');`
  );

  if (at(8)) {
    db.exec(
      `INSERT INTO injection_logs
         (id, profile_id, site, site_point, dose_units, insulin_type, meal_log_id,
          note, source, logged_at, tags)
       VALUES
         ('inj1','p1','abdomen_left',3,6.5,'bolus','m1','sabah','manual','2026-07-01T07:10:00.000Z','["sport"]'),
         ('inj2','p1',${at(9) ? "'abdomen_left_upper'" : "'abdomen_right'"},1,14,'basal',NULL,NULL,'manual','2026-07-01T22:10:00.000Z','[]'),
         ('inj3','p2',${at(11) ? "NULL" : "'arm_left'"},NULL,4.5,'bolus',NULL,NULL,'calculator','2026-07-01T13:05:00.000Z','[]');`
    );
  }

  if (at(13)) {
    db.exec(
      `INSERT INTO meal_templates
         (id, profile_id, name, slot, sort_order, use_count, last_used_at, created_at)
       VALUES ('t1','p1','Sabah rutini','breakfast',0,4,'2026-07-28T07:00:00.000Z','2026-07-01T00:00:00.000Z'),
              ('t2','p2','Okul kahvaltisi',NULL,0,1,NULL,'2026-07-01T00:00:00.000Z');
       INSERT INTO meal_template_items
         (id, template_id, food_id, name_snapshot, carb_100g_snapshot, portion_g, carbs_g_fixed, sort_order)
       VALUES ('ti1','t1','f-seed','Ekmek',48.5,50,NULL,0),
              ('ti2','t1',NULL,'Cay',0,200,0,1),
              ('ti3','t2','f-mine','Anneannemin böreği',31,120,NULL,0);`
    );
  }
  if (at(14)) {
    db.prepare(V14_WRITE_META).run(SEED_CATALOG_VERSION_KEY, "3");
  }
}

/** Stands in for the three catalog rows the v1 → v2 re-seed writes. */
const CHAIN_SEED_STUB = [
  ["stub-1", "Ekmek", "Bread"],
  ["stub-2", "Pilav", "Rice"],
  ["stub-3", "Elma", "Apple"],
];

/**
 * seedFoods() reduced to what the chain depends on: the same "is there already a
 * catalog?" guard, three rows instead of the real array. What the real one
 * inserts, and what it refuses to touch, is covered by I8-I11.
 */
function seedStub(db: DatabaseSync): void {
  const existing = (
    db
      .prepare(
        "SELECT COUNT(*) AS c FROM foods WHERE is_custom = 0 AND source IS NULL;"
      )
      .get() as { c: number }
  ).c;
  if (existing > 0) return;
  const insert = db.prepare(
    `INSERT INTO foods (id, name_tr, name_en, category, carb_100g, is_custom, created_at)
     VALUES (?, ?, ?, 'other', 20, 0, '2026-01-01T00:00:00.000Z');`
  );
  for (const row of CHAIN_SEED_STUB) insert.run(...row);
}

/** The v3 → v4 step, verbatim from lib/db/index.ts createInjectionSchema(). */
const CHAIN_CREATE_INJECTIONS = `
  CREATE TABLE IF NOT EXISTS injection_logs (
    id TEXT PRIMARY KEY NOT NULL,
    profile_id TEXT NOT NULL,
    site TEXT
      CHECK (site IS NULL OR site IN ('abdomen_left','abdomen_right','abdomen_left_upper',
                      'abdomen_right_upper','abdomen_left_lower','abdomen_right_lower',
                      'thigh_left','thigh_right','arm_left','arm_right',
                      'buttock_left','buttock_right')),
    site_point INTEGER CHECK (site_point IS NULL OR site_point BETWEEN 1 AND 4),
    dose_units REAL,
    insulin_type TEXT CHECK (insulin_type IN ('basal','bolus')),
    meal_log_id TEXT,
    note TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    logged_at TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '[]',
    bolus_kind TEXT,
    FOREIGN KEY (profile_id) REFERENCES user_profiles (id) ON DELETE CASCADE,
    FOREIGN KEY (meal_log_id) REFERENCES meal_logs (id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_injection_profile ON injection_logs (profile_id, logged_at DESC);
  CREATE INDEX IF NOT EXISTS idx_injection_meal_log ON injection_logs (meal_log_id);
`;

/**
 * initDatabase()'s migration chain, in the same order and with the same guards.
 *
 * The v8 → v17 steps are the REAL exported functions (and therefore the REAL
 * stamps, which live inside their transactions). Only the pre-v8 steps, which are
 * inline DDL in lib/db/index.ts and cannot be imported without pulling in
 * expo-sqlite, are replayed here; K6 pins them against that file's source so this
 * copy cannot drift.
 *
 * `stampFinal: false` is the crash under test: the chain runs to the end and the
 * process dies before lib/db/index.ts's closing `PRAGMA user_version = 17`.
 */
async function runChain(
  db: DatabaseSync,
  opts: { stampFinal?: boolean } = {}
): Promise<void> {
  const target = adapt(db);
  db.exec("PRAGMA foreign_keys = ON;");
  const currentVersion = readUserVersion(db);

  if (currentVersion >= 1 && currentVersion < 6) {
    try {
      db.exec("ALTER TABLE foods ADD COLUMN source TEXT;");
    } catch {
      // column already exists, ignore
    }
  }
  if (currentVersion >= 1 && currentVersion < 2) {
    try {
      db.exec("ALTER TABLE foods ADD COLUMN category TEXT NOT NULL DEFAULT 'other';");
    } catch {
      // column already exists, ignore
    }
    db.exec("DELETE FROM foods WHERE is_custom = 0;");
    seedStub(db);
    await stampSchemaVersion(target, 2);
  }
  if (currentVersion >= 1 && currentVersion < 3) {
    try {
      db.exec(
        "ALTER TABLE user_profiles ADD COLUMN glucose_unit TEXT NOT NULL DEFAULT 'mgdl';"
      );
    } catch {
      // column already exists, ignore
    }
    await stampSchemaVersion(target, 3);
  }
  if (currentVersion >= 1 && currentVersion < 4) {
    db.exec(CHAIN_CREATE_INJECTIONS);
    await stampSchemaVersion(target, 4);
  }
  if (currentVersion >= 1 && currentVersion < 5) {
    for (const table of ["sugar_logs", "meal_logs", "injection_logs"]) {
      try {
        db.exec(`ALTER TABLE ${table} ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';`);
      } catch {
        // column already exists, ignore
      }
    }
    await stampSchemaVersion(target, 5);
  }
  if (currentVersion >= 1 && currentVersion < 7) {
    db.exec("DROP TABLE IF EXISTS insulin_pens;");
    await stampSchemaVersion(target, 7);
  }

  if (currentVersion >= 1 && currentVersion < 8) await migrateToV8(target);
  if (currentVersion >= 1 && currentVersion < 9) await migrateToV9(target);
  if (currentVersion >= 1 && currentVersion < 10) await migrateToV10(target);
  if (currentVersion >= 1 && currentVersion < 11) await migrateToV11(target);
  if (currentVersion >= 1 && currentVersion < 12) await migrateToV12(target);
  if (currentVersion >= 1 && currentVersion < 13) await migrateToV13(target);
  if (currentVersion >= 1 && currentVersion < 14) await migrateToV14(target);
  if (currentVersion >= 1 && currentVersion < 15) await migrateToV15(target);
  if (currentVersion >= 1 && currentVersion < 16) await migrateToV16(target);
  if (currentVersion >= 1 && currentVersion < 17) await migrateToV17(target);

  if (opts.stampFinal !== false) db.exec("PRAGMA user_version = 17;");
}

function count(db: DatabaseSync, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS c FROM ${table};`).get() as { c: number }).c;
}

function snapshotRows(db: DatabaseSync, table: string): Record<string, unknown>[] {
  return db.prepare(`SELECT * FROM ${table} ORDER BY id;`).all() as Record<
    string,
    unknown
  >[];
}

/** Every value a table held before must still be there, column by column. */
function sameRows(
  label: string,
  before: Record<string, unknown>[],
  after: Record<string, unknown>[]
): void {
  eq(`${label}: row count preserved`, after.length, before.length);
  let identical = true;
  for (let i = 0; i < before.length; i++) {
    for (const key of Object.keys(before[i])) {
      if (before[i][key] !== after[i]?.[key]) {
        identical = false;
        console.error(
          `  ✗ ${label} ${String(before[i].id)}.${key}: ${String(
            before[i][key]
          )} → ${String(after[i]?.[key])}`
        );
      }
    }
  }
  ok(`${label}: every stored value byte-for-byte unchanged`, identical);
}

/**
 * One column of one injection row. Returns a sentinel rather than throwing when
 * the column or the row is gone, so the loss this file is guarding against is
 * REPORTED as a failed assertion instead of taking the whole run down.
 */
function injectionField(
  db: DatabaseSync,
  id: string,
  column: string
): unknown {
  try {
    const row = db
      .prepare(`SELECT ${column} AS v FROM injection_logs WHERE id = ?;`)
      .get(id) as { v: unknown } | undefined;
    return row === undefined ? "<row gone>" : row.v;
  } catch {
    return "<column gone>";
  }
}

/** The stored catalog version, or 0 when the marker was never written. */
function readCatalogVersion(db: DatabaseSync): number {
  const row = db.prepare(V14_READ_META).get(SEED_CATALOG_VERSION_KEY) as
    | { value: string }
    | undefined;
  if (!row) return 0;
  const parsed = Number.parseInt(row.value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * The top-up, as lib/db/index.ts runs it: the same gate, the REAL
 * selectMissingFoods decision, the REAL app_meta statements. Only the batched
 * INSERT is rewritten as a plain loop, because expo-sqlite's multi-row bind has
 * no bearing on which rows end up in the table. Returns how many it inserted.
 */
function runTopUp(db: DatabaseSync): number {
  if (readCatalogVersion(db) >= SEED_CATALOG_VERSION) return 0;

  const rows = db.prepare("SELECT name_en FROM foods;").all() as {
    name_en: string | null;
  }[];
  const missing = selectMissingFoods(
    SEED_FOODS,
    rows.map((r) => r.name_en)
  );

  const insert = db.prepare(
    `INSERT INTO foods (id, name_tr, name_en, name_de, name_es, name_fr, aliases_json,
                        category, barcode, carb_100g, glycemic_index, glycemic_load,
                        portion_size_g, brand_name, custom_notes, is_custom, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL, NULL, 0, NULL, ?);`
  );
  db.exec("BEGIN;");
  try {
    missing.forEach((f, i) => {
      const aliases = JSON.stringify([
        ...new Set([f.tr, f.en, f.de, f.es, f.fr].map((n) => n.trim().toLowerCase())),
      ]);
      insert.run(
        `topup-${i}`,
        f.tr,
        f.en,
        f.de,
        f.es,
        f.fr,
        aliases,
        f.cat,
        f.carb,
        f.gi,
        Math.round((f.gi * f.carb) / 100),
        f.portion ?? 100,
        "2026-08-02T00:00:00.000Z"
      );
    });
    db.exec("COMMIT;");
  } catch (e) {
    db.exec("ROLLBACK;");
    throw e;
  }

  db.prepare(V14_WRITE_META).run(
    SEED_CATALOG_VERSION_KEY,
    String(SEED_CATALOG_VERSION)
  );
  return missing.length;
}

main();
