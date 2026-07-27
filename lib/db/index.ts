import * as SQLite from "expo-sqlite";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { uuid } from "../uuid";
import { SEED_FOODS } from "./seed";
import type { DiabetesType, InsulinMode } from "./types";
import { migrateToV8, migrateToV9, migrateToV10 } from "./migrations";
import i18n from "../i18n";

/** Localized default profile name (resolved at creation time / device language). */
export function defaultProfileName(): string {
  return i18n.t("profiles.defaultName");
}

const DB_NAME = "zerospike.db";
const SCHEMA_VERSION = 10;

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
 * seeds 562 foods once, and ensures a default profile exists.
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

  // v5 → v6: where a food row came from. NULL for the seeded catalog and for
  // the user's own foods; 'off' for a barcode result cached from Open Food
  // Facts so the next scan of that product works offline.
  //
  // Runs ahead of the older steps below on purpose: seedFoods() reads this
  // column, and the v1 → v2 step re-seeds.
  if (currentVersion >= 1 && currentVersion < 6) {
    try {
      await db.execAsync("ALTER TABLE foods ADD COLUMN source TEXT;");
    } catch {
      // column already exists, ignore
    }
  }

  // v1 → v2: add the category column and re-seed foods with categories.
  if (currentVersion >= 1 && currentVersion < 2) {
    try {
      await db.execAsync(
        "ALTER TABLE foods ADD COLUMN category TEXT NOT NULL DEFAULT 'other';"
      );
    } catch {
      // column already exists, ignore
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
      // column already exists, ignore
    }
  }

  // v3 → v4: injection-site logging (preserves existing data).
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
        // column already exists, ignore
      }
    }
  }

  // v6 → v7: the stock-tracking feature removed in R5 left one table behind.
  // Foreign keys are ON, so its ON DELETE SET NULL clears the dangling
  // references first - no injection row is deleted (data preserved).
  if (currentVersion >= 1 && currentVersion < 7) {
    try {
      await db.execAsync("DROP TABLE IF EXISTS insulin_pens;");
    } catch {
      // best-effort; the app no longer references this table either way
    }
  }

  // v7 → v8: range targets, onboarding personalization, injection rotation
  // points, and the final removal of the last dormant stock-tracking column.
  if (currentVersion >= 1 && currentVersion < 8) {
    await migrateToV8(db);
  }

  // v8 → v9: widen the injection site set (abdomen split into four quadrants).
  // Rebuilds injection_logs with the new CHECK; old abdomen_left/right rows stay
  // valid and are copied verbatim (see migrateToV9 + v9Sql).
  if (currentVersion >= 1 && currentVersion < 9) {
    await migrateToV9(db);
  }

  // v9 → v10: add the nullable sugar_logs.healthkit_uuid column (Apple Health
  // write-back mirror). A plain ADD COLUMN - no rebuild, cannot lose a row.
  if (currentVersion >= 1 && currentVersion < 10) {
    await migrateToV10(db);
  }

  await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION};`);

  // Lift the pre-v8 onboarding answers onto the profile (once, best-effort).
  await adoptLegacyOnboardingContext();
}

// migrateToV8 / migrateToV9 / migrateToV10 live in ./migrations.ts (R10 FAZ 4),
// so scripts/migration.test.ts can import and run the real functions instead
// of hand-maintained copies. See that file for the per-migration documentation.

async function createSchemaV1(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS user_profiles (
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
      source TEXT,
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
      healthkit_uuid TEXT,
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

  // Injection-site logging (shared with the v3 → v4 migration).
  await createInjectionSchema(db);
}

/**
 * Creates the injection-site logging table. Idempotent (IF NOT EXISTS) so it is
 * safe both on a fresh install and as the v3 → v4 migration step. Existing rows
 * are untouched. Migrated installs converge on this exact shape through the v8
 * table rebuild (see migrateToV8).
 *
 * `site_point` is the FITTER-style rotation point (a 2x2 quarter inside the
 * region); null on rows logged before v8, which count toward their region total
 * only. `source` marks where the row came from ('manual', or 'calculator' for
 * the bolus row the dose calculator writes alongside a meal).
 */
async function createInjectionSchema(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS injection_logs (
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
      tags TEXT NOT NULL DEFAULT '[]',
      FOREIGN KEY (profile_id) REFERENCES user_profiles (id) ON DELETE CASCADE,
      FOREIGN KEY (meal_log_id) REFERENCES meal_logs (id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_injection_profile ON injection_logs (profile_id, logged_at DESC);
  `);
}

