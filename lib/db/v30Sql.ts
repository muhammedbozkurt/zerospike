/**
 * The schema v30 statements, dependency-free so the tests run the REAL SQL
 * against a scratch database (same arrangement as v13Sql..v29Sql).
 *
 * v30 is the sensor-reading retention. Raw readings (sugar_logs, is_cgm = 1) are
 * kept for 365 days; older ones are folded into one row per hour and source in
 * sugar_hourly (count, mean, min, max) by lib/cgm/retention.ts. Two create-only
 * tables, no existing row is touched:
 *
 *  - sugar_hourly: the hourly summary. hour_utc is the UTC hour start as an ISO
 *    string; the primary key makes a re-run merge instead of double count.
 *  - cgm_retention_state: when the fold last finished for a profile, so it runs
 *    at most once a day.
 *
 * Both cascade with the profile. Hand-typed readings (source = 'manual') are
 * never summarized or deleted: every statement below filters them out.
 */

export const CGM_RAW_KEEP_DAYS = 365;
/** The fold runs at most once per this long, per profile. */
export const CGM_RETENTION_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Rows are folded in slices of this many days, one short transaction each. */
export const CGM_RETENTION_SLICE_DAYS = 30;

export const V30_CREATE: string[] = [
  `CREATE TABLE IF NOT EXISTS sugar_hourly (
    profile_id TEXT NOT NULL,
    hour_utc TEXT NOT NULL,
    source TEXT NOT NULL,
    n INTEGER NOT NULL,
    mean REAL NOT NULL,
    min INTEGER NOT NULL,
    max INTEGER NOT NULL,
    PRIMARY KEY (profile_id, hour_utc, source),
    FOREIGN KEY (profile_id) REFERENCES user_profiles (id) ON DELETE CASCADE
  ) WITHOUT ROWID;`,
  `CREATE TABLE IF NOT EXISTS cgm_retention_state (
    profile_id TEXT PRIMARY KEY NOT NULL,
    last_run_at TEXT NOT NULL,
    FOREIGN KEY (profile_id) REFERENCES user_profiles (id) ON DELETE CASCADE
  );`,
];

/** Placeholders: profile_id. */
export const V30_SELECT_RETENTION_STATE =
  "SELECT last_run_at FROM cgm_retention_state WHERE profile_id = ?;";

/** Placeholders: profile_id, last_run_at. */
export const V30_UPSERT_RETENTION_STATE = `INSERT INTO cgm_retention_state (profile_id, last_run_at) VALUES (?, ?)
  ON CONFLICT (profile_id) DO UPDATE SET last_run_at = excluded.last_run_at;`;

/** The oldest raw sensor reading before the cutoff. Placeholders: profile_id, cutoff. */
export const V30_SELECT_OLDEST_RAW = `SELECT MIN(logged_at) AS oldest FROM sugar_logs
  WHERE profile_id = ? AND is_cgm = 1 AND source <> 'manual' AND logged_at < ?;`;

/**
 * Folds raw sensor readings in [from, to) into sugar_hourly. Merges into an
 * hour that already has a row (a slice that ended mid-hour, or a replay).
 * Placeholders: profile_id, from, to.
 */
export const V30_FOLD_SLICE = `INSERT INTO sugar_hourly (profile_id, hour_utc, source, n, mean, min, max)
  SELECT profile_id,
         strftime('%Y-%m-%dT%H:00:00.000Z', logged_at) AS hour_utc,
         source,
         COUNT(*),
         AVG(glucose_level_mgdl),
         MIN(glucose_level_mgdl),
         MAX(glucose_level_mgdl)
    FROM sugar_logs
   WHERE profile_id = ? AND is_cgm = 1 AND source <> 'manual'
     AND logged_at >= ? AND logged_at < ?
   GROUP BY hour_utc, source
  ON CONFLICT (profile_id, hour_utc, source) DO UPDATE SET
    mean = (mean * n + excluded.mean * excluded.n) / (n + excluded.n),
    n = n + excluded.n,
    min = MIN(min, excluded.min),
    max = MAX(max, excluded.max);`;

/** Placeholders: profile_id, from, to. The same predicate as V30_FOLD_SLICE. */
export const V30_DELETE_SLICE = `DELETE FROM sugar_logs
  WHERE profile_id = ? AND is_cgm = 1 AND source <> 'manual'
    AND logged_at >= ? AND logged_at < ?;`;

/**
 * The delete trigger of v28 leaves a tombstone per imported row it removes. A
 * row this old can never come back from a 30/90 day sync window, so those
 * tombstones guard nothing. Placeholders: profile_id, cutoff.
 */
export const V30_DROP_STALE_TOMBSTONES =
  "DELETE FROM health_import_tombstones WHERE profile_id = ? AND logged_at < ?;";
