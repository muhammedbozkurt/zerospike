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
