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
import { V16_ADD_ORAL_MEDS_ENABLED, V16_CREATE } from "./v16Sql";
import { V17_CREATE } from "./v17Sql";
import { V18_CREATE, V18_SEED_FROM_MED_LOGS } from "./v18Sql";
import { V19_REMINDERS_COLUMNS } from "./v19Sql";
import { V20_FOODS_COLUMNS } from "./v20Sql";
import {
  V21_DEFAULT_TO_ALARM,
  V21_MARK_EXPLICIT_CHOICE,
  V21_REMINDERS_COLUMNS,
} from "./v21Sql";
import {
  V22_BACKFILL_CHUNK_SIZE,
  V22_COPY_SUGAR_LOGS,
  V22_CREATE_SUGAR_LOGS,
  V22_DROP_OLD_SUGAR_LOGS,
  V22_DROP_SCRATCH,
  V22_INJECTION_COLUMNS,
  V22_PROFILE_COLUMNS,
  V22_RENAME_SUGAR_LOGS,
  V22_SELECT_HEALTH_ROWS,
  V22_SUGAR_INDEX,
  matchesLegacyAutoPeriodTag,
} from "./v22Sql";
import {
  V23_CREATE_FOOD_PORTIONS,
  V23_CREATE_FTS,
  V23_CREATE_TRIGGERS,
  V23_DROP_FTS,
  V23_DROP_TRIGGERS,
  V23_FOODS_COLUMNS,
  V23_REBUILD_FTS,
} from "./v23Sql";
import { V24_CREATE } from "./v24Sql";
import { V25_EMPTY_DEFAULT_NAMES } from "./v25Sql";
import { V26_MEAL_COLUMNS, V26_INJECTION_COLUMNS } from "./v26Sql";
import { V27_RESET_RATIO_CONFIRMATION } from "./v27Sql";

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
 * The versions a step is allowed to stamp. A literal union rather than `number`
 * because PRAGMA takes no bound parameter and the value below is therefore
 * interpolated: typing it this way is compile-time proof that a schema version
 * can only ever be one of these constants and never anything a user reaches.
 */
export type SchemaStamp =
  | 2
  | 3
  | 4
  | 5
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14
  | 15
  | 16
  | 17
  | 18
  | 19
  | 20
  | 21
  | 22
  | 23
  | 24
  | 25
  | 26
  | 27;

/**
 * Records that the schema has reached `version`, from INSIDE the step's own
 * transaction so the step and the number that says it ran commit together.
 *
 * The chain used to write one `user_version = 15` after every step had already
 * committed. A process killed in that window (OS reclaim, force quit, crash) left
 * an install whose schema was v15 while user_version still read, say, 8 - so the
 * next launch re-ran the v9 and v11 injection_logs REBUILDS over a table that had
 * since collected real entries. Those copy lists predate bolus_kind and, through
 * v8, write site_point as NULL and source as 'manual', so every such value the
 * user had recorded in between was destroyed. Stamping per step means an
 * interrupted chain resumes at the next step instead of replaying landed ones.
 *
 * SQLite keeps user_version in the database header, which is journalled like any
 * other page: written inside a transaction it commits and rolls back with it.
 */
export async function stampSchemaVersion(
  db: SQLite.SQLiteDatabase,
  version: SchemaStamp
): Promise<void> {
  await db.execAsync(`PRAGMA user_version = ${version};`);
}

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
      await stampSchemaVersion(db, 8);
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
      await stampSchemaVersion(db, 9);
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
 * throw that would leave user_version stuck. No row can be lost.
 *
 * The one ALTER would not need a transaction on its own; the transaction is here
 * so the stamp lands with it, and so the guarded no-op case still stamps rather
 * than returning early and leaving the chain to replay from v9 forever.
 */
