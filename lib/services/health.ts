import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { logCrash } from "../analytics";
import {
  getSugarLog,
  insertHealthSugarLogs,
  setSugarLogHealthUuid,
} from "../db/logs";
import { getProfile, listProfiles } from "../db/profiles";
import type { SugarLog } from "../db/types";
import { planWriteFlagRead, shouldWriteToHealth } from "../healthWriteScope";
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
 * iOS never reveals whether share access was granted, so a resolved call is
 * the best signal; Android's grant list is authoritative. The caller keeps
 * the toggle on only if this resolves true.
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
 * Writes ONE reading to the platform health store as a bloodGlucose sample
 * (mg/dL) and returns the created sample's id, or null on failure / no
 * provider. The id is stored on the local row so the mirror can be revoked
 * when the row is deleted.
 */
export async function writeGlucoseToHealth(
  mgdl: number,
  dateIso: string
): Promise<string | null> {
  if (!Number.isFinite(mgdl) || mgdl <= 0) return null;
  const provider = getProvider();
  if (!provider) return null;
  try {
    return await provider.writeGlucose(mgdl, dateIso);
  } catch {
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
  } catch {
    // swallow: a failed mirror-delete must never block the local delete
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
 */
export async function writeGlucoseToHealthIfEnabled(log: SugarLog): Promise<void> {
  if (log.source === "health") return;
  if (!hasHealthProvider()) return;
  const scope = await readHealthWriteScope();
  const allowed = shouldWriteToHealth({
    writeEnabledForProfile: scope.enabled,
    recordProfileId: log.profile_id,
    enabledProfileId: scope.profileId,
  });
  if (!allowed) return;
  const uuid = await writeGlucoseToHealth(log.glucose_level_mgdl, log.logged_at);
  if (!uuid) {
    // The toggle is on and the write was attempted, so a null result here
    // means the write itself failed (H3) - most likely revoked Settings
    // access - not that the mirror is off.
    healthWriteFailureNoticePending = true;
    return;
  }
  try {
    // The caller fires this and moves on, so the row can be undone while the write
    // is still in flight. A sample whose local reading no longer exists is an
    // orphan in the user's Health app, so it is revoked instead of being recorded
    // on a row that is gone.
    if (!(await getSugarLog(log.id))) {
      await deleteGlucoseFromHealth(uuid);
      return;
    }
    await setSugarLogHealthUuid(log.id, uuid);
  } catch (err) {
    // This is fired-and-forgotten from the add flow (never awaited), so a DB
    // hiccup here must never surface as an unhandled rejection. The sample is
    // already written to Health; at worst it stays un-linked (healthkit_uuid
    // not recorded on the row) instead of crashing. H5: the sample is now
    // orphaned in Health (nothing local points at it), so this is tracked
    // silently - no message to the user for a DB-write failure they cannot act on.
    logCrash(err, { screen: "health", op: "linkHealthUuid" });
  }
}

/**
 * Re-mirrors an EDITED reading: revokes the old health-store sample (if any)
 * and writes a fresh one for the corrected value/time. Returns the new id to
 * store on the row (via setSugarLogHealthUuid), or null when nothing should be
 * stored (mirror off, or the write failed). Same delete-old-then-write-new
 * shape as create (writeGlucoseToHealthIfEnabled) - neither store has an
 * "update a sample" call, so a correction is a revoke of the stale value plus
 * a write of the new one.
 */
export async function updateGlucoseInHealth(
  oldUuid: string | null,
  mgdl: number,
  dateIso: string,
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
  if (oldUuid) await deleteGlucoseFromHealth(oldUuid);
  const uuid = await writeGlucoseToHealth(mgdl, dateIso);
  // Same H3 signal as writeGlucoseToHealthIfEnabled: allowed to write, but the
  // write itself came back empty.
  if (!uuid) healthWriteFailureNoticePending = true;
  return uuid;
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
