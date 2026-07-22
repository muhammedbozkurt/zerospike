/**
 * The schema v8 statements, kept in a dependency-free module so the migration
 * test (scripts/migration.test.ts) can execute the REAL SQL against a scratch
 * database instead of a hand-copied approximation that could drift.
 */

/** Columns added to user_profiles. Checked against PRAGMA table_info first, so
 *  no statement ever fails inside the migration transaction. */
export const V8_PROFILE_COLUMNS: { name: string; type: string }[] = [
  { name: "target_fasting_min", type: "INTEGER NOT NULL DEFAULT 80" },
  { name: "target_postmeal_min", type: "INTEGER NOT NULL DEFAULT 80" },
  { name: "hypo_threshold_mgdl", type: "INTEGER NOT NULL DEFAULT 70" },
  { name: "daily_carb_target_min_g", type: "INTEGER NOT NULL DEFAULT 160" },
  { name: "diabetes_type", type: "TEXT NOT NULL DEFAULT 'unknown'" },
  { name: "insulin_mode", type: "TEXT NOT NULL DEFAULT 'both'" },
  { name: "ratios_confirmed", type: "INTEGER NOT NULL DEFAULT 1" },
];

/** Derives each profile's carb-range low end from its own single value. */
export const V8_CARB_RANGE_UPDATE =
  "UPDATE user_profiles SET daily_carb_target_min_g = CAST(daily_carb_target_g * 0.8 AS INTEGER);";

/** A half-finished previous attempt must not contribute rows to this one. */
export const V8_DROP_SCRATCH = "DROP TABLE IF EXISTS injection_logs_v8;";

export const V8_CREATE_INJECTIONS = `
  CREATE TABLE injection_logs_v8 (
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
    tags TEXT NOT NULL DEFAULT '[]',
    FOREIGN KEY (profile_id) REFERENCES user_profiles (id) ON DELETE CASCADE,
    FOREIGN KEY (meal_log_id) REFERENCES meal_logs (id) ON DELETE SET NULL
  );
`;

/**
 * Copies every injection into the v8 table.
 *
 * The values are NORMALISED rather than filtered. An earlier version used
 * INSERT OR IGNORE, which meant any row that failed the new CHECK constraints
 * was silently skipped and then destroyed with the old table: a data-loss path
 * triggered by exactly the rows most likely to be odd. Nothing is dropped now.
 *
 *  - `site` outside the eight known regions falls back to the canonical first
 *    region, so the entry survives and stays visible/editable.
 *  - `insulin_type` keeps NULL as NULL (an injection with no type recorded is a
 *    real state, and inventing "bolus" for it would fabricate active insulin).
 *    A non-null value outside basal/bolus becomes 'bolus', which is the
 *    conservative direction: IOB only ever lowers a suggested correction.
 *  - The explicit column list is what lets this run on an install that still
 *    carries the old dormant stock-tracking column and on one that never did.
 */
export const V8_COPY_INJECTIONS = `
  INSERT INTO injection_logs_v8
    (id, profile_id, site, site_point, dose_units, insulin_type, meal_log_id,
     note, source, logged_at, tags)
  SELECT
    id,
    profile_id,
    CASE WHEN site IN ('abdomen_left','abdomen_right','thigh_left','thigh_right',
                       'arm_left','arm_right','buttock_left','buttock_right')
         THEN site ELSE 'abdomen_left' END,
    NULL,
    dose_units,
    CASE WHEN insulin_type IS NULL THEN NULL
         WHEN insulin_type IN ('basal','bolus') THEN insulin_type
         ELSE 'bolus' END,
    meal_log_id,
    note,
    'manual',
    logged_at,
    COALESCE(tags, '[]')
  FROM injection_logs;
`;

export const V8_DROP_OLD = "DROP TABLE injection_logs;";
export const V8_RENAME =
  "ALTER TABLE injection_logs_v8 RENAME TO injection_logs;";
export const V8_INDEX =
  "CREATE INDEX IF NOT EXISTS idx_injection_profile ON injection_logs (profile_id, logged_at DESC);";