export async function migrateToV10(db: SQLite.SQLiteDatabase): Promise<void> {
  const cols = await db.getAllAsync<{ name: string }>(
    "PRAGMA table_info(sugar_logs);"
  );
  const hasColumn = cols.some((c) => c.name === "healthkit_uuid");

  await db.withTransactionAsync(async () => {
    if (!hasColumn) {
      await db.execAsync(V10_ADD_HK_UUID);
    }
    await stampSchemaVersion(db, 10);
  });
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
      await stampSchemaVersion(db, 11);
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
    await stampSchemaVersion(db, 12);
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
    await stampSchemaVersion(db, 13);
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
    await stampSchemaVersion(db, 14);
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
    await stampSchemaVersion(db, 15);
  });
}

/**
 * The v15 → v16 migration: oral medication tracking. The med_logs table (what
 * was taken and when) and user_profiles.oral_meds_enabled, the flag that decides
 * whether those surfaces are shown. See ./v16Sql for the shape.
 *
 * Create-only plus ONE guarded ADD COLUMN, exactly like v13: no table is
 * rebuilt, so no reading, meal or injection can be lost or rewritten by it. The
 * column check is read BEFORE the transaction (like migrateToV8/V13/V15), so
 * nothing inside it can throw a "duplicate column" that would leave a
 * half-applied schema with user_version already advanced; a re-run, or an install
 * that already has the column from a fresh v16 schema, is a no-op.
 */
export async function migrateToV16(db: SQLite.SQLiteDatabase): Promise<void> {
  const profileCols = await db.getAllAsync<{ name: string }>(
    "PRAGMA table_info(user_profiles);"
  );
  const hasOralMeds = profileCols.some((c) => c.name === "oral_meds_enabled");

  await db.withTransactionAsync(async () => {
    for (const statement of V16_CREATE) {
      await db.execAsync(statement);
    }
    if (!hasOralMeds) {
      await db.execAsync(V16_ADD_ORAL_MEDS_ENABLED);
    }
    await stampSchemaVersion(db, 16);
  });
}

/**
 * The v16 → v17 migration: the reminders registry (see ./v17Sql) - one table
 * backing every scheduled local reminder, replacing the three separate
 * boolean + "HH:MM" pairs NotificationPrefs used to carry for basal/med/glucose
 * and adding room for user-defined custom ones.
 *
 * Create-only, exactly like v14/v16: no existing table is read, written or
 * rebuilt, so nothing already stored or scheduled can be lost by it, and a
 * re-run is a no-op. The one-time move of the pre-registry settings INTO this
 * table (lib/db/remindersBridge.ts) is deliberately not part of this migration:
 * it runs from lib/services/notifications.ts instead, so initDatabase() never
 * grows a dependency on the notifications service.
 */
export async function migrateToV17(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const statement of V17_CREATE) {
      await db.execAsync(statement);
    }
    await stampSchemaVersion(db, 17);
  });
}

/**
 * The v17 → v18 migration: the meds registry (see ./v18Sql) - a per-profile
 * list of medication names the user has already typed, most-recently-used
 * first, so a repeat entry is a tap instead of retyping (lib/db/meds.ts). Two
 * parts, both idempotent, in ONE transaction: the create-only DDL (identical
 * to what a fresh install runs), then a one-time backfill of that list from
 * med_logs' distinct names (V18_SEED_FROM_MED_LOGS - INSERT OR IGNORE against
 * the table's own UNIQUE(profile_id, name) constraint, so a re-run - or a kill
 * between this step and its stamp - inserts nothing a first run already did).
 *
 * The stamp lands in the SAME transaction as the seed (stampSchemaVersion's own
 * per-step-commit rule, see the top of this file), so in practice this step
 * runs at most once per install: nothing the user does afterwards (renaming or
 * deleting a saved name through app/settings/medications.tsx) can be followed
 * by a second real run of this function - only by a re-run of the whole
 * transaction from before ANY of it, including the seed, committed.
 *
 * No med_logs row is read twice into a duplicate, and no existing table is
 * altered or rebuilt, so nothing already stored can be lost by it.
 */
