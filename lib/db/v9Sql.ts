/**
 * The schema v9 statements, kept dependency-free so the migration test
 * (scripts/migration.test.ts) executes the REAL SQL against a scratch database.
 *
 * v9 widens the injection site set: the abdomen is split into four quadrants
 * (upper/lower x left/right) to match the FITTER rotation guidance and the new
 * body map. SQLite cannot ALTER a CHECK constraint, so injection_logs is rebuilt
 * with the expanded CHECK, exactly like v8.
 *
 * DATA PRESERVATION: the OLD values `abdomen_left` / `abdomen_right` stay VALID
 * (they remain in the CHECK), so pre-v9 rows are copied verbatim and are never
 * rewritten into a quadrant. The map shows those legacy rows as a general
 * abdomen-left/right total. Every column is copied 1:1; nothing is normalised or
 * dropped.
 */

/** The full v9 site list, shared by the rebuild CHECK and the copy's guard. */
export const V9_SITE_LIST = [
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

const SITE_SQL_LIST = V9_SITE_LIST.map((s) => `'${s}'`).join(",");

/** A half-finished previous attempt must not contribute rows to this one. */
export const V9_DROP_SCRATCH = "DROP TABLE IF EXISTS injection_logs_v9;";

export const V9_CREATE_INJECTIONS = `
  CREATE TABLE injection_logs_v9 (
    id TEXT PRIMARY KEY NOT NULL,
    profile_id TEXT NOT NULL,
    site TEXT NOT NULL
      CHECK (site IN (${SITE_SQL_LIST})),
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
 * Copies every injection verbatim. All pre-v9 sites are still valid, so the
 * only guard is the defensive fallback for a value somehow outside the (now
 * wider) known set, which keeps the entry alive rather than failing the CHECK.
 */
export const V9_COPY_INJECTIONS = `
  INSERT INTO injection_logs_v9
    (id, profile_id, site, site_point, dose_units, insulin_type, meal_log_id,
     note, source, logged_at, tags)
  SELECT
    id,
    profile_id,
    CASE WHEN site IN (${SITE_SQL_LIST}) THEN site ELSE 'abdomen_left' END,
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

export const V9_DROP_OLD = "DROP TABLE injection_logs;";
export const V9_RENAME =
  "ALTER TABLE injection_logs_v9 RENAME TO injection_logs;";
export const V9_INDEX =
  "CREATE INDEX IF NOT EXISTS idx_injection_profile ON injection_logs (profile_id, logged_at DESC);";
