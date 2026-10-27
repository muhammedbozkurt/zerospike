import type { GlucoseSource } from "../glucoseSource";
import type { PeriodTag } from "./types";
import { V28_UPSERT_FLOOR } from "./v28Sql";

/**
 * The glucose import's decisions and SQL, kept dependency-free (no expo-sqlite
 * import) so scripts/healthImport.test.ts and scripts/cgmPerf.test.ts can call
 * the planner directly - the same arrangement as journalSql.ts and the vNSql
 * migration modules.
 *
 * Every importer (Apple Health, Health Connect, Nightscout) goes through
 * importGlucoseRows. A hand-typed row ('manual') is never inserted, changed or
 * deleted by anything in this file.
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

/** A reading from any importer, as insertImportedGlucose takes it. */
export interface ImportedGlucoseRow {
  /** UTC ISO timestamp. */
  at: string;
  /** Whole mg/dL; rounded on the way in. */
  mgdl: number;
  /** Never 'manual': typed readings do not come through an importer. */
  source: GlucoseSource;
  /** The app or device that wrote it (bundle id, package name). Never analytics. */
  sourceApp?: string | null;
  /** The id the source gave it; makes the import idempotent per source. */
  externalId?: string | null;
  /** A sensor reading: kept out of the journal, folded to hours after a year. */
  isCgm: boolean;
  periodTag?: PeriodTag;
}

/** How far apart two readings of the same value can be and still be the same
 *  measurement typed twice. Shared by planHealthImport and by
 *  findMatchingSugarLog (the calculator's own dedupe, lib/db/logs.ts), so
 *  "same reading" means one thing everywhere in the app: identical value,
 *  within this window. */
export const SUGAR_DEDUP_WINDOW_MINUTES = 15;

/** Two sources reporting the same sensor reading: within this many ms... */
export const SAME_READING_WINDOW_MS = 150_000;
/** ...and within this many mg/dL (mmol/L to mg/dL rounding differs by one). */
export const SAME_READING_TOLERANCE_MGDL = 1;
/** A stream written every minute is thinned to one reading per about 5 minutes:
 *  a sample closer than this to a kept one from the same app is skipped. */
export const CGM_THINNING_MS = 270_000;
/** A sample dated further ahead than this (clock skew) is rejected. */
export const IMPORT_FUTURE_SLACK_MS = 5 * 60_000;
/** A rejected future sample is worth reading again only when it is this close
 *  to now (a few minutes of clock skew, a timezone slip); one further out would
 *  hold the sync cursor back for good. */
export const IMPORT_FUTURE_RETRY_MAX_MS = 24 * 60 * 60_000;
/** A legacy untagged non-sensor row this close in time and equal in value is
 *  the same reading a sensor candidate now describes (take-over). */
const TAKE_OVER_LEGACY_MS = 60_000;
/** A NON-sensor candidate this close in time (and within the tolerance in value)
 *  to a sensor row of another stream is that sensor value mirrored by a second
 *  app, not a glucometer reading: a real fingerstick a minute away stays. Wide
 *  enough for a mirror that rounds to the half minute, because a mirrored copy
 *  counted as a fingerstick would reach the calculator's dose path. Applies to
 *  a source app that MIRRORS (see findMirrorStreams); any other app is only
 *  treated as a mirror at SENSOR_MIRROR_EXACT_MS, because a real fingerstick
 *  lands within 30 s and +-1 mg/dL of a sensor value by chance (about 1.6 % of
 *  readings) and must not be dropped, or turned into a sensor row. */
const SENSOR_MIRROR_WINDOW_MS = 30_000;
/** The mirror window for a source app that has not shown itself to mirror. */
const SENSOR_MIRROR_EXACT_MS = 5_000;
/** A non-sensor source app mirrors when, over the last 30 days, at least this
 *  many of its readings exist (stored plus the batch)... */
export const MIRROR_MIN_SAMPLES = 6;
/** ...and at least this share of them sit within SENSOR_MIRROR_WINDOW_MS and
 *  the tolerance of a sensor row of another stream. */
export const MIRROR_MIN_SHARE = 0.8;
export const MIRROR_HISTORY_DAYS = 30;
/** A source app counts as a known sensor only with this many sensor rows in the
 *  last 30 days (same number as lib/cgm/detect CGM_HINT_MIN_SAMPLES): one row
 *  made by a chance match must not turn every later reading of a glucometer app
 *  into a sensor reading. */
export const KNOWN_CGM_MIN_ROWS = 12;

/** Placeholders: profile_id, source, [source_app], since (ISO). `appClause` is
 *  "source_app IS NULL" or "source_app = ?". One row {c}: sensor rows, capped at
 *  KNOWN_CGM_MIN_ROWS. Known when c >= KNOWN_CGM_MIN_ROWS. */
export function knownCgmSql(appClause: string): string {
  return `SELECT COUNT(*) AS c FROM (
      SELECT 1 FROM sugar_logs
       WHERE profile_id = ? AND source = ? AND ${appClause}
         AND is_cgm = 1 AND logged_at >= ? LIMIT ${KNOWN_CGM_MIN_ROWS}
    );`;
}

