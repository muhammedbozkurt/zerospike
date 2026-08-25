import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  getSugarLog,
  insertHealthSugarLogs,
  setSugarLogHealthUuid,
} from "../db/logs";
import { getProfile, listProfiles } from "../db/profiles";
import type { PeriodTag, SugarLog } from "../db/types";
import { planWriteFlagRead, shouldWriteToHealth } from "../healthWriteScope";
import { pickMgdl, snapIso } from "./healthMath";

/** Our own app bundle id, used to skip our OWN writes on import (loop guard). */
const OWN_BUNDLE_ID = "com.greeneyeapp.zerospike";

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
 * Apple Health (HealthKit) / Android Health Connect bridge.
 *
 * Mirrors the RevenueCat pattern: a single DEBUG flag keeps everything
 * simulated during development (no device or CGM required), while a production
 * build reads real `BloodGlucose` samples from the platform health store.
 *
 * The native module is lazy-`require`d ONLY in real mode, so Expo Go,
 * development and JS bundling never load native code.
 *
 *   iOS only → @kingstinct/react-native-healthkit  (HKQuantityType bloodGlucose)
 *
 * Android Health Connect was removed for the Google Play health-permission
 * policy, so the whole Health/CGM feature is iOS-only. Flip to real by shipping
 * a production build (DEBUG_MOCK_HEALTH is __DEV__), or set the constant to
 * `false` to test the real path on a dev build.
 */
/** Dev builds simulate Health end to end. To exercise the REAL HealthKit path
 *  on a dev build (the simulator's Health app included), restart the bundler
 *  with EXPO_PUBLIC_REAL_HEALTH=1; the native module is already linked. */
export const DEBUG_MOCK_HEALTH =
  __DEV__ && process.env.EXPO_PUBLIC_REAL_HEALTH !== "1";

/** How far back a sync scans the health store (days). */
const SYNC_WINDOW_DAYS = 90;
/** Hard cap on samples pulled per sync (newest first). */
const SYNC_MAX_SAMPLES = 300;

export interface GlucoseSample {
  value: number; // mg/dL
  date: string; // ISO timestamp
  period_tag: PeriodTag;
}

/** Outcome of a sync so the UI can tell the user exactly what happened. */
export type SyncStatus = "ok" | "unavailable" | "denied" | "error";
export interface SyncResult {
  status: SyncStatus;
  /** newly inserted rows */
  inserted: number;
  /** samples read from the health store (0 → nothing there / no permission) */
  read: number;
}

/**
 * A GUESS at the period of an imported sample, from its hour of day. HealthKit
 * carries no fasting/post-meal context, so this is an assumption, not an
 * observation - which is exactly why every imported row is stored with
 * source: "health" and why the fasting/post-meal AVERAGES exclude those rows
 * (see lib/insights.ts). The tag is only there so an imported reading still has
 * a sensible label in the journal.
 */
function pickTagForHour(hour: number): PeriodTag {
  // Late evening / just after midnight first: the old order tested `hour < 9`
  // ahead of it, so the `hour < 1` half of the bedtime rule could never run and
  // a 00:30 reading was filed as "fasting".
  if (hour >= 22 || hour < 1) return "bedtime";
  if (hour < 9) return "fasting";
  return "manual";
}

// ── Availability & permissions ─────────────────────────────────────────────

export async function isHealthAvailable(): Promise<boolean> {
  if (DEBUG_MOCK_HEALTH) return Platform.OS === "ios";
  try {
    if (Platform.OS === "ios") {
      const HK = require("@kingstinct/react-native-healthkit");
      return await HK.isHealthDataAvailable();
    }
  } catch {
    return false;
  }
  return false;
}