export async function migrateToV18(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const statement of V18_CREATE) {
      await db.execAsync(statement);
    }
    await db.execAsync(V18_SEED_FROM_MED_LOGS);
    await stampSchemaVersion(db, 18);
  });
}

/**
 * The v18 → v19 migration: two columns on the reminders registry (see
 * ./v19Sql) - profile_id (who owns a row; NULL for every row that predates
 * this step) and alarm_enabled (the 2.2.0 AlarmKit opt-in flag; unused by any
 * UI in this wave). Two guarded ADD COLUMNs, exactly like v15/v16: no table is
 * rebuilt and no row is read or rewritten, so an interrupted run cannot cost a
 * reminder and a re-run is a no-op. The column check is read BEFORE the
 * transaction (like migrateToV8/V13/V15/V16), so nothing inside it can throw a
 * "duplicate column" that would leave a half-applied schema with user_version
 * already advanced.
 *
 * Deliberately does NOT assign the newly-NULL profile_id anywhere: which
 * profile is "active" is an application-level fact this dependency-free file
 * cannot know (see the top of this file), so that one-time hand-off is a
 * RUNTIME step instead (adoptOrphanReminders in ./remindersBridge.ts, driven
 * from lib/db/reminders.ts / lib/services/notifications.ts) - never part of
 * this migration.
 */
export async function migrateToV19(db: SQLite.SQLiteDatabase): Promise<void> {
  const cols = await db.getAllAsync<{ name: string }>(
    "PRAGMA table_info(reminders);"
  );
  const present = new Set(cols.map((c) => c.name));
  const missing = V19_REMINDERS_COLUMNS.filter((c) => !present.has(c.name));

  await db.withTransactionAsync(async () => {
    for (const col of missing) {
      await db.execAsync(
        `ALTER TABLE reminders ADD COLUMN ${col.name} ${col.type};`
      );
    }
    await stampSchemaVersion(db, 19);
  });
}

/**
 * The v19 → v20 migration: one column on the food catalogue (see ./v20Sql) -
 * `emoji`, the user's own icon for a food they can edit (app/add-food.tsx's
 * emoji grid). One guarded ADD COLUMN, exactly like v15/v16/v19: no table is
 * rebuilt and no row is read or rewritten, so an interrupted run cannot cost
 * a food and a re-run is a no-op. The column check runs BEFORE the
 * transaction (like migrateToV8/V13/V15/V16/V19), so nothing inside it can
 * throw a "duplicate column" that would leave a half-applied schema with
 * user_version already advanced.
 *
 * Every existing row (seeded or custom) starts at NULL: the seeded catalogue
 * never sets it (a seeded row is never editable), and an existing custom food
 * simply shows the same emojiFor match it always has until its owner opens it
 * and picks one - see resolveFoodEmoji in lib/foodMeta for the one place that
 * decides between the two.
 *
 * (The v20 migration itself is below missingColumns.)
 */

/**
 * The columns of `table` that are NOT there yet, out of `wanted`.
 *
 * One guard, used by the migrations AND by the fresh-install path in
 * ./index.ts. The fresh-install path used to apply its ALTERs unconditionally
 * on the reasoning that the table had just been created and could not already
 * have them - which is true right up until an install is KILLED partway
 * through. On the next launch that path runs again from the top, the CREATEs
 * are all "IF NOT EXISTS" no-ops, and the first unguarded ALTER then throws
 * "duplicate column name" on a database that will never finish setting itself
 * up. Asking first costs one PRAGMA per table and makes the whole path
 * replayable.
 */
