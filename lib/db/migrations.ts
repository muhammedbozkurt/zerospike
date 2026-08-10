import type * as SQLite from "expo-sqlite";

import {
  V8_CARB_RANGE_UPDATE,
  V8_COPY_INJECTIONS,
  V8_CREATE_INJECTIONS,
  V8_DROP_OLD,
  V8_DROP_SCRATCH,
  V8_INDEX,
  V8_PROFILE_COLUMNS,
  V8_RENAME,
} from "./v8Sql";
import {
  V9_COPY_INJECTIONS,
  V9_CREATE_INJECTIONS,
  V9_DROP_OLD,
  V9_DROP_SCRATCH,
  V9_INDEX,
  V9_RENAME,
} from "./v9Sql";
import { V10_ADD_HK_UUID } from "./v10Sql";
import {
  V11_COPY_INJECTIONS,
  V11_CREATE_INJECTIONS,
  V11_DROP_OLD,
  V11_DROP_SCRATCH,
  V11_INDEX,
  V11_RENAME,
} from "./v11Sql";
import { V12_INDEXES } from "./v12Sql";
import { V13_ADD_MEAL_TEMPLATE_ID, V13_CREATE } from "./v13Sql";
import { V14_CREATE } from "./v14Sql";
import { V15_ADD_BOLUS_KIND, V15_PROFILE_COLUMNS } from "./v15Sql";

/**
 * The schema migration bodies (R10 FAZ 4), extracted verbatim from
 * lib/db/index.ts so scripts/migration.test.ts can import and run the REAL
 * functions instead of hand-maintained copies. Behavior is byte-for-byte
 * identical to before the extraction: same SQL statement order, same PRAGMA
 * placement, same transaction boundaries. Only the function bodies moved.
 *
 * `SQLite.SQLiteDatabase` is imported as a TYPE ONLY (erased at both build time
 * and by esbuild/tsx), so this file never attempts to load the native
 * expo-sqlite module, so the same functions run unmodified against a real
 * on-device database (from lib/db/index.ts) and against the node:sqlite
 * adapter in the Node-only migration test.
 */

/**
 * The v8 migration, in one place because it touches two tables at once.
 *
 * user_profiles gains:
 *   - target_fasting_min / target_postmeal_min / hypo_threshold_mgdl, so a
 *     target is a RANGE rather than a single ceiling. Existing users get the
 *     ADA-shaped defaults (80 low end, 70 hypo) while their own *_max values
 *     are preserved untouched.
 *   - daily_carb_target_min_g, derived from the existing single value (x 0.8).
 *   - diabetes_type / insulin_mode / ratios_confirmed, so the onboarding answers
 *     stop being dead data. insulin_mode defaults to 'both' here (preserving the
 *     pre-v8 behaviour of showing every insulin surface); the one-time carry of
 *     the old AsyncStorage answers happens in adoptLegacyOnboardingContext().
 *     ratios_confirmed defaults to 1 for existing users: they have been running
 *     on whatever ratios are stored for a while and we cannot retroactively tell
 *     a confirmed value from a default, so we do not start nagging them.
 *
 * injection_logs is REBUILT (not altered) because the last dormant column from
 * the removed stock-tracking feature sits in a foreign-key constraint, which
 * SQLite refuses to DROP COLUMN through. The rebuild also adds site_point (the
 * FITTER 2x2 rotation point) and source.
 *
 * The whole body runs in ONE transaction and normalises rather than filters, so
 * it cannot lose an entry or leave the database without an injection_logs table.
 * The statements live in ./v8Sql.ts so scripts/migration.test.ts runs the real
 * ones. See that test for the row-preservation guarantee.
 */
