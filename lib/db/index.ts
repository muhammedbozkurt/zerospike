import * as SQLite from "expo-sqlite";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { uuid } from "../uuid";
import type { DiabetesType, InsulinMode } from "./types";
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
  migrateToV20,
  migrateToV21,
  stampSchemaVersion,
} from "./migrations";
import { V13_CREATE } from "./v13Sql";
import { V14_CREATE, V14_READ_META, V14_WRITE_META } from "./v14Sql";
import { V16_CREATE } from "./v16Sql";
import { V17_CREATE } from "./v17Sql";
import { V18_CREATE } from "./v18Sql";
import { V19_REMINDERS_COLUMNS } from "./v19Sql";
import { V20_FOODS_COLUMNS } from "./v20Sql";
import {
  V21_DEFAULT_TO_ALARM,
  V21_MARK_EXPLICIT_CHOICE,
  V21_REMINDERS_COLUMNS,
} from "./v21Sql";
import {
  SEED_CATALOG_VERSION,
  SEED_CATALOG_VERSION_KEY,
  selectMissingFoods,
} from "./seedVersion";
import type { SeedFood } from "./seed";
import i18n from "../i18n";

/** Localized default profile name (resolved at creation time / device language). */
export function defaultProfileName(): string {
  return i18n.t("profiles.defaultName");
}

const DB_NAME = "zerospike.db";
const SCHEMA_VERSION = 21;

/** Stable id for the default profile created on first launch. */
export const DEFAULT_PROFILE_ID = "00000000-0000-4000-8000-000000000001";

/** Stable id for the screenshot-only "tracking" panel profile (08-takip): a
 *  second seeded account with insulin_mode "none" / diabetes_type "none".
 *  Only ever created behind isScreenshotMode() - see ./screenshotSeed. */
export const SCREENSHOT_TRACKING_PROFILE_ID = "00000000-0000-4000-8000-000000000002";

let dbInstance: SQLite.SQLiteDatabase | null = null;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (dbInstance) return dbInstance;
  dbInstance = await SQLite.openDatabaseAsync(DB_NAME);
  return dbInstance;
}

/**
 * Initializes the database on first launch. Idempotent and safe to call on
 * every start. Creates all tables, an FTS5 search index (+ sync triggers),
 * seeds the food catalog, and ensures a default profile exists.
 */
