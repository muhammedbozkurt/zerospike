/**
 * The queries behind the sensor curve, the ring and the per-day journal rows.
 * expo-sqlite is loaded lazily so the SQL runs under plain Node
 * (scripts/cgmCurve.test.ts, scripts/cgmPerf.test.ts) against a scratch
 * database with the real v29 columns and indexes.
 *
 * Every statement filters on profile_id and a time range, so each one lands on
 * idx_sugar_profile, idx_sugar_cgm or idx_sugar_manual and never scans the
 * table.
 */
import { recentDayRanges } from "../cgm/curve";

/** Placeholders: profile_id, since (ISO), until (ISO). Sensor AND hand-entered
 *  readings, so the curve can mark the manual ones on the same axis. */
export const CGM_WINDOW_SQL =
  "SELECT logged_at, glucose_level_mgdl, is_cgm FROM sugar_logs WHERE profile_id = ? AND logged_at >= ? AND logged_at <= ? ORDER BY logged_at;";

/** Placeholders: profile_id. The newest sensor readings, newest first. */
export const CGM_LATEST_SQL =
  "SELECT logged_at, glucose_level_mgdl FROM sugar_logs WHERE profile_id = ? AND is_cgm = 1 ORDER BY logged_at DESC LIMIT 6;";

/** Placeholders: low, high, profile_id, since (ISO), until (ISO). */
export const CGM_RANGE_STATS_SQL =
  "SELECT COUNT(*) AS c, AVG(glucose_level_mgdl) AS a, COALESCE(SUM(CASE WHEN glucose_level_mgdl BETWEEN ? AND ? THEN 1 ELSE 0 END), 0) AS r FROM sugar_logs WHERE profile_id = ? AND is_cgm = 1 AND logged_at >= ? AND logged_at < ?;";

/**
 * One row per local day that has sensor readings. The day bounds come from JS
 * (local midnights, so a 23 or 25 hour day is right) and are joined as a VALUES
 * list: each day is one index range on idx_sugar_cgm. Placeholders: low, high,
 * profile_id, then (dayKey, since, until) per day.
 */
export function cgmDaySummariesSql(dayCount: number): string {
  const values = Array.from({ length: dayCount }, () => "(?, ?, ?)").join(", ");
  return `WITH days(day, lo, hi) AS (VALUES ${values})
SELECT d.day AS day, COUNT(s.id) AS c, AVG(s.glucose_level_mgdl) AS a,
       COALESCE(SUM(CASE WHEN s.glucose_level_mgdl BETWEEN ? AND ? THEN 1 ELSE 0 END), 0) AS r,
       MAX(s.logged_at) AS last_at
  FROM days d
  JOIN sugar_logs s ON s.profile_id = ? AND s.is_cgm = 1 AND s.logged_at >= d.lo AND s.logged_at < d.hi
 GROUP BY d.day
 ORDER BY d.day DESC;`;
}

export interface CgmWindowRow {
  logged_at: string;
  glucose_level_mgdl: number;
  is_cgm: number;
}

export interface CgmLatestRow {
  logged_at: string;
  glucose_level_mgdl: number;
}

export interface CgmRangeStats {
  count: number;
  avgMgdl: number | null;
  inRange: number;
}

export interface CgmDaySummary {
  dayKey: string;
  count: number;
  avgMgdl: number;
  inRange: number;
  lastAt: string;
}

export function windowArgs(profileId: string, startMs: number, endMs: number): string[] {
  return [profileId, new Date(startMs).toISOString(), new Date(endMs).toISOString()];
}

export function rangeStatsArgs(
  profileId: string,
  band: { low: number; high: number },
  startMs: number,
  endMs: number
): (string | number)[] {
  return [
    band.low,
    band.high,
    profileId,
    new Date(startMs).toISOString(),
    new Date(endMs).toISOString(),
  ];
}

export function toRangeStats(
  row: { c: number; a: number | null; r: number } | null | undefined
): CgmRangeStats {
  const count = row?.c ?? 0;
  return {
    count,
    avgMgdl: count > 0 && row?.a != null ? Math.round(row.a) : null,
    inRange: row?.r ?? 0,
  };
}

export function daySummariesArgs(
  profileId: string,
  band: { low: number; high: number },
  nowMs: number,
  dayCount: number
): (string | number)[] {
  const args: (string | number)[] = [];
  for (const d of recentDayRanges(nowMs, dayCount)) {
    args.push(d.dayKey, new Date(d.loMs).toISOString(), new Date(d.hiMs).toISOString());
  }
  args.push(band.low, band.high, profileId);
  return args;
}

export function toDaySummaries(
  rows: readonly { day: string; c: number; a: number; r: number; last_at: string }[]
): CgmDaySummary[] {
  return rows
    .filter((r) => r.c > 0)
    .map((r) => ({
      dayKey: r.day,
      count: r.c,
      avgMgdl: Math.round(r.a),
      inRange: r.r,
      lastAt: r.last_at,
    }));
}

export async function getCgmWindowRows(
  profileId: string,
  startMs: number,
  endMs: number
): Promise<CgmWindowRow[]> {
  const { getDb } = await import("./index");
  const db = await getDb();
  return db.getAllAsync<CgmWindowRow>(CGM_WINDOW_SQL, windowArgs(profileId, startMs, endMs));
}

export async function getCgmLatest(profileId: string): Promise<CgmLatestRow[]> {
  const { getDb } = await import("./index");
  const db = await getDb();
  return db.getAllAsync<CgmLatestRow>(CGM_LATEST_SQL, [profileId]);
}

export async function getCgmRangeStats(
  profileId: string,
  band: { low: number; high: number },
  startMs: number,
  endMs: number
): Promise<CgmRangeStats> {
  const { getDb } = await import("./index");
  const db = await getDb();
  const row = await db.getFirstAsync<{ c: number; a: number | null; r: number }>(
    CGM_RANGE_STATS_SQL,
    rangeStatsArgs(profileId, band, startMs, endMs)
  );
  return toRangeStats(row);
}

export async function getCgmDaySummaries(
  profileId: string,
  band: { low: number; high: number },
  nowMs: number,
  dayCount: number
): Promise<CgmDaySummary[]> {
  if (dayCount <= 0) return [];
  const { getDb } = await import("./index");
  const db = await getDb();
  const rows = await db.getAllAsync<{
    day: string;
    c: number;
    a: number;
    r: number;
    last_at: string;
  }>(cgmDaySummariesSql(dayCount), daySummariesArgs(profileId, band, nowMs, dayCount));
  return toDaySummaries(rows);
}
