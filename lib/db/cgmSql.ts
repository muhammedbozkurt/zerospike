/**
 * Sensor-reading counts, kept free of expo-sqlite at module level so the SQL
 * runs under plain Node (scripts/cgmState.test.ts) against a scratch database.
 */

/** Readings in the last 24 hours that mean a sensor is feeding this profile. */
export const CGM_DETECT_MIN_READINGS = 12;
export const CGM_DETECT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Placeholders: profile_id, since (ISO). Reads idx_sugar_cgm. */
export const CGM_COUNT_SINCE_SQL =
  "SELECT COUNT(*) AS c FROM sugar_logs WHERE profile_id = ? AND is_cgm = 1 AND logged_at >= ?;";

export function cgmDetected(count: number): boolean {
  return Number.isFinite(count) && count >= CGM_DETECT_MIN_READINGS;
}

export function cgmWindowStartIso(nowMs: number): string {
  return new Date(nowMs - CGM_DETECT_WINDOW_MS).toISOString();
}

export async function countCgmReadingsSince(
  profileId: string,
  sinceIso: string
): Promise<number> {
  const { getDb } = await import("./index");
  const db = await getDb();
  const row = await db.getFirstAsync<{ c: number }>(CGM_COUNT_SINCE_SQL, [
    profileId,
    sinceIso,
  ]);
  return row?.c ?? 0;
}

/** Sensor readings this profile received in the last 24 hours. */
export async function countCgmReadingsLast24h(
  profileId: string,
  nowMs: number = Date.now()
): Promise<number> {
  return countCgmReadingsSince(profileId, cgmWindowStartIso(nowMs));
}

/** A non-sensor reading this close in time (and within the tolerance in value)
 *  to a sensor reading of ANOTHER stream is that sensor value mirrored by a
 *  second app. */
export const SENSOR_TWIN_WINDOW_SECONDS = 30;
export const SENSOR_TWIN_TOLERANCE_MGDL = 1;

/**
 * "Not a sensor twin", for a row aliased `alias` that is already known to be
 * non-sensor (is_cgm = 0). The import never drops or converts a reading for
 * being a mirror; the mirror is told apart HERE, when rows are read. A twin is a
 * non-sensor, non-typed row with a sensor row of another stream (source or app
 * differs) within 30 s and +-1 mg/dL. Typed ('manual') rows are never twins.
 * The inner lookup is one range on idx_sugar_cgm per outer row. A real
 * fingerstick that happens to land within 30 s and +-1 mg/dL of a sensor value
 * stays in the database and in Health; it only stays out of the dose path and
 * is counted inside the sensor summary in the journal (accepted limit).
 */
export function notSensorTwinSql(alias: string): string {
  const a = alias;
  return `(${a}.source = 'manual' OR NOT EXISTS (
        SELECT 1 FROM sugar_logs tw
         WHERE tw.profile_id = ${a}.profile_id AND tw.is_cgm = 1
           AND tw.logged_at BETWEEN strftime('%Y-%m-%dT%H:%M:%fZ', ${a}.logged_at, '-${SENSOR_TWIN_WINDOW_SECONDS} seconds')
                                AND strftime('%Y-%m-%dT%H:%M:%fZ', ${a}.logged_at, '+${SENSOR_TWIN_WINDOW_SECONDS} seconds')
           AND ABS(tw.glucose_level_mgdl - ${a}.glucose_level_mgdl) <= ${SENSOR_TWIN_TOLERANCE_MGDL}
           AND (tw.source IS NOT ${a}.source OR tw.source_app IS NOT ${a}.source_app)))`;
}

/**
 * Readings that may feed a dose or a duplicate prompt are typed or fingerstick
 * rows only (is_cgm = 0). A sensor value is a trend, not the measurement a
 * correction dose is worked from, and a sensor row must never be linked to a
 * meal or overwritten by the calculator. Placeholders: profile_id, since [,
 * until]. Kept here so scripts/cgmDoseIsolation.test.ts runs the exact text.
 */
export function recentManualSugarSql(withUntil: boolean): string {
  return `SELECT id, logged_at, glucose_level_mgdl FROM sugar_logs s
      WHERE s.profile_id = ? AND s.is_cgm = 0 AND s.logged_at >= ? ${withUntil ? "AND s.logged_at <= ?" : ""}
        AND ${notSensorTwinSql("s")}
      ORDER BY s.logged_at DESC;`;
}

/** Placeholders: profile_id. Imported readings that are NOT sensor rows: what
 *  the dashboard compares around a sync to tell a logged reading from a stream. */
export const COUNT_NON_CGM_HEALTH_SQL =
  "SELECT COUNT(*) AS c FROM sugar_logs WHERE profile_id = ? AND source = 'health' AND is_cgm = 0;";

export async function countNonCgmHealthRows(profileId: string): Promise<number> {
  const { getDb } = await import("./index");
  const db = await getDb();
  const row = await db.getFirstAsync<{ c: number }>(COUNT_NON_CGM_HEALTH_SQL, [profileId]);
  return row?.c ?? 0;
}

/** Placeholders: profile_id, mg/dL, from, to. */
export const MATCHING_MANUAL_SUGAR_SQL = `SELECT * FROM sugar_logs s
      WHERE s.profile_id = ? AND s.is_cgm = 0 AND s.glucose_level_mgdl = ?
        AND s.logged_at BETWEEN ? AND ?
        AND ${notSensorTwinSql("s")}
      ORDER BY s.logged_at DESC LIMIT 1;`;