export async function initDatabase(): Promise<void> {
  const db = await getDb();

  await db.execAsync("PRAGMA journal_mode = WAL;");
  await db.execAsync("PRAGMA foreign_keys = ON;");

  const row = await db.getFirstAsync<{ user_version: number }>(
    "PRAGMA user_version;"
  );
  const currentVersion = row?.user_version ?? 0;

  // Whether this launch wrote the whole catalog itself. If it did, the top-up at
  // the end has nothing to look for and can just record the version.
  let seededNow = false;

  // Every step below stamps the version it reaches as it lands, so a process
  // killed part way through the chain resumes at the next step on the following
  // launch instead of replaying steps that already committed. Replaying them is
  // what destroyed data: the v8/v9/v11 rebuilds copy through column lists frozen
  // at their own era, so running them a second time over a table that has since
  // reached v15 drops bolus_kind and rewrites site_point / source. See
  // stampSchemaVersion in ./migrations.
  //
  // `currentVersion` is read once and never reassigned, so the stamps cannot
  // affect which of the branches below run on THIS launch: the chain still
  // decides everything from the version the database had on entry.

  if (currentVersion < 1) {
    await createSchemaV1(db);
    await ensureDefaultProfile(db);
    seededNow = await seedFoods(db);
  }

  // v5 → v6: where a food row came from. NULL for the seeded catalog and for
  // the user's own foods; 'off' for a barcode result cached from Open Food
  // Facts so the next scan of that product works offline.
  //
  // Runs ahead of the older steps below on purpose: seedFoods() reads this
  // column, and the v1 → v2 step re-seeds.
  //
  // Deliberately NOT stamped: it is the only step out of version order, so
  // recording 6 here would tell the next launch that v2 → v5 had run when they
  // have not, and those steps would be skipped forever. The v6 → v7 step below
  // stamps 7 instead, by which point everything through v6 really has landed
  // (this ALTER runs on any launch that enters the chain below 6).
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
    seededNow = (await seedFoods(db)) || seededNow;
    // These early steps have no transaction of their own, so the stamp follows
    // the step instead of committing with it. That is enough here and only here:
    // each one is a guarded ALTER, a CREATE IF NOT EXISTS or a DROP IF EXISTS
    // that rebuilds no table and deletes no user row (the DELETE above reaches
    // only seeded catalog rows, which the same step re-inserts). A kill between
    // the step and its stamp therefore costs a repeat of the step on the next
    // launch, never a row. The rebuild steps from v8 on cannot say that, which is
    // why their stamps are inside their transactions.
    await stampSchemaVersion(db, 2);
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
    await stampSchemaVersion(db, 3);
  }

  // v3 → v4: injection-site logging (preserves existing data).
  if (currentVersion >= 1 && currentVersion < 4) {
    await createInjectionSchema(db);
    await stampSchemaVersion(db, 4);
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
    await stampSchemaVersion(db, 5);
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
    // Stamps 7, not 6: the v5 → v6 foods.source column is added by the step at
    // the top of the chain, which any launch entering below 6 has just run.
    await stampSchemaVersion(db, 7);
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

  // v10 → v11: injection_logs.site becomes nullable, so a dose logged without a
  // region (the calculator's mealtime bolus) is recorded as having none instead
  // of being stamped 'abdomen_left'. Rebuild; every row copied verbatim.
  if (currentVersion >= 1 && currentVersion < 11) {
    await migrateToV11(db);
  }

  // v11 → v12: indexes on the foreign-key CHILD columns. SQLite indexes the
  // parent side of a foreign key automatically but never the child, so every
  // delete had to table-scan the referencing tables to enforce its action
  // (meal_logs twice over, favorites, injection_logs) - and clearing a profile
  // ran three of those scans in a row. Index-only change: no row is touched.
  if (currentVersion >= 1 && currentVersion < 12) {
    await migrateToV12(db);
  }

  // v12 → v13: repeating-meal templates (meal_templates + meal_template_items)
  // and the nullable meal_logs.meal_template_id that records which template a
  // logged meal came from. Create-only plus one guarded ADD COLUMN: no table is
  // rebuilt, so no stored meal is touched (see migrateToV13 + v13Sql).
  if (currentVersion >= 1 && currentVersion < 13) {
    await migrateToV13(db);
  }

  // v13 → v14: the app_meta key/value table, which is what a food catalog
  // version can be recorded in - and therefore what lets foods added in a later
  // release reach an install that already exists. One CREATE TABLE IF NOT
  // EXISTS: nothing is read, written or rebuilt (see migrateToV14 + v14Sql).
  if (currentVersion >= 1 && currentVersion < 14) {
    await migrateToV14(db);
  }

  // v14 → v15: the insulin product catalog columns (profile's basal product +
  // dose, both insulins' product ids, and which kind a bolus injection was). Two
  // guarded ADD COLUMN passes, no table rebuilt (see migrateToV15 + v15Sql).
  if (currentVersion >= 1 && currentVersion < 15) {
    await migrateToV15(db);
  }

  // v15 → v16: oral medication tracking - the med_logs table and the
  // user_profiles.oral_meds_enabled flag that shows its surfaces. Create-only
  // plus one guarded ADD COLUMN, no table rebuilt (see migrateToV16 + v16Sql).
  if (currentVersion >= 1 && currentVersion < 16) {
    await migrateToV16(db);
  }

  // v16 → v17: the reminders registry - one table backing every scheduled local
  // reminder (basal/med/glucose/custom), replacing the three separate boolean +
  // "HH:MM" pairs NotificationPrefs used to carry. Create-only (see
  // migrateToV17 + v17Sql); the one-time move of the pre-registry settings INTO
  // this table runs from lib/services/notifications.ts, not from here.
  if (currentVersion >= 1 && currentVersion < 17) {
    await migrateToV17(db);
  }

  // v17 → v18: the meds registry - a per-profile list of medication names
  // already typed, most-recently-used first, seeded once from med_logs' own
  // distinct names. Create-only DDL plus one idempotent backfill, no existing
  // table altered or rebuilt (see migrateToV18 + v18Sql).
  if (currentVersion >= 1 && currentVersion < 18) {
    await migrateToV18(db);
  }

  // v18 → v19: reminders.profile_id (ownership; NULL until the runtime,
  // one-time hand-off - see adoptOrphanReminders in ./remindersBridge.ts) and
  // reminders.alarm_enabled (2.2.0's AlarmKit opt-in flag, unused by any UI in
  // this wave). Two guarded ADD COLUMNs, no table rebuilt (see migrateToV19 +
  // ./v19Sql).
  if (currentVersion >= 1 && currentVersion < 19) {
    await migrateToV19(db);
  }

  // v19 → v20: foods.emoji - the user's own icon for a food they can edit
  // (app/add-food.tsx's emoji grid). One guarded ADD COLUMN, no table
  // rebuilt (see migrateToV20 + ./v20Sql).
  if (currentVersion >= 1 && currentVersion < 20) {
    await migrateToV20(db);
  }

  // v20 → v21: reminders.alarm_user_set (whether the user themselves picked how
  // a reminder is delivered) plus the two UPDATEs that make the alarm the
  // default for every row they never picked for. One guarded ADD COLUMN, no
  // table rebuilt (see migrateToV21 + ./v21Sql).
  if (currentVersion >= 1 && currentVersion < 21) {
    await migrateToV21(db);
  }

  // The fresh-install stamp, and a backstop for a database that entered the chain
  // above SCHEMA_VERSION (a downgrade). createSchemaV1 builds the current shape
  // directly and no migrateToV* runs on that path, so nothing else would record a
  // version there. It is no longer what carries a MIGRATED install: every step
  // above has already stamped what it reached, so a launch killed before this
  // line resumes at the next step rather than replaying the chain.
  await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION};`);

  // Give an existing install the foods this release added. Runs last, so it can
  // count on app_meta existing whichever path got us here.
  await syncSeedCatalog(db, seededNow);

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
      -- Insulin product catalog (schema v15); all three nullable, see ./v15Sql.
      basal_daily_units REAL,
      basal_insulin_id TEXT,
      bolus_insulin_id TEXT,
      -- Oral medication surfaces on/off (schema v16), presentation only: see
      -- ./v16Sql. Never an input to any calculation.
      oral_meds_enabled INTEGER NOT NULL DEFAULT 0,
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
      -- Which meal template this row was logged from (schema v13). Provenance
      -- only, deliberately WITHOUT a foreign key: see ./v13Sql.
      meal_template_id TEXT,
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
    -- The food tab asks for one category at a time; without this the counts and
    -- every drill-down scanned the whole catalog.
    CREATE INDEX IF NOT EXISTS idx_foods_category ON foods (is_custom, category);
    -- Foreign-key CHILD columns (see ./v12Sql): SQLite never indexes these on its
    -- own, so a delete had to scan the referencing table to enforce its action.
    CREATE INDEX IF NOT EXISTS idx_meal_sugar_log ON meal_logs (sugar_log_id);
    CREATE INDEX IF NOT EXISTS idx_meal_food ON meal_logs (food_id);
    CREATE INDEX IF NOT EXISTS idx_favorites_food ON favorites (food_id);
  `);

  // The user's own icon for an editable food (schema v20, see ./v20Sql).
  // Applied unconditionally - not the guarded form migrateToV20 uses -
  // because the table was just created by the block above and can never
  // already have it; a fresh install therefore runs the exact same ALTER
  // statement, in the exact same order, that a migrated install's
  // migrateToV20 does, and ends up with byte-identical foods DDL either way.
  for (const col of V20_FOODS_COLUMNS) {
    await db.execAsync(`ALTER TABLE foods ADD COLUMN ${col.name} ${col.type};`);
  }

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

  // Repeating-meal templates (schema v13). The SAME statements the v12 → v13
  // migration runs, so a fresh install and a migrated one are the same shape.
  for (const statement of V13_CREATE) {
    await db.execAsync(statement);
  }

  // The database's own key/value facts (schema v14), from the same statements
  // the v13 → v14 migration runs. Created BEFORE the catalog is seeded, because
  // seeding is what first has a version to record.
  for (const statement of V14_CREATE) {
    await db.execAsync(statement);
  }

  // Oral medication logging (schema v16), from the SAME statements the v15 → v16
  // migration runs, so a fresh install and a migrated one are the same shape.
  for (const statement of V16_CREATE) {
    await db.execAsync(statement);
  }

  // The reminders registry (schema v17), from the SAME statements the v16 → v17
  // migration runs, so a fresh install and a migrated one are the same shape. A
  // fresh install never bridges anything (there is no legacy pref to carry): it
  // simply starts with an empty table.
  for (const statement of V17_CREATE) {
    await db.execAsync(statement);
  }

  // The meds registry (schema v18), from the SAME statements the v17 → v18
  // migration runs, so a fresh install and a migrated one are the same shape.
  // A fresh install seeds nothing (there is no med_logs history to backfill
  // from): it simply starts with an empty table.
  for (const statement of V18_CREATE) {
    await db.execAsync(statement);
  }

  // The profile-ownership + AlarmKit opt-in columns on reminders (schema v19,
  // see ./v19Sql). Applied unconditionally - not the guarded form migrateToV19
  // uses - because the table was just created by the V17_CREATE loop above and
  // can never already have them; a fresh install therefore runs the exact same
  // ALTER statements, in the exact same order, that a migrated install's
  // migrateToV19 does, and ends up with byte-identical reminders DDL either
  // way. A fresh reminders table starts empty, so there is nothing to hand off
  // to a profile (unlike a migrated table's pre-v19 rows - see
  // adoptOrphanReminders in ./remindersBridge.ts).
  for (const col of V19_REMINDERS_COLUMNS) {
    await db.execAsync(`ALTER TABLE reminders ADD COLUMN ${col.name} ${col.type};`);
  }

  // The "the user picked this themselves" marker (schema v21, see ./v21Sql),
  // applied the same unconditional way as the v19 columns above. The two
  // UPDATEs migrateToV21 runs after it are replayed here too, against a table
  // that was just created and is therefore empty: they are a guaranteed no-op,
  // and running them anyway keeps the fresh-install and migrated paths a single
  // sequence of statements rather than two that have to be kept in agreement by
  // hand.
  for (const col of V21_REMINDERS_COLUMNS) {
    await db.execAsync(`ALTER TABLE reminders ADD COLUMN ${col.name} ${col.type};`);
  }
  await db.execAsync(V21_MARK_EXPLICIT_CHOICE);
  await db.execAsync(V21_DEFAULT_TO_ALARM);

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
 *
 * `site` is nullable since v11: the calculator's mealtime bolus has no region,
 * and recording none is honest where stamping a region was not.
 *
 * `bolus_kind` (v15) records whether a bolus row was for a meal or a correction;
 * always NULL for a basal row (see logInjection/updateInjection in ./injections.ts).
 */