export async function requestHealthPermissions(): Promise<boolean> {
  if (DEBUG_MOCK_HEALTH) return isHealthAvailable();
  try {
    if (Platform.OS === "ios") {
      const HK = require("@kingstinct/react-native-healthkit");
      // iOS never reveals whether *read* access was granted (privacy), so a
      // resolved call is the best signal we can get here. v14 takes a single
      // { toShare, toRead } object with string-literal identifiers. We also
      // request insulin delivery + exercise time for the Pro Health summary.
      await HK.requestAuthorization({
        toShare: [],
        toRead: [
          "HKQuantityTypeIdentifierBloodGlucose",
          "HKQuantityTypeIdentifierInsulinDelivery",
          "HKQuantityTypeIdentifierAppleExerciseTime",
        ],
      });
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

// ── Reads ──────────────────────────────────────────────────────────────────

function readMockGlucose(): GlucoseSample[] {
  const now = Date.now();
  const samples: GlucoseSample[] = [];
  let baseline = 95 + Math.round(Math.random() * 20);
  // ~8 readings/day over the window, timestamps snapped to the half hour so
  // repeat syncs dedupe cleanly (matching real-store behaviour).
  const count = 24;
  for (let i = count - 1; i >= 0; i--) {
    const raw = now - i * 3 * 60 * 60 * 1000;
    const ts = new Date(Math.round(raw / (30 * 60 * 1000)) * 30 * 60 * 1000);
    baseline += Math.round((Math.random() - 0.45) * 18);
    baseline = Math.max(70, Math.min(220, baseline));
    samples.push({
      value: baseline,
      date: ts.toISOString(),
      period_tag: pickTagForHour(ts.getHours()),
    });
  }
  return samples;
}

async function readRealGlucoseIOS(): Promise<GlucoseSample[]> {
  const HK = require("@kingstinct/react-native-healthkit");
  const from = new Date(Date.now() - SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  // v14 (Nitro) moved the date range into filter.date and made the identifier a
  // string literal (the HKQuantityTypeIdentifier enum was removed).
  const samples = await HK.queryQuantitySamples(
    "HKQuantityTypeIdentifierBloodGlucose",
    {
      limit: SYNC_MAX_SAMPLES,
      ascending: false,
      unit: "mg/dL",
      filter: { date: { startDate: from } },
    }
  );
  return (samples ?? [])
    // H2 loop guard: NEVER re-import a sample we wrote ourselves, or a
    // mirror-then-import cycle would double every manual reading. HealthKit tags
    // each sample with the writing app's bundle in sourceRevision.
    .filter(
      (s: any) => s?.sourceRevision?.source?.bundleIdentifier !== OWN_BUNDLE_ID
    )
    .map((s: any) => {
    const when = new Date(s.endDate ?? s.startDate);
    // The query above requests unit "mg/dL", so s.quantity is ALREADY mg/dL,
    // it must NOT pass through any mmol heuristic (that inverted true sub-30
    // hypos into fake highs). snapIso collapses ms-drift re-reads on dedup.
    const mgdl = pickMgdl({ mgdl: Number(s.quantity) });
    return {
      value: mgdl == null ? 0 : Math.round(mgdl),
      date: snapIso(when.toISOString()),
      period_tag: pickTagForHour(when.getHours()),
    };
  });
}

/** Reads recent glucose from the platform health store (or the dev mock). */
export async function readRecentGlucose(): Promise<GlucoseSample[]> {
  if (DEBUG_MOCK_HEALTH) return readMockGlucose();
  try {
    if (Platform.OS === "ios") return await readRealGlucoseIOS();
  } catch {
    return [];
  }
  return [];
}

// ── Writes: mirror manual readings to Apple Health (opt-in) ─────────────────

/**
 * Requests WRITE (share) permission for blood glucose. Called at POINT OF USE -
 * when the user turns the "write to Apple Health" toggle ON - never at onboarding.
 * iOS never reveals whether share access was granted, so a resolved call is the
 * best signal; the caller keeps the toggle on only if this resolves true.
 */
export async function requestHealthWritePermission(): Promise<boolean> {
  if (DEBUG_MOCK_HEALTH) return isHealthAvailable();
  try {
    if (Platform.OS === "ios") {
      const HK = require("@kingstinct/react-native-healthkit");
      await HK.requestAuthorization({
        toShare: ["HKQuantityTypeIdentifierBloodGlucose"],
        toRead: [],
      });
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Writes ONE reading to Apple Health as a bloodGlucose sample (mg/dL) and returns
 * the created sample's UUID, or null on failure / off iOS. The UUID is stored on
 * the local row so the mirror can be revoked when the row is deleted.
 */
export async function writeGlucoseToHealth(
  mgdl: number,
  dateIso: string
): Promise<string | null> {
  if (!Number.isFinite(mgdl) || mgdl <= 0) return null;
  if (DEBUG_MOCK_HEALTH) return `mock-hk-${Date.parse(dateIso) || 0}-${Math.round(mgdl)}`;
  try {
    if (Platform.OS === "ios") {
      const HK = require("@kingstinct/react-native-healthkit");
      const when = new Date(dateIso);
      const res = await HK.saveQuantitySample(
        "HKQuantityTypeIdentifierBloodGlucose",
        { unit: "mg/dL", quantity: Math.round(mgdl), start: when, end: when }
      );
      // v14 returns the new sample's UUID string (older shapes: an object).
      if (typeof res === "string") return res;
      return res?.uuid ?? null;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Best-effort revoke of a mirrored sample by UUID. HealthKit only lets an app
 * delete samples IT wrote, so this is safe; any failure is swallowed and never
 * blocks the local delete.
 */
export async function deleteGlucoseFromHealth(uuid: string | null): Promise<void> {
  if (!uuid || DEBUG_MOCK_HEALTH) return;
  try {
    if (Platform.OS === "ios") {
      const HK = require("@kingstinct/react-native-healthkit");
      await HK.deleteObjects("HKQuantityTypeIdentifierBloodGlucose", {
        uuids: [uuid],
      });
    }
  } catch {
    // swallow: a failed mirror-delete must never block the local delete
  }
}

/**
 * If the user opted in, mirror a freshly-added MANUAL reading to Apple Health and
 * store the returned UUID on the row. Never mirrors imported ('health') rows -
 * that is where the loop would start. Fire-and-forget from the add flow; a failed
 * mirror leaves the row un-mirrored (healthkit_uuid stays null) and never crashes.
 *
 * The opt-in belongs to ONE profile, and the row carries its own profile_id, so
 * a reading is mirrored only when the two are the same person.
 */
export async function writeGlucoseToHealthIfEnabled(log: SugarLog): Promise<void> {
  if (log.source === "health") return;
  if (Platform.OS !== "ios") return;
  const scope = await readHealthWriteScope();
  const allowed = shouldWriteToHealth({
    writeEnabledForProfile: scope.enabled,
    recordProfileId: log.profile_id,
    enabledProfileId: scope.profileId,
  });
  if (!allowed) return;
  const uuid = await writeGlucoseToHealth(log.glucose_level_mgdl, log.logged_at);
  if (!uuid) return;
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
  } catch {
    // This is fired-and-forgotten from the add flow (never awaited), so a DB
    // hiccup here must never surface as an unhandled rejection. The sample is
    // already written to Health; at worst it stays un-linked (healthkit_uuid
    // not recorded on the row) instead of crashing.
  }
}

/**
 * Re-mirrors an EDITED reading: revokes the old Apple Health sample (if any)
 * and writes a fresh one for the corrected value/time. Returns the new UUID to
 * store on the row (via setSugarLogHealthUuid), or null when nothing should be
 * stored (mirror off, or the write failed). Same delete-old-then-write-new
 * shape as create (writeGlucoseToHealthIfEnabled) - HealthKit has no "update a
 * sample" call, so a correction is a revoke of the stale value plus a write of
 * the new one.
 *
 * NOT wired to a caller yet: the two edit flows that can change a mirrored
 * reading's value (dashboard glucose edit, calculator's linked-reading edit)
 * live in files outside this task's ownership. See the delivery report for the
 * call sites and the one-line change each needs.
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
  if (Platform.OS !== "ios") return null;
  const scope = await readHealthWriteScope();
  const allowed = shouldWriteToHealth({
    writeEnabledForProfile: scope.enabled,
    recordProfileId,
    enabledProfileId: scope.profileId,
  });
  if (!allowed) return null;
  if (oldUuid) await deleteGlucoseFromHealth(oldUuid);
  return writeGlucoseToHealth(mgdl, dateIso);
}

// ── Import into local SQLite ───────────────────────────────────────────────

/**
 * Pulls recent glucose readings from the platform health store (or the mock in
 * dev) into the profile's local log, skipping anything already imported.
 *
 * Returns a {@link SyncResult} so the caller can give precise feedback:
 *  - `unavailable` → no Health/Health Connect on this device
 *  - `denied`      → permission not granted (Android; iOS can't report this)
 *  - `error`       → the native read threw
 *  - `ok`          → read `read` samples, inserted `inserted` new ones
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

export interface HealthSummary {
  /** Total exercise/active minutes over the window (null if unavailable). */
  activeMinutes: number | null;
  /** Insulin delivery split from the health store (iOS/DIY Loop only). */
  insulin: { basalUnits: number; bolusUnits: number; count: number } | null;
}

function mockHealthSummary(windowDays: number): HealthSummary {
  // iOS-only feature, so Android returns nothing even in the dev mock.
  if (Platform.OS !== "ios") return { activeMinutes: null, insulin: null };
  const scale = windowDays / 7;
  return {
    activeMinutes: Math.round(150 * scale),
    insulin: {
      basalUnits: Math.round(18 * 7 * scale),
      bolusUnits: Math.round(12 * 7 * scale),
      count: Math.round(28 * scale),
    },
  };
}

async function readInsulinIOS(windowDays: number): Promise<HealthSummary["insulin"]> {
  const HK = require("@kingstinct/react-native-healthkit");
  const from = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const samples = await HK.queryQuantitySamples(
    "HKQuantityTypeIdentifierInsulinDelivery",
    { limit: 2000, ascending: false, unit: "IU", filter: { date: { startDate: from } } }
  );
  let basal = 0;
  let bolus = 0;
  let count = 0;
  for (const s of samples ?? []) {
    const units = Number(s.quantity) || 0;
    // HKInsulinDeliveryReason metadata: 1 = basal, 2 = bolus.
    const reason = s?.metadata?.HKInsulinDeliveryReason;
    if (reason === 2) bolus += units;
    else basal += units;
    count++;
  }
  return { basalUnits: Math.round(basal), bolusUnits: Math.round(bolus), count };
}

async function readExerciseMinutesIOS(windowDays: number): Promise<number> {
  const HK = require("@kingstinct/react-native-healthkit");
  const from = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const samples = await HK.queryQuantitySamples(
    "HKQuantityTypeIdentifierAppleExerciseTime",
    { limit: 3000, ascending: false, unit: "min", filter: { date: { startDate: from } } }
  );
  let mins = 0;
  for (const s of samples ?? []) mins += Number(s.quantity) || 0;
  return Math.round(mins);
}

/**
 * Reads a descriptive Health summary for the Pro "activity vs glucose" view:
 * exercise minutes + insulin delivery split (iOS/HealthKit only; DIY Loop
 * users). Read-only: nothing is written to the local log, so it never touches
 * the injection-site rotation model. Returns all-null on error / no access, and
 * always all-null off iOS (Health Connect was removed).
 */
export async function readHealthSummary(windowDays: number): Promise<HealthSummary> {
  if (DEBUG_MOCK_HEALTH) return mockHealthSummary(windowDays);
  const out: HealthSummary = { activeMinutes: null, insulin: null };
  if (Platform.OS !== "ios") return out;
  try {
    out.insulin = await readInsulinIOS(windowDays);
    out.activeMinutes = await readExerciseMinutesIOS(windowDays);
  } catch {
    // leave whatever was read; never throw to the UI
  }
  return out;
}
