/**
 * Pure decision layer for the Apple Health / Health Connect write-mirror
 * retry (2.4/2.3.5's health-write observability work). Lives outside
 * lib/services/health.ts for the same reason lib/healthWriteScope.ts does:
 * that module pulls in Expo/native code and AsyncStorage, which cannot run
 * under plain Node, so the part that has to be provable
 * (scripts/healthWriteRetry.test.ts) is split out here.
 *
 * Things live here:
 *  1. selectHealthRetryCandidates - which rows the foreground/manual-sync
 *     retry re-attempts. CONSENT SCOPE (2.3.5 fix): a row is only ever a
 *     candidate when its id is in the caller's own pending-write queue -
 *     never merely because it "looks" pending (no uuid, not a health
 *     import). The queue is populated ONLY when a write was actually
 *     attempted while the toggle was on and failed (see health.ts's
 *     writeGlucoseToHealthIfEnabled); a reading logged while the toggle was
 *     OFF was never attempted and never joins the queue, so it can never be
 *     swept up by a later retry just because it happens to have no uuid.
 *  2. pruneWritePendingQueue - keeps that same queue from growing without
 *     bound: an entry queued too long ago is dropped, and the whole queue is
 *     capped, oldest-queued first.
 *  3. isRetryPassOpen - re-checked before EVERY row of a retry pass (not
 *     just once for the whole pass), so a toggle switched off mid-pass stops
 *     it immediately instead of finishing on a stale "was on when I started"
 *     read.
 *  4. buildRetryStatusRecord - the ONE status record a whole retry pass
 *     writes (never one write per row - see health.ts).
 *  5. healthWriteStatusKey - which i18n key the Settings > Data status line
 *     under the write toggle should show for a stored status record.
 */

/** The fields the retry candidate scan actually needs from a sugar_logs row. */
export interface RetryCandidateRow {
  id: string;
  /** 'manual' | 'health' | ... - only a non-'health' row can be re-mirrored;
   *  a row imported FROM the health store never carries a mirror UUID and
   *  re-writing it would double the reading in the user's own Health app.
   *  Defensive here: a row that ever reaches this filter should already be
   *  non-'health' by construction (the queue is never fed from one). */
  source: string;
  /** Already mirrored once (a real UUID) -> nothing to retry. Defensive for
   *  the same reason as `source` above. */
  healthkit_uuid: string | null;
  logged_at: string;
}

/** Retry window: matches the app's own Health import/export horizon closely
 *  enough (see SYNC_WINDOW_DAYS in lib/services/healthTypes.ts) without
 *  reaching back into readings the user is unlikely to still care about
 *  mirroring late. Applied to the PENDING QUEUE, not to a broader scan of
 *  the profile's history. */
export const HEALTH_RETRY_WINDOW_DAYS = 7;

/** Sequential, one write at a time (never parallel - a burst of retried
 *  native calls is worse than a slower catch-up), so this also caps how long
 *  a single foreground/sync pass can spend on it. */
export const HEALTH_RETRY_MAX_ROWS = 50;

/**
 * Which of a profile's QUEUED rows (rows.id present in `pendingIds`) should
 * get a retried mirror write this pass, oldest first (so a long-pending gap
 * fills in chronological order rather than newest-first, which would keep
 * re-skipping the oldest failure forever if the cap is hit every time).
 *
 * `pendingIds` is the consent-scope gate (see the module doc above): a row
 * whose id is not in this set is never a candidate, full stop, regardless of
 * anything else about it. `inFlightIds` excludes a row another Health
 * operation is queued or running on right now (health.ts's busyRowIds(), the
 * keys of its per-row lock): that operation writes the row's current values
 * itself, so the pass leaves it alone instead of queueing behind it.
 * health.ts passes the rows with healthkit_uuid cleared, because a queued row
 * can be linked to a sample whose rewrite failed and still needs the retry.
 *
 * `nowMs` is a parameter (not Date.now() inline) so this stays pure and
 * exactly reproducible in tests.
 */
export function selectHealthRetryCandidates<T extends RetryCandidateRow>(
  rows: readonly T[],
  pendingIds: ReadonlySet<string> | readonly string[],
  inFlightIds: ReadonlySet<string> | readonly string[],
  nowMs: number,
  windowDays: number = HEALTH_RETRY_WINDOW_DAYS,
  max: number = HEALTH_RETRY_MAX_ROWS
): T[] {
  const pending = pendingIds instanceof Set ? pendingIds : new Set(pendingIds);
  const inFlight = inFlightIds instanceof Set ? inFlightIds : new Set(inFlightIds);
  const cutoffMs = nowMs - windowDays * 24 * 60 * 60 * 1000;
  return rows
    .filter((r) => pending.has(r.id) && !inFlight.has(r.id))
    .filter((r) => r.source !== "health" && r.healthkit_uuid == null)
    .filter((r) => {
      const t = new Date(r.logged_at).getTime();
      return Number.isFinite(t) && t >= cutoffMs && t <= nowMs;
    })
    .sort((a, b) => new Date(a.logged_at).getTime() - new Date(b.logged_at).getTime())
    .slice(0, max);
}

