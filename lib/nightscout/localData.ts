/**
 * The Nightscout readings stored on this device: how many there are, and
 * removing them when the user turns the connection off and asks for it.
 * Only source = 'nightscout' rows of one profile are touched; typed readings
 * and other sources never. The database is reached lazily so the SQL stays
 * testable under plain Node with a host object.
 */
import { BUSY_TIMEOUT_SQL, type HealthImportHost } from "../db/healthImportSql";
import { emitCgmChanged } from "../cgm/importEvents";

export const COUNT_NIGHTSCOUT_SQL =
  "SELECT COUNT(*) AS c FROM sugar_logs WHERE profile_id = ? AND source = 'nightscout';";

/** Placeholders: profile_id. A write first (see BUSY_TIMEOUT_SQL), RETURNING
 *  tells how many went without a count query. */
export const DELETE_NIGHTSCOUT_SQL = `DELETE FROM sugar_logs
  WHERE profile_id = ? AND source = 'nightscout'
  RETURNING id;`;

export interface CountHost {
  getFirstAsync<T>(sql: string, params: (string | number | null)[]): Promise<T | null>;
}

export async function countNightscoutReadingsWith(host: CountHost, profileId: string): Promise<number> {
  const row = await host.getFirstAsync<{ c: number }>(COUNT_NIGHTSCOUT_SQL, [profileId]);
  return row?.c ?? 0;
}

export async function deleteNightscoutReadingsWith(host: HealthImportHost, profileId: string): Promise<number> {
  let removed = 0;
  await host.withExclusiveTransactionAsync(async (txn) => {
    await txn.execAsync(BUSY_TIMEOUT_SQL);
    const gone = await txn.getAllAsync<{ id: string }>(DELETE_NIGHTSCOUT_SQL, [profileId]);
    removed = gone.length;
    // The hourly sensor summaries of year-old readings cannot be split by
    // source, so they stay; only rows still held individually are removed.
  });
  return removed;
}

export async function countNightscoutReadings(profileId: string): Promise<number> {
  const { getDb } = await import("../db/index");
  return countNightscoutReadingsWith(await getDb(), profileId);
}

export async function deleteNightscoutReadings(profileId: string): Promise<number> {
  const { getDb } = await import("../db/index");
  const removed = await deleteNightscoutReadingsWith(await getDb(), profileId);
  if (removed > 0) emitCgmChanged({ kind: "clear", profileId });
  return removed;
}
