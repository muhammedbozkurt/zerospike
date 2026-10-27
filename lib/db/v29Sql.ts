/**
 * The schema v29 statements, dependency-free so the tests run the REAL SQL
 * against a scratch database (same arrangement as v13Sql..v28Sql).
 *
 * v29 prepares sugar_logs for sensor (CGM) readings without a second table:
 *
 *  - source_app: which app or device wrote the reading (an identifier, never
 *    sent to analytics).
 *  - external_id: the id the source gave the reading, so an import is
 *    idempotent per (profile, source, external_id).
 *  - is_cgm: 1 for a sensor reading. The journal and the manual lists skip
 *    these rows by index instead of scanning tens of thousands of them.
 *
 * Plain guarded ADD COLUMNs (no rebuild, no row rewritten) plus three indexes.
 * The one data step marks rows an earlier release already imported from Health
 * as sensor readings when they form a long, evenly spaced run.
 */

export const V29_COLUMNS: { name: string; type: string }[] = [
  { name: "source_app", type: "TEXT" },
  { name: "external_id", type: "TEXT" },
  { name: "is_cgm", type: "INTEGER NOT NULL DEFAULT 0" },
];

export const V29_INDEXES: string[] = [
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_sugar_ext ON sugar_logs (profile_id, source, external_id) WHERE external_id IS NOT NULL;`,
  `CREATE INDEX IF NOT EXISTS idx_sugar_cgm ON sugar_logs (profile_id, logged_at) WHERE is_cgm = 1;`,
  `CREATE INDEX IF NOT EXISTS idx_sugar_manual ON sugar_logs (profile_id, logged_at DESC) WHERE is_cgm = 0;`,
];

export const V29_SELECT_HEALTH_ROWS = `SELECT id, profile_id, logged_at, period_tag FROM sugar_logs WHERE source = 'health' ORDER BY profile_id, logged_at;`;

export const V29_BACKFILL_CHUNK_SIZE = 500;

/** A run is a sensor stream when readings are at most this far apart... */
export const V29_RUN_MAX_GAP_MS = 6 * 60 * 1000;
/** ...and it holds at least this many of them. */
export const V29_RUN_MIN_LENGTH = 36;

/**
 * Ids of the rows that belong to a long, evenly spaced run per profile. Input
 * must be ordered by profile_id then logged_at (V29_SELECT_HEALTH_ROWS).
 *
 * A row the user labelled (period_tag other than 'unset') is theirs, typically a
 * glucometer reading that sits inside a sensor's run: it is never marked and
 * does not take part in the run (the sensor rows around it still form theirs).
 */
export function findCgmRunIds(
  rows: readonly { id: string; profile_id: string; logged_at: string; period_tag?: string | null }[]
): string[] {
  const out: string[] = [];
  let run: string[] = [];
  let lastProfile: string | null = null;
  let lastMs = 0;
  const flush = () => {
    if (run.length >= V29_RUN_MIN_LENGTH) out.push(...run);
    run = [];
  };
  for (const r of rows) {
    if (r.period_tag != null && r.period_tag !== "unset") continue;
    const ms = Date.parse(r.logged_at);
    if (!Number.isFinite(ms)) {
      flush();
      lastProfile = null;
      continue;
    }
    const continues =
      lastProfile === r.profile_id && ms - lastMs <= V29_RUN_MAX_GAP_MS;
    if (!continues) flush();
    run.push(r.id);
    lastProfile = r.profile_id;
    lastMs = ms;
  }
  flush();
  return out;
}
