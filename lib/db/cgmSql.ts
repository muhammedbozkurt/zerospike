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

/** A non-sensor imported row is looked at against the sensor rows of ANOTHER
 *  stream this close to it. */
export const SENSOR_NEAR_WINDOW_SECONDS = 150;
/** The view-time twin test is much tighter than the dose-path proximity: a
 *  real fingerstick must show unless a sensor row of another stream sits this
 *  close with the same value. */
export const SENSOR_TWIN_WINDOW_SECONDS = 30;
export const SENSOR_TWIN_TOLERANCE_MGDL = 1;
/** How far the nearest sensor row on each side of a mirrored value may lie: a
 *  little over the 270 s the import thins a stream to. */
export const SENSOR_BRACKET_SECONDS = 330;

/** Sensor rows of another stream (source or app differs) within `windowSeconds`
 *  (default 150) of the row aliased `a`, narrowed by `extra`. One range on
 *  idx_sugar_cgm. */
function otherStreamSensorSql(
  a: string,
  extra = "",
  windowSeconds = SENSOR_NEAR_WINDOW_SECONDS
): string {
  return `SELECT 1 FROM sugar_logs tw
         WHERE tw.profile_id = ${a}.profile_id AND tw.is_cgm = 1
           AND tw.logged_at BETWEEN strftime('%Y-%m-%dT%H:%M:%fZ', ${a}.logged_at, '-${windowSeconds} seconds')
                                AND strftime('%Y-%m-%dT%H:%M:%fZ', ${a}.logged_at, '+${windowSeconds} seconds')
           AND (tw.source IS NOT ${a}.source OR tw.source_app IS NOT ${a}.source_app)${extra}`;
}

/** The nearest sensor row of another stream before (dir = -1) or after (+1)
 *  the row aliased `a`, within the bracket reach, as a scalar subquery on
 *  idx_sugar_cgm. */
function neighbourSensorSql(a: string, dir: -1 | 1): string {
  const edge =
    dir < 0
      ? `tw.logged_at <= ${a}.logged_at AND tw.logged_at >= strftime('%Y-%m-%dT%H:%M:%fZ', ${a}.logged_at, '-${SENSOR_BRACKET_SECONDS} seconds')`
      : `tw.logged_at >= ${a}.logged_at AND tw.logged_at <= strftime('%Y-%m-%dT%H:%M:%fZ', ${a}.logged_at, '+${SENSOR_BRACKET_SECONDS} seconds')`;
  return `SELECT tw.glucose_level_mgdl FROM sugar_logs tw
         WHERE tw.profile_id = ${a}.profile_id AND tw.is_cgm = 1 AND ${edge}
           AND (tw.source IS NOT ${a}.source OR tw.source_app IS NOT ${a}.source_app)
         ORDER BY tw.logged_at ${dir < 0 ? "DESC" : "ASC"} LIMIT 1`;
}

/**
 * Positive form of the twin test, for a row aliased `alias` that is already
 * known to be non-sensor (is_cgm = 0). A row only mirrors a sensor stream of
 * another source or app when either
 *  (a) a sensor row within 150 s carries the same value +-1 mg/dL (one lookup,
 *      the common case), or
 *  (b) a sensor row of that stream lies within 150 s AND the row's value sits in
 *      the [min - 1, max + 1] band of the nearest sensor row before and the
 *      nearest one after it (within 330 s; one of the two is enough at the edge
 *      of a stream). (b) is what recognises a copy of a value that the thinned
 *      stream (about one row in five minutes) no longer holds exactly.
 * Import-side only (healthImportSql mirrors it); the view uses sensorStrictTwinSql.
 */
export function sensorBandTwinSql(alias: string): string {
  const a = alias;
  const t = SENSOR_TWIN_TOLERANCE_MGDL;
  const lo = "MIN(COALESCE(b.p, b.n), COALESCE(b.n, b.p))";
  const hi = "MAX(COALESCE(b.p, b.n), COALESCE(b.n, b.p))";
  return `(EXISTS (${otherStreamSensorSql(a, ` AND ABS(tw.glucose_level_mgdl - ${a}.glucose_level_mgdl) <= ${t}`)})
        OR (EXISTS (${otherStreamSensorSql(a)})
            AND EXISTS (SELECT 1 FROM (SELECT (${neighbourSensorSql(a, -1)}) AS p, (${neighbourSensorSql(a, 1)}) AS n) b
                         WHERE ${a}.glucose_level_mgdl >= ${lo} - ${t} AND ${a}.glucose_level_mgdl <= ${hi} + ${t})))`;
}

/**
 * Strict twin test for the VIEW (journal, insights, charts, PDF), for a row
 * aliased `alias` that is already known to be non-sensor: a sensor row of
 * another stream (source or app differs) within 30 s carries the same value
 * +-1 mg/dL. The wider band test (sensorBandTwinSql) is deliberately not used
 * here: a real fingerstick between two CGM values often falls inside their band.
 */
export function sensorStrictTwinSql(alias: string): string {
  const a = alias;
  return `EXISTS (${otherStreamSensorSql(a, ` AND ABS(tw.glucose_level_mgdl - ${a}.glucose_level_mgdl) <= ${SENSOR_TWIN_TOLERANCE_MGDL}`, SENSOR_TWIN_WINDOW_SECONDS)})`;
}

/**
 * "Not a sensor twin", for a row aliased `alias` that is already known to be
 * non-sensor (is_cgm = 0). The import never drops or converts a reading for
 * being a mirror; the mirror is told apart HERE, when rows are read, and only by
 * the strict rule (sensorStrictTwinSql). Typed ('manual') rows are never twins,
 * nor rows the user tagged or linked to a meal: a mirror app does neither.
 * Accepted limit: some mirrors of a thinned 1 minute stream can show as their
 * own journal row.
 */
export function notSensorTwinSql(alias: string): string {
  const a = alias;
  return `(${a}.source = 'manual' OR ${a}.period_tag <> 'unset'
        OR EXISTS (SELECT 1 FROM meal_logs ml WHERE ml.sugar_log_id = ${a}.id)
        OR NOT ${sensorStrictTwinSql(a)})`;
}

/**
 * Rows that may feed a dose, whatever their value: typed, labelled or
 * meal-linked rows always; any other non-sensor row only when no sensor row of
 * another stream is within 150 s. A mirror of a 1 minute stream cannot slip
 * through between two kept sensor values this way. Accepted consequence: while a
 * sensor runs, a fingerstick that reaches the app only through Health is not
 * offered to the calculator (the user can type the value, and a typed reading is
 * always offered).
 */
export function doseEligibleSql(alias: string): string {
  const a = alias;
  return `(${a}.source = 'manual' OR ${a}.period_tag <> 'unset'
        OR EXISTS (SELECT 1 FROM meal_logs ml WHERE ml.sugar_log_id = ${a}.id)
        OR NOT EXISTS (${otherStreamSensorSql(a)}))`;
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
        AND ${doseEligibleSql("s")}
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
        AND ${doseEligibleSql("s")}
      ORDER BY s.logged_at DESC LIMIT 1;`;
