import { Linking, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { logCrash } from "../analytics";
import {
  getSugarLog,
  insertHealthSugarLogs,
  listHealthBackfillRows,
  listHealthMirrorRows,
  listHealthUuidLinks,
  listLinkedHealthUuids,
  setSugarLogHealthUuid,
} from "../db/logs";
import { getProfile, listProfiles } from "../db/profiles";
import type { PeriodTag, SugarLog } from "../db/types";
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
import { buildHealthWriteMeta, type HealthWriteMeta } from "../healthMeta";
import { planWriteFlagRead, shouldWriteToHealth } from "../healthWriteScope";
import {
  buildRetryStatusRecord,
  isRetryPassOpen,
  pruneWritePendingQueue,
  selectHealthRetryCandidates,
  type HealthWriteStatusRecord,
  type PendingWriteEntry,
} from "../healthWriteRetry";
import { healthAppleKit } from "./healthAppleKit";
import {
  healthConnect,
  getHealthConnectStatus as hcGetStatus,
  isReadPermissionBlocked,
  isWritePermissionBlocked,
} from "./healthConnect";
import { healthMock } from "./healthMock";
import {
  ANDROID_SYNC_WINDOW_DAYS,
  SYNC_MAX_SAMPLES,
  SYNC_WINDOW_DAYS,
} from "./healthTypes";
import type {
  GlucoseSample,
  HealthConnectStatus,
  HealthProvider,
  HealthSummary,
  SyncResult,
} from "./healthTypes";

export type {
  GlucoseSample,
  SyncStatus,
  SyncResult,
  HealthSummary,
  HealthConnectStatus,
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
async function getPendingWriteEntries(profileId: string): Promise<PendingWriteEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(`${HEALTH_WRITE_PENDING_KEY}.${profileId}`);
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
  entries: readonly PendingWriteEntry[]
): Promise<void> {
  try {
    await AsyncStorage.setItem(`${HEALTH_WRITE_PENDING_KEY}.${profileId}`, JSON.stringify(entries));
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
async function addPendingWriteId(profileId: string | null | undefined, id: string): Promise<void> {
  if (!profileId) return;
  await writeQueueLock(async () => {
    try {
      const nowMs = Date.now();
      let entries = pruneWritePendingQueue(await getPendingWriteEntries(profileId), nowMs);
      if (!entries.some((e) => e.id === id)) {
        entries = pruneWritePendingQueue(
          [...entries, { id, queuedAtIso: new Date(nowMs).toISOString() }],
          nowMs
        );
      }
      await savePendingWriteEntries(profileId, entries);
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
  idsToRemove: readonly string[]
): Promise<void> {
  if (idsToRemove.length === 0) return;
  await writeQueueLock(async () => {
    try {
      const entries = await getPendingWriteEntries(profileId);
      const remove = new Set(idsToRemove);
      const next = entries.filter((e) => !remove.has(e.id));
      if (next.length === entries.length) return;
      await savePendingWriteEntries(profileId, next);
    } catch {
      // best-effort
    }
  });
}

/** Links a Health sample id to its row. The id also leaves the delete queue:
 *  Health Connect keeps the uuid on an upsert, so an id queued for deletion by
 *  an earlier undo can be the very sample this row now owns. */
async function linkHealthUuid(rowId: string, uuid: string): Promise<void> {
  await setSugarLogHealthUuid(rowId, uuid);
  await dequeueHealthDeletes([uuid]);
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
  profileId?: string | null
): Promise<{ read: boolean; write: boolean; writeEnabled: boolean; newlyEnabled: boolean }> {
  const provider = getProvider();
  if (!provider) return { read: false, write: false, writeEnabled: false, newlyEnabled: false };
  try {
    const wasAuthorized = await provider.isWriteAuthorized();
    const res = await provider.requestReadWritePermissions();
    let newlyEnabled = false;
    if (res.write && !wasAuthorized) {
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
 *  by default (see ANDROID_SYNC_WINDOW_DAYS), HealthKit gets the full 90. */
export async function readRecentGlucose(): Promise<GlucoseSample[]> {
  const provider = getProvider();
  if (!provider) return [];
  const windowDays = Platform.OS === "android" ? ANDROID_SYNC_WINDOW_DAYS : SYNC_WINDOW_DAYS;
  try {
    return await provider.readRecentGlucose(windowDays, SYNC_MAX_SAMPLES);
  } catch {
    return [];
  }
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
 * Row ids a write is mid-flight on RIGHT NOW, module-level (2.3.5 fix):
 * added the instant an attempt starts, removed as soon as it settles either
 * way. Both the fresh-write path (writeGlucoseToHealthIfEnabled) and the
 * retry pass (retryPendingHealthWrites) add/remove their own row here and
 * the retry additionally SKIPS anything already in this set - without it, a
 * fresh write and a retry pass racing on the same row could both see
 * healthkit_uuid still null and write a second sample for the same reading.
 */
const healthWriteInFlightIds = new Set<string>();

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
  try {
    return await provider.writeGlucose(mgdl, dateIso, meta);
  } catch (err) {
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
  if (!uuid) return;
  const provider = getProvider();
  if (!provider) return;
  try {
    await provider.deleteGlucose(uuid);
  } catch (err) {
    logCrash(err, { screen: "health", op: "deleteGlucose" });
    // A failed mirror-delete never blocks the local delete; it is retried
    // later instead (retryPendingHealthDeletes).
    await queueHealthDeletes([uuid]);
  }
}

async function getDeleteEntries(): Promise<PendingDeleteEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(HEALTH_DELETE_PENDING_KEY);
    if (!raw) return [];
    return normalizeDeleteEntries(JSON.parse(raw), new Date().toISOString());
  } catch {
    return [];
  }
}

async function saveDeleteEntries(entries: readonly PendingDeleteEntry[]): Promise<void> {
  try {
    await AsyncStorage.setItem(HEALTH_DELETE_PENDING_KEY, JSON.stringify(entries));
  } catch {
    // best-effort
  }
}

async function queueHealthDeletes(uuids: readonly string[]): Promise<void> {
  if (uuids.length === 0) return;
  await deleteQueueLock(async () => {
    await saveDeleteEntries(enqueueDeletes(await getDeleteEntries(), uuids, Date.now()));
  });
}

async function dequeueHealthDeletes(uuids: readonly string[]): Promise<void> {
  await deleteQueueLock(async () => {
    const entries = await getDeleteEntries();
    if (entries.length === 0) return;
    const next = removeDeleted(entries, uuids);
    if (next.length !== entries.length) await saveDeleteEntries(next);
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
      await provider.deleteGlucoseBatch(batch);
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
        await provider.deleteGlucoseBatch(batch);
        done.push(...batch);
      } catch {
        // One bad id must not pin the rest of its batch: fall back to singles,
        // but give up on the whole pass if the first single fails too.
        let first = true;
        for (const id of batch) {
          try {
            await provider.deleteGlucose(id);
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
 */
export async function writeGlucoseToHealthIfEnabled(log: SugarLog): Promise<boolean> {
  if (log.source === "health") return true;
  if (!hasHealthProvider()) return true;
  const scope = await readHealthWriteScope();
  const allowed = shouldWriteToHealth({
    writeEnabledForProfile: scope.enabled,
    recordProfileId: log.profile_id,
    enabledProfileId: scope.profileId,
  });
  if (!allowed) return true;
  healthWriteInFlightIds.add(log.id);
  try {
    const uuid = await writeGlucoseToHealth(
      log.glucose_level_mgdl,
      log.logged_at,
      buildHealthWriteMeta(log)
    );
    await recordHealthWriteStatus(log.profile_id, uuid != null);
    if (!uuid) {
      // The toggle is on and the write was attempted, so a null result here
      // means the write itself failed (H3) - most likely revoked Settings
      // access - not that the mirror is off. Queued so the next
      // foreground/manual-sync retry re-attempts exactly this row (see
      // retryPendingHealthWrites) - the queue is the ONLY thing a retry
      // ever reads from, so a row logged while the toggle was off can never
      // be swept up later (consent scope, 2.3.5 fix).
      healthWriteFailureNoticePending = true;
      await addPendingWriteId(log.profile_id, log.id);
      return false;
    }
    try {
      // The caller fires this and moves on, so the row can be undone while the write
      // is still in flight. A sample whose local reading no longer exists is an
      // orphan in the user's Health app, so it is revoked instead of being recorded
      // on a row that is gone.
      if (!(await getSugarLog(log.id))) {
        await deleteGlucoseFromHealth(uuid);
        return true;
      }
      await linkHealthUuid(log.id, uuid);
      // In case an earlier attempt had queued this same row: it is linked
      // now, so it must not be retried again.
      await removePendingWriteIds(log.profile_id, [log.id]);
    } catch (err) {
      // The sample IS in Health now but the local row never got the link -
      // left alone, a LATER write (a retry, or this row logged again) would
      // see healthkit_uuid still null and write a SECOND sample for the
      // same reading (2.3.5 double-write fix). Revoke the orphan and queue
      // the row instead, so the next retry starts clean.
      try {
        await deleteGlucoseFromHealth(uuid);
      } catch {
        // best-effort: the DB failure below is what matters here
      }
      await addPendingWriteId(log.profile_id, log.id);
      // This is fired-and-forgotten from the add flow (never awaited), so a DB
      // hiccup here must never surface as an unhandled rejection.
      logCrash(err, { screen: "health", op: "linkHealthUuid" });
    }
    return true;
  } finally {
    healthWriteInFlightIds.delete(log.id);
  }
}

/**
 * Re-mirrors an EDITED reading: writes the corrected value/time, then revokes
 * the old health-store sample (if any, and if it is a different object).
 * Returns the new id to store on the row (via setSugarLogHealthUuid), or null
 * when nothing should be stored (mirror off, or the write failed; the stale
 * sample is revoked in that case too, so a wrong value never lingers).
 */
export async function updateGlucoseInHealth(
  /** The row being corrected - queued for retry on failure (2.3.5 fix): this
   *  row already carried a mirror sample (oldUuid), so it is squarely inside
   *  the mirror's already-consented scope, not a consent-scope expansion the
   *  way a never-attempted row would be. */
  logId: string,
  oldUuid: string | null,
  mgdl: number,
  dateIso: string,
  /** The corrected reading's period tag, for the meal-context metadata. */
  periodTag: PeriodTag | null,
  /** The profile the corrected row belongs to. REQUIRED (X7): defaulting it to
   *  "whatever profile has the switch on" made the check compare a value to
   *  itself, so the gate always opened - a caregiver correcting a reading on
   *  one profile could mirror it into the Health account of another. */
  recordProfileId: string | null
): Promise<string | null> {
  if (!hasHealthProvider()) return null;
  const scope = await readHealthWriteScope();
  const allowed = shouldWriteToHealth({
    writeEnabledForProfile: scope.enabled,
    recordProfileId,
    enabledProfileId: scope.profileId,
  });
  if (!allowed) return null;
  // Write FIRST, revoke the stale sample after: a failed write can no longer
  // cost the user the old sample. The write carries the row id as sync id with
  // a newer version, so the store itself replaces a sample written the same
  // way (HealthKit replaces it with a new uuid and drops the old sample, Health
  // Connect upserts and keeps the uuid). The explicit revoke covers legacy
  // samples that carry no sync id; when the store already replaced the old one
  // it finds nothing and is harmless. It is skipped when the uuid is unchanged,
  // since that would delete the sample just written.
  const uuid = await writeGlucoseToHealth(
    mgdl,
    dateIso,
    buildHealthWriteMeta({ id: logId, period_tag: periodTag })
  );
  if (oldUuid && oldUuid !== uuid) await deleteGlucoseFromHealth(oldUuid);
  await recordHealthWriteStatus(recordProfileId, uuid != null);
  // Same H3 signal as writeGlucoseToHealthIfEnabled: allowed to write, but the
  // write itself came back empty.
  if (!uuid) {
    healthWriteFailureNoticePending = true;
    // Queued so the next foreground/manual-sync retry re-attempts exactly
    // this row - the caller still clears healthkit_uuid to null on the row
    // (it has no fresh sample to point at), which is exactly what makes the
    // row eligible again once queued.
    await addPendingWriteId(recordProfileId, logId);
  }
  return uuid;
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

    const candidates = selectHealthRetryCandidates(
      rows,
      pendingIds,
      healthWriteInFlightIds,
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
      healthWriteInFlightIds.add(row.id);
      try {
        const uuid = await writeGlucoseToHealth(
          row.glucose_level_mgdl,
          row.logged_at,
          buildHealthWriteMeta(row)
        );
        if (!uuid) continue; // stays queued, tried again next pass
        try {
          // Same orphan guard as the fresh-write path: the row may have been
          // deleted while the native write was in flight.
          if (!(await getSugarLog(row.id))) {
            await deleteGlucoseFromHealth(uuid);
            continue;
          }
          await linkHealthUuid(row.id, uuid);
          // Only counted as succeeded once the LOCAL link is written too -
          // a native write that succeeds but never links (below) leaves the
          // row still pending, and must count toward the failed tally, not
          // the succeeded one, or buildRetryStatusRecord's count would be
          // wrong (see 2.3.5 fix).
          succeeded++;
          succeededIds.push(row.id);
        } catch (err) {
          // Same double-write guard as the fresh-write path: the sample
          // exists now but never got linked, so revoke it and leave the
          // row queued rather than risking a second sample next retry.
          try {
            await deleteGlucoseFromHealth(uuid);
          } catch {
            // best-effort
          }
          logCrash(err, { screen: "health", op: "retryLinkHealthUuid" });
        }
      } finally {
        healthWriteInFlightIds.delete(row.id);
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
      healthWriteInFlightIds,
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
        if (healthWriteInFlightIds.has(stale.id)) continue;
        healthWriteInFlightIds.add(stale.id);
        try {
          const row = await getSugarLog(stale.id);
          if (!row || row.healthkit_uuid != null || row.source === "health") continue;
          const uuid = await writeGlucoseToHealth(
            row.glucose_level_mgdl,
            row.logged_at,
            buildHealthWriteMeta(row)
          );
          if (!uuid) {
            failed++;
            continue;
          }
          try {
            if (!(await getSugarLog(row.id))) {
              await deleteGlucoseFromHealth(uuid);
              continue;
            }
            await linkHealthUuid(row.id, uuid);
            written++;
            writtenIds.push(row.id);
          } catch (err) {
            try {
              await deleteGlucoseFromHealth(uuid);
            } catch {
              // best-effort
            }
            failed++;
            logCrash(err, { screen: "health", op: "backfillLinkHealthUuid" });
          }
        } finally {
          healthWriteInFlightIds.delete(stale.id);
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
export async function importHealthGlucose(profileId: string): Promise<SyncResult> {
  // 1) Is there a health store at all?
  if (!(await isHealthAvailable())) {
    return { status: "unavailable", inserted: 0, read: 0 };
  }

  // 2) Permission. iOS can't reveal read access, so we can only fail closed
  //    on Android, where the grant list is authoritative.
  const granted = await requestHealthPermissions();
  if (!granted) {
    return { status: "denied", inserted: 0, read: 0 };
  }

  // 3) Read + import, never letting a native error reach the UI.
  let samples: GlucoseSample[];
  try {
    samples = await readRecentGlucose();
  } catch {
    return { status: "error", inserted: 0, read: 0 };
  }

  // One transaction for the whole batch, with the dedup resolved from a single
  // range query (see insertHealthSugarLogs) instead of a COUNT per sample.
  const usable = samples.filter((s) => Number.isFinite(s.value) && s.value > 0);
  const inserted = await insertHealthSugarLogs(
    profileId,
    usable.map((s) => ({
      glucose_level_mgdl: s.value,
      period_tag: s.period_tag,
      logged_at: s.date,
    }))
  );
  return { status: "ok", inserted, read: samples.length };
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