export async function migrateToV8(db: SQLite.SQLiteDatabase): Promise<void> {
  // Which profile columns are missing. Read up front so no statement inside the
  // transaction below can fail: a caught "duplicate column" error mid-migration
  // is exactly the kind of thing that leaves a half-applied schema behind.
  const existing = await db.getAllAsync<{ name: string }>(
    "PRAGMA table_info(user_profiles);"
  );
  const present = new Set(existing.map((c) => c.name));
  const missing = V8_PROFILE_COLUMNS.filter((c) => !present.has(c.name));

  // PRAGMA foreign_keys is a no-op inside a transaction, so it is toggled
  // around it. Off for the table rebuild: the copy briefly has two tables
  // referencing the same rows.
  await db.execAsync("PRAGMA foreign_keys = OFF;");
  try {
    // All of it or none of it. The previous version ran DROP and RENAME as
    // separate statements with no transaction, so a crash in between left the
    // database with NO injection_logs table at all and user_version still at 7,
    // which meant the migration re-ran and failed on every subsequent launch.
    await db.withTransactionAsync(async () => {
      for (const col of missing) {
        await db.execAsync(
          `ALTER TABLE user_profiles ADD COLUMN ${col.name} ${col.type};`
        );
      }
      if (missing.some((c) => c.name === "daily_carb_target_min_g")) {
        await db.execAsync(V8_CARB_RANGE_UPDATE);
      }

      await db.execAsync(V8_DROP_SCRATCH);
      await db.execAsync(V8_CREATE_INJECTIONS);
      await db.execAsync(V8_COPY_INJECTIONS);
      await db.execAsync(V8_DROP_OLD);
      await db.execAsync(V8_RENAME);
      await db.execAsync(V8_INDEX);
    });
  } finally {
    await db.execAsync("PRAGMA foreign_keys = ON;");
  }
}

/**
 * The v8 → v9 migration: rebuild injection_logs with the widened site CHECK (the
 * abdomen quadrants). Mirrors the v8 rebuild - one transaction, foreign keys off
 * for the copy, every row preserved verbatim. The OLD abdomen_left/right values
 * are still in the CHECK, so legacy rows are copied unchanged (never rewritten
 * into a quadrant). Statements live in ./v9Sql so the migration test runs the
 * real SQL.
 */
export async function migrateToV9(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync("PRAGMA foreign_keys = OFF;");
  try {
    await db.withTransactionAsync(async () => {
      await db.execAsync(V9_DROP_SCRATCH);
      await db.execAsync(V9_CREATE_INJECTIONS);
      await db.execAsync(V9_COPY_INJECTIONS);
      await db.execAsync(V9_DROP_OLD);
      await db.execAsync(V9_RENAME);
      await db.execAsync(V9_INDEX);
    });
  } finally {
    await db.execAsync("PRAGMA foreign_keys = ON;");
  }
}

/**
 * The v9 → v10 migration: add the nullable sugar_logs.healthkit_uuid column that
 * records the Apple Health sample UUID of a mirrored manual reading. A single
 * ADD COLUMN, guarded so a re-run (older build already at v10, or the column
 * present from a fresh v10 schema) is a no-op rather than a "duplicate column"
 * throw that would leave user_version stuck. No transaction is needed for one
 * ALTER, and no row can be lost.
 */
export async function migrateToV10(db: SQLite.SQLiteDatabase): Promise<void> {
  const cols = await db.getAllAsync<{ name: string }>(
    "PRAGMA table_info(sugar_logs);"
  );
  if (cols.some((c) => c.name === "healthkit_uuid")) return;
  await db.execAsync(V10_ADD_HK_UUID);
}

/**
 * The v10 → v11 migration: rebuild injection_logs with a NULLABLE site, so a dose
 * logged without a region (the calculator's mealtime bolus) can say so instead of
 * being filed under a region the user never picked. Same shape as the v8/v9
 * rebuilds - one transaction, foreign keys off for the copy, every row preserved
 * verbatim. Statements live in ./v11Sql so the migration test runs the real SQL.
 */
export async function migrateToV11(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync("PRAGMA foreign_keys = OFF;");
  try {
    await db.withTransactionAsync(async () => {
      await db.execAsync(V11_DROP_SCRATCH);
      await db.execAsync(V11_CREATE_INJECTIONS);
      await db.execAsync(V11_COPY_INJECTIONS);
      await db.execAsync(V11_DROP_OLD);
      await db.execAsync(V11_RENAME);
      await db.execAsync(V11_INDEX);
    });
  } finally {
    await db.execAsync("PRAGMA foreign_keys = ON;");
  }
}

