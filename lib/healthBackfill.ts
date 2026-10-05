/**
 * Pure selection for the one-time "send past readings to Health" action.
 * Kept out of lib/services/health.ts (native/AsyncStorage imports) so the rule
 * that decides WHICH rows are ever written is provable under plain Node
 * (scripts/healthBackfill.test.ts).
 */

export const HEALTH_BACKFILL_WINDOWS = [7, 30, 90] as const;
export type HealthBackfillWindow = (typeof HEALTH_BACKFILL_WINDOWS)[number];

/** Rows written per batch; progress is reported between batches. */
export const HEALTH_BACKFILL_BATCH = 25;
/** Hard cap per run: a longer history is sent by running the action again. */
export const HEALTH_BACKFILL_MAX_ROWS = 1000;

export interface BackfillRow {
  id: string;
  profile_id: string;
  /** 'manual' | 'health' | ... */
  source: string;
  healthkit_uuid: string | null;
  logged_at: string;
}

/**
 * Rows of ONE profile that were entered in the app (never imported from
 * Health) and have no Health sample yet, inside the window, oldest first. A
 * row imported from Health is someone else's sample and would double in the
 * user's own Health app; a row that already has a uuid is already there.
 */
export function selectBackfillCandidates<T extends BackfillRow>(
  rows: readonly T[],
  profileId: string,
  inFlightIds: ReadonlySet<string>,
  nowMs: number,
  windowDays: number,
  max: number = HEALTH_BACKFILL_MAX_ROWS
): T[] {
  const cutoffMs = nowMs - windowDays * 24 * 60 * 60 * 1000;
  return rows
    .filter((r) => r.profile_id === profileId)
    .filter((r) => r.source !== "health" && r.healthkit_uuid == null)
    .filter((r) => !inFlightIds.has(r.id))
    .filter((r) => {
      const t = new Date(r.logged_at).getTime();
      return Number.isFinite(t) && t >= cutoffMs && t <= nowMs;
    })
    .sort((a, b) => new Date(a.logged_at).getTime() - new Date(b.logged_at).getTime())
    .slice(0, max);
}

export function chunkBatches<T>(items: readonly T[], size: number = HEALTH_BACKFILL_BATCH): T[][] {
  const out: T[][] = [];
  if (size <= 0) return out;
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
