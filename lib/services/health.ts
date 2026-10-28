import { AppState, Linking, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { logCrash } from "../analytics";
import {
  deleteImportedGlucoseByExternalIds,
  getImportedSourceHistory,
  getSugarLog,
  insertImportedGlucose,
  listHealthBackfillRows,
  listHealthMirrorRows,
  listHealthUuidLinks,
  listLinkedHealthUuids,
  setSugarLogHealthUuid,
} from "../db/logs";
import { hasRetryableFutureRow } from "../db/healthImportSql";
import { getProfile, listProfiles } from "../db/profiles";
import { detectCgmSource, type DetectSample } from "../cgm/detect";
import { isUserEntered } from "../glucoseSource";
import type { SugarLog } from "../db/types";
import { snapIso } from "./healthMath";
import {
  chunkBatches,
  selectBackfillCandidates,
  type HealthBackfillWindow,
} from "../healthBackfill";
import {
  HEALTH_DELETE_BATCH,
  enqueueDeletes,
  normalizeDeleteEntries,
  ownHealthUuids,
  pruneDeleteQueue,
  removeDeleted,
  selectDeletePass,
  type PendingDeleteEntry,
} from "../healthDeleteQueue";
import { buildHealthWriteMeta, nextSyncVersion, type HealthWriteMeta } from "../healthMeta";
import { planWriteFlagRead, shouldWriteToHealth } from "../healthWriteScope";
import {
  buildRetryStatusRecord,
  isRetryPassOpen,
  pruneWritePendingQueue,
  selectHealthRetryCandidates,
  type HealthWriteStatusRecord,
  type PendingWriteEntry,
} from "../healthWriteRetry";
import { healthAppleKit, prepareHealthKitWrite } from "./healthAppleKit";
import {
  healthConnect,
  getHealthConnectStatus as hcGetStatus,
  isReadPermissionBlocked,
  isWritePermissionBlocked,
} from "./healthConnect";
import { healthMock } from "./healthMock";
import { createImportShare } from "../healthConnectFlow";
import {
  ANDROID_GLUCOSE_PAGE_SIZE,
  ANDROID_SYNC_ROUND_MAX_SAMPLES,
  ANDROID_SYNC_WINDOW_DAYS,
  IOS_GLUCOSE_PAGE_SIZE,
  IOS_SYNC_ROUND_MAX_SAMPLES,
  SYNC_MAX_SAMPLES,
  SYNC_WINDOW_DAYS,
} from "./healthTypes";
import type {
  GlucosePage,
  GlucoseSample,
  HealthConnectStatus,
  HealthLastSync,
  HealthProvider,
  HealthSummary,
  HealthSyncError,
  HealthSyncSource,
  HealthWriteKind,
  InsulinKind,
  SyncResult,
} from "./healthTypes";

export type {
  GlucoseSample,
  SyncStatus,
  SyncResult,
  HealthSummary,
  HealthConnectStatus,
  HealthLastSync,
  HealthSyncError,
  HealthSyncSource,
  HealthWriteKind,
  InsulinKind,
} from "./healthTypes";
export type { HealthWriteStatusRecord } from "../healthWriteRetry";

/** Shared brand name for the on-device health store, plugged into i18n
 *  strings via the {{health}} placeholder. Single source of truth so it is
 *  never redefined per screen (see settings.healthSection / healthSectionAndroid
 *  for the alternate, per-locale-translated pick used by settings/paywall). */
export const HEALTH_NAME = Platform.OS === "ios" ? "Apple Health" : "Health Connect";

/** Base of the "mirror manual readings to Apple Health" preference (default
 *  OFF). Stored PER PROFILE at "<base>.<profileId>": one Health account serves
 *  the whole device, so on a family/caregiver install a device-wide flag pushed
 *  one profile's readings into another person's Health. */
const HEALTH_WRITE_KEY = "zerospike.healthWriteEnabled";
/** Mirrors AppContext's key: writes happen outside React (fire-and-forget from
 *  the add flow), so the active profile is resolved the same way there. */
const ACTIVE_PROFILE_KEY = "zerospike.activeProfile";
/** Read-only view of the Health auto-sync opt-in owned by CGM_KEY in
 *  app/(tabs)/index.tsx, so screens outside the dashboard can tell whether THIS
 *  profile connected Health at all. Values are "true"/"false" there. */
const HEALTH_SYNC_KEY = "zerospike.cgmSync";
/** Last attempted mirror write's outcome, PER PROFILE (same scoping as
 *  HEALTH_WRITE_KEY): a JSON-serialised {@link HealthWriteStatusRecord},
 *  shown as the status line under the write toggle (settings/data.tsx). */
const HEALTH_WRITE_STATUS_KEY = "zerospike.healthWriteStatus";
/**
 * CONSENT SCOPE (2.3.5 fix): the queue of sugar_logs ids the retry in
 * {@link retryPendingHealthWrites} is EVER allowed to touch, PER PROFILE. A
 * row joins this queue only from {@link writeGlucoseToHealthIfEnabled} at
 * the exact moment a write was attempted (toggle on, row eligible) and
 * failed - never merely because it "looks" pending (no uuid yet). Without
 * this, a scan-based retry would eventually reach - and silently write to
 * Health - readings the user logged while the mirror was OFF, which they
 * never agreed to have written at all.
 */
const HEALTH_WRITE_PENDING_KEY = "zerospike.healthWritePending";
/** Health sample ids whose revoke failed, retried on the write retry's
 *  triggers. DEVICE-wide (not per profile): a deleted profile's copies must
 *  still be retried once the profile is gone. Only ever holds ids this app
 *  wrote (see lib/healthDeleteQueue.ts). */
const HEALTH_DELETE_PENDING_KEY = "zerospike.healthDeletePending";

/** Glucose keeps its original queue keys; carbs and insulin get a kind
 *  segment ("<base>.<kind>.<profile>" / "<base>.<kind>") so a carb id can
 *  never be handed to the glucose delete call or retried as a reading. */
type QueueKind = "glucose" | HealthWriteKind;
function pendingWriteKey(profileId: string, kind: QueueKind): string {
  return kind === "glucose"
    ? `${HEALTH_WRITE_PENDING_KEY}.${profileId}`
    : `${HEALTH_WRITE_PENDING_KEY}.${kind}.${profileId}`;
}
function deleteQueueKey(kind: QueueKind): string {
  return kind === "glucose" ? HEALTH_DELETE_PENDING_KEY : `${HEALTH_DELETE_PENDING_KEY}.${kind}`;
}

/** Per-profile switches (default OFF except the background switch, see
 *  getHealthBgSyncEnabled). Values "1"/"0" like the glucose mirror flag. */
const HEALTH_BG_SYNC_KEY = "zerospike.healthBgSync";
const HEALTH_WRITE_KIND_KEYS: Record<HealthWriteKind, string> = {
  carbs: "zerospike.healthWriteCarbs",
  insulin: "zerospike.healthWriteInsulin",
};
const HEALTH_LAST_SYNC_KEY = "zerospike.healthLastSync";
/** Per profile (`<key>.<profileId>`): where the HealthKit anchored read resumes. */
const HEALTH_ANCHOR_KEY = "zerospike.healthHkAnchor";
/** Device-wide: set by the foreground (which knows the Pro state) so a
 *  background run, which has no React context, can honour the Pro gate. */
const HEALTH_BG_ENTITLED_KEY = "zerospike.healthBgEntitled";

/** Serializes async read-modify-write cycles on one AsyncStorage queue: two
 *  overlapping mutations would otherwise both read the same snapshot and the
 *  second write would drop the first one's change. */
function makeLock() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn, fn);
    tail = run.catch(() => {});
    return run;
  };
}
const writeQueueLock = makeLock();
const deleteQueueLock = makeLock();

/** Same resolution as lib/db/reminders.ts: saved id first, else the first
 *  profile. Never throws - a failed lookup is "no profile", like a fresh install. */
async function activeProfileId(): Promise<string | null> {
  try {
    const saved = await AsyncStorage.getItem(ACTIVE_PROFILE_KEY);
    const profile = saved ? await getProfile(saved) : null;
    if (profile) return profile.id;
    const fallback = (await listProfiles())[0];
    return fallback?.id ?? null;
  } catch {
    return null;
  }
}

/** The mirror flag AND the profile it belongs to, so callers can check a
 *  reading against it rather than trusting the flag alone. */
async function readHealthWriteScope(
  profileId?: string | null
): Promise<{ profileId: string | null; enabled: boolean }> {
  try {
    const id = profileId ?? (await activeProfileId());
    if (!id) return { profileId: null, enabled: false };
    const scopedKey = `${HEALTH_WRITE_KEY}.${id}`;
    const [scoped, legacy] = await Promise.all([
      AsyncStorage.getItem(scopedKey),
      AsyncStorage.getItem(HEALTH_WRITE_KEY),
    ]);
    const plan = planWriteFlagRead({ scoped, legacy });
    // One-time hand-off of the retired device-wide flag to whichever profile
    // reads it first, so no second profile can inherit the same opt-in.
    if (plan.adoptScoped != null) await AsyncStorage.setItem(scopedKey, plan.adoptScoped);
    if (plan.clearLegacy) await AsyncStorage.removeItem(HEALTH_WRITE_KEY);
    return { profileId: id, enabled: plan.enabled };
  } catch {
    return { profileId: null, enabled: false };
  }
}

/** Is the Apple Health mirror on for this profile (default: the active one)? */
export async function getHealthWriteEnabled(profileId?: string | null): Promise<boolean> {
  return (await readHealthWriteScope(profileId)).enabled;
}

export async function setHealthWriteEnabled(
  on: boolean,
  profileId?: string | null
): Promise<void> {
  try {
    const id = profileId ?? (await activeProfileId());
    if (!id) return;
    await AsyncStorage.setItem(`${HEALTH_WRITE_KEY}.${id}`, on ? "1" : "0");
    // Retire the device-wide key on any write too: a profile that has never
    // read the flag must not inherit a stale device-wide opt-in later.
    await AsyncStorage.removeItem(HEALTH_WRITE_KEY);
  } catch {
    // best-effort
  }
}

/** Persists the outcome of an attempted mirror write for this profile -
 *  best-effort, never thrown from a write path over it. `failedCount` is
 *  only meaningful (and only ever passed) for a whole RETRY PASS - see
 *  {@link buildRetryStatusRecord}; a single fresh write/correction never
 *  passes it, so the record reads as a plain single failure. */