/** One entry in the per-profile pending-write queue (see health.ts's
 *  HEALTH_WRITE_PENDING_KEY doc comment for the consent-scope rule the
 *  queue itself enforces). `queuedAtIso` is when the row JOINED the queue -
 *  not the reading's own `logged_at` - because pruning has to work without
 *  ever reading the database (stays pure/testable here), and "how long has
 *  this failure sat unresolved" is a different question from "how old is
 *  the reading" anyway (selectHealthRetryCandidates already answers that
 *  second one against the real row). */
export interface PendingWriteEntry {
  id: string;
  queuedAtIso: string;
}

/** Hard cap on the pending-write queue's size, PER PROFILE. A queue this
 *  deep means something is persistently broken (Health access revoked for
 *  a week, say) - the newest failures are the ones still worth catching up
 *  on, so the oldest-QUEUED entries are the ones dropped once the cap is
 *  hit, not the newest. */
export const HEALTH_PENDING_QUEUE_MAX = 200;

/**
 * Keeps the pending-write queue from growing without bound (2.3.5 fix):
 *  1. Drops any entry queued more than `windowDays` ago - a row that has
 *     been sitting unresolved that long is given up on rather than fetched
 *     and re-checked on every single retry pass forever.
 *  2. Caps what is left at `maxSize`, keeping the entries queued MOST
 *     recently (oldest-queued dropped first) - `entries` is assumed to
 *     already be in queue order (oldest first, since addPendingWriteId only
 *     ever appends), so this is a plain slice from the end.
 *
 * Pure and storage-free: the caller (health.ts) is the one that persists
 * whatever this returns.
 */
export function pruneWritePendingQueue(
  entries: readonly PendingWriteEntry[],
  nowMs: number,
  windowDays: number = HEALTH_RETRY_WINDOW_DAYS,
  maxSize: number = HEALTH_PENDING_QUEUE_MAX
): PendingWriteEntry[] {
  const cutoffMs = nowMs - windowDays * 24 * 60 * 60 * 1000;
  const fresh = entries.filter((e) => {
    const t = new Date(e.queuedAtIso).getTime();
    return Number.isFinite(t) && t >= cutoffMs;
  });
  return fresh.length > maxSize ? fresh.slice(fresh.length - maxSize) : fresh;
}

/**
 * Is a retry pass still allowed to spend another write on `profileId`? Same
 * per-profile rule every mirror write uses (lib/healthWriteScope.ts's
 * shouldWriteToHealth), but asked fresh before EVERY row of a pass rather
 * than once for the whole pass: a pass can span many sequential native
 * calls, and the user may switch the write toggle off in the middle of one
 * (settings/data.tsx) - the pass has to stop AT that row, not keep spending
 * writes the user just said no to, and not wait for the row after that to
 * notice via a stale scope captured before the pass started.
 */
export function isRetryPassOpen(
  scope: { enabled: boolean; profileId: string | null },
  profileId: string
): boolean {
  return scope.enabled && scope.profileId === profileId;
}

/** What Settings > Data persists (per profile) about the last attempted
 *  mirror write - a single fresh write/correction, or a whole retry pass. */
export interface HealthWriteStatusRecord {
  result: "success" | "failed";
  atIso: string;
  /** Only present when `result` is "failed" AND this record came from a
   *  RETRY PASS over more than one row (see buildRetryStatusRecord) - how
   *  many of that pass's attempts failed. Absent for a single fresh
   *  write/correction failure, which is always exactly one. */
  failedCount?: number;
}

/**
 * The ONE status record a whole retry pass writes, from its final tally -
 * never one write per row (that would leave only the LAST row's outcome on
 * screen, hiding every earlier success or failure in the same pass). `null`
 * when the pass attempted nothing, so the caller writes no record at all
 * rather than overwriting a real previous status with a no-op result.
 */
export function buildRetryStatusRecord(
  attempted: number,
  succeeded: number,
  atIso: string
): HealthWriteStatusRecord | null {
  if (attempted <= 0) return null;
  const failedCount = attempted - succeeded;
  return failedCount > 0 ? { result: "failed", atIso, failedCount } : { result: "success", atIso };
}

/** i18n key for the status line under the write toggle, or null when there
 *  is nothing to show yet (no write has been attempted this profile). */
export function healthWriteStatusKey(
  status: HealthWriteStatusRecord | null
): "settings.healthWriteLastSuccess" | "settings.healthWriteLastFailed" | null {
  if (!status) return null;
  return status.result === "success"
    ? "settings.healthWriteLastSuccess"
    : "settings.healthWriteLastFailed";
}