async function createInjectionSchema(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
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
      -- Meal vs correction bolus (schema v15), nullable: see ./v15Sql.
      bolus_kind TEXT,
      FOREIGN KEY (profile_id) REFERENCES user_profiles (id) ON DELETE CASCADE,
      FOREIGN KEY (meal_log_id) REFERENCES meal_logs (id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_injection_profile ON injection_logs (profile_id, logged_at DESC);
    -- Foreign-key child column (see ./v12Sql). Also read directly whenever a meal
    -- is deleted or its calculator bolus is looked up.
    CREATE INDEX IF NOT EXISTS idx_injection_meal_log ON injection_logs (meal_log_id);
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
    case "none":
      return "none";
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

/** Seed rows per multi-row INSERT. 13 bound values each, so a batch of 50 stays
 *  well under SQLite's 999-parameter floor on older builds. */
const SEED_BATCH_ROWS = 50;

/**
 * Inserts catalog rows. One multi-row INSERT per batch instead of one statement
 * per food: each of those was its own statement parse plus its own round trip
 * into the native layer, which is the bulk of a first launch's database time.
 * One transaction, and the foods_ai FTS trigger fires per row exactly as before.
 *
 * Only ever INSERTs. Nothing here updates or deletes, so no row the user has
 * touched can be reached by it.
 */
async function insertSeedFoods(
  db: SQLite.SQLiteDatabase,
  foods: SeedFood[]
): Promise<void> {
  const now = new Date().toISOString();

  await db.withTransactionAsync(async () => {
    for (let start = 0; start < foods.length; start += SEED_BATCH_ROWS) {
      const batch = foods.slice(start, start + SEED_BATCH_ROWS);
      const values: (string | number)[] = [];
      for (const f of batch) {
        values.push(
          uuid(),
          f.tr,
          f.en,
          f.de,
          f.es,
          f.fr,
          buildAliases([f.tr, f.en, f.de, f.es, f.fr]),
          f.cat,
          f.carb,
          f.gi,
          Math.round((f.gi * f.carb) / 100),
          f.portion ?? 100,
          now
        );
      }
      const rows = batch
        .map(() => "(?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL, NULL, 0, ?)")
        .join(", ");
      await db.runAsync(
        `INSERT INTO foods
          (id, name_tr, name_en, name_de, name_es, name_fr, aliases_json,
           category, barcode, carb_100g, glycemic_index, glycemic_load,
           portion_size_g, brand_name, custom_notes, is_custom, created_at)
         VALUES ${rows};`,
        values
      );
    }
  });
}

/** True when this call actually wrote the catalog. */
async function seedFoods(db: SQLite.SQLiteDatabase): Promise<boolean> {
  // Count only seeded rows so a re-seed after migration works even when the
  // user already has custom foods or cached barcode results (source IS NOT NULL).
  const existing = await db.getFirstAsync<{ c: number }>(
    "SELECT COUNT(*) AS c FROM foods WHERE is_custom = 0 AND source IS NULL;"
  );
  if ((existing?.c ?? 0) > 0) return false;

  // Loaded HERE, not at module scope: ./seed is a four-figure element literal
  // that used to be parsed on every single cold start to serve a branch that
  // runs once in the lifetime of an install. The early return above is now
  // reached without ever touching it.
  const { SEED_FOODS } = await import("./seed");
  await insertSeedFoods(db, SEED_FOODS);
  return true;
}

/** The stored catalog version, or 0 for an install that predates the marker. */
async function readSeedCatalogVersion(db: SQLite.SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ value: string }>(V14_READ_META, [
    SEED_CATALOG_VERSION_KEY,
  ]);
  if (!row) return 0;
  const parsed = Number.parseInt(row.value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Brings an EXISTING install up to the current food catalog.
 *
 * The catalog used to be a first-launch-only affair: seedFoods() returns the
 * moment it finds one seeded row, so every food added in a later release only
 * ever reached people who installed after it. This closes that: when the stored
 * catalog version is behind, the foods this database does not have yet are
 * inserted, and the version is recorded so the next launch does nothing.
 *
 * What it will not do, in order of how much it would cost the user to get wrong:
 *
 *   - It never UPDATEs and never DELETEs. Every statement it runs is an INSERT,
 *     so a food the user edited, renamed or corrected the carb value of cannot be
 *     reached by it, and neither can their own foods (is_custom = 1) or a cached
 *     barcode result.
 *   - It skips any catalog food whose English name already exists in the table,
 *     matched case-insensitively against ALL rows - including the user's own. A
 *     user who long ago typed in the food we are now shipping keeps theirs, and
 *     does not end up with two rows of the same name in their list.
 *   - It is best-effort. A failure here leaves the catalog exactly as it was and
 *     the version unrecorded, so the next launch tries again; it must never be
 *     the reason the app does not open.
 *
 * `justSeeded` is the fresh-install path: the whole catalog was written moments
 * ago from this same array, so there is nothing to look for and the version is
 * simply recorded. That keeps a first launch from paying for a scan that can only
 * ever find everything already present.
 */
async function syncSeedCatalog(
  db: SQLite.SQLiteDatabase,
  justSeeded: boolean
): Promise<void> {
  try {
    if (justSeeded) {
      await db.runAsync(V14_WRITE_META, [
        SEED_CATALOG_VERSION_KEY,
        String(SEED_CATALOG_VERSION),
      ]);
      return;
    }

    // The whole point of the marker: one indexed lookup on every launch after
    // the first, and ./seed is never parsed again.
    if ((await readSeedCatalogVersion(db)) >= SEED_CATALOG_VERSION) return;

    const { SEED_FOODS } = await import("./seed");

    const rows = await db.getAllAsync<{ name_en: string | null }>(
      "SELECT name_en FROM foods;"
    );
    const missing = selectMissingFoods(
      SEED_FOODS,
      rows.map((r) => r.name_en)
    );
    if (missing.length > 0) await insertSeedFoods(db, missing);

    await db.runAsync(V14_WRITE_META, [
      SEED_CATALOG_VERSION_KEY,
      String(SEED_CATALOG_VERSION),
    ]);
  } catch {
    // Best-effort: the catalog stays as it was and the next launch retries.
  }
}

/**
 * Clears the user-entered logs of ONE profile (keeps the seeded foods and every
 * profile row).
 *
 * The profile filter is not optional. This used to run unfiltered DELETEs, so a
 * parent clearing their own records also erased their child's glucose, meal and
 * injection history from a screen that named a single profile - an unrecoverable
 * loss of someone else's data. Anything that should span profiles has to be its
 * own explicitly labelled action.
 *
 * Meal templates are NOT touched: a template is a recipe the user wrote, not a
 * record of anything that happened, so clearing the history leaves what they
 * repeat intact. They go with their profile (ON DELETE CASCADE) and are removed
 * one at a time from the template list.
 */
export async function clearAllLogs(profileId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM med_logs WHERE profile_id = ?;", [profileId]);
  await db.runAsync("DELETE FROM injection_logs WHERE profile_id = ?;", [profileId]);
  await db.runAsync("DELETE FROM meal_logs WHERE profile_id = ?;", [profileId]);
  await db.runAsync("DELETE FROM sugar_logs WHERE profile_id = ?;", [profileId]);
}