/**
 * The v11 → v12 migration: indexes on the foreign-key CHILD columns, so a delete
 * no longer table-scans every referencing table to enforce its referential
 * action. See ./v12Sql for which columns and why each one earns an index.
 *
 * Pure DDL over indexes: no row is read, written or moved, and every statement is
 * IF NOT EXISTS. One transaction so a kill mid-run leaves either all four indexes
 * or none, never a half-applied schema with user_version already advanced. The
 * order below matters not at all; nothing here depends on anything else.
 */
export async function migrateToV12(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const statement of V12_INDEXES) {
      await db.execAsync(statement);
    }
  });
}

/**
 * The v12 → v13 migration: the repeating-meal templates (two new tables) and the
 * nullable meal_logs.meal_template_id that records which template a logged meal
 * came from. See ./v13Sql for the shape and for why an item keeps both a live
 * food_id and a name/carb snapshot.
 *
 * Create-only plus ONE guarded ADD COLUMN: no table is rebuilt, so no row can be
 * lost or rewritten and an interrupted run leaves every existing meal exactly as
 * it was. The column check is read BEFORE the transaction (like migrateToV8), so
 * nothing inside it can throw a "duplicate column" that would leave a
 * half-applied schema with user_version already advanced; a re-run, or an install
 * that already has the column from a fresh v13 schema, is a no-op.
 */
export async function migrateToV13(db: SQLite.SQLiteDatabase): Promise<void> {
  const cols = await db.getAllAsync<{ name: string }>(
    "PRAGMA table_info(meal_logs);"
  );
  const hasColumn = cols.some((c) => c.name === "meal_template_id");

  await db.withTransactionAsync(async () => {
    for (const statement of V13_CREATE) {
      await db.execAsync(statement);
    }
    if (!hasColumn) {
      await db.execAsync(V13_ADD_MEAL_TEMPLATE_ID);
    }
  });
}

/**
 * The v13 → v14 migration: the app_meta key/value table, which is what lets the
 * food catalog reach an install that already exists. See ./v14Sql for the table
 * and ./seedVersion for the number it holds; the top-up itself is
 * syncSeedCatalog() in ./index.ts and runs after every migration has landed.
 *
 * ONE create-only statement. No existing table is read, written or rebuilt, so
 * an interrupted run cannot lose a row and a re-run is a no-op. The transaction
 * is here for the same reason v12's was: a kill mid-run must leave either the
 * table or nothing, never a half-applied schema with user_version advanced.
 */
export async function migrateToV14(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const statement of V14_CREATE) {
      await db.execAsync(statement);
    }
  });
}

/**
 * The v14 → v15 migration: the insulin product catalog columns. user_profiles
 * gains basal_daily_units / basal_insulin_id / bolus_insulin_id (which product the
 * profile uses, and their own daily basal dose); injection_logs gains bolus_kind
 * (meal vs correction). See ./v15Sql for why all four are nullable with no CHECK.
 *
 * Both column checks are read BEFORE the transaction (like migrateToV8/V13), so
 * nothing inside it can throw a "duplicate column" that would leave a
 * half-applied schema with user_version already advanced; a re-run, or an install
 * that already has the columns from a fresh v15 schema, is a no-op.
 */
export async function migrateToV15(db: SQLite.SQLiteDatabase): Promise<void> {
  const profileCols = await db.getAllAsync<{ name: string }>(
    "PRAGMA table_info(user_profiles);"
  );
  const presentOnProfile = new Set(profileCols.map((c) => c.name));
  const missingProfileCols = V15_PROFILE_COLUMNS.filter(
    (c) => !presentOnProfile.has(c.name)
  );

  const injectionCols = await db.getAllAsync<{ name: string }>(
    "PRAGMA table_info(injection_logs);"
  );
  const hasBolusKind = injectionCols.some((c) => c.name === "bolus_kind");

  await db.withTransactionAsync(async () => {
    for (const col of missingProfileCols) {
      await db.execAsync(
        `ALTER TABLE user_profiles ADD COLUMN ${col.name} ${col.type};`
      );
    }
    if (!hasBolusKind) {
      await db.execAsync(V15_ADD_BOLUS_KIND);
    }
  });
}
