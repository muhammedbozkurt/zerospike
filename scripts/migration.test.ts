/**
 * Schema v8/v9/v10/v11/v12/v13/v14 migration test.
 *
 * Builds a real v7-shaped (or v8-shaped) database, seeds it with rows that
 * exercise the edge cases, runs the REAL migrateToV8..V14 functions from
 * lib/db/migrations.ts (R10 FAZ 4, no hand-copied re-implementation), and
 * asserts every row survives and every shape is correct.
 *
 * lib/db/migrations.ts is written against expo-sqlite's async API
 * (execAsync / getAllAsync / withTransactionAsync); `adapt()` below is a thin
 * wrapper so those same functions run unmodified against node:sqlite's
 * synchronous DatabaseSync here: glue, not a second implementation.
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
    // deno-lint/tsc: only the three members above are ever called by
    // migrateToV8/V9/V10/V11; the rest of expo-sqlite's surface is unused here.
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
    ok("SCHEMA_VERSION is 14", /const SCHEMA_VERSION = 14;/.test(indexSrc));
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

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

/** A SQL string literal, for the fixtures that build statements by hand. */
function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
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
