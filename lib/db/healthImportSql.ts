import type { PeriodTag } from "./types";
import { V28_UPSERT_FLOOR } from "./v28Sql";

/**
 * insertHealthSugarLogs' dedupe decision, kept dependency-free (no expo-sqlite
 * import) so scripts/healthImport.test.ts can call planHealthImport directly -
 * the same arrangement as journalSql.ts and the vNSql migration modules.
 */

/** One sample from the platform health store, ready to be stored. */
export interface HealthSugarSample {
  glucose_level_mgdl: number;
  period_tag: PeriodTag;
  /** Already snapped to the dedup grain by the caller (see healthMath.snapIso). */
  logged_at: string;
}

/** The one thing the import dedupe needs to know about a reading the profile
 *  already has: what it read and when. Deliberately source-agnostic - see
 *  planHealthImport. */
export interface ExistingSugarReading {
  logged_at: string;
  glucose_level_mgdl: number;
}

/** How far apart two readings of the same value can be and still be the same
 *  measurement typed twice. Shared by planHealthImport and by
 *  findMatchingSugarLog (the calculator's own dedupe, lib/db/logs.ts), so
 *  "same reading" means one thing everywhere in the app: identical value,
 *  within this window. */
export const SUGAR_DEDUP_WINDOW_MINUTES = 15;

/**
 * Pure planner: given the samples a Health sync just read and the profile's
 * existing readings, returns exactly the samples that should be INSERTED.
 *
 * A sample is a duplicate of an existing reading of ANY source - manual or a
 * previous import - when they carry the same value (mg/dL, exact match) and
 * are within `windowMinutes` of each other (2.3.1 P3, bulgu 3d). A manual
 * entry the user typed for a measurement they ALSO have in Apple Health must
 * block the import of that same measurement, or the reading lands twice in
 * the journal; only source='health' used to be checked, so a manual entry
 * never blocked its own Health duplicate.
 *
 * `existing` is treated as read-only; a growing local copy of "reading times
 * already accounted for" absorbs both `existing` and whatever this call has
 * already decided to insert, so two identical samples in the SAME batch also
 * collapse into one insert instead of both passing a pre-batch check.
 */
export function planHealthImport(
  samples: HealthSugarSample[],
  existing: ExistingSugarReading[],
  windowMinutes: number = SUGAR_DEDUP_WINDOW_MINUTES
): HealthSugarSample[] {
  const windowMs = windowMinutes * 60_000;
  const taken = existing.map((r) => ({
    atMs: Date.parse(r.logged_at),
    mgdl: Math.round(r.glucose_level_mgdl),
  }));

  const toInsert: HealthSugarSample[] = [];
  for (const s of samples) {
    const mgdl = Math.round(s.glucose_level_mgdl);
    const atMs = Date.parse(s.logged_at);
    const isDuplicate = taken.some(
      (t) => t.mgdl === mgdl && Math.abs(t.atMs - atMs) <= windowMs
    );
    if (isDuplicate) continue;
    taken.push({ atMs, mgdl });
    toInsert.push(s);
  }
  return toInsert;
}

/** How long a connection waits for another writer's lock before "database is
 *  locked". SQLite's default is 0, so a write that overlapped the Health
 *  import's transaction failed at once and was lost. Set on the main
 *  connection (getDb) and on the import's own transaction connection. */
export const BUSY_TIMEOUT_SQL = "PRAGMA busy_timeout = 5000;";

/** Samples per import transaction. A 90 day CGM backfill is ~26k rows; one
 *  transaction held the write lock for seconds. Chunks stay short, and the
 *  dedupe of a chunk sees the committed rows of the one before. */
export const HEALTH_IMPORT_CHUNK_SIZE = 500;

/** Tombstones older than this can no longer match anything a sync reads
 *  (30/90 day windows) and are dropped on the next import. */
const TOMBSTONE_KEEP_DAYS = 180;

export interface HealthImportSql {
  execAsync(source: string): Promise<void>;
  getAllAsync<T>(source: string, params: (string | number | null)[]): Promise<T[]>;
  runAsync(source: string, params: (string | number | null)[]): Promise<unknown>;
}

export interface HealthImportHost {
  withExclusiveTransactionAsync(task: (txn: HealthImportSql) => Promise<void>): Promise<void>;
}

