import type { PeriodTag } from "./types";

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