/**
 * True when some row was refused only for being dated ahead of the clock (more
 * than the slack, less than a day). The caller then keeps its read cursor where
 * it is, so the next sync reads the row again once its time has come.
 */
export function hasRetryableFutureRow(
  rows: readonly { at: string }[],
  nowMs: number = Date.now()
): boolean {
  for (const r of rows) {
    const ms = Date.parse(r.at);
    if (!Number.isFinite(ms)) continue;
    if (ms > nowMs + IMPORT_FUTURE_SLACK_MS && ms <= nowMs + IMPORT_FUTURE_RETRY_MAX_MS) return true;
  }
  return false;
}
/** Sensor readings outside this range are not sensor values (LOW/HIGH codes). */
export const CGM_MGDL_MIN = 20;
export const CGM_MGDL_MAX = 600;

const LEGACY_WINDOW_MS = SUGAR_DEDUP_WINDOW_MINUTES * 60_000;
/** The widest window any rule looks at. */
const MAX_WINDOW_MS = LEGACY_WINDOW_MS;

export interface PlanCandidate {
  atMs: number;
  mgdl: number;
  source: string;
  sourceApp: string | null;
  externalId: string | null;
  isCgm: boolean;
}

export interface PlanExisting {
  /** Row id; needed to take over a pre-2.5.0 row. */
  id?: string;
  atMs: number;
  mgdl: number;
  source: string;
  sourceApp: string | null;
  externalId: string | null;
  isCgm: boolean;
  /** True when the user labelled the row (period_tag other than 'unset') or a
   *  meal points at it: such a row is theirs and never becomes a sensor
   *  reading. */
  tagged?: boolean;
}

/** A reading the user deleted or corrected (schema v28). */
export interface PlanTombstone {
  atMs: number;
  mgdl: number;
}

export interface GlucoseImportPlan {
  /** Indexes into the candidate array, in time order. */
  insert: number[];
  /** Existing rows that already ARE a candidate: they get the source's id,
   *  app and sensor flag instead of a second row being added. */
  own: { existingId: string; candidate: number }[];
  /** Plain stored rows that are the mirror of a sensor candidate that arrived
   *  later (rule 4c): they become sensor rows and the candidate adds nothing. */
  markCgm: string[];
}

