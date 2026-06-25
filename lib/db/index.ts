import * as SQLite from "expo-sqlite";
import { uuid } from "../uuid";
import { SEED_FOODS } from "./seed";
import i18n from "../i18n";

/** Localized default profile name (resolved at creation time / device language). */
export function defaultProfileName(): string {
  return i18n.t("profiles.defaultName");
}

const DB_NAME = "zerospike.db";
const SCHEMA_VERSION = 5;

/** Stable id for the default profile created on first launch. */
export const DEFAULT_PROFILE_ID = "00000000-0000-4000-8000-000000000001";

let dbInstance: SQLite.SQLiteDatabase | null = null;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (dbInstance) return dbInstance;
  dbInstance = await SQLite.openDatabaseAsync(DB_NAME);
  return dbInstance;
}

/**
 * Initializes the database on first launch. Idempotent and safe to call on
 * every start. Creates all tables, an FTS5 search index (+ sync triggers),
 * seeds 563 foods once, and ensures a default profile exists.
 */
export async function initDatabase(): Promise<void> {
  const db = await getDb();

  await db.execAsync("PRAGMA journal_mode = WAL;");
  await db.execAsync("PRAGMA foreign_keys = ON;");

  const row = await db.getFirstAsync<{ user_version: number }>(
    "PRAGMA user_version;"
  );
  const currentVersion = row?.user_version ?? 0;

  if (currentVersion < 1) {
    await createSchemaV1(db);
    await ensureDefaultProfile(db);
    await seedFoods(db);
  }

  // v1 → v2: add the category column and re-seed foods with categories.
  if (currentVersion >= 1 && currentVersion < 2) {
    try {
      await db.execAsync(
        "ALTER TABLE foods ADD COLUMN category TEXT NOT NULL DEFAULT 'other';"
      );
    } catch {
      // column already exists — ignore
    }
    await db.execAsync("DELETE FROM foods WHERE is_custom = 0;");
    await seedFoods(db);
  }

  // v2 → v3: per-profile glucose display unit (mg/dL default).
  if (currentVersion >= 1 && currentVersion < 3) {
    try {
      await db.execAsync(
        "ALTER TABLE user_profiles ADD COLUMN glucose_unit TEXT NOT NULL DEFAULT 'mgdl';"
      );
    } catch {
      // column already exists — ignore
    }
  }

  // v3 → v4: insulin pens + injection-site logging (preserves existing data).
  if (currentVersion >= 1 && currentVersion < 4) {
    await createInjectionSchema(db);
  }

  // v4 → v5: optional context tags on each log table.
  if (currentVersion >= 1 && currentVersion < 5) {
    for (const table of ["sugar_logs", "meal_logs", "injection_logs"]) {
      try {
        await db.execAsync(
          `ALTER TABLE ${table} ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';`
        );
      } catch {
        // column already exists — ignore
      }
    }
  }

  await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION};`);
}

async function createSchemaV1(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS user_profiles (
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

    CREATE TABLE IF NOT EXISTS foods (
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
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sugar_logs (
      id TEXT PRIMARY KEY NOT NULL,
      profile_id TEXT NOT NULL,
      glucose_level_mgdl INTEGER NOT NULL,
      period_tag TEXT NOT NULL DEFAULT 'manual'
        CHECK (period_tag IN ('fasting','pre_meal','post_meal_2h','bedtime','manual')),
      source TEXT NOT NULL DEFAULT 'manual',
      logged_at TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      FOREIGN KEY (profile_id) REFERENCES user_profiles (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS meal_logs (
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

    CREATE TABLE IF NOT EXISTS favorites (
      id TEXT PRIMARY KEY NOT NULL,
      profile_id TEXT NOT NULL,
      food_id TEXT NOT NULL,
      UNIQUE (profile_id, food_id),
      FOREIGN KEY (profile_id) REFERENCES user_profiles (id) ON DELETE CASCADE,
      FOREIGN KEY (food_id) REFERENCES foods (id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sugar_profile ON sugar_logs (profile_id, logged_at DESC);
    CREATE INDEX IF NOT EXISTS idx_meal_profile ON meal_logs (profile_id, logged_at DESC);
    CREATE INDEX IF NOT EXISTS idx_foods_barcode ON foods (barcode);
    CREATE INDEX IF NOT EXISTS idx_foods_custom ON foods (is_custom);
  `);

  // FTS5 across all five language columns + aliases, keyed by the food UUID.
  // Typing "rice", "reis" or "pilav" all match the same row.
  await db.execAsync(`
    CREATE VIRTUAL TABLE IF NOT EXISTS foods_fts USING fts5(
      food_id UNINDEXED,
      name_tr, name_en, name_de, name_es, name_fr, aliases, brand,
      tokenize = 'unicode61 remove_diacritics 2'
    );

    CREATE TRIGGER IF NOT EXISTS foods_ai AFTER INSERT ON foods BEGIN
      INSERT INTO foods_fts (food_id, name_tr, name_en, name_de, name_es, name_fr, aliases, brand)
      VALUES (new.id, new.name_tr, new.name_en, new.name_de, new.name_es, new.name_fr,
              new.aliases_json, COALESCE(new.brand_name, ''));
    END;

    CREATE TRIGGER IF NOT EXISTS foods_ad AFTER DELETE ON foods BEGIN
      DELETE FROM foods_fts WHERE food_id = old.id;
    END;

    CREATE TRIGGER IF NOT EXISTS foods_au AFTER UPDATE ON foods BEGIN
      DELETE FROM foods_fts WHERE food_id = old.id;
      INSERT INTO foods_fts (food_id, name_tr, name_en, name_de, name_es, name_fr, aliases, brand)
      VALUES (new.id, new.name_tr, new.name_en, new.name_de, new.name_es, new.name_fr,
              new.aliases_json, COALESCE(new.brand_name, ''));
    END;
  `);

  // Insulin pens + injection-site logging (shared with the v3 → v4 migration).
  await createInjectionSchema(db);
}