async function importChunk(
  txn: HealthImportSql,
  profileId: string,
  chunk: HealthSugarSample[],
  newId: () => string
): Promise<number> {
  const floorRow = (
    await txn.getAllAsync<{ floor_at: string }>(
      "SELECT floor_at FROM health_import_floor WHERE profile_id = ?;",
      [profileId]
    )
  )[0];
  const samples = floorRow ? chunk.filter((s) => s.logged_at > floorRow.floor_at) : chunk;
  if (samples.length === 0) return 0;

  const from = samples[0].logged_at;
  const to = samples[samples.length - 1].logged_at;
  const windowMs = SUGAR_DEDUP_WINDOW_MINUTES * 60_000;
  const rangeFrom = new Date(Date.parse(from) - windowMs).toISOString();
  const rangeTo = new Date(Date.parse(to) + windowMs).toISOString();

  const existing = await txn.getAllAsync<ExistingSugarReading>(
    `SELECT logged_at, glucose_level_mgdl FROM sugar_logs
      WHERE profile_id = ? AND logged_at BETWEEN ? AND ?;`,
    [profileId, rangeFrom, rangeTo]
  );
  const removed = await txn.getAllAsync<ExistingSugarReading>(
    `SELECT logged_at, glucose_level_mgdl FROM health_import_tombstones
      WHERE profile_id = ? AND logged_at BETWEEN ? AND ?;`,
    [profileId, rangeFrom, rangeTo]
  );

  const toInsert = planHealthImport(samples, existing.concat(removed));
  for (const s of toInsert) {
    await txn.runAsync(
      `INSERT INTO sugar_logs
         (id, profile_id, glucose_level_mgdl, period_tag, source, logged_at, tags)
       VALUES (?, ?, ?, ?, 'health', ?, '[]');`,
      [newId(), profileId, Math.round(s.glucose_level_mgdl), s.period_tag, s.logged_at]
    );
  }
  return toInsert.length;
}

/**
 * Imports Health samples in time-ordered chunks, one exclusive transaction
 * each, and returns how many rows were new. A reading the user deleted or
 * corrected (tombstone, schema v28) or that predates the last "Verileri sil"
 * (import floor) is treated like one that already exists. An interrupted run
 * leaves whole chunks behind; the next sync dedupes against them.
 */
export async function importHealthSamples(
  host: HealthImportHost,
  profileId: string,
  samples: HealthSugarSample[],
  newId: () => string,
  nowMs: number = Date.now()
): Promise<number> {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) =>
    a.logged_at < b.logged_at ? -1 : a.logged_at > b.logged_at ? 1 : 0
  );
  const pruneBefore = new Date(nowMs - TOMBSTONE_KEEP_DAYS * 86_400_000).toISOString();

  let inserted = 0;
  for (let i = 0; i < sorted.length; i += HEALTH_IMPORT_CHUNK_SIZE) {
    const chunk = sorted.slice(i, i + HEALTH_IMPORT_CHUNK_SIZE);
    let n = 0;
    await host.withExclusiveTransactionAsync(async (txn) => {
      await txn.execAsync(BUSY_TIMEOUT_SQL);
      if (i === 0) {
        await txn.runAsync(
          "DELETE FROM health_import_tombstones WHERE profile_id = ? AND logged_at < ?;",
          [profileId, pruneBefore]
        );
      }
      n = await importChunk(txn, profileId, chunk, newId);
    });
    inserted += n;
  }
  return inserted;
}

/**
 * "Verileri sil": the floor and the four deletes land in one transaction, floor
 * first so the delete trigger does not write a tombstone per reading. Samples
 * at or before `nowIso` are never imported again.
 */
export async function clearProfileLogs(
  host: HealthImportHost,
  profileId: string,
  nowIso: string
): Promise<void> {
  await host.withExclusiveTransactionAsync(async (txn) => {
    await txn.execAsync(BUSY_TIMEOUT_SQL);
    await txn.runAsync(V28_UPSERT_FLOOR, [profileId, nowIso]);
    await txn.runAsync(
      "DELETE FROM health_import_tombstones WHERE profile_id = ? AND logged_at <= ?;",
      [profileId, nowIso]
    );
    await txn.runAsync("DELETE FROM med_logs WHERE profile_id = ?;", [profileId]);
    await txn.runAsync("DELETE FROM injection_logs WHERE profile_id = ?;", [profileId]);
    await txn.runAsync("DELETE FROM meal_logs WHERE profile_id = ?;", [profileId]);
    await txn.runAsync("DELETE FROM sugar_logs WHERE profile_id = ?;", [profileId]);
  });
}
