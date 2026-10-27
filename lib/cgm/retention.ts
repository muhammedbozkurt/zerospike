/**
 * Sensor-reading retention: raw readings (sugar_logs, is_cgm = 1) are kept for
 * 365 days, older ones are folded into one sugar_hourly row per hour and source
 * (count, mean, min, max). Dependency-free (no expo-sqlite) so
 * scripts/cgmRetention.test.ts runs the real SQL against node:sqlite.
 *
 * Hand-typed readings are never touched: every statement shares V30_FOLDABLE
 * (imported sensor rows with the source's id and no user label). The fold and the delete of one slice
 * share a transaction, so a crash leaves either both or neither, and a re-run
 * finds nothing left to fold (idempotent).
 */

import { BUSY_TIMEOUT_SQL, type HealthImportHost } from "../db/healthImportSql";
import {
  CGM_RAW_KEEP_DAYS,
  CGM_RETENTION_MIN_INTERVAL_MS,
  CGM_RETENTION_SLICE_DAYS,
  V30_DELETE_SLICE,
  V30_FOLDABLE,
  V30_DROP_STALE_TOMBSTONES,
  V30_FOLD_SLICE,
  V30_SELECT_OLDEST_RAW,
  V30_SELECT_RETENTION_STATE,
  V30_UPSERT_RETENTION_STATE,
} from "../db/v30Sql";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** What the retention needs from a database: plain reads plus the short
 *  exclusive transactions the Health import already uses. */
export interface RetentionHost extends HealthImportHost {
  getAllAsync<T>(source: string, params: (string | number | null)[]): Promise<T[]>;
}

export interface RetentionResult {
  /** Raw readings folded into hourly rows and removed. */
  folded: number;
  /** Slices processed (one transaction each). */
  slices: number;
}

/** The first instant that is still kept raw: 365 days back, on an hour boundary
 *  so no hour is ever split between a raw row and its summary. */
export function retentionCutoffMs(nowMs: number): number {
  return Math.floor((nowMs - CGM_RAW_KEEP_DAYS * DAY_MS) / HOUR_MS) * HOUR_MS;
}

/**
 * Folds the profile's sensor readings older than the cutoff. Runs unconditionally;
 * {@link runCgmRetentionIfDue} adds the once-a-day throttle.
 */
export async function runCgmRetention(
  host: RetentionHost,
  profileId: string,
  nowMs: number = Date.now()
): Promise<RetentionResult> {
  const cutoffMs = retentionCutoffMs(nowMs);
  const cutoffIso = new Date(cutoffMs).toISOString();
  let folded = 0;
  let slices = 0;

  for (;;) {
    const oldestRow = (
      await host.getAllAsync<{ oldest: string | null }>(V30_SELECT_OLDEST_RAW, [profileId, cutoffIso])
    )[0];
    const oldestMs = oldestRow?.oldest ? Date.parse(oldestRow.oldest) : NaN;
    if (!Number.isFinite(oldestMs)) break;

    const fromMs = Math.floor(oldestMs / HOUR_MS) * HOUR_MS;
    const toMs = Math.min(fromMs + CGM_RETENTION_SLICE_DAYS * DAY_MS, cutoffMs);
    const fromIso = new Date(fromMs).toISOString();
    const toIso = new Date(toMs).toISOString();

    let removed = 0;
    await host.withExclusiveTransactionAsync(async (txn) => {
      await txn.execAsync(BUSY_TIMEOUT_SQL);
      // The fold is a write, so it is the first statement that touches the
      // database and takes the lock under the busy timeout (the deferred BEGIN
      // would otherwise start on a read snapshot).
      await txn.runAsync(V30_FOLD_SLICE, [profileId, fromIso, toIso]);
      const gone = await txn.getAllAsync<{ c: number }>(
        `SELECT COUNT(*) AS c FROM sugar_logs
          WHERE profile_id = ? AND ${V30_FOLDABLE}
            AND logged_at >= ? AND logged_at < ?;`,
        [profileId, fromIso, toIso]
      );
      removed = gone[0]?.c ?? 0;
      await txn.runAsync(V30_DELETE_SLICE, [profileId, fromIso, toIso]);
      await txn.runAsync(V30_DROP_STALE_TOMBSTONES, [profileId, cutoffIso]);
    });
    folded += removed;
    slices++;
    if (removed === 0) break;
  }
  return { folded, slices };
}

/**
 * The once-a-day entry point, called after an import. Returns null when the
 * profile was folded within the last 24 hours. The state is written after the
 * fold, so an interrupted run is simply tried again by the next import.
 */
export async function runCgmRetentionIfDue(
  host: RetentionHost,
  profileId: string,
  nowMs: number = Date.now()
): Promise<RetentionResult | null> {
  const last = (
    await host.getAllAsync<{ last_run_at: string }>(V30_SELECT_RETENTION_STATE, [profileId])
  )[0];
  const lastMs = last ? Date.parse(last.last_run_at) : NaN;
  if (Number.isFinite(lastMs) && nowMs - lastMs < CGM_RETENTION_MIN_INTERVAL_MS && lastMs <= nowMs) {
    return null;
  }
  const result = await runCgmRetention(host, profileId, nowMs);
  await host.withExclusiveTransactionAsync(async (txn) => {
    await txn.execAsync(BUSY_TIMEOUT_SQL);
    await txn.runAsync(V30_UPSERT_RETENTION_STATE, [profileId, new Date(nowMs).toISOString()]);
  });
  return result;
}
