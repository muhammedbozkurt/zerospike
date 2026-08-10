/**
 * The schema v11 statements, kept dependency-free so the migration test
 * (scripts/migration.test.ts) executes the REAL SQL against a scratch database.
 *
 * v11 makes injection_logs.site NULLABLE. A mealtime bolus written by the dose
 * calculator has no region: the calculator never asks for one. It used to be
 * stamped 'abdomen_left', which put an entry the user never placed into their
 * rotation picture and inflated that region's heat. A null site records what
 * actually happened - a dose with no region - and the map counts those rows as
 * unassigned instead of attributing them to a place.
 *
 * SQLite cannot drop a NOT NULL constraint in place, so injection_logs is rebuilt
 * exactly like v8/v9: one transaction, foreign keys off for the copy, every row
 * and every column copied 1:1. Existing rows all have a site and keep it; nothing
 * is normalised, rewritten or dropped.
 */

/** The valid site list (unchanged since v9); NULL is now allowed alongside it. */
export const V11_SITE_LIST = [
  "abdomen_left",
  "abdomen_right",
  "abdomen_left_upper",
  "abdomen_right_upper",
  "abdomen_left_lower",
  "abdomen_right_lower",
  "thigh_left",
  "thigh_right",
  "arm_left",
  "arm_right",
  "buttock_left",
  "buttock_right",
] as const;

const SITE_SQL_LIST = V11_SITE_LIST.map((s) => `'${s}'`).join(",");

/** A half-finished previous attempt must not contribute rows to this one. */
export const V11_DROP_SCRATCH = "DROP TABLE IF EXISTS injection_logs_v11;";

export const V11_CREATE_INJECTIONS = `
  CREATE TABLE injection_logs_v11 (
    id TEXT PRIMARY KEY NOT NULL,
    profile_id TEXT NOT NULL,
    site TEXT
      CHECK (site IS NULL OR site IN (${SITE_SQL_LIST})),
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
 * Copies every injection verbatim. A stored site outside the known set is kept as
 * NULL rather than being forced into a region the user never chose - the entry
 * survives either way, which is the whole point of the rebuild.
 */
export const V11_COPY_INJECTIONS = `
  INSERT INTO injection_logs_v11
    (id, profile_id, site, site_point, dose_units, insulin_type, meal_log_id,
     note, source, logged_at, tags)
  SELECT
    id,
    profile_id,
    CASE WHEN site IN (${SITE_SQL_LIST}) THEN site ELSE NULL END,
    site_point,
    dose_units,
    insulin_type,
    meal_log_id,
    note,
    COALESCE(source, 'manual'),
    logged_at,
    COALESCE(tags, '[]')
  FROM injection_logs;
`;

export const V11_DROP_OLD = "DROP TABLE injection_logs;";
export const V11_RENAME =
  "ALTER TABLE injection_logs_v11 RENAME TO injection_logs;";
export const V11_INDEX =
  "CREATE INDEX IF NOT EXISTS idx_injection_profile ON injection_logs (profile_id, logged_at DESC);";