export async function missingColumns(
  db: SQLite.SQLiteDatabase,
  table: string,
  wanted: readonly { name: string; type: string }[]
): Promise<{ name: string; type: string }[]> {
  const cols = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info(${table});`
  );
  const present = new Set(cols.map((c) => c.name));
  return wanted.filter((c) => !present.has(c.name));
}

export async function migrateToV20(db: SQLite.SQLiteDatabase): Promise<void> {
  const cols = await db.getAllAsync<{ name: string }>(
    "PRAGMA table_info(foods);"
  );
  const present = new Set(cols.map((c) => c.name));
  const missing = V20_FOODS_COLUMNS.filter((c) => !present.has(c.name));

  await db.withTransactionAsync(async () => {
    for (const col of missing) {
      await db.execAsync(
        `ALTER TABLE foods ADD COLUMN ${col.name} ${col.type};`
      );
    }
    await stampSchemaVersion(db, 20);
  });
}

/**
 * The v20 → v21 migration: reminders.alarm_user_set plus the two UPDATEs that
 * make the AlarmKit delivery the default (see ./v21Sql for the full reasoning,
 * including why the order of those two statements is load-bearing).
 *
 * One guarded ADD COLUMN, exactly like v15/v16/v19/v20 - no table is rebuilt.
 * The two UPDATEs that follow rewrite only the two alarm flags and never touch
 * a row's time, label, order or ownership, so an interrupted run cannot cost a
 * reminder. The column check runs BEFORE the transaction (like
 * migrateToV8/V13/V15/V16/V19/V20), so nothing inside it can throw a "duplicate
 * column" that would leave a half-applied schema with user_version already
 * advanced.
 *
 * Re-running is inert even without the user_version guard (which a downgrade
 * to an older build and back can defeat - see K4): both UPDATEs are tied to the
 * run that actually ADDS the column, i.e. the single moment the old default was
 * still in force. Replaying them later would re-read rows the app itself has
 * since written and mistake the new default for a user's own pick, quietly
 * making every one of them immune to any future default change.
 */
export async function migrateToV21(db: SQLite.SQLiteDatabase): Promise<void> {
  const cols = await db.getAllAsync<{ name: string }>(
    "PRAGMA table_info(reminders);"
  );
  const present = new Set(cols.map((c) => c.name));
  const missing = V21_REMINDERS_COLUMNS.filter((c) => !present.has(c.name));

  await db.withTransactionAsync(async () => {
    for (const col of missing) {
      await db.execAsync(
        `ALTER TABLE reminders ADD COLUMN ${col.name} ${col.type};`
      );
    }
    if (missing.length > 0) {
      await db.execAsync(V21_MARK_EXPLICIT_CHOICE);
      await db.execAsync(V21_DEFAULT_TO_ALARM);
    }
    await stampSchemaVersion(db, 21);
  });
}

/**
 * The v21 → v22 migration: two guarded ADD COLUMNs on user_profiles
 * (basal_insulin_other / bolus_insulin_other, see ./v22Sql), two more guarded
 * ADD COLUMNs on injection_logs (insulin_product_id / insulin_product_other -
 * the product an injection actually used, kept on the row itself so it never
 * shifts when the profile's own product choice changes later), plus a rebuild
 * of sugar_logs that widens its period_tag CHECK to accept 'unset' - the
 * value a Health import now carries instead of a guessed period (see
 * ../periodTag). SQLite cannot ALTER a CHECK constraint, so the rebuild
 * follows the exact v8/v9/v11 shape: foreign keys off, one transaction, every
 * row copied verbatim through a CHECK that is a strict superset of the old
 * one.
 *
 * The backfill that actually SETS a row to 'unset' is a separate, targeted
 * step inside the same transaction, run against the just-rebuilt table: every
 * source='health' row is read up front (before the transaction, like the
 * column-presence checks elsewhere in this file), matched against the OLD
 * hour-based guess it may still carry (matchesLegacyAutoPeriodTag), and only
 * an exact match is blanked out - a row the user has since retagged by hand no
 * longer matches the guess and is left untouched. Matching ids are updated in
 * chunks of V22_BACKFILL_CHUNK_SIZE, comfortably under SQLite's default
 * 999-bound-parameter ceiling.
 *
 * Naturally idempotent, unlike v21's default flip: once a row reads 'unset' it
 * can never again equal legacyAutoPeriodTag's output ('bedtime' / 'fasting' /
 * 'manual'), so a replay of this whole function only ever touches a row once,
 * with no separate "already ran" flag required.
 */
export async function migrateToV22(db: SQLite.SQLiteDatabase): Promise<void> {
  const profileCols = await db.getAllAsync<{ name: string }>(
    "PRAGMA table_info(user_profiles);"
  );
  const presentOnProfile = new Set(profileCols.map((c) => c.name));
  const missingProfileCols = V22_PROFILE_COLUMNS.filter(
    (c) => !presentOnProfile.has(c.name)
  );

  const injectionCols = await db.getAllAsync<{ name: string }>(
    "PRAGMA table_info(injection_logs);"
  );
  const presentOnInjection = new Set(injectionCols.map((c) => c.name));
  const missingInjectionCols = V22_INJECTION_COLUMNS.filter(
    (c) => !presentOnInjection.has(c.name)
  );

  const healthRows = await db.getAllAsync<{
    id: string;
    logged_at: string;
    period_tag: string;
  }>(V22_SELECT_HEALTH_ROWS);
  const idsToUnset = healthRows
    .filter((r) => matchesLegacyAutoPeriodTag(r.logged_at, r.period_tag))
    .map((r) => r.id);

  await db.execAsync("PRAGMA foreign_keys = OFF;");
  try {
    await db.withTransactionAsync(async () => {
      for (const col of missingProfileCols) {
        await db.execAsync(
          `ALTER TABLE user_profiles ADD COLUMN ${col.name} ${col.type};`
        );
      }
      for (const col of missingInjectionCols) {
        await db.execAsync(
          `ALTER TABLE injection_logs ADD COLUMN ${col.name} ${col.type};`
        );
      }

      await db.execAsync(V22_DROP_SCRATCH);
      await db.execAsync(V22_CREATE_SUGAR_LOGS);
      await db.execAsync(V22_COPY_SUGAR_LOGS);
      await db.execAsync(V22_DROP_OLD_SUGAR_LOGS);
      await db.execAsync(V22_RENAME_SUGAR_LOGS);
      await db.execAsync(V22_SUGAR_INDEX);

      for (let i = 0; i < idsToUnset.length; i += V22_BACKFILL_CHUNK_SIZE) {
        const chunk = idsToUnset.slice(i, i + V22_BACKFILL_CHUNK_SIZE);
        const placeholders = chunk.map(() => "?").join(",");
        await db.runAsync(
          `UPDATE sugar_logs SET period_tag = 'unset' WHERE id IN (${placeholders});`,
          chunk
        );
      }

      await stampSchemaVersion(db, 22);
    });
  } finally {
    await db.execAsync("PRAGMA foreign_keys = ON;");
  }
}

/**
 * Adds the four v23 name columns (name_it/name_pt/name_ar/name_ja) to `foods`
 * if they are not there yet. Idempotent, and the single place both
 * migrateToV23 AND any earlier step that writes to `foods` through
 * insertSeedFoods() (lib/db/index.ts's v1 → v2 re-seed, which runs BEFORE
 * migrateToV23 in the chain) must call first: insertSeedFoods() binds all ten
 * name columns unconditionally, so running it against a table that has not
 * gained these four yet throws "no such column" - and on that specific v1 → v2
 * step, which used to run its DELETE outside any transaction, the throw left
 * the catalog deleted with nothing to replace it and user_version stuck below
 * 2 forever (K1c). Same missingColumns guard as every other ALTER in this
 * file, so a kill between two of these ALTERs replays cleanly next launch.
 */
export async function ensureFoodNameColumns(
  db: SQLite.SQLiteDatabase
): Promise<void> {
  for (const col of await missingColumns(db, "foods", V23_FOODS_COLUMNS)) {
    await db.execAsync(`ALTER TABLE foods ADD COLUMN ${col.name} ${col.type};`);
  }
}

/**
 * The v22 → v23 migration: four more food name columns (name_it, name_pt,
 * name_ar, name_ja - see ./v23Sql, added through ensureFoodNameColumns above)
 * and food_portions, the per-food list of preset serving sizes. Two guarded
 * ADD COLUMNs, one CREATE TABLE IF NOT EXISTS: no existing row is read or
 * rewritten by either, so an interrupted run cannot cost a food. Unlike
 * migrateToV8/V13/V15/V16/V19/V20/V21, the column check runs INSIDE the
 * transaction here (ensureFoodNameColumns is also called from lib/db/index.ts's
 * v1 → v2 step, ahead of a DELETE it must share a transaction with - see that
 * helper's own doc) - harmless, since missingColumns is a read-only PRAGMA and
 * SQLite is single-writer, so nothing else can add the column out from under it
 * mid-transaction.
 *
 * foods_fts is a different story: FTS5 has no ALTER TABLE ADD COLUMN, so
 * widening it to the four new columns means DROP + CREATE + a full
 * repopulate from `foods` (an INSERT ... SELECT, since the table is not
 * external-content and has no automatic rebuild command), with the three
 * sync triggers dropped and recreated around it so they write the new
 * columns too. The drop is momentary and inside the same transaction as the
 * repopulate, so a reader never sees an empty search index; a kill mid-run
 * rolls the whole rebuild back and the next launch retries it from scratch.
 */
export async function migrateToV23(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.withTransactionAsync(async () => {
    await ensureFoodNameColumns(db);

    await db.execAsync(V23_CREATE_FOOD_PORTIONS);

    await db.execAsync(V23_DROP_TRIGGERS);
    await db.execAsync(V23_DROP_FTS);
    await db.execAsync(V23_CREATE_FTS);
    await db.execAsync(V23_CREATE_TRIGGERS);
    await db.execAsync(V23_REBUILD_FTS);

    await stampSchemaVersion(db, 23);
  });
}

/**
 * The v23 → v24 migration: analytics_queue, the on-device outbox of the
 * Supabase analytics sink (see ./v24Sql). Create-only DDL, identical to what a
 * fresh install runs, so no existing row is read, rewritten or lost and a
 * re-run is a no-op. The stamp lands in the same transaction as the DDL.
 */
export async function migrateToV24(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const statement of V24_CREATE) {
      await db.execAsync(statement);
    }
    await stampSchemaVersion(db, 24);
  });
}

/**
 * The v24 → v25 migration: profile names that are exactly a locale's default
 * text become '' (see ./v25Sql). Data-only UPDATE, idempotent; the stamp lands
 * in the same transaction.
 */
export async function migrateToV25(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.execAsync(V25_EMPTY_DEFAULT_NAMES);
    await stampSchemaVersion(db, 25);
  });
}

/**
 * The v25 → v26 migration: nullable health_uuid on meal_logs and
 * injection_logs (see ./v26Sql). Guarded ADD COLUMNs so a replay is a no-op,
 * stamp in the same transaction.
 */
export async function migrateToV26(db: SQLite.SQLiteDatabase): Promise<void> {
  const mealMissing = await missingColumns(db, "meal_logs", V26_MEAL_COLUMNS);
  const injectionMissing = await missingColumns(
    db,
    "injection_logs",
    V26_INJECTION_COLUMNS
  );
  await db.withTransactionAsync(async () => {
    for (const col of mealMissing) {
      await db.execAsync(`ALTER TABLE meal_logs ADD COLUMN ${col.name} ${col.type};`);
    }
    for (const col of injectionMissing) {
      await db.execAsync(
        `ALTER TABLE injection_logs ADD COLUMN ${col.name} ${col.type};`
      );
    }
    await stampSchemaVersion(db, 26);
  });
}

/**
 * The v26 → v27 migration: every profile's ratios_confirmed becomes 0 (see
 * ./v27Sql). Data-only UPDATE of one flag, idempotent, stamp in the same
 * transaction. A launch already at v27 never runs it again, so a confirmation
 * made afterwards survives every later open.
 */
export async function migrateToV27(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.execAsync(V27_RESET_RATIO_CONFIRMATION);
    await stampSchemaVersion(db, 27);
  });
}
