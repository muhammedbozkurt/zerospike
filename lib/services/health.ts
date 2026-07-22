import { Platform } from "react-native";
import { addSugarLog, sugarLogExistsAt } from "../db/logs";
import type { PeriodTag } from "../db/types";
import { pickMgdl, snapIso } from "./healthMath";

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
export const DEBUG_MOCK_HEALTH = __DEV__;

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
  if (hour < 9) return "fasting";
  if (hour >= 22 || hour < 1) return "bedtime";
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
  return (samples ?? []).map((s: any) => {
    const when = new Date(s.endDate ?? s.startDate);
    // The query above requests unit "mg/dL", so s.quantity is ALREADY mg/dL —
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

  let inserted = 0;
  for (const s of samples) {
    if (!Number.isFinite(s.value) || s.value <= 0) continue;
    if (await sugarLogExistsAt(profileId, s.date, "health", s.value)) continue;
    await addSugarLog({
      profile_id: profileId,
      glucose_level_mgdl: s.value,
      period_tag: s.period_tag,
      source: "health",
      logged_at: s.date,
    });
    inserted++;
  }
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