async function recordHealthWriteStatus(
  profileId: string | null | undefined,
  ok: boolean,
  failedCount?: number
): Promise<void> {
  if (!profileId) return;
  try {
    const record: HealthWriteStatusRecord = {
      result: ok ? "success" : "failed",
      atIso: new Date().toISOString(),
      ...(ok || failedCount == null ? {} : { failedCount }),
    };
    await AsyncStorage.setItem(`${HEALTH_WRITE_STATUS_KEY}.${profileId}`, JSON.stringify(record));
  } catch {
    // best-effort
  }
}

/** Writes {@link HealthWriteStatusRecord} straight to storage - used by
 *  retryPendingHealthWrites, which already builds the exact record it wants
 *  (via buildRetryStatusRecord) rather than deriving one from a single
 *  ok/failedCount pair. */
async function saveHealthWriteStatus(
  profileId: string,
  record: HealthWriteStatusRecord
): Promise<void> {
  try {
    await AsyncStorage.setItem(`${HEALTH_WRITE_STATUS_KEY}.${profileId}`, JSON.stringify(record));
  } catch {
    // best-effort
  }
}

/** The entries currently queued for retry for this profile (see
 *  HEALTH_WRITE_PENDING_KEY's doc comment for the consent-scope rule they
 *  enforce). Corrupt/missing storage reads as an empty queue. Tolerates a
 *  bare id string too (defensive only - nothing in this codebase has ever
 *  stored the queue that way, but a malformed/hand-edited entry should not
 *  crash the read): it is given a fresh `queuedAtIso` rather than dropped.
 */
async function getPendingWriteEntries(
  profileId: string,
  kind: QueueKind = "glucose"
): Promise<PendingWriteEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(pendingWriteKey(profileId, kind));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const nowIso = new Date().toISOString();
    const out: PendingWriteEntry[] = [];
    for (const v of parsed) {
      if (typeof v === "string") out.push({ id: v, queuedAtIso: nowIso });
      else if (v && typeof v.id === "string" && typeof v.queuedAtIso === "string") {
        out.push({ id: v.id, queuedAtIso: v.queuedAtIso });
      }
    }
    return out;
  } catch {
    return [];
  }
}

async function savePendingWriteEntries(
  profileId: string,
  entries: readonly PendingWriteEntry[],
  kind: QueueKind = "glucose"
): Promise<void> {
  try {
    await AsyncStorage.setItem(pendingWriteKey(profileId, kind), JSON.stringify(entries));
  } catch {
    // best-effort
  }
}

/** The ids currently queued for retry - convenience for callers that only
 *  need membership/identity, not the queue timestamps. */
async function getPendingWriteIds(profileId: string): Promise<string[]> {
  return (await getPendingWriteEntries(profileId)).map((e) => e.id);
}

/** Queues one row for retry - called ONLY at the moment a write was
 *  actually attempted (toggle on, row eligible) and failed. Never called
 *  for a row that was simply never attempted. Also prunes the queue (2.3.5
 *  fix): every add is a natural point to drop what has aged out rather than
 *  letting the queue grow unbounded between retry passes. */
async function addPendingWriteId(
  profileId: string | null | undefined,
  id: string,
  kind: QueueKind = "glucose"
): Promise<void> {
  if (!profileId) return;
  await writeQueueLock(async () => {
    try {
      const nowMs = Date.now();
      let entries = pruneWritePendingQueue(await getPendingWriteEntries(profileId, kind), nowMs);
      if (!entries.some((e) => e.id === id)) {
        entries = pruneWritePendingQueue(
          [...entries, { id, queuedAtIso: new Date(nowMs).toISOString() }],
          nowMs
        );
      }
      await savePendingWriteEntries(profileId, entries, kind);
    } catch {
      // best-effort
    }
  });
}

/** Drops one or more ids from the retry queue - a successful (re)write, or
 *  a row that no longer exists locally. No-op on an empty list so a caller
 *  never has to guard the call itself. */
async function removePendingWriteIds(
  profileId: string,
  idsToRemove: readonly string[],
  kind: QueueKind = "glucose"
): Promise<void> {
  if (idsToRemove.length === 0) return;
  await writeQueueLock(async () => {
    try {
      const entries = await getPendingWriteEntries(profileId, kind);
      const remove = new Set(idsToRemove);
      const next = entries.filter((e) => !remove.has(e.id));
      if (next.length === entries.length) return;
      await savePendingWriteEntries(profileId, next, kind);
    } catch {
      // best-effort
    }
  });
}

/** Links a Health sample id to its row. The id also leaves the delete queue:
 *  Health Connect keeps the uuid on an upsert, so an id queued for deletion by
 *  an earlier undo can be the very sample this row now owns. */
async function linkHealthUuid(rowId: string, uuid: string): Promise<boolean> {
  if (!(await setSugarLogHealthUuid(rowId, uuid))) return false;
  await dequeueHealthDeletes([uuid]);
  return true;
}

/** Last attempted mirror write's outcome for this profile (default: the
 *  active one), or null when none has been attempted yet. Read by
 *  settings/data.tsx for the status line under the write toggle. */