/**
 * Creates the insulin-pen and injection-site logging tables (schema v4).
 * Idempotent (IF NOT EXISTS) so it is safe both on a fresh install and as the
 * v3 → v4 migration step. Existing rows are untouched.
 */
async function createInjectionSchema(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS insulin_pens (
      id TEXT PRIMARY KEY NOT NULL,
      profile_id TEXT NOT NULL,
      name TEXT NOT NULL,
      insulin_type TEXT NOT NULL CHECK (insulin_type IN ('basal','bolus')),
      total_units REAL NOT NULL,
      remaining_units REAL NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      FOREIGN KEY (profile_id) REFERENCES user_profiles (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS injection_logs (
      id TEXT PRIMARY KEY NOT NULL,
      profile_id TEXT NOT NULL,
      site TEXT NOT NULL
        CHECK (site IN ('abdomen_left','abdomen_right','thigh_left','thigh_right',
                        'arm_left','arm_right','buttock_left','buttock_right')),
      dose_units REAL,
      pen_id TEXT,
      insulin_type TEXT CHECK (insulin_type IN ('basal','bolus')),
      meal_log_id TEXT,
      note TEXT,
      logged_at TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      FOREIGN KEY (profile_id) REFERENCES user_profiles (id) ON DELETE CASCADE,
      FOREIGN KEY (pen_id) REFERENCES insulin_pens (id) ON DELETE SET NULL,
      FOREIGN KEY (meal_log_id) REFERENCES meal_logs (id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_injection_profile ON injection_logs (profile_id, logged_at DESC);
    CREATE INDEX IF NOT EXISTS idx_pens_profile ON insulin_pens (profile_id, is_active);
  `);
}

async function ensureDefaultProfile(db: SQLite.SQLiteDatabase): Promise<void> {
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT OR IGNORE INTO user_profiles
       (id, name, insulin_sensitivity_factor, carb_ratio_breakfast,
        carb_ratio_lunch, carb_ratio_dinner, target_fasting_max,
        target_postmeal_max, daily_carb_target_g, created_at)
     VALUES (?, ?, 40, 10, 12, 12, 100, 140, 200, ?);`,
    [DEFAULT_PROFILE_ID, defaultProfileName(), now]
  );
}

/** Build a deduped synonym list from the five translated names. */
function buildAliases(names: string[]): string {
  const seen = new Set<string>();
  for (const n of names) {
    const key = n.trim().toLowerCase();
    if (key) seen.add(key);
  }
  return JSON.stringify([...seen]);
}

async function seedFoods(db: SQLite.SQLiteDatabase): Promise<void> {
  // Count only seeded (non-custom) rows so a re-seed after migration works
  // even when the user already has custom foods.
  const existing = await db.getFirstAsync<{ c: number }>(
    "SELECT COUNT(*) AS c FROM foods WHERE is_custom = 0;"
  );
  if ((existing?.c ?? 0) > 0) return;

  const now = new Date().toISOString();

  await db.withTransactionAsync(async () => {
    for (const f of SEED_FOODS) {
      const gl = Math.round((f.gi * f.carb) / 100);
      const aliases = buildAliases([f.tr, f.en, f.de, f.es, f.fr]);
      await db.runAsync(
        `INSERT INTO foods
          (id, name_tr, name_en, name_de, name_es, name_fr, aliases_json,
           category, barcode, carb_100g, glycemic_index, glycemic_load,
           portion_size_g, brand_name, custom_notes, is_custom, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL, NULL, 0, ?);`,
        [
          uuid(),
          f.tr,
          f.en,
          f.de,
          f.es,
          f.fr,
          aliases,
          f.cat,
          f.carb,
          f.gi,
          gl,
          f.portion ?? 100,
          now,
        ]
      );
    }
  });
}

/**
 * Clears all user-entered logs for every profile (keeps the seeded foods, the
 * profiles, and the user's insulin pens — pens are configuration, managed
 * separately in the pen UI, not wiped by a log reset).
 */
export async function clearAllLogs(): Promise<void> {
  const db = await getDb();
  await db.execAsync("DELETE FROM injection_logs;");
  await db.execAsync("DELETE FROM meal_logs;");
  await db.execAsync("DELETE FROM sugar_logs;");
}
