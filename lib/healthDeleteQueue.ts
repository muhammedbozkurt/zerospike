/**
 * Pure rules for the pending Health-delete queue: sample ids whose revoke
 * failed (store unreachable, access revoked) and are retried on the same
 * triggers as the write retry. Device-wide, not per profile, because a deleted
 * profile's copies must still be retried after the profile is gone.
 *
 * SCOPE: an id only ever enters through {@link ownHealthUuids}, i.e. the
 * healthkit_uuid of a row this app mirrored. A reading imported from Health
 * never carries one, so the queue can never be made to delete someone else's
 * sample.
 */

export interface PendingDeleteEntry {
  uuid: string;
  queuedAtIso: string;
}

export const HEALTH_DELETE_WINDOW_DAYS = 30;
export const HEALTH_DELETE_QUEUE_MAX = 500;
/** Ids sent to the store per native call. */
export const HEALTH_DELETE_BATCH = 50;
/** Ids attempted per retry pass. */
export const HEALTH_DELETE_PASS_MAX = 200;

export function ownHealthUuids(
  rows: readonly { source: string; healthkit_uuid: string | null }[]
): string[] {
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.source === "health") continue;
    if (typeof r.healthkit_uuid !== "string" || r.healthkit_uuid.length === 0) continue;
    seen.add(r.healthkit_uuid);
  }
  return [...seen];
}

export function normalizeDeleteEntries(raw: unknown, nowIso: string): PendingDeleteEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: PendingDeleteEntry[] = [];
  for (const v of raw) {
    if (typeof v === "string" && v) out.push({ uuid: v, queuedAtIso: nowIso });
    else if (v && typeof v.uuid === "string" && v.uuid && typeof v.queuedAtIso === "string") {
      out.push({ uuid: v.uuid, queuedAtIso: v.queuedAtIso });
    }
  }
  return out;
}

export function pruneDeleteQueue(
  entries: readonly PendingDeleteEntry[],
  nowMs: number,
  windowDays: number = HEALTH_DELETE_WINDOW_DAYS,
  maxSize: number = HEALTH_DELETE_QUEUE_MAX
): PendingDeleteEntry[] {
  const cutoffMs = nowMs - windowDays * 24 * 60 * 60 * 1000;
  const fresh = entries.filter((e) => {
    const t = new Date(e.queuedAtIso).getTime();
    return Number.isFinite(t) && t >= cutoffMs;
  });
  return fresh.length > maxSize ? fresh.slice(fresh.length - maxSize) : fresh;
}

export function enqueueDeletes(
  entries: readonly PendingDeleteEntry[],
  uuids: readonly string[],
  nowMs: number
): PendingDeleteEntry[] {
  const have = new Set(entries.map((e) => e.uuid));
  const nowIso = new Date(nowMs).toISOString();
  const next = [...entries];
  for (const uuid of uuids) {
    if (typeof uuid !== "string" || !uuid || have.has(uuid)) continue;
    have.add(uuid);
    next.push({ uuid, queuedAtIso: nowIso });
  }
  return pruneDeleteQueue(next, nowMs);
}

export function removeDeleted(
  entries: readonly PendingDeleteEntry[],
  uuids: readonly string[]
): PendingDeleteEntry[] {
  const gone = new Set(uuids);
  return entries.filter((e) => !gone.has(e.uuid));
}

/** Oldest first, capped per pass. */
export function selectDeletePass(
  entries: readonly PendingDeleteEntry[],
  max: number = HEALTH_DELETE_PASS_MAX
): string[] {
  return entries.slice(0, max).map((e) => e.uuid);
}