export async function getHealthWriteStatus(
  profileId?: string | null
): Promise<HealthWriteStatusRecord | null> {
  try {
    const id = profileId ?? (await activeProfileId());
    if (!id) return null;
    const raw = await AsyncStorage.getItem(`${HEALTH_WRITE_STATUS_KEY}.${id}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<HealthWriteStatusRecord>;
    if (parsed.result !== "success" && parsed.result !== "failed") return null;
    if (typeof parsed.atIso !== "string") return null;
    // failedCount only ever comes from a retry-pass record (buildRetryStatusRecord) -
    // preserved here so a batch failure keeps its real count instead of the
    // caller falling back to "1" for a plain single-write failure.
    if (typeof parsed.failedCount === "number" && Number.isFinite(parsed.failedCount)) {
      return { result: parsed.result, atIso: parsed.atIso, failedCount: parsed.failedCount };
    }
    return { result: parsed.result, atIso: parsed.atIso };
  } catch {
    return null;
  }
}

/**
 * Whether this profile has Health auto-sync switched on (the dashboard toggle).
 * Read-only: the dashboard owns the toggle and its one-time move to a
 * per-profile key, so this never consumes the legacy value, it only mirrors it.
 */
export async function getHealthSyncEnabled(profileId?: string | null): Promise<boolean> {
  try {
    const id = profileId ?? (await activeProfileId());
    if (!id) return false;
    const scoped = await AsyncStorage.getItem(`${HEALTH_SYNC_KEY}.${id}`);
    if (scoped != null) return scoped === "true";
    return (await AsyncStorage.getItem(HEALTH_SYNC_KEY)) === "true";
  } catch {
    return false;
  }
}

/**
 * Apple Health (HealthKit) / Android Health Connect facade.
 *
 * A single DEBUG flag keeps everything simulated during development (no
 * device or CGM required), while a production build reads real
 * `BloodGlucose` samples from the platform health store.
 *
 * This module owns AsyncStorage/profile/scope state and the local-DB import,
 * and picks ONE {@link HealthProvider} per platform:
 *
 *   iOS     -> healthAppleKit.ts (@kingstinct/react-native-healthkit)
 *   Android -> healthConnect.ts  (react-native-health-connect)
 *   DEBUG   -> healthMock.ts     (simulated, either platform)
 *
 * Provider modules `require()` their native package INSIDE each function,
 * never at module scope, so this facade can statically import all three and
 * an iOS bundle never loads Health Connect (and vice versa).
 */
/** Dev builds simulate Health end to end. To exercise the REAL native path on
 *  a dev build, restart the bundler with EXPO_PUBLIC_REAL_HEALTH=1; the
 *  native module is already linked. */
export const DEBUG_MOCK_HEALTH =
  __DEV__ && process.env.EXPO_PUBLIC_REAL_HEALTH !== "1";

/** Picks the active provider for this run: the dev mock, or whichever native
 *  provider matches the CURRENT platform (never a lazy/deferred check). */
function getProvider(): HealthProvider | null {
  if (DEBUG_MOCK_HEALTH) return healthMock;
  if (Platform.OS === "ios") return healthAppleKit;
  if (Platform.OS === "android") return healthConnect;
  return null;
}

/** Is there ANY health provider wired up for this platform/build? Used by
 *  callers outside this module (e.g. glucoseEdit.ts) that need a platform
 *  gate without duplicating the DEBUG_MOCK_HEALTH / Platform.OS branching. */
export function hasHealthProvider(): boolean {
  return getProvider() != null;
}

// ── Availability & permissions ─────────────────────────────────────────────

export async function isHealthAvailable(): Promise<boolean> {
  const provider = getProvider();
  if (!provider) return false;
  try {
    return await provider.isAvailable();
  } catch {
    return false;
  }
}

export async function requestHealthPermissions(): Promise<boolean> {
  const provider = getProvider();
  if (!provider) return false;
  try {
    return await provider.requestReadPermissions();
  } catch {
    return false;
  }
}

/**
 * The connect flow: asks for read AND write blood-glucose access in one system
 * dialog. When the write grant is NEW (it was not authorized before this call),
 * the mirror switches on for the profile, because the user just said yes to it;
 * a grant that already existed leaves the profile's own switch alone, so a user
 * who turned the mirror off is never switched back on by reconnecting. A denial
 * is silent: nothing is switched on and nothing is reported.
 */
export async function requestHealthReadWriteAccess(
  profileId?: string | null,
  /** False once the run that asked was cancelled: a grant that arrives then must not switch the mirror on unannounced. */
  wanted: () => boolean = () => true
): Promise<{ read: boolean; write: boolean; writeEnabled: boolean; newlyEnabled: boolean }> {
  const provider = getProvider();
  if (!provider) return { read: false, write: false, writeEnabled: false, newlyEnabled: false };
  try {
    const wasAuthorized = await provider.isWriteAuthorized();
    const res = await provider.requestReadWritePermissions();
    let newlyEnabled = false;
    if (res.write && !wasAuthorized && wanted()) {
      const id = profileId ?? (await activeProfileId());
      if (id) {
        await setHealthWriteEnabled(true, id);
        newlyEnabled = true;
      }
    }
    const writeEnabled = res.write && (await getHealthWriteEnabled(profileId));
    return { read: res.read, write: res.write, writeEnabled, newlyEnabled };
  } catch {
    return { read: false, write: false, writeEnabled: false, newlyEnabled: false };
  }
}

/** Android-only: three-state Health Connect availability (missing / needs a
 *  Play update / ready), so a settings screen can send the user to the right
 *  place instead of a generic "unavailable". Always "unavailable" off Android. */
export async function getHealthConnectStatus(): Promise<HealthConnectStatus> {
  // Dev mock: healthMock is the active provider regardless of platform, so an
  // Android emulator running with DEBUG_MOCK_HEALTH must never fall through to
  // the REAL Health Connect SDK check (which reports "unavailable" there and
  // hides the Health card/section for the whole simulated flow).
  if (DEBUG_MOCK_HEALTH) return "available";
  if (Platform.OS !== "android") return "unavailable";
  try {
    return await hcGetStatus();
  } catch {
    return "unavailable";
  }
}

/** Android-only: true once a read/write permission request came back denied
 *  with the granted-permission list UNCHANGED across the call - the signal
 *  that the system dialog is silently no-oping (denied twice / restricted),
 *  so a caller should send the user to Settings instead of re-prompting. */
export function isHealthConnectPermissionBlocked(kind: "read" | "write"): boolean {
  if (Platform.OS !== "android") return false;
  return kind === "write" ? isWritePermissionBlocked() : isReadPermissionBlocked();
}

// ── Reads ──────────────────────────────────────────────────────────────────

/** Reads recent glucose from the platform health store (or the dev mock).
 *  The look-back window is per platform: Health Connect only grants 30 days
 *  by default (see ANDROID_SYNC_WINDOW_DAYS), HealthKit gets the full 90.
 *  A native failure rejects: an empty array means "nothing to read", never
 *  "the read failed", so the caller can keep the Android change token. */
export async function readRecentGlucose(): Promise<GlucoseSample[]> {
  const provider = getProvider();
  if (!provider) return [];
  const windowDays = Platform.OS === "android" ? ANDROID_SYNC_WINDOW_DAYS : SYNC_WINDOW_DAYS;
  return provider.readRecentGlucose(windowDays, SYNC_MAX_SAMPLES);
}

// ── Writes: mirror manual readings to the platform health store (opt-in) ────

/**
 * Requests WRITE (share) permission for blood glucose. Called at POINT OF USE -
 * when the user turns the "write to Health" toggle ON - never at onboarding.
 * Both platforms report the real outcome (iOS via authorizationStatusFor, which
 * is reliable for share types; Android via the grant list). The caller keeps
 * the toggle on only if this resolves true. iOS never re-shows the dialog once
 * denied, so a false there needs {@link openHealthSettings} guidance.
 */
export async function requestHealthWritePermission(): Promise<boolean> {
  const provider = getProvider();
  if (!provider) return false;
  try {
    return await provider.requestWritePermission();
  } catch {
    return false;
  }
}

/**
 * Set when a mirrored write to Health fails while the mirror toggle is ON -
 * most likely because Health write access was revoked in system Settings after
 * the toggle was switched on. Consumed ONCE by
 * {@link takeHealthWriteFailureNotice} so a caller can tell the user; the
 * toggle itself is NEVER flipped off here (H3): it must keep showing exactly
 * what the user set it to.
 */
let healthWriteFailureNoticePending = false;

/**
 * Returns true (and clears the flag) the first time it is called after a
 * mirrored write failed while the toggle was on. Returns false otherwise -
 * including every call after the first one for the same failure.
 */
export function takeHealthWriteFailureNotice(): boolean {
  if (!healthWriteFailureNoticePending) return false;
  healthWriteFailureNoticePending = false;
  return true;
}

/**
 * Session-scoped, independent of {@link healthWriteFailureNoticePending}
 * above (which drives the separate "tell me at the next manual sync" toast
 * on the dashboard): this one gates the NEW immediate toast shown right on
 * the screen that just tried to write a reading (index.tsx, calculator.tsx,
 * useJournalRows.tsx). Without it, a run of consecutive failed writes (e.g.
 * Health access revoked) would otherwise pop the same toast after every
 * single one.
 */
let healthWriteFailureToastShown = false;

/**
 * True the FIRST time it is called after a mirrored write failed while the
 * toggle was on, for the remaining lifetime of this app session; false on
 * every call after that (including across further failures). A caller shows
 * its "could not write to Health" toast only when this returns true.
 */
export function shouldAnnounceHealthWriteFailure(): boolean {
  if (healthWriteFailureToastShown) return false;
  healthWriteFailureToastShown = true;
  return true;
}

/**
 * One promise chain per sugar_logs row: every Health write, rewrite and revoke
 * of a reading starts only after the previous one for that reading settled.
 * Without it a correction made while the first write was still in flight was
 * dropped (the edit saw no link yet) and the first write then linked the old
 * value; and two writes of one reading landing out of order made HealthKit
 * refuse the older version, whose metadata-free retry left a second sample.
 * Never acquire a row's lock from inside that same row's locked section.
 */
const rowChains = new Map<string, Promise<void>>();

function withRowLock<T>(rowId: string, fn: () => Promise<T>): Promise<T> {
  const prev = rowChains.get(rowId) ?? Promise.resolve();
  const run = prev.then(fn);
  const tail = run.then(
    () => undefined,
    () => undefined
  );
  rowChains.set(rowId, tail);
  void tail.then(() => {
    if (rowChains.get(rowId) !== tail) return;
    rowChains.delete(rowId);
    // Settled means its native call returned, so the clock has moved past the
    // version it used; keeping the entry would only grow the map.
    lastSyncVersion.delete(rowId);
  });
  return run;
}

/** A native write or delete that never settles must not hold its row's lock,
 *  and with it every later edit of that reading, for the rest of the session. */
const NATIVE_TIMEOUT_MS = 30_000;
let nativeTimeoutMs = NATIVE_TIMEOUT_MS;
/** Test hook only: the timeout is a constant in the app. */
export function setHealthNativeTimeoutForTests(ms: number | null): void {
  nativeTimeoutMs = ms ?? NATIVE_TIMEOUT_MS;
}

class HealthNativeTimeout extends Error {}

function withNativeTimeout<T>(call: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new HealthNativeTimeout("health native call timed out")), nativeTimeoutMs);
    call.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

/**
 * A write given up on can still land later. Nothing to do when the row is
 * already linked to it (Health Connect upserts keep the uuid); revoked when the
 * reading is gone. Otherwise it is NOT simply revoked: on HealthKit a late
 * sync-id write has already replaced the linked sample, so revoking it left the
 * reading out of Health until the next retry. The row's current values are
 * written again instead, and the late sample revoked after that lands.
 */
function settleLateSample(rowId: string, uuid: string): Promise<void> {
  return withRowLock(rowId, async () => {
    const row = await getSugarLog(rowId);
    if (!row) {
      await deleteGlucoseFromHealth(uuid);
      return;
    }
    if (row.healthkit_uuid === uuid) return;
    const scope = await readHealthWriteScope();
    const open = shouldWriteToHealth({
      writeEnabledForProfile: scope.enabled,
      recordProfileId: row.profile_id,
      enabledProfileId: scope.profileId,
    });
    if (open) {
      const res = await mirrorStoredRow(row, [uuid]);
      if (res.outcome === "written") await removePendingWriteIds(row.profile_id, [rowId]);
      return;
    }
    // Mirror switched off since: nothing new is written. The late sample is
    // the newest one this reading has in Health, so the row points at it.
    await linkHealthUuid(rowId, uuid);
  }).catch((err) => logCrash(err, { screen: "health", op: "settleLateSample" }));
}

/** Test hook only: resolves once no reading has a Health operation queued or
 *  running. */
export async function healthIdleForTests(): Promise<void> {
  while (rowChains.size > 0) await Promise.all([...rowChains.values()]);
}

/** Rows with a Health operation queued or running. The retry pass and the
 *  history transfer skip them: the operation already holding the row writes
 *  its current values itself. */
function busyRowIds(): ReadonlySet<string> {
  return new Set(rowChains.keys());
}

/** Last sync version written per row in this process (see nextSyncVersion). */
const lastSyncVersion = new Map<string, number>();

/** Built inside the row lock, right before the native call, so a later write
 *  of the same reading always carries a strictly higher version. */
function nextWriteMeta(row: Pick<SugarLog, "id" | "period_tag">): HealthWriteMeta {
  const version = nextSyncVersion(lastSyncVersion.get(row.id), Date.now());
  lastSyncVersion.set(row.id, version);
  return buildHealthWriteMeta(row, version);
}

type MirrorOutcome = "written" | "failed" | "gone" | "linkFailed";

/**
 * Writes the row's CURRENT stored values and links the result. Must run inside
 * withRowLock(row.id). Every other sample the row pointed at (its stored link
 * and any id the caller still held) is revoked once the new one is linked:
 * HealthKit replaces a same-sync-id sample itself, but a sample saved without
 * metadata (the healthAppleKit fallback) or a legacy one can only go this way.
 * Health Connect keeps the uuid on an upsert, so nothing is revoked there.
 */
async function mirrorStoredRow(
  row: SugarLog,
  heldUuids: readonly (string | null | undefined)[]
): Promise<{ outcome: MirrorOutcome; uuid: string | null }> {
  const uuid = await writeGlucoseToHealth(row.glucose_level_mgdl, row.logged_at, nextWriteMeta(row));
  if (!uuid) return { outcome: "failed", uuid: null };
  try {
    // The local delete is not under this lock, so the reading can be gone by
    // now; its sample would be an orphan in the user's Health app. Checked
    // twice: a delete can also land between this read and the link, and then
    // the link updates no row.
    const current = await getSugarLog(row.id);
    if (!current || !(await linkHealthUuid(row.id, uuid))) {
      await deleteGlucoseFromHealth(uuid);
      return { outcome: "gone", uuid: null };
    }
    const stale = new Set<string>();
    for (const u of [current.healthkit_uuid, row.healthkit_uuid, ...heldUuids]) {
      if (u && u !== uuid) stale.add(u);
    }
    for (const u of stale) await deleteGlucoseFromHealth(u);
    return { outcome: "written", uuid };
  } catch (err) {
    // The sample IS in Health but the row never got the link: left alone, a
    // later write would add a second sample for the same reading (2.3.5).
    try {
      await deleteGlucoseFromHealth(uuid);
    } catch {
      // best-effort: the DB failure is what matters here
    }
    logCrash(err, { screen: "health", op: "linkHealthUuid" });
    return { outcome: "linkFailed", uuid: null };
  }
}

/**
 * Writes ONE reading to the platform health store as a bloodGlucose sample
 * (mg/dL) and returns the created sample's id, or null on failure / no
 * provider. The id is stored on the local row so the mirror can be revoked
 * when the row is deleted.
 */
export async function writeGlucoseToHealth(
  mgdl: number,
  dateIso: string,
  meta?: HealthWriteMeta
): Promise<string | null> {
  if (!Number.isFinite(mgdl) || mgdl <= 0) return null;
  const provider = getProvider();
  if (!provider) return null;
  // The HealthKit permission sheet waits for the user, however long they take,
  // so it runs before the native-call timeout starts, never inside it.
  if (provider === healthAppleKit && !(await prepareHealthKitWrite())) return null;
  let call: Promise<string | null>;
  try {
    call = provider.writeGlucose(mgdl, dateIso, meta);
  } catch (err) {
    logCrash(err, { screen: "health", op: "writeGlucose" });
    return null;
  }
  try {
    return await withNativeTimeout(call);
  } catch (err) {
    if (err instanceof HealthNativeTimeout && meta?.recordId) {
      const rowId = meta.recordId;
      void call.then(
        (late) => (late ? settleLateSample(rowId, late) : undefined),
        () => undefined
      );
    }
    logCrash(err, { screen: "health", op: "writeGlucose" });
    return null;
  }
}

/**
 * Best-effort revoke of a mirrored sample by id. Both native stores only let
 * an app delete samples IT wrote, so this is safe; any failure is swallowed
 * and never blocks the local delete.
 *
 * LOCKED: only ever called with the healthkit_uuid of a row THIS app wrote
 * to Health (see writeGlucoseToHealthIfEnabled / updateGlucoseInHealth). A row
 * imported FROM Health (source: "health") never gets a healthkit_uuid -
 * insertHealthSugarLogs leaves that column unset - so a health-import row can
 * never reach this call with a real uuid, and its delete path is a no-op here.
 * Do not "fix" this by trying to revoke an imported sample: the sample belongs
 * to whatever wrote it into Health, not to this app.
 */
export async function deleteGlucoseFromHealth(uuid: string | null): Promise<void> {
  await revokeHealthSample(uuid);
}

/** deleteGlucoseFromHealth, telling whether the sample is gone now (false:
 *  nothing to revoke, or the revoke failed and was queued for retry). */
async function revokeHealthSample(uuid: string | null): Promise<boolean> {
  if (!uuid) return false;
  const provider = getProvider();
  if (!provider) return false;
  try {
    await withNativeTimeout(provider.deleteGlucose(uuid));
    return true;
  } catch (err) {
    logCrash(err, { screen: "health", op: "deleteGlucose" });
    // A failed mirror-delete never blocks the local delete; it is retried
    // later instead (retryPendingHealthDeletes).
    await queueHealthDeletes([uuid]);
    return false;
  }
}

/**
 * The revoke for a reading the user just deleted, in line behind any write of
 * that reading still in flight (that write's own orphan check revokes what it
 * produced) and ahead of the write an undo queues next. A row linked to the
 * revoked id by then (an undo restored it while a correction was in flight,
 * and the Health Connect upsert kept the uuid) is unlinked and queued for a
 * rewrite, so it never points at a sample that no longer exists.
 */
export function deleteGlucoseRowFromHealth(rowId: string, uuid: string | null): Promise<void> {
  return withRowLock(rowId, async () => {
    if (uuid && (await revokeHealthSample(uuid))) await relinkAfterDelete([uuid]);
  }).catch((err) => logCrash(err, { screen: "health", op: "deleteGlucoseRow" }));
}

async function getDeleteEntries(kind: QueueKind = "glucose"): Promise<PendingDeleteEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(deleteQueueKey(kind));
    if (!raw) return [];
    return normalizeDeleteEntries(JSON.parse(raw), new Date().toISOString());
  } catch {
    return [];
  }
}

async function saveDeleteEntries(
  entries: readonly PendingDeleteEntry[],
  kind: QueueKind = "glucose"
): Promise<void> {
  try {
    await AsyncStorage.setItem(deleteQueueKey(kind), JSON.stringify(entries));
  } catch {
    // best-effort
  }
}

async function queueHealthDeletes(
  uuids: readonly string[],
  kind: QueueKind = "glucose"
): Promise<void> {
  if (uuids.length === 0) return;
  await deleteQueueLock(async () => {
    await saveDeleteEntries(enqueueDeletes(await getDeleteEntries(kind), uuids, Date.now()), kind);
  });
}

async function dequeueHealthDeletes(
  uuids: readonly string[],
  kind: QueueKind = "glucose"
): Promise<void> {
  await deleteQueueLock(async () => {
    const entries = await getDeleteEntries(kind);
    if (entries.length === 0) return;
    const next = removeDeleted(entries, uuids);
    if (next.length !== entries.length) await saveDeleteEntries(next, kind);
  });
}

/** Revokes sample ids in batches; ids a batch could not delete go to the
 *  retry queue. Returns how many were deleted right away. */
async function revokeHealthSamples(uuids: readonly string[]): Promise<number> {
  const provider = getProvider();
  if (!provider || uuids.length === 0) return 0;
  let deleted = 0;
  const failed: string[] = [];
  for (const batch of chunkBatches(uuids, HEALTH_DELETE_BATCH)) {
    try {
      await withNativeTimeout(provider.deleteGlucoseBatch(batch));
      deleted += batch.length;
    } catch (err) {
      logCrash(err, { screen: "health", op: "deleteGlucoseBatch" });
      failed.push(...batch);
    }
  }
  await queueHealthDeletes(failed);
  return deleted;
}

/** How many Health samples this app wrote for the profile (a reading imported
 *  from Health never counts). Drives the honest "copies are deleted too" line
 *  in the clear/delete confirmations. */
export async function countHealthCopies(profileId: string): Promise<number> {
  if (!hasHealthProvider()) return 0;
  try {
    return ownHealthUuids(await listHealthMirrorRows(profileId)).length;
  } catch {
    return 0;
  }
}

/** Call BEFORE a bulk clear or profile delete removes the rows: collects the
 *  Health ids of the profile's own copies and revokes them best-effort, queueing
 *  failures. Never throws, never blocks the local delete. */
export async function revokeHealthCopiesBeforeDelete(profileId: string): Promise<number> {
  if (!hasHealthProvider()) return 0;
  try {
    const uuids = ownHealthUuids(await listHealthMirrorRows(profileId));
    return await revokeHealthSamples(uuids);
  } catch (err) {
    logCrash(err, { screen: "health", op: "revokeCopiesBeforeDelete" });
    return 0;
  }
}

let healthDeleteRetryInFlight = false;

/** Re-attempts queued Health deletes (bounded per pass, oldest first). Not
 *  gated on the write switch: the user asked for the data to go. An id a row
 *  is linked to again (an undo re-mirror) is not a delete candidate any more.
 *  When the store keeps refusing (a failed batch AND a failed first single),
 *  the pass stops instead of spending one native call per queued id. */
export async function retryPendingHealthDeletes(): Promise<{ attempted: number; succeeded: number }> {
  const none = { attempted: 0, succeeded: 0 };
  const provider = getProvider();
  if (!provider || healthDeleteRetryInFlight) return none;
  healthDeleteRetryInFlight = true;
  try {
    const pass = await deleteQueueLock(async () => {
      const current = await getDeleteEntries();
      const pruned = pruneDeleteQueue(current, Date.now());
      let kept = pruned;
      const candidates = selectDeletePass(pruned);
      const bound = new Set(candidates.length > 0 ? await listLinkedHealthUuids(candidates) : []);
      if (bound.size > 0) kept = removeDeleted(pruned, [...bound]);
      if (kept.length !== current.length) await saveDeleteEntries(kept);
      return selectDeletePass(kept);
    });
    if (pass.length === 0) return none;
    const done: string[] = [];
    let stop = false;
    let refused: string | null = null;
    for (const batch of chunkBatches(pass, HEALTH_DELETE_BATCH)) {
      if (stop) break;
      try {
        await withNativeTimeout(provider.deleteGlucoseBatch(batch));
        done.push(...batch);
      } catch {
        // One bad id must not pin the rest of its batch: fall back to singles,
        // but give up on the whole pass if the first single fails too.
        let first = true;
        for (const id of batch) {
          try {
            await withNativeTimeout(provider.deleteGlucose(id));
            done.push(id);
          } catch {
            if (first) {
              stop = true;
              refused = id;
              break;
            }
          }
          first = false;
        }
      }
    }
    if (done.length > 0) {
      await dequeueHealthDeletes(done);
      await relinkAfterDelete(done);
    }
    // An id the store keeps refusing goes to the back, so it cannot starve the
    // ids behind it on every later pass.
    if (refused) {
      const moved = refused;
      await deleteQueueLock(async () => {
        const entries = await getDeleteEntries();
        const head = entries.find((e) => e.uuid === moved);
        if (!head) return;
        await saveDeleteEntries([...entries.filter((e) => e.uuid !== moved), head]);
      });
    }
    return { attempted: pass.length, succeeded: done.length };
  } catch (err) {
    logCrash(err, { screen: "health", op: "retryPendingHealthDeletes" });
    return none;
  } finally {
    healthDeleteRetryInFlight = false;
  }
}

/** The link check before a pass cannot see a row that got re-linked to an id
 *  WHILE its native delete was running (an undo re-mirror on Health Connect
 *  keeps the uuid). Such a row now points at a deleted sample: its link is
 *  cleared and it goes back on the write queue so the next retry re-writes it. */
async function relinkAfterDelete(deleted: readonly string[]): Promise<void> {
  const links = await listHealthUuidLinks(deleted);
  for (const row of links) {
    await setSugarLogHealthUuid(row.id, null);
    await addPendingWriteId(row.profile_id, row.id);
  }
}

/**
 * If the user opted in, mirror a freshly-added MANUAL reading to the health
 * store and store the returned id on the row. Never mirrors imported
 * ('health') rows - that is where the loop would start. Fire-and-forget from
 * the add flow; a failed mirror leaves the row un-mirrored (healthkit_uuid
 * stays null) and never crashes.
 *
 * The opt-in belongs to ONE profile, and the row carries its own profile_id, so
 * a reading is mirrored only when the two are the same person.
 *
 * Returns true when there was nothing to report (mirror off/not this
 * profile/imported row, or the write succeeded) and false when the mirror
 * WAS applicable and the write itself failed - the signal a caller uses to
 * show its own immediate "could not write" toast (gated on
 * {@link shouldAnnounceHealthWriteFailure} so it only ever fires once per
 * session).
 *
 * Only the row's id is taken from `log`: the values written are the STORED
 * row's, read inside the row lock. The one-time question writes the reading
 * it was asked about after the user answered, and an undo writes a restored
 * snapshot; either can be older than the row by then.
 */
export async function writeGlucoseToHealthIfEnabled(log: SugarLog): Promise<boolean> {
  if (!isUserEntered(log.source)) return true;
  if (!hasHealthProvider()) return true;
  return withRowLock(log.id, async () => {
    // Gone already (deleted before this write got its turn): nothing to mirror.
    const row = await getSugarLog(log.id);
    if (!row || !isUserEntered(row.source)) return true;
    const scope = await readHealthWriteScope();
    const allowed = shouldWriteToHealth({
      writeEnabledForProfile: scope.enabled,
      recordProfileId: row.profile_id,
      enabledProfileId: scope.profileId,
    });
    if (!allowed) return true;
    const res = await mirrorStoredRow(row, [log.healthkit_uuid]);
    await recordHealthWriteStatus(row.profile_id, res.outcome !== "failed");
    if (res.outcome === "failed") {
      // The toggle is on and the write was attempted, so a null result here
      // means the write itself failed (H3) - most likely revoked Settings
      // access - not that the mirror is off. Queued so the next
      // foreground/manual-sync retry re-attempts exactly this row (see
      // retryPendingHealthWrites) - the queue is the ONLY thing a retry
      // ever reads from, so a row logged while the toggle was off can never
      // be swept up later (consent scope, 2.3.5 fix).
      healthWriteFailureNoticePending = true;
      await addPendingWriteId(row.profile_id, row.id);
      return false;
    }
    // Written but never linked: the orphan was revoked, the next retry starts clean.
    if (res.outcome === "linkFailed") await addPendingWriteId(row.profile_id, row.id);
    // In case an earlier attempt had queued this same row: it is linked now.
    if (res.outcome === "written") await removePendingWriteIds(row.profile_id, [row.id]);
    return true;
  }).catch((err) => {
    // Fired and forgotten from the add flow: a DB hiccup must never surface
    // as an unhandled rejection.
    logCrash(err, { screen: "health", op: "writeGlucoseToHealthIfEnabled" });
    return true;
  });
}

/**
 * Re-mirrors an EDITED reading, in line behind any write of it still in flight.
 * The corrected values are read from the stored row inside the row lock, so the
 * last edit always wins. Write FIRST, revoke the stale sample after: a failed
 * write can no longer cost the user the old sample, and the write carries the
 * row id as sync id with a strictly newer version, so the store replaces a
 * sample written the same way (HealthKit with a new uuid, Health Connect in
 * place). Links the result on the row itself and returns it.
 *
 * `uuid` is null when nothing was linked: the mirror is off for the row, the
 * reading was never mirrored or is gone (`failed` false, nothing to report), or
 * the write itself did not land (`failed` true). A failed rewrite keeps the old
 * sample and its link - revoking it on an empty result would delete the only
 * copy if the store had merely refused or ignored the write - and the row is
 * queued; the retry pass rewrites it with its current values.
 */
export interface HealthRewriteResult {
  uuid: string | null;
  failed: boolean;
}


export async function updateGlucoseInHealth(
  /** The row being corrected - queued for retry on failure (2.3.5 fix): this
   *  row already carried a mirror sample (oldUuid), so it is squarely inside
   *  the mirror's already-consented scope, not a consent-scope expansion the
   *  way a never-attempted row would be. */
  logId: string,
  /** The sample the caller last saw linked. Only a hint: a screen's copy can
   *  predate the link of a first write that was still in flight, so the stored
   *  link is what decides, and both are revoked once the rewrite lands. */
  oldUuid: string | null,
  /** The profile the corrected row belongs to. REQUIRED (X7): defaulting it to
   *  "whatever profile has the switch on" made the check compare a value to
   *  itself, so the gate always opened - a caregiver correcting a reading on
   *  one profile could mirror it into the Health account of another. */
  recordProfileId: string | null
): Promise<HealthRewriteResult> {
  const none: HealthRewriteResult = { uuid: null, failed: false };
  if (!hasHealthProvider()) return none;
  return withRowLock(logId, async () => {
    const scope = await readHealthWriteScope();
    const allowed = shouldWriteToHealth({
      writeEnabledForProfile: scope.enabled,
      recordProfileId,
      enabledProfileId: scope.profileId,
    });
    if (!allowed) return none;
    const row = await getSugarLog(logId);
    if (!row || !isUserEntered(row.source)) return none;
    // Only a reading that is (or was) mirrored is rewritten; one logged while
    // the mirror was off stays out of Health (consent scope).
    const held = [row.healthkit_uuid, oldUuid].filter((u): u is string => !!u);
    if (held.length === 0) return none;
    const res = await mirrorStoredRow(row, held);
    await recordHealthWriteStatus(recordProfileId, res.outcome !== "failed");
    if (res.outcome === "written") {
      await removePendingWriteIds(row.profile_id, [logId]);
      return { uuid: res.uuid, failed: false };
    }
    if (res.outcome === "gone") return none;
    if (res.outcome === "failed") {
      // Same H3 signal as writeGlucoseToHealthIfEnabled: allowed to write,
      // but the write itself came back empty.
      healthWriteFailureNoticePending = true;
    }
    await addPendingWriteId(recordProfileId, logId);
    return { uuid: null, failed: true };
  });
}

// Module-level (not per-profile): the app only ever shows one active
// profile's dashboard at a time, and this guards against the two triggers
// below (foreground AppState + manual sync) firing close together and
// running two overlapping passes, which could otherwise both see the same
// row's healthkit_uuid as still null and write it to Health twice.
let healthRetryInFlight = false;

/**
 * Foreground/manual-sync catch-up for the write mirror (2.4/2.3.5): re-
 * attempts a bounded, chronological batch of THIS profile's own QUEUED rows
 * (see HEALTH_WRITE_PENDING_KEY's doc comment - consent scope: never a row
 * that was simply never attempted) - covers both "the write silently failed
 * at the time" (H3) and "Health write access was only granted just now"
 * (see healthAppleKit's pre-write authorization check). Sequential, never
 * parallel, capped at {@link HEALTH_RETRY_MAX_ROWS} - see
 * selectHealthRetryCandidates for the exact selection rule.
 *
 * Gated on the SAME per-profile scope every other mirror write uses:
 * retrying is never a way around "this profile's toggle is off", and it is
 * not gated on Pro status - once the write mirror is on for a profile it
 * keeps working the same way a fresh write does (see settings/data.tsx,
 * where turning it OFF is always available even to a lapsed-Pro profile).
 */
export async function retryPendingHealthWrites(
  profileId: string
): Promise<{ attempted: number; succeeded: number }> {
  try {
    return await runPendingHealthWrites(profileId);
  } catch (err) {
    logCrash(err, { screen: "health", op: "retryPendingHealthWrites" });
    return { attempted: 0, succeeded: 0 };
  }
}

async function runPendingHealthWrites(
  profileId: string
): Promise<{ attempted: number; succeeded: number }> {
  const none = { attempted: 0, succeeded: 0 };
  if (!profileId || !hasHealthProvider()) return none;
  await retryPendingHealthDeletes();
  await retryPendingHealthRecordDeletes("carbs");
  await retryPendingHealthRecordDeletes("insulin");
  if (healthRetryInFlight) return none;
  const scope = await readHealthWriteScope(profileId);
  if (!scope.enabled || scope.profileId !== profileId) return none;
  healthRetryInFlight = true;
  try {
    const nowMs = Date.now();
    // Prune FIRST (2.3.5 fix): every retry pass, not just every add, is a
    // point to drop what has aged out of the queue - a profile that never
    // opens the app for a while would otherwise only ever prune on the rare
    // fresh write that happens to fail.
    const prunedEntries = await writeQueueLock(async () => {
      const current = await getPendingWriteEntries(profileId);
      const pruned = pruneWritePendingQueue(current, nowMs);
      if (pruned.length !== current.length) await savePendingWriteEntries(profileId, pruned);
      return pruned;
    });
    const pendingIds = prunedEntries.map((e) => e.id);
    if (pendingIds.length === 0) return none;
    // Fetch every queued row so the pure selector can apply the window/cap
    // rule against its real logged_at; a row that no longer exists (deleted
    // since the failed write) is dropped from the queue right here instead
    // of being retried forever.
    const fetched = await Promise.all(pendingIds.map((id) => getSugarLog(id)));
    const rows: SugarLog[] = [];
    const goneIds: string[] = [];
    fetched.forEach((row, i) => {
      if (row) rows.push(row);
      else goneIds.push(pendingIds[i]);
    });
    if (goneIds.length > 0) await removePendingWriteIds(profileId, goneIds);

    // The selector's "not linked yet" rule predates the row lock: a queued row
    // can now be linked to a sample whose rewrite failed (updateGlucoseInHealth
    // keeps that link), and it is rewritten under its lock like any other.
    const candidates = selectHealthRetryCandidates(
      rows.map((r) => ({ ...r, healthkit_uuid: null })),
      pendingIds,
      busyRowIds(),
      nowMs
    );
    let succeeded = 0;
    const succeededIds: string[] = [];
    for (const row of candidates) {
      // Re-read fresh for EVERY row (2.3.5 fix), not the `scope` captured
      // once above: a pass can span many sequential native calls, and the
      // user may switch the write toggle off in the middle of one
      // (settings/data.tsx) - stop the whole pass right there rather than
      // spending further writes on a stale "was on when I started" read.
      const freshScope = await readHealthWriteScope(profileId);
      if (!isRetryPassOpen(freshScope, profileId)) break;
      // Defensive only: every queued row already belongs to this profile by
      // construction (the queue is itself per-profile), so this should
      // never actually trip - a mismatch here is queue corruption, not a
      // reason to stop the whole pass, so it skips just this row.
      if (row.profile_id !== profileId) continue;
      // Re-read inside the row lock: the reading may have been corrected or
      // deleted since the queue was read. Written with its current values; a
      // queued row that is still linked is a correction that did not land,
      // so its old sample is replaced. A failed or unlinked write stays
      // queued, and only a LOCAL link counts as succeeded (2.3.5).
      const done = await withRowLock(row.id, async () => {
        const current = await getSugarLog(row.id);
        if (!current || !isUserEntered(current.source)) return false;
        const res = await mirrorStoredRow(current, []);
        return res.outcome === "written";
      });
      if (done) {
        succeeded++;
        succeededIds.push(row.id);
      }
    }
    if (succeededIds.length > 0) await removePendingWriteIds(profileId, succeededIds);
    // ONE status record for the whole pass (never one per row - that would
    // leave only the last row's outcome on screen).
    const record = buildRetryStatusRecord(candidates.length, succeeded, new Date(nowMs).toISOString());
    if (record) await saveHealthWriteStatus(profileId, record);
    return { attempted: candidates.length, succeeded };
  } finally {
    healthRetryInFlight = false;
  }
}

/** Rows waiting for a retried Health write for this profile (queue size after
 *  pruning). Shown next to the "try now" action in settings. */
export async function getHealthPendingWriteCount(profileId: string): Promise<number> {
  const entries = pruneWritePendingQueue(await getPendingWriteEntries(profileId), Date.now());
  return entries.length;
}

let healthBackfillInFlight = false;
let backfillProgress: { done: number; total: number } | null = null;
const backfillListeners = new Set<() => void>();

function setBackfillProgress(next: { done: number; total: number } | null): void {
  backfillProgress = next;
  backfillListeners.forEach((l) => l());
}

/** The running history transfer's progress, or null when none is running. One
 *  pass at a time for the whole app, so every screen shows the same one. */
export function getHealthBackfillProgress(): { done: number; total: number } | null {
  return backfillProgress;
}

export function subscribeHealthBackfill(listener: () => void): () => void {
  backfillListeners.add(listener);
  return () => {
    backfillListeners.delete(listener);
  };
}

export interface HealthBackfillResult {
  /** Rows the run set out to write. */
  total: number;
  written: number;
  failed: number;
  /** The write switch was off or there is no provider. */
  skipped: boolean;
  /** Another transfer is already running; nothing was started. */
  alreadyRunning: boolean;
}

/**
 * One-time transfer of the active profile's past, app-entered readings that
 * have no Health sample yet (see selectBackfillCandidates). Sequential batches,
 * progress after each. Every row is re-read right before its write, so a row
 * that was deleted, edited or linked since the list was taken is skipped or
 * written with its current values. Idempotent: every write carries the row id
 * as sync id with a newer version, so a pass killed between the native write
 * and the local link, then started again, makes the store REPLACE that sample
 * instead of adding a second one. Re-checks the write switch before every row.
 */
export async function backfillGlucoseToHealth(
  profileId: string,
  windowDays: HealthBackfillWindow,
  onProgress?: (done: number, total: number) => void
): Promise<HealthBackfillResult> {
  const skipped = { total: 0, written: 0, failed: 0, skipped: true, alreadyRunning: false };
  if (!profileId || !hasHealthProvider()) return skipped;
  if (healthBackfillInFlight) return { ...skipped, alreadyRunning: true };
  const scope = await readHealthWriteScope(profileId);
  if (!isRetryPassOpen(scope, profileId)) return skipped;
  healthBackfillInFlight = true;
  try {
    const nowMs = Date.now();
    const since = new Date(nowMs - windowDays * 24 * 60 * 60 * 1000).toISOString();
    const rows = selectBackfillCandidates(
      await listHealthBackfillRows(profileId, since),
      profileId,
      busyRowIds(),
      nowMs,
      windowDays
    );
    let written = 0;
    let failed = 0;
    const writtenIds: string[] = [];
    const report = (done: number) => {
      setBackfillProgress({ done, total: rows.length });
      onProgress?.(done, rows.length);
    };
    report(0);
    let open = true;
    let handled = 0;
    for (const batch of chunkBatches(rows)) {
      for (const stale of batch) {
        handled++;
        if (!isRetryPassOpen(await readHealthWriteScope(profileId), profileId)) {
          open = false;
          break;
        }
        // A row another write is holding is written by that write itself.
        if (rowChains.has(stale.id)) continue;
        const outcome = await withRowLock(stale.id, async () => {
          const row = await getSugarLog(stale.id);
          if (!row || row.healthkit_uuid != null || !isUserEntered(row.source)) return null;
          return (await mirrorStoredRow(row, [])).outcome;
        });
        if (outcome === "written") {
          written++;
          writtenIds.push(stale.id);
        } else if (outcome === "failed" || outcome === "linkFailed") {
          failed++;
        }
      }
      report(handled);
      if (!open) break;
    }
    if (writtenIds.length > 0) await removePendingWriteIds(profileId, writtenIds);
    return { total: rows.length, written, failed, skipped: false, alreadyRunning: false };
  } finally {
    healthBackfillInFlight = false;
    setBackfillProgress(null);
  }
}

/**
 * Takes the user to where the Health write permission can be (re)granted:
 * Health Connect's own settings on Android, the Health app on iOS (iOS never
 * re-shows its permission dialog after a denial). Never throws.
 */
export async function openHealthSettings(): Promise<void> {
  try {
    if (Platform.OS === "android") {
      const HC = require("react-native-health-connect");
      HC.openHealthConnectSettings();
    } else {
      await Linking.openURL("x-apple-health://");
    }
  } catch (err) {
    logCrash(err, { screen: "health", op: "openHealthSettings" });
  }
}

// ── Per-profile switches: background sync, carbs and insulin writes ─────────

async function resolveProfileId(profileId?: string | null): Promise<string | null> {
  return profileId ?? (await activeProfileId());
}

/** Insulin can only be written to HealthKit; Health Connect has no insulin type. */
export function isHealthKindWriteSupported(kind: HealthWriteKind): boolean {
  if (!hasHealthProvider()) return false;
  return kind === "carbs" || Platform.OS === "ios";
}

export async function getHealthKindWriteEnabled(
  kind: HealthWriteKind,
  profileId?: string | null
): Promise<boolean> {
  if (!isHealthKindWriteSupported(kind)) return false;
  try {
    const id = await resolveProfileId(profileId);
    if (!id) return false;
    return (await AsyncStorage.getItem(`${HEALTH_WRITE_KIND_KEYS[kind]}.${id}`)) === "1";
  } catch {
    return false;
  }
}

export async function setHealthKindWriteEnabled(
  kind: HealthWriteKind,
  on: boolean,
  profileId?: string | null
): Promise<void> {
  try {
    const id = await resolveProfileId(profileId);
    if (!id) return;
    await AsyncStorage.setItem(`${HEALTH_WRITE_KIND_KEYS[kind]}.${id}`, on ? "1" : "0");
  } catch {
    // best-effort
  }
}

/** Point-of-use permission for one extra type, when its switch is turned on. */
export async function requestHealthKindWritePermission(kind: HealthWriteKind): Promise<boolean> {
  const provider = getProvider();
  if (!provider || !isHealthKindWriteSupported(kind)) return false;
  try {
    return await provider.requestKindWritePermission(kind);
  } catch {
    return false;
  }
}

export async function isHealthKindWriteAuthorized(kind: HealthWriteKind): Promise<boolean> {
  const provider = getProvider();
  if (!provider || !isHealthKindWriteSupported(kind)) return false;
  try {
    return await provider.isKindWriteAuthorized(kind);
  } catch {
    return false;
  }
}

/** Background read switch. Unset follows the profile's existing Health sync
 *  switch (cgmSync), so users who already sync keep syncing; an explicit
 *  value (the separate switch in settings) wins. */
export async function getHealthBgSyncEnabled(profileId?: string | null): Promise<boolean> {
  try {
    const id = await resolveProfileId(profileId);
    if (!id) return false;
    const own = await AsyncStorage.getItem(`${HEALTH_BG_SYNC_KEY}.${id}`);
    if (own != null) return own === "1";
    return await getHealthSyncEnabled(id);
  } catch {
    return false;
  }
}

export async function setHealthBgSyncEnabled(
  on: boolean,
  profileId?: string | null
): Promise<void> {
  try {
    const id = await resolveProfileId(profileId);
    if (!id) return;
    await AsyncStorage.setItem(`${HEALTH_BG_SYNC_KEY}.${id}`, on ? "1" : "0");
  } catch {
    // best-effort
  }
}

/** Foreground tells the service whether the user is entitled to background
 *  sync (Pro). A background run has no React context to ask. Fails closed. */
export async function setHealthBackgroundEntitled(entitled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(HEALTH_BG_ENTITLED_KEY, entitled ? "1" : "0");
  } catch {
    // best-effort
  }
}

export async function getHealthBackgroundEntitled(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(HEALTH_BG_ENTITLED_KEY)) === "1";
  } catch {
    return false;
  }
}

// ── Last sync stamp + error state (structured, text is the caller's) ────────

async function recordHealthLastSync(
  profileId: string,
  result: SyncResult,
  source: HealthSyncSource
): Promise<void> {
  try {
    let error: HealthSyncError | null = null;
    if (result.status === "unavailable") error = "unavailable";
    else if (result.status === "denied") error = "denied";
    else if (result.status === "error") error = "read_failed";
    const record: HealthLastSync = {
      atIso: new Date().toISOString(),
      status: result.status,
      inserted: result.inserted,
      read: result.read,
      source,
      error,
    };
    await AsyncStorage.setItem(`${HEALTH_LAST_SYNC_KEY}.${profileId}`, JSON.stringify(record));
  } catch {
    // best-effort
  }
}

/** The last import attempt for the profile (default: active), or null. */
export async function getHealthLastSync(
  profileId?: string | null
): Promise<HealthLastSync | null> {
  try {
    const id = await resolveProfileId(profileId);
    if (!id) return null;
    const raw = await AsyncStorage.getItem(`${HEALTH_LAST_SYNC_KEY}.${id}`);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<HealthLastSync>;
    if (typeof p.atIso !== "string") return null;
    if (p.status !== "ok" && p.status !== "unavailable" && p.status !== "denied" && p.status !== "error") {
      return null;
    }
    const source: HealthSyncSource =
      p.source === "background" || p.source === "foreground" ? p.source : "manual";
    const error: HealthSyncError | null =
      p.error === "unavailable" || p.error === "denied" || p.error === "read_failed" ? p.error : null;
    return {
      atIso: p.atIso,
      status: p.status,
      inserted: Number(p.inserted) || 0,
      read: Number(p.read) || 0,
      source,
      error,
    };
  } catch {
    return null;
  }
}

// ── Background sync entry point (iOS observer / Android task) ───────────────

export type HealthBackgroundSkip =
  | "no_provider"
  | "not_entitled"
  | "no_profile"
  | "sync_off"
  | "no_permission"
  | "no_background_permission"
  | "unchanged";

export interface HealthBackgroundOutcome {
  ran: boolean;
  skipped: HealthBackgroundSkip | null;
  result: SyncResult | null;
}

/** Why background sync cannot run right now for the active profile, or null
 *  when it can. Never prompts. Shared by the run and by the registration. */
export async function getHealthBackgroundBlocker(): Promise<HealthBackgroundSkip | null> {
  const provider = getProvider();
  if (!provider || DEBUG_MOCK_HEALTH) return "no_provider";
  if (!(await getHealthBackgroundEntitled())) return "not_entitled";
  const profileId = await activeProfileId();
  if (!profileId) return "no_profile";
  if (!(await getHealthSyncEnabled(profileId)) || !(await getHealthBgSyncEnabled(profileId))) {
    return "sync_off";
  }
  try {
    if (!(await provider.isReadGranted())) return "no_permission";
    if (Platform.OS === "android" && !(await provider.hasBackgroundReadPermission())) {
      return "no_background_permission";
    }
  } catch {
    return "no_permission";
  }
  return null;
}

/**
 * One background pass: the ACTIVE profile only (the foreground sync is also
 * active-profile only, and one Health account serves the device). Reuses
 * importHealthGlucose, so source filtering and the duplicate rules are the
 * foreground ones. Never prompts and never throws.
 */
export async function syncHealthInBackground(): Promise<HealthBackgroundOutcome> {
  const skip = (skipped: HealthBackgroundSkip): HealthBackgroundOutcome => ({
    ran: false,
    skipped,
    result: null,
  });
  try {
    const blocker = await getHealthBackgroundBlocker();
    if (blocker) return skip(blocker);
    const provider = getProvider();
    const profileId = await activeProfileId();
    if (!provider || !profileId) return skip("no_profile");
    let commit: (() => Promise<void>) | null = null;
    if (Platform.OS === "android") {
      const peek = await provider.peekGlucoseChanges();
      if (!peek.changed) return skip("unchanged");
      commit = peek.commit;
      // Records the user removed in Health Connect leave with their import.
      if (peek.deletedIds && peek.deletedIds.length > 0) {
        try {
          await deleteImportedGlucoseByExternalIds(profileId, "health", peek.deletedIds);
        } catch (err) {
          logCrash(err, { screen: "health", op: "deleteRemovedGlucose" });
          // Keep the token where it is so the next pass sees these deletions again.
          commit = null;
        }
      }
    }
    const result = await importHealthGlucose(profileId, "background");
    if (result.status === "ok" && commit) await commit();
    if (result.inserted > 0) bumpBackgroundListeners();
    return { ran: true, skipped: null, result };
  } catch (err) {
    logCrash(err, { screen: "health", op: "syncHealthInBackground" });
    return { ran: false, skipped: null, result: { status: "error", inserted: 0, read: 0 } };
  }
}

// A system launch (HealthKit relaunching the terminated app) starts JS while
// the app is not active; the observer subscription is not guaranteed to fire
// then, so run one pass directly.
if (Platform.OS === "ios" && AppState.currentState !== "active") {
  setTimeout(() => {
    void syncHealthInBackground();
  }, 0);
}

const backgroundImportListeners = new Set<() => void>();
function bumpBackgroundListeners(): void {
  backgroundImportListeners.forEach((l) => {
    try {
      l();
    } catch {
      // a listener must not break the sync
    }
  });
}

/** Fires after a background pass inserted rows, so a mounted screen can
 *  refresh. Returns the unsubscribe. */
export function subscribeHealthBackgroundImport(listener: () => void): () => void {
  backgroundImportListeners.add(listener);
  return () => {
    backgroundImportListeners.delete(listener);
  };
}

// ── Carbs and insulin: opt-in mirror writes, one switch per data type ───────

export type HealthRecordInput =
  | {
      kind: "carbs";
      id: string;
      profileId: string;
      loggedAt: string;
      grams: number;
      /** From a carb estimate: the sample is marked as such in the store. */
      estimated?: boolean;
    }
  | {
      kind: "insulin";
      id: string;
      profileId: string;
      loggedAt: string;
      units: number;
      insulinKind: InsulinKind;
    };

export type HealthRecordOutcome = "written" | "failed" | "skipped" | "unsupported";

/** `uuid` is the id to store on the row (meal_logs / injection_logs
 *  health_uuid) when outcome is "written". Linking is the caller's: this
 *  module has no access to those tables. */
export interface HealthRecordResult {
  outcome: HealthRecordOutcome;
  uuid: string | null;
}

function recordLockKey(kind: HealthWriteKind, id: string): string {
  return `${kind}:${id}`;
}

function nextRecordMeta(kind: HealthWriteKind, id: string): HealthWriteMeta {
  const key = recordLockKey(kind, id);
  const version = nextSyncVersion(lastSyncVersion.get(key), Date.now());
  lastSyncVersion.set(key, version);
  return { recordId: id, version, mealContext: null };
}

async function writeRecordToHealth(
  provider: HealthProvider,
  input: HealthRecordInput,
  meta: HealthWriteMeta
): Promise<string | null> {
  // Never prompts: the permission sheet belongs to the Settings switch. A revoked
  // grant would otherwise reopen the system screen on every save and foreground.
  if (!(await provider.isKindWriteAuthorized(input.kind))) return null;
  const op = input.kind === "carbs" ? "writeCarbs" : "writeInsulin";
  try {
    const call =
      input.kind === "carbs"
        ? provider.writeCarbs(input.grams, input.loggedAt, { ...meta, estimated: input.estimated === true })
        : provider.writeInsulin(input.units, input.insulinKind, input.loggedAt, meta);
    return await withNativeTimeout(call);
  } catch (err) {
    logCrash(err, { screen: "health", op });
    return null;
  }
}

/**
 * Writes (or rewrites after an edit) ONE carb or insulin entry. Gated like the
 * glucose mirror: the type's switch must be on for the profile that owns the
 * entry, and that profile must be the active one. Idempotent per entry id (the
 * id is the sync identifier with a rising version), so an edit replaces the
 * earlier sample; `heldUuids` (the row's stored link) are revoked AFTER the new
 * sample landed, so a failed rewrite never costs the old one. A failure joins
 * the type's retry queue (see getHealthRecordRetryIds).
 */
export function mirrorHealthRecord(
  input: HealthRecordInput,
  heldUuids: readonly (string | null | undefined)[] = []
): Promise<HealthRecordResult> {
  const provider = getProvider();
  if (!provider) return Promise.resolve({ outcome: "skipped", uuid: null });
  if (!isHealthKindWriteSupported(input.kind)) {
    return Promise.resolve({ outcome: "unsupported", uuid: null });
  }
  if (!Number.isFinite(input.kind === "carbs" ? input.grams : input.units)) {
    return Promise.resolve({ outcome: "skipped", uuid: null });
  }
  return withRowLock(recordLockKey(input.kind, input.id), async (): Promise<HealthRecordResult> => {
    const activeId = await activeProfileId();
    const enabled = activeId ? await getHealthKindWriteEnabled(input.kind, activeId) : false;
    const allowed = shouldWriteToHealth({
      writeEnabledForProfile: enabled,
      recordProfileId: input.profileId,
      enabledProfileId: activeId,
    });
    if (!allowed) return { outcome: "skipped", uuid: null };
    const uuid = await writeRecordToHealth(provider, input, nextRecordMeta(input.kind, input.id));
    if (!uuid) {
      healthWriteFailureNoticePending = true;
      await addPendingWriteId(input.profileId, input.id, input.kind);
      return { outcome: "failed", uuid: null };
    }
    const stale = new Set<string>();
    for (const u of heldUuids) if (u && u !== uuid) stale.add(u);
    if (stale.size > 0) await revokeHealthRecords(input.kind, [...stale]);
    await removePendingWriteIds(input.profileId, [input.id], input.kind);
    return { outcome: "written", uuid };
  }).catch((err) => {
    logCrash(err, { screen: "health", op: "mirrorHealthRecord" });
    return { outcome: "failed", uuid: null };
  });
}

function deleteRecordBatch(
  provider: HealthProvider,
  kind: HealthWriteKind,
  ids: string[]
): Promise<void> {
  return kind === "carbs" ? provider.deleteCarbsBatch(ids) : provider.deleteInsulinBatch(ids);
}

/** Best-effort revoke of samples this app wrote. Not gated on the switch (the
 *  user asked for the data to go); failures are queued and retried. Returns
 *  how many were deleted right away. */
export async function revokeHealthRecords(
  kind: HealthWriteKind,
  uuids: readonly string[]
): Promise<number> {
  const provider = getProvider();
  if (!provider || uuids.length === 0 || !isHealthKindWriteSupported(kind)) return 0;
  let deleted = 0;
  const failed: string[] = [];
  for (const batch of chunkBatches(uuids, HEALTH_DELETE_BATCH)) {
    try {
      await withNativeTimeout(deleteRecordBatch(provider, kind, batch));
      deleted += batch.length;
    } catch (err) {
      logCrash(err, { screen: "health", op: `deleteBatch.${kind}` });
      failed.push(...batch);
    }
  }
  await queueHealthDeletes(failed, kind);
  return deleted;
}

/** Revoke for an entry the user just deleted, in line behind any write of it. */
export function deleteHealthRecord(
  kind: HealthWriteKind,
  entryId: string,
  uuid: string | null
): Promise<void> {
  return withRowLock(recordLockKey(kind, entryId), async () => {
    if (uuid) await revokeHealthRecords(kind, [uuid]);
  }).catch((err) => logCrash(err, { screen: "health", op: "deleteHealthRecord" }));
}

const recordDeleteRetryInFlight = new Set<HealthWriteKind>();

/** Re-attempts the queued deletes of one type (bounded, oldest first). */
export async function retryPendingHealthRecordDeletes(
  kind: HealthWriteKind
): Promise<{ attempted: number; succeeded: number }> {
  const none = { attempted: 0, succeeded: 0 };
  const provider = getProvider();
  if (!provider || !isHealthKindWriteSupported(kind) || recordDeleteRetryInFlight.has(kind)) {
    return none;
  }
  recordDeleteRetryInFlight.add(kind);
  try {
    const pass = await deleteQueueLock(async () => {
      const current = await getDeleteEntries(kind);
      const pruned = pruneDeleteQueue(current, Date.now());
      if (pruned.length !== current.length) await saveDeleteEntries(pruned, kind);
      return selectDeletePass(pruned);
    });
    if (pass.length === 0) return none;
    const done: string[] = [];
    for (const batch of chunkBatches(pass, HEALTH_DELETE_BATCH)) {
      try {
        await withNativeTimeout(deleteRecordBatch(provider, kind, batch));
        done.push(...batch);
      } catch {
        // the store keeps refusing: stop instead of one native call per id
        break;
      }
    }
    if (done.length > 0) await dequeueHealthDeletes(done, kind);
    return { attempted: pass.length, succeeded: done.length };
  } catch (err) {
    logCrash(err, { screen: "health", op: "retryPendingHealthRecordDeletes" });
    return none;
  } finally {
    recordDeleteRetryInFlight.delete(kind);
  }
}

/** Entry ids whose write failed while the type's switch was on (consent
 *  scope: only entries that were actually attempted ever join). The caller
 *  re-reads each row and calls mirrorHealthRecord again, then clears it. */
export async function getHealthRecordRetryIds(
  kind: HealthWriteKind,
  profileId: string
): Promise<string[]> {
  const entries = pruneWritePendingQueue(
    await getPendingWriteEntries(profileId, kind),
    Date.now()
  );
  return entries.map((e) => e.id);
}

export async function clearHealthRecordRetryIds(
  kind: HealthWriteKind,
  profileId: string,
  ids: readonly string[]
): Promise<void> {
  await removePendingWriteIds(profileId, ids, kind);
}

// ── Import into local SQLite ───────────────────────────────────────────────

/**
 * Pulls recent glucose readings from the platform health store (or the mock in
 * dev) into the profile's local log, skipping anything already imported.
 *
 * Returns a {@link SyncResult} so the caller can give precise feedback:
 *  - `unavailable` -> no Health/Health Connect on this device
 *  - `denied`      -> permission not granted
 *  - `error`       -> the native read threw
 *  - `ok`          -> read `read` samples, inserted `inserted` new ones
 */
export async function importHealthGlucose(
  profileId: string,
  source: HealthSyncSource = "manual"
): Promise<SyncResult> {
  // Overlapping triggers (observer burst, task + foreground, double tap) share
  // the one running import for the profile instead of racing the dedup read.
  // A run that never settled (a system dialog iOS could not present) must not
  // be handed to every later caller: past IMPORT_STALE_MS a fresh one starts.
  return importShare.share(profileId, () => runImportHealthGlucose(profileId, source));
}

const importShare = createImportShare<SyncResult>(() => Date.now());

async function runImportHealthGlucose(
  profileId: string,
  source: HealthSyncSource
): Promise<SyncResult> {
  const result = await importGlucoseOnce(profileId, source);
  await recordHealthLastSync(profileId, result, source);
  return result;
}

/** Never rejects: a locked database, a failed permission lookup or a bad page
 *  becomes status "error" (recorded as the last sync, shown by the caller), not
 *  an unhandled promise rejection out of a fire-and-forget background run. */
async function importGlucoseOnce(
  profileId: string,
  source: HealthSyncSource
): Promise<SyncResult> {
  try {
    return await importGlucoseSteps(profileId, source);
  } catch (err) {
    logCrash(err, { screen: "health", op: "importGlucoseOnce" });
    return { status: "error", inserted: 0, read: 0 };
  }
}

async function importGlucoseSteps(
  profileId: string,
  source: HealthSyncSource
): Promise<SyncResult> {
  // 1) Is there a health store at all?
  if (!(await isHealthAvailable())) {
    return { status: "unavailable", inserted: 0, read: 0 };
  }

  // 2) Permission. iOS can't reveal read access, so we can only fail closed
  //    on Android, where the grant list is authoritative. A background run
  //    only checks the grant: it must never open a system dialog.
  const provider = getProvider();
  const granted =
    source === "background"
      ? await (provider?.isReadGranted() ?? Promise.resolve(false)).catch(() => false)
      : await requestHealthPermissions();
  if (!granted) {
    return { status: "denied", inserted: 0, read: 0 };
  }

  if (!provider) return { status: "unavailable", inserted: 0, read: 0 };

  // 3) Read page by page and import each page before asking for the next, so a
  //    sensor's 90 days never sit in memory at once and an interruption keeps
  //    what was already stored. HealthKit resumes from its anchor (saved only
  //    after the page landed); Health Connect re-reads its 30 day window and the
  //    import dedupes by record id.
  const android = Platform.OS === "android";
  const windowDays = android ? ANDROID_SYNC_WINDOW_DAYS : SYNC_WINDOW_DAYS;
  const pageSize = android ? ANDROID_GLUCOSE_PAGE_SIZE : IOS_GLUCOSE_PAGE_SIZE;
  const roundMax = android ? ANDROID_SYNC_ROUND_MAX_SAMPLES : IOS_SYNC_ROUND_MAX_SAMPLES;
  let cursor = android ? null : await readHealthAnchor(profileId);
  let read = 0;
  let inserted = 0;
  // A sample dated ahead of the clock is refused by the import. The anchor must
  // not move past such a page (or any later one: an anchor covers everything
  // before it), or the sample is lost for good; the next sync reads it again.
  let holdAnchor = false;
  for (;;) {
    let page: GlucosePage;
    try {
      page = await provider.readGlucosePage({ windowDays, cursor, pageSize });
    } catch {
      return { status: "error", inserted, read };
    }
    read += page.samples.length;
    const done = await importGlucosePage(profileId, page);
    inserted += done.inserted;
    if (done.retryLater) holdAnchor = true;
    if (!android && page.cursor && !holdAnchor) await writeHealthAnchor(profileId, page.cursor);
    if (!page.hasMore || read >= roundMax) break;
    cursor = page.cursor;
  }
  return { status: "ok", inserted, read };
}

async function readHealthAnchor(profileId: string): Promise<string | null> {
  try {
    return (await AsyncStorage.getItem(`${HEALTH_ANCHOR_KEY}.${profileId}`)) || null;
  } catch {
    return null;
  }
}

async function writeHealthAnchor(profileId: string, anchor: string): Promise<void> {
  try {
    await AsyncStorage.setItem(`${HEALTH_ANCHOR_KEY}.${profileId}`, anchor);
  } catch {
    // The next sync reads from the older anchor; the import dedupes by id.
  }
}

const DAY_MS = 86_400_000;

/**
 * Whether the readings one source app wrote are a sensor stream (see
 * lib/cgm/detect.ts). The page alone usually decides; a thin page (a small
 * incremental sync) is judged together with what the app already delivered. This
 * only MARKS rows: it never changes the profile's measurement mode.
 */
async function sourceIsSensor(
  profileId: string,
  sourceApp: string | null,
  group: GlucoseSample[]
): Promise<boolean> {
  const own: DetectSample[] = group.map((s) => ({
    atMs: Date.parse(s.date),
    userEntered: s.userEntered === true,
    specimenSource: s.specimenSource ?? null,
    recordingMethod: s.recordingMethod ?? null,
  }));
  const context = {
    sourceApp,
    deviceText: group.find((s) => s.deviceText)?.deviceText ?? null,
  };
  if (detectCgmSource(own, context).isCgm) return true;
  try {
    const times = own.map((s) => s.atMs).filter((t) => Number.isFinite(t));
    if (times.length === 0) return false;
    const history = await getImportedSourceHistory(
      profileId,
      "health",
      sourceApp,
      new Date(Math.min(...times) - DAY_MS).toISOString(),
      new Date(Math.max(...times) + DAY_MS).toISOString()
    );
    const seen = new Set(times);
    const stored: DetectSample[] = history.timesMs
      .filter((t) => !seen.has(t))
      .map((atMs) => ({ atMs }));
    return detectCgmSource([...own, ...stored], { ...context, knownCgm: history.knownCgm }).isCgm;
  } catch {
    return false;
  }
}

/** True for a reading that can be a sensor reading even in a sensor's source:
 *  not typed by hand, not a finger-stick specimen. */
function sampleCanBeSensor(s: GlucoseSample): boolean {
  return (
    s.userEntered !== true &&
    s.recordingMethod !== 3 &&
    s.specimenSource !== 2 &&
    s.specimenSource !== 6
  );
}

async function importGlucosePage(
  profileId: string,
  page: GlucosePage
): Promise<{ inserted: number; retryLater: boolean }> {
  if (page.deletedIds.length > 0) {
    await deleteImportedGlucoseByExternalIds(profileId, "health", page.deletedIds);
  }
  const usable = page.samples.filter((s) => Number.isFinite(s.value) && s.value > 0);
  if (usable.length === 0) return { inserted: 0, retryLater: false };
  const retryLater = hasRetryableFutureRow(usable.map((s) => ({ at: s.date })));

  const groups = new Map<string, GlucoseSample[]>();
  for (const s of usable) {
    const key = s.sourceApp ?? "";
    const list = groups.get(key);
    if (list) list.push(s);
    else groups.set(key, [s]);
  }
  const sensorApps = new Set<string>();
  for (const [key, group] of groups) {
    if (await sourceIsSensor(profileId, key === "" ? null : key, group)) sensorApps.add(key);
  }

  const inserted = await insertImportedGlucose(
    profileId,
    usable.map((s) => {
      const isCgm = sensorApps.has(s.sourceApp ?? "") && sampleCanBeSensor(s);
      return {
        at: isCgm ? s.date : snapIso(s.date),
        mgdl: s.value,
        source: "health" as const,
        sourceApp: s.sourceApp ?? null,
        externalId: s.externalId ?? null,
        isCgm,
        periodTag: s.period_tag,
      };
    })
  );
  return { inserted, retryLater };
}

// ── Pro: activity + insulin delivery summary (read-only, descriptive) ────────

/**
 * Reads a descriptive Health summary for the Pro "activity vs glucose" view:
 * exercise minutes + insulin delivery split (iOS/HealthKit only; DIY Loop
 * users). Read-only: nothing is written to the local log, so it never touches
 * the injection-site rotation model. Returns all-null on error / no provider,
 * and always all-null on Android (Health Connect has no insulin record type
 * and this app does not read Android exercise/steps data).
 */
export async function readHealthSummary(windowDays: number): Promise<HealthSummary> {
  const provider = getProvider();
  if (!provider) return { activeMinutes: null, insulin: null };
  try {
    return await provider.readSummary(windowDays);
  } catch {
    return { activeMinutes: null, insulin: null };
  }
}