function lowerBound(sortedMs: number[], target: number): number {
  let lo = 0;
  let hi = sortedMs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedMs[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Whether a stored id-less row may be taken over by candidate c. A sensor
 * candidate never turns a labelled row into a sensor reading, and a plain
 * (non-sensor) stored row only when it is the very same value a minute apart at
 * most; a sensor row is taken over by a sensor candidate, a plain row by a plain
 * one.
 */
function canTakeOver(c: PlanCandidate, e: PlanExisting, dt: number, dv: number): boolean {
  if (e.isCgm === c.isCgm) return true;
  if (!c.isCgm) return false;
  return !e.tagged && dv === 0 && dt <= TAKE_OVER_LEGACY_MS;
}

/** Rule 4c: a stored plain row that a sensor candidate of another stream
 *  mirrors. Never a typed ('manual') row, never one the user labelled or a meal
 *  uses. `windowMs` is the stored row's app's mirror window. */
function isStoredMirror(c: PlanCandidate, e: PlanExisting, dt: number, dv: number, windowMs: number): boolean {
  return (
    c.isCgm &&
    !e.isCgm &&
    Boolean(e.id) &&
    e.source !== "manual" &&
    !e.tagged &&
    dt <= windowMs &&
    dv <= SAME_READING_TOLERANCE_MGDL
  );
}

/** Rule 4b: see SENSOR_MIRROR_WINDOW_MS. `windowMs` is the candidate's app's. */
function isSensorMirror(
  c: PlanCandidate,
  otherIsCgm: boolean,
  cStream: string,
  otherStream: string,
  dt: number,
  dv: number,
  windowMs: number
): boolean {
  return (
    !c.isCgm &&
    otherIsCgm &&
    otherStream !== cStream &&
    dt <= windowMs &&
    dv <= SAME_READING_TOLERANCE_MGDL
  );
}

export interface MirrorPoint {
  atMs: number;
  mgdl: number;
  /** streamKey(source, sourceApp) */
  stream: string;
}

/**
 * Which non-sensor source apps mirror a sensor: of an app's readings (stored
 * plus this batch, last 30 days) at least MIRROR_MIN_SAMPLES exist and at least
 * MIRROR_MIN_SHARE of them match a sensor row of another stream within 30 s and
 * +-1 mg/dL. A glucometer app has the odd chance match, a mirror has nearly all.
 * O(n log n).
 */
export function findMirrorStreams(plain: readonly MirrorPoint[], sensor: readonly MirrorPoint[]): Set<string> {
  const total = new Map<string, number>();
  for (const p of plain) total.set(p.stream, (total.get(p.stream) ?? 0) + 1);
  const eligible = new Set<string>();
  for (const [k, n] of total) if (n >= MIRROR_MIN_SAMPLES) eligible.add(k);
  const out = new Set<string>();
  if (eligible.size === 0 || sensor.length === 0) return out;
  const sorted = [...sensor].sort((a, b) => a.atMs - b.atMs);
  const ms = sorted.map((s) => s.atMs);
  const hit = new Map<string, number>();
  for (const p of plain) {
    if (!eligible.has(p.stream)) continue;
    for (
      let i = lowerBound(ms, p.atMs - SENSOR_MIRROR_WINDOW_MS);
      i < sorted.length && ms[i] <= p.atMs + SENSOR_MIRROR_WINDOW_MS;
      i++
    ) {
      if (sorted[i].stream !== p.stream && Math.abs(sorted[i].mgdl - p.mgdl) <= SAME_READING_TOLERANCE_MGDL) {
        hit.set(p.stream, (hit.get(p.stream) ?? 0) + 1);
        break;
      }
    }
  }
  for (const k of eligible) {
    if ((hit.get(k) ?? 0) >= MIRROR_MIN_SHARE * (total.get(k) ?? 1)) out.add(k);
  }
  return out;
}

const NO_MIRROR_STREAMS: ReadonlySet<string> = new Set();

function streamKey(source: string, sourceApp: string | null): string {
  return `${source}\u0000${sourceApp ?? ""}`;
}

/**
 * Pure planner, O(n log n): which candidates to insert and which old rows to
 * take over. `existing` and `tombstones` are treated as read-only; accepted
 * candidates join a local, time-ordered list so two samples of the SAME batch
 * collapse the same way a sample and a stored row do.
 *
 * Rules, in order, for a candidate c (time-sorted):
 *  1. The same source and external id already exists (or came earlier in the
 *     batch): skip.
 *  2. A tombstone of the same value inside the legacy 15 minute window (a
 *     sensor reading: inside 150 s and +-1 mg/dL) means the user removed it: skip.
 *  3. An old row of the same source without an external id, within 150 s and
 *     +-1 mg/dL, is the same reading imported before ids existed: take it over
 *     (never a 'manual' row), insert nothing. A sensor candidate takes over a
 *     sensor row, or a plain untagged row of the very same value a minute
 *     apart at most; a row the user labelled never becomes a sensor reading.
 *  4. A row of ANOTHER source or app within 150 s and +-1 mg/dL is the same
 *     reading seen twice: skip. This is what keeps a typed reading, or the one
 *     Nightscout already delivered, from appearing twice. First in stays. A
 *     NON-sensor candidate is never dropped for sitting next to a sensor row:
 *     a glucometer reading one minute after a sensor value is its own
 *     measurement.
 *  4b. A NON-sensor candidate of a source app that MIRRORS a sensor (see
 *     findMirrorStreams: >= 6 readings in 30 days, >= 80 % of them within 30 s
 *     and +-1 mg/dL of a sensor row of another stream) and within 30 s of such
 *     a row is that sensor value mirrored: skip, or it would be stored as a
 *     hand-read row (double count, and the dose path would take it for a typed
 *     reading). Any other app only at 5 s: a real fingerstick lands within 30 s
 *     and +-1 mg/dL of a sensor value by chance and stays.
 *  4c. A SENSOR candidate within the same window (30 s for a mirroring app, 5 s
 *     otherwise) and +-1 mg/dL of a stored plain row of another stream (not
 *     typed, not labelled, no meal pointing at it) is the value that row mirrors,
 *     which arrived in the wrong order: the row becomes the sensor row
 *     (markCgm) and the candidate adds nothing, so neither a second copy nor a
 *     hand-read row that could feed a dose is left. This also holds when the
 *     candidate itself is thinned away by rule 5. Within one batch the sensor
 *     candidates are planned first for the same reason.
 *  5. A sensor reading closer than 270 s to a kept reading of the same app is
 *     thinned away (a 1 minute stream becomes about 5 minutes).
 *  6. A NON-sensor reading with the same value within 15 minutes of a
 *     non-sensor row is the old "typed twice" duplicate. Sensor rows are not
 *     part of this rule, and neither is a sensor candidate: consecutive equal
 *     readings of a flat stretch are real.
 */
export function planGlucoseImport(
  candidates: readonly PlanCandidate[],
  existing: readonly PlanExisting[],
  tombstones: readonly PlanTombstone[] = [],
  mirrorStreams: ReadonlySet<string> = NO_MIRROR_STREAMS
): GlucoseImportPlan {
  const mirrorWindow = (stream: string): number =>
    mirrorStreams.has(stream) ? SENSOR_MIRROR_WINDOW_MS : SENSOR_MIRROR_EXACT_MS;
  const ex = existing.map((e) => ({ ...e })).sort((a, b) => a.atMs - b.atMs);
  const exMs = ex.map((e) => e.atMs);
  const tomb = [...tombstones].sort((a, b) => a.atMs - b.atMs);
  const tombMs = tomb.map((t) => t.atMs);

  const order = candidates
    .map((_, i) => i)
    .sort(
      (a, b) =>
        Number(candidates[b].isCgm) - Number(candidates[a].isCgm) || candidates[a].atMs - candidates[b].atMs || a - b
    );

  const extKeys = new Set<string>();
  for (const e of ex) {
    if (e.externalId) extKeys.add(`${e.source}\u0000${e.externalId}`);
  }
  const owned = new Set<number>();
  const accepted: PlanCandidate[] = [];
  const acceptedMs: number[] = [];
  const insert: number[] = [];
  const own: { existingId: string; candidate: number }[] = [];
  const markCgm: string[] = [];

  for (const ci of order) {
    const c = candidates[ci];
    const key = c.externalId ? `${c.source}\u0000${c.externalId}` : null;
    if (key && extKeys.has(key)) continue;

    // Tombstones.
    let removed = false;
    for (let i = lowerBound(tombMs, c.atMs - MAX_WINDOW_MS); i < tomb.length && tombMs[i] <= c.atMs + MAX_WINDOW_MS; i++) {
      const dt = Math.abs(tomb[i].atMs - c.atMs);
      if (c.isCgm) {
        if (dt <= SAME_READING_WINDOW_MS && Math.abs(tomb[i].mgdl - c.mgdl) <= SAME_READING_TOLERANCE_MGDL) {
          removed = true;
          break;
        }
      } else if (tomb[i].mgdl === c.mgdl && dt <= LEGACY_WINDOW_MS) {
        removed = true;
        break;
      }
    }
    if (removed) continue;

    const cStream = streamKey(c.source, c.sourceApp);
    let skip = false;
    let thinned = false;
    let takeOver: PlanExisting | null = null;
    let takeOverIdx = -1;
    let takeOverDt = Infinity;
    const mirrors: PlanExisting[] = [];
    // A mirroring app's stored copy of a sensor value turns into the sensor row.
    // Also when the sensor original is itself thinned away (a 1 minute stream),
    // or the copy would stay a hand-read row.
    const foldMirrors = (): void => {
      for (const m of mirrors) {
        m.isCgm = true;
        markCgm.push(m.id as string);
      }
      mirrors.length = 0;
    };

    const lo = lowerBound(exMs, c.atMs - MAX_WINDOW_MS);
    for (let i = lo; i < ex.length && exMs[i] <= c.atMs + MAX_WINDOW_MS; i++) {
      const e = ex[i];
      const dt = Math.abs(e.atMs - c.atMs);
      const dv = Math.abs(e.mgdl - c.mgdl);
      const tight = dt <= SAME_READING_WINDOW_MS && dv <= SAME_READING_TOLERANCE_MGDL;

      if (
        tight &&
        key &&
        e.id &&
        !e.externalId &&
        e.source === c.source &&
        e.source !== "manual" &&
        (e.sourceApp == null || e.sourceApp === c.sourceApp) &&
        canTakeOver(c, e, dt, dv) &&
        !owned.has(i) &&
        dt < takeOverDt
      ) {
        takeOver = e;
        takeOverIdx = i;
        takeOverDt = dt;
        continue;
      }
      const eStream = streamKey(e.source, e.sourceApp);
      if (tight && (c.isCgm || !e.isCgm) && eStream !== cStream) {
        if (isStoredMirror(c, e, dt, dv, mirrorWindow(eStream))) {
          mirrors.push(e);
          continue;
        }
        skip = true;
        break;
      }
      if (isSensorMirror(c, e.isCgm, cStream, eStream, dt, dv, mirrorWindow(cStream))) {
        skip = true;
        break;
      }
      if (c.isCgm && e.isCgm && dt < CGM_THINNING_MS && eStream === cStream) {
        skip = true;
        thinned = true;
      }
      if (!c.isCgm && !e.isCgm && e.mgdl === c.mgdl && dt <= LEGACY_WINDOW_MS) {
        skip = true;
        break;
      }
    }
    if (skip) {
      if (thinned) foldMirrors();
      continue;
    }
    if (takeOver) {
      owned.add(takeOverIdx);
      own.push({ existingId: takeOver.id as string, candidate: ci });
      if (key) extKeys.add(key);
      continue;
    }

    for (let i = lowerBound(acceptedMs, c.atMs - MAX_WINDOW_MS); i < accepted.length && acceptedMs[i] <= c.atMs + MAX_WINDOW_MS; i++) {
      const a = accepted[i];
      const dt = Math.abs(c.atMs - a.atMs);
      const dv = Math.abs(a.mgdl - c.mgdl);
      const tight = dt <= SAME_READING_WINDOW_MS && dv <= SAME_READING_TOLERANCE_MGDL;
      if (tight && (c.isCgm || !a.isCgm) && streamKey(a.source, a.sourceApp) !== cStream) {
        skip = true;
        break;
      }
      if (isSensorMirror(c, a.isCgm, cStream, streamKey(a.source, a.sourceApp), dt, dv, mirrorWindow(cStream))) {
        skip = true;
        break;
      }
      if (c.isCgm && a.isCgm && dt < CGM_THINNING_MS && streamKey(a.source, a.sourceApp) === cStream) {
        skip = true;
        thinned = true;
      }
      if (!c.isCgm && !a.isCgm && a.mgdl === c.mgdl && dt <= LEGACY_WINDOW_MS) {
        skip = true;
        break;
      }
    }
    if (skip) {
      if (thinned) foldMirrors();
      continue;
    }

    if (mirrors.length > 0) {
      foldMirrors();
      if (key) extKeys.add(key);
      continue;
    }

    const at = lowerBound(acceptedMs, c.atMs + 1);
    accepted.splice(at, 0, c);
    acceptedMs.splice(at, 0, c.atMs);
    if (key) extKeys.add(key);
    insert.push(ci);
  }
  insert.sort((a, b) => candidates[a].atMs - candidates[b].atMs || a - b);
  return { insert, own, markCgm };
}

/**
 * The 2.3.1 rule, kept as the one-call form for the non-sensor Health path and
 * its tests: a sample is a duplicate of an existing reading of ANY source -
 * manual or a previous import - when they carry the same value (mg/dL, exact
 * match) and are within `windowMinutes` of each other (2.3.1 P3, bulgu 3d).
 * A manual entry the user typed for a measurement they ALSO have in Apple
 * Health must block the import of that same measurement, or the reading lands
 * twice in the journal.
 *
 * `existing` is treated as read-only; accepted samples are absorbed too, so two
 * identical samples in the SAME batch also collapse into one insert. The result
 * keeps the input order.
 */
export function planHealthImport(
  samples: HealthSugarSample[],
  existing: ExistingSugarReading[],
  windowMinutes: number = SUGAR_DEDUP_WINDOW_MINUTES
): HealthSugarSample[] {
  const windowMs = windowMinutes * 60_000;
  const candidates: PlanCandidate[] = samples.map((s) => ({
    atMs: Date.parse(s.logged_at),
    mgdl: Math.round(s.glucose_level_mgdl),
    source: "health",
    sourceApp: null,
    externalId: null,
    isCgm: false,
  }));
  const rows: PlanExisting[] = existing.map((r) => ({
    atMs: Date.parse(r.logged_at),
    mgdl: Math.round(r.glucose_level_mgdl),
    source: "health",
    sourceApp: null,
    externalId: null,
    isCgm: false,
  }));
  if (windowMs === LEGACY_WINDOW_MS) {
    const plan = planGlucoseImport(candidates, rows);
    return plan.insert.sort((a, b) => a - b).map((i) => samples[i]);
  }
  return planWindowed(samples, candidates, rows, windowMs);
}

/** planHealthImport with a window other than the shared 15 minutes. */
function planWindowed(
  samples: HealthSugarSample[],
  candidates: PlanCandidate[],
  rows: PlanExisting[],
  windowMs: number
): HealthSugarSample[] {
  const ex = [...rows].sort((a, b) => a.atMs - b.atMs);
  const exMs = ex.map((e) => e.atMs);
  const order = candidates.map((_, i) => i).sort((a, b) => candidates[a].atMs - candidates[b].atMs || a - b);
  const accepted: PlanCandidate[] = [];
  const keep: number[] = [];
  for (const ci of order) {
    const c = candidates[ci];
    let dup = false;
    for (let i = lowerBound(exMs, c.atMs - windowMs); i < ex.length && exMs[i] <= c.atMs + windowMs; i++) {
      if (ex[i].mgdl === c.mgdl) {
        dup = true;
        break;
      }
    }
    if (!dup) {
      for (let i = accepted.length - 1; i >= 0; i--) {
        if (c.atMs - accepted[i].atMs > windowMs) break;
        if (accepted[i].mgdl === c.mgdl) {
          dup = true;
          break;
        }
      }
    }
    if (dup) continue;
    accepted.push(c);
    keep.push(ci);
  }
  return keep.sort((a, b) => a - b).map((i) => samples[i]);
}

/** How long a connection waits for another writer's lock before "database is
 *  locked". SQLite's default is 0, so a write that overlapped the Health
 *  import's transaction failed at once and was lost. Set on the main
 *  connection (getDb) and on the import's own transaction connection. */
export const BUSY_TIMEOUT_SQL = "PRAGMA busy_timeout = 5000;";

/** Samples per import transaction. A 90 day CGM backfill is ~26k rows; one
 *  transaction held the write lock for seconds. Chunks stay short, and the
 *  dedupe of a chunk sees the committed rows of the one before. */
export const HEALTH_IMPORT_CHUNK_SIZE = 200;

/** Tombstones older than this can no longer match anything a sync reads
 *  (30/90 day windows) and are dropped on the next import. */
const TOMBSTONE_KEEP_DAYS = 180;

export interface HealthImportStatement {
  executeAsync(params: (string | number | null)[]): Promise<unknown>;
  finalizeAsync(): Promise<void>;
}

export interface HealthImportSql {
  execAsync(source: string): Promise<void>;
  getAllAsync<T>(source: string, params: (string | number | null)[]): Promise<T[]>;
  runAsync(source: string, params: (string | number | null)[]): Promise<unknown>;
  prepareAsync(source: string): Promise<HealthImportStatement>;
}

export interface HealthImportHost {
  withExclusiveTransactionAsync(task: (txn: HealthImportSql) => Promise<void>): Promise<void>;
}

/** The first statement of every chunk. withExclusiveTransactionAsync opens its
 *  transaction with a plain (deferred) BEGIN, so a read as the first statement
 *  would pin a read snapshot, and the first write after another connection's
 *  commit would fail at once with "database is locked" - busy_timeout cannot
 *  help a stale snapshot. A write first takes the lock under the busy timeout.
 *  It also repairs a floor set while the device clock was ahead: a floor in the
 *  future would block every reading until the clock caught up. Placeholders:
 *  now, profile_id, now. */
const WRITE_FIRST_CLAMP_FLOOR_SQL =
  "UPDATE health_import_floor SET floor_at = ? WHERE profile_id = ? AND floor_at > ?;";

interface ExistingRowSql {
  id: string;
  logged_at: string;
  glucose_level_mgdl: number;
  source: string;
  source_app: string | null;
  external_id: string | null;
  is_cgm: number;
  period_tag: string;
  meal_linked: number;
}

interface NormalizedRow {
  iso: string;
  atMs: number;
  mgdl: number;
  source: GlucoseSource;
  sourceApp: string | null;
  externalId: string | null;
  isCgm: boolean;
  periodTag: PeriodTag;
}

function normalizeRows(rows: readonly ImportedGlucoseRow[], nowMs: number): NormalizedRow[] {
  const out: NormalizedRow[] = [];
  for (const r of rows) {
    if ((r.source as string) === "manual") continue;
    const atMs = Date.parse(r.at);
    if (!Number.isFinite(atMs) || atMs > nowMs + IMPORT_FUTURE_SLACK_MS) continue;
    const mgdl = Math.round(r.mgdl);
    if (!Number.isFinite(mgdl) || mgdl <= 0) continue;
    if (r.isCgm && (mgdl < CGM_MGDL_MIN || mgdl > CGM_MGDL_MAX)) continue;
    const externalId = typeof r.externalId === "string" && r.externalId.trim() ? r.externalId.trim().slice(0, 200) : null;
    const sourceApp = typeof r.sourceApp === "string" && r.sourceApp.trim() ? r.sourceApp.trim().slice(0, 128) : null;
    out.push({
      iso: new Date(atMs).toISOString(),
      atMs,
      mgdl,
      source: r.source,
      sourceApp,
      externalId,
      isCgm: r.isCgm,
      periodTag: r.periodTag ?? "unset",
    });
  }
  out.sort((a, b) => a.atMs - b.atMs);
  return out;
}

/** The time ranges a chunk's existing-row and tombstone lookups must cover. A
 *  dense chunk is one range; a sparse one (a few glucometer readings across
 *  weeks) is a handful of small ranges instead of weeks of stored sensor rows. */
function lookupRanges(sortedMs: number[]): [number, number][] {
  const ranges: [number, number][] = [];
  for (const t of sortedMs) {
    const from = t - MAX_WINDOW_MS;
    const to = t + MAX_WINDOW_MS;
    const last = ranges[ranges.length - 1];
    if (last && from <= last[1] + 2 * 60 * 60_000) last[1] = Math.max(last[1], to);
    else ranges.push([from, to]);
  }
  if (ranges.length > 8) return [[ranges[0][0], ranges[ranges.length - 1][1]]];
  return ranges;
}

/**
 * The source apps of this call that mirror a sensor (findMirrorStreams), from
 * the last 30 days of stored rows plus the whole batch. A batch row that the
 * profile already has (same source and external id: a re-read) counts once.
 * Runs once per import call, inside its first transaction; the sensor rows are
 * only loaded when some app has enough readings to be judged.
 */
async function loadMirrorStreams(
  txn: HealthImportSql,
  profileId: string,
  batch: readonly NormalizedRow[],
  nowMs: number
): Promise<ReadonlySet<string>> {
  const sinceMs = nowMs - MIRROR_HISTORY_DAYS * 86_400_000;
  const since = new Date(sinceMs).toISOString();
  const stored = await txn.getAllAsync<{
    source: string;
    source_app: string | null;
    external_id: string | null;
    logged_at: string;
    glucose_level_mgdl: number;
  }>(
    `SELECT source, source_app, external_id, logged_at, glucose_level_mgdl FROM sugar_logs
      WHERE profile_id = ? AND is_cgm = 0 AND source <> 'manual' AND logged_at >= ?;`,
    [profileId, since]
  );
  const plain: MirrorPoint[] = [];
  const seen = new Set<string>();
  for (const r of stored) {
    if (r.external_id) seen.add(`${r.source} ${r.external_id}`);
    plain.push({
      atMs: Date.parse(r.logged_at),
      mgdl: Math.round(r.glucose_level_mgdl),
      stream: streamKey(r.source, r.source_app),
    });
  }
  const sensor: MirrorPoint[] = [];
  for (const r of batch) {
    if (r.atMs < sinceMs - SENSOR_MIRROR_WINDOW_MS) continue;
    const stream = streamKey(r.source, r.sourceApp);
    if (r.isCgm) sensor.push({ atMs: r.atMs, mgdl: r.mgdl, stream });
    else if (!r.externalId || !seen.has(`${r.source} ${r.externalId}`)) plain.push({ atMs: r.atMs, mgdl: r.mgdl, stream });
  }
  const counts = new Map<string, number>();
  for (const p of plain) counts.set(p.stream, (counts.get(p.stream) ?? 0) + 1);
  let judged = false;
  for (const n of counts.values()) if (n >= MIRROR_MIN_SAMPLES) judged = true;
  if (!judged) return NO_MIRROR_STREAMS;

  const storedSensor = await txn.getAllAsync<{
    source: string;
    source_app: string | null;
    logged_at: string;
    glucose_level_mgdl: number;
  }>(
    `SELECT source, source_app, logged_at, glucose_level_mgdl FROM sugar_logs
      WHERE profile_id = ? AND is_cgm = 1 AND logged_at >= ?;`,
    [profileId, since]
  );
  for (const r of storedSensor) {
    sensor.push({
      atMs: Date.parse(r.logged_at),
      mgdl: Math.round(r.glucose_level_mgdl),
      stream: streamKey(r.source, r.source_app),
    });
  }
  return findMirrorStreams(plain, sensor);
}

async function importChunk(
  txn: HealthImportSql,
  profileId: string,
  chunk: NormalizedRow[],
  newId: () => string,
  mirrorStreams: ReadonlySet<string>
): Promise<number> {
  const floorRow = (
    await txn.getAllAsync<{ floor_at: string }>(
      "SELECT floor_at FROM health_import_floor WHERE profile_id = ?;",
      [profileId]
    )
  )[0];
  const rows = floorRow ? chunk.filter((s) => s.iso > floorRow.floor_at) : chunk;
  if (rows.length === 0) return 0;

  const existingById = new Map<string, ExistingRowSql>();
  const tombstones: PlanTombstone[] = [];
  for (const [fromMs, toMs] of lookupRanges(rows.map((r) => r.atMs))) {
    const from = new Date(fromMs).toISOString();
    const to = new Date(toMs).toISOString();
    const found = await txn.getAllAsync<ExistingRowSql>(
      `SELECT id, logged_at, glucose_level_mgdl, source, source_app, external_id, is_cgm, period_tag,
              EXISTS(SELECT 1 FROM meal_logs WHERE sugar_log_id = sugar_logs.id) AS meal_linked
         FROM sugar_logs
        WHERE profile_id = ? AND logged_at BETWEEN ? AND ?;`,
      [profileId, from, to]
    );
    for (const r of found) existingById.set(r.id, r);
    const removed = await txn.getAllAsync<ExistingSugarReading>(
      `SELECT logged_at, glucose_level_mgdl FROM health_import_tombstones
        WHERE profile_id = ? AND logged_at BETWEEN ? AND ?;`,
      [profileId, from, to]
    );
    for (const t of removed) {
      tombstones.push({ atMs: Date.parse(t.logged_at), mgdl: Math.round(t.glucose_level_mgdl) });
    }
  }

  const existing: PlanExisting[] = [...existingById.values()].map((r) => ({
    id: r.id,
    atMs: Date.parse(r.logged_at),
    mgdl: r.glucose_level_mgdl,
    source: r.source,
    sourceApp: r.source_app,
    externalId: r.external_id,
    isCgm: r.is_cgm === 1,
    tagged: r.period_tag !== "unset" || r.meal_linked === 1,
  }));
  const plan = planGlucoseImport(rows, existing, tombstones, mirrorStreams);

  for (const o of plan.own) {
    const c = rows[o.candidate];
    await txn.runAsync(
      `UPDATE OR IGNORE sugar_logs SET external_id = ?, source_app = ?, is_cgm = ?
        WHERE id = ? AND source <> 'manual' AND external_id IS NULL;`,
      [c.externalId, c.sourceApp, c.isCgm ? 1 : 0, o.existingId]
    );
  }
  for (const id of plan.markCgm) {
    await txn.runAsync(
      `UPDATE OR IGNORE sugar_logs SET is_cgm = 1
        WHERE id = ? AND source <> 'manual' AND period_tag = 'unset' AND is_cgm = 0
          AND NOT EXISTS (SELECT 1 FROM meal_logs WHERE sugar_log_id = sugar_logs.id);`,
      [id]
    );
  }
  if (plan.insert.length === 0) return 0;

  // One prepared statement for the whole chunk: parsed once, bound per row.
  const insert = await txn.prepareAsync(
    `INSERT INTO sugar_logs
       (id, profile_id, glucose_level_mgdl, period_tag, source, logged_at, tags,
        source_app, external_id, is_cgm)
     VALUES (?, ?, ?, ?, ?, ?, '[]', ?, ?, ?)
     ON CONFLICT DO NOTHING;`
  );
  try {
    for (const ci of plan.insert) {
      const c = rows[ci];
      await insert.executeAsync([
        newId(),
        profileId,
        c.mgdl,
        c.periodTag,
        c.source,
        c.iso,
        c.sourceApp,
        c.externalId,
        c.isCgm ? 1 : 0,
      ]);
    }
  } finally {
    await insert.finalizeAsync();
  }
  return plan.insert.length;
}

/**
 * Imports readings from any source in time-ordered chunks, one exclusive
 * transaction each, and returns how many rows were new. A reading the user
 * deleted or corrected (tombstone, schema v28) or that predates the last
 * "Verileri sil" (import floor) is treated like one that already exists. An
 * interrupted run leaves whole chunks behind; the next sync dedupes against them.
 */
export async function importGlucoseRows(
  host: HealthImportHost,
  profileId: string,
  rows: readonly ImportedGlucoseRow[],
  newId: () => string,
  nowMs: number = Date.now()
): Promise<number> {
  const sorted = normalizeRows(rows, nowMs);
  if (sorted.length === 0) return 0;
  const nowIso = new Date(nowMs).toISOString();
  const pruneBefore = new Date(nowMs - TOMBSTONE_KEEP_DAYS * 86_400_000).toISOString();

  let inserted = 0;
  let mirrorStreams: ReadonlySet<string> | null = null;
  for (let i = 0; i < sorted.length; i += HEALTH_IMPORT_CHUNK_SIZE) {
    const chunk = sorted.slice(i, i + HEALTH_IMPORT_CHUNK_SIZE);
    let n = 0;
    await host.withExclusiveTransactionAsync(async (txn) => {
      await txn.execAsync(BUSY_TIMEOUT_SQL);
      await txn.runAsync(WRITE_FIRST_CLAMP_FLOOR_SQL, [nowIso, profileId, nowIso]);
      if (i === 0) {
        await txn.runAsync(
          "DELETE FROM health_import_tombstones WHERE profile_id = ? AND logged_at < ?;",
          [profileId, pruneBefore]
        );
      }
      if (mirrorStreams === null) mirrorStreams = await loadMirrorStreams(txn, profileId, sorted, nowMs);
      n = await importChunk(txn, profileId, chunk, newId, mirrorStreams);
    });
    inserted += n;
  }
  return inserted;
}

/**
 * The 2.4 entry point, kept for the plain Health sample shape: a non-sensor
 * Health reading with no id. Same pipeline as importGlucoseRows.
 */
export async function importHealthSamples(
  host: HealthImportHost,
  profileId: string,
  samples: HealthSugarSample[],
  newId: () => string,
  nowMs: number = Date.now()
): Promise<number> {
  return importGlucoseRows(
    host,
    profileId,
    samples.map((s) => ({
      at: s.logged_at,
      mgdl: s.glucose_level_mgdl,
      source: "health" as const,
      isCgm: false,
      periodTag: s.period_tag,
    })),
    newId,
    nowMs
  );
}

/** Ids per delete statement (SQLite's bound-variable limit is far above this). */
const DELETE_BY_ID_CHUNK = 400;

/**
 * Removes readings a source reported as deleted (HealthKit deletedSamples,
 * Health Connect deletion changes). Only rows that source imported can go:
 * the source must be an importer and a typed ('manual') row is excluded in the
 * statement itself. Returns how many rows were removed.
 */
export async function deleteImportedGlucose(
  host: HealthImportHost,
  profileId: string,
  source: GlucoseSource,
  externalIds: readonly string[]
): Promise<number> {
  if ((source as string) === "manual") return 0;
  const ids = [...new Set(externalIds.filter((id) => typeof id === "string" && id.length > 0))];
  let removed = 0;
  for (let i = 0; i < ids.length; i += DELETE_BY_ID_CHUNK) {
    const part = ids.slice(i, i + DELETE_BY_ID_CHUNK);
    await host.withExclusiveTransactionAsync(async (txn) => {
      await txn.execAsync(BUSY_TIMEOUT_SQL);
      // The marker insert is the first statement (a write, see
      // WRITE_FIRST_CLAMP_FLOOR_SQL) and tells the v28 delete trigger this is the
      // source's delete, not the user's: no tombstone. It never outlives the
      // transaction.
      await txn.runAsync("INSERT OR IGNORE INTO health_import_source_delete (k) VALUES (1);", []);
      // The transaction connection has foreign_keys off, so meal_logs.sugar_log_id
      // would keep pointing at a deleted row: unlink first, same statement scope.
      await txn.runAsync(
        `UPDATE meal_logs SET sugar_log_id = NULL
          WHERE sugar_log_id IN (
            SELECT id FROM sugar_logs
             WHERE profile_id = ? AND source = ? AND source <> 'manual'
               AND external_id IN (${part.map(() => "?").join(",")}));`,
        [profileId, source, ...part]
      );
      // RETURNING hands back what went, so no count query has to run before it.
      const gone = await txn.getAllAsync<{ id: string }>(
        `DELETE FROM sugar_logs
          WHERE profile_id = ? AND source = ? AND source <> 'manual'
            AND external_id IN (${part.map(() => "?").join(",")})
          RETURNING id;`,
        [profileId, source, ...part]
      );
      removed += gone.length;
      await txn.runAsync("DELETE FROM health_import_source_delete;", []);
    });
  }
  return removed;
}

/**
 * "Verileri sil": the floor and the deletes land in one transaction, floor
 * first so the delete trigger does not write a tombstone per reading. Samples
 * at or before `nowIso` are never imported again. The hourly sensor summaries
 * (schema v30) go with the readings.
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
    await txn.runAsync("DELETE FROM sugar_hourly WHERE profile_id = ?;", [profileId]);
  });
}