async function ensureDefaultProfile(db: SQLite.SQLiteDatabase): Promise<void> {
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT OR IGNORE INTO user_profiles
       (id, name, insulin_sensitivity_factor, carb_ratio_breakfast,
        carb_ratio_lunch, carb_ratio_dinner, target_fasting_min,
        target_fasting_max, target_postmeal_min, target_postmeal_max,
        hypo_threshold_mgdl, daily_carb_target_g, daily_carb_target_min_g,
        created_at)
     VALUES (?, ?, 40, 10, 12, 12, 80, 100, 80, 140, 70, 200, 160, ?);`,
    [DEFAULT_PROFILE_ID, defaultProfileName(), now]
  );
}

/**
 * One-time carry of the pre-v8 onboarding answers. Before v8 the quiz wrote the
 * diabetes/insulin answers to AsyncStorage and nothing ever read them back, so
 * the profile columns start at their neutral defaults. This lifts whatever the
 * user actually answered onto the profile once, then marks itself done.
 *
 * Only ever runs against profiles still sitting on the migration default, so it
 * cannot overwrite a choice the user has since made in settings. Best-effort:
 * a failure just leaves the profile on 'both', which is the pre-v8 behaviour.
 */
export async function adoptLegacyOnboardingContext(): Promise<void> {
  const DONE_KEY = "zerospike.v8ContextAdopted";
  const DIABETES_KEY = "zerospike.diabetesContext";
  const INSULIN_KEY = "zerospike.insulinContext";
  try {
    if ((await AsyncStorage.getItem(DONE_KEY)) === "true") return;

    const [diabetesRaw, insulinRaw] = await Promise.all([
      AsyncStorage.getItem(DIABETES_KEY),
      AsyncStorage.getItem(INSULIN_KEY),
    ]);

    const db = await getDb();
    const diabetes = normalizeDiabetesType(diabetesRaw);
    if (diabetes) {
      await db.runAsync(
        "UPDATE user_profiles SET diabetes_type = ? WHERE diabetes_type = 'unknown';",
        [diabetes]
      );
    }
    const mode = normalizeInsulinMode(insulinRaw);
    if (mode) {
      await db.runAsync(
        "UPDATE user_profiles SET insulin_mode = ? WHERE insulin_mode = 'both';",
        [mode]
      );
    }

    await AsyncStorage.setItem(DONE_KEY, "true");
  } catch {
    // best-effort; the profile defaults preserve the pre-v8 behaviour
  }
}

function normalizeDiabetesType(raw: string | null): DiabetesType | null {
  switch (raw) {
    case "type1":
    case "type2":
    case "gestational":
    case "prediabetes":
      return raw;
    case "other":
      return "unknown";
    default:
      return null;
  }
}

function normalizeInsulinMode(raw: string | null): InsulinMode | null {
  switch (raw) {
    case "basal":
    case "bolus":
    case "both":
    case "none":
      return raw;
    default:
      return null;
  }
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
  // Count only seeded rows so a re-seed after migration works even when the
  // user already has custom foods or cached barcode results (source IS NOT NULL).
  const existing = await db.getFirstAsync<{ c: number }>(
    "SELECT COUNT(*) AS c FROM foods WHERE is_custom = 0 AND source IS NULL;"
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
 * Clears all user-entered logs for every profile (keeps the seeded foods and
 * the profiles).
 */
export async function clearAllLogs(): Promise<void> {
  const db = await getDb();
  await db.execAsync("DELETE FROM injection_logs;");
  await db.execAsync("DELETE FROM meal_logs;");
  await db.execAsync("DELETE FROM sugar_logs;");
}
