/**
 * The schema v28 statements, dependency-free so the tests run the REAL SQL
 * against a scratch database (same arrangement as v13Sql..v27Sql).
 *
 * v28 stops the Health import from re-creating what the user removed. The
 * import dedupes against rows that exist, so a Health reading the user deleted
 * or corrected came back on the next sync, and "Verileri sil" gave the whole
 * 30/90 day window back. Two create-only tables, no existing row is touched:
 *
 *  - health_import_tombstones: the (time, value) of an imported reading that was
 *    deleted, or whose time or value was changed. Written by triggers, so every
 *    delete and edit path is covered without each caller remembering to.
 *    Deliberately no foreign key: a tombstone written while a profile's rows are
 *    cascaded away must not fail that delete (deleteProfile removes them).
 *  - health_import_floor: per profile, the moment its logs were last cleared.
 *    Samples at or before it are never imported again. A bulk clear therefore
 *    writes one row instead of one tombstone per deleted reading, and the
 *    delete trigger skips readings the floor already covers.
 *
 * Only source = 'health' rows qualify: a manual reading was never imported.
 *
 * health_import_source_delete is a one-row marker, inserted and removed inside
 * the single transaction of deleteImportedGlucose: a delete the SOURCE asked for
 * (the user removed it in Apple Health or Health Connect, or an app deleted and
 * re-wrote a sample under a new id) leaves no tombstone, so the re-written
 * sample is imported again. Only the user's own delete or edit leaves a trace.
 */

export const V28_CREATE: string[] = [
  `CREATE TABLE IF NOT EXISTS health_import_tombstones (
    profile_id TEXT NOT NULL,
    logged_at TEXT NOT NULL,
    glucose_level_mgdl INTEGER NOT NULL
  );`,
  `CREATE INDEX IF NOT EXISTS idx_health_tombstones ON health_import_tombstones (profile_id, logged_at);`,
  `CREATE TABLE IF NOT EXISTS health_import_floor (
    profile_id TEXT PRIMARY KEY NOT NULL,
    floor_at TEXT NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS health_import_source_delete (
    k INTEGER PRIMARY KEY NOT NULL
  );`,
  `CREATE TRIGGER IF NOT EXISTS trg_health_tombstone_delete
    AFTER DELETE ON sugar_logs
    WHEN OLD.source = 'health'
      AND NOT EXISTS (SELECT 1 FROM health_import_source_delete)
      AND NOT EXISTS (
        SELECT 1 FROM health_import_floor f
         WHERE f.profile_id = OLD.profile_id AND f.floor_at >= OLD.logged_at
      )
  BEGIN
    INSERT INTO health_import_tombstones (profile_id, logged_at, glucose_level_mgdl)
    VALUES (OLD.profile_id, OLD.logged_at, OLD.glucose_level_mgdl);
  END;`,
  `CREATE TRIGGER IF NOT EXISTS trg_health_tombstone_update
    AFTER UPDATE OF glucose_level_mgdl, logged_at ON sugar_logs
    WHEN OLD.source = 'health'
      AND (OLD.glucose_level_mgdl IS NOT NEW.glucose_level_mgdl OR OLD.logged_at IS NOT NEW.logged_at)
  BEGIN
    INSERT INTO health_import_tombstones (profile_id, logged_at, glucose_level_mgdl)
    VALUES (OLD.profile_id, OLD.logged_at, OLD.glucose_level_mgdl);
  END;`,
];

/** Moves a profile's import floor forward (never back). */
export const V28_UPSERT_FLOOR = `INSERT INTO health_import_floor (profile_id, floor_at) VALUES (?, ?)
  ON CONFLICT (profile_id) DO UPDATE SET floor_at = MAX(floor_at, excluded.floor_at);`;
