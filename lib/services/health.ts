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
 * The native modules are lazy-`require`d ONLY in real mode, so Expo Go,
 * development and JS bundling never load native code.
 *
 *   iOS     → @kingstinct/react-native-healthkit  (HKQuantityType bloodGlucose)
 *   Android → react-native-health-connect          (BloodGlucose records)
 *
 * Flip to real by shipping a production build (DEBUG_MOCK_HEALTH is __DEV__),
 * or set the constant to `false` to test the real path on a dev build.
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

function pickTagForHour(hour: number): PeriodTag {
  if (hour < 9) return "fasting";
  if (hour >= 22 || hour < 1) return "bedtime";
  return "manual";
}

// ── Availability & permissions ─────────────────────────────────────────────

export async function isHealthAvailable(): Promise<boolean> {
  if (DEBUG_MOCK_HEALTH) {
    return Platform.OS === "ios" || Platform.OS === "android";
  }
  try {
    if (Platform.OS === "ios") {
      const HK = require("@kingstinct/react-native-healthkit");
      return await HK.isHealthDataAvailable();
    }
    if (Platform.OS === "android") {
      const { getSdkStatus, SdkAvailabilityStatus } = require("react-native-health-connect");
      const status = await getSdkStatus();
      return status === SdkAvailabilityStatus.SDK_AVAILABLE;
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
      // { toShare, toRead } object with string-literal identifiers.
      await HK.requestAuthorization({
        toShare: [],
        toRead: ["HKQuantityTypeIdentifierBloodGlucose"],
      });
      return true;
    }
    if (Platform.OS === "android") {
      const HC = require("react-native-health-connect");
      await HC.initialize();
      await HC.requestPermission([{ accessType: "read", recordType: "BloodGlucose" }]);
      // Trust the explicit grant list rather than requestPermission's return,
      // whose shape has varied across versions.
      return await androidHasReadPermission(HC);
    }
  } catch {
    return false;
  }
  return false;
}

/** True only if Health Connect currently holds BloodGlucose *read* access. */
async function androidHasReadPermission(HC: any): Promise<boolean> {
  try {
    const granted = await HC.getGrantedPermissions();
    return (
      Array.isArray(granted) &&
      granted.some(
        (p: any) => p?.recordType === "BloodGlucose" && p?.accessType === "read"
      )
    );
  } catch {
    return false;
  }
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

async function readRealGlucoseAndroid(): Promise<GlucoseSample[]> {
  const HC = require("react-native-health-connect");
  await HC.initialize();
  const end = new Date();
  const start = new Date(end.getTime() - SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const res = await HC.readRecords("BloodGlucose", {
    timeRangeFilter: {
      operator: "between",
      startTime: start.toISOString(),
      endTime: end.toISOString(),
    },
    ascendingOrder: false,
    pageSize: SYNC_MAX_SAMPLES,
  });
  const records = res?.records ?? (Array.isArray(res) ? res : []);
  return records.map((r: any) => {
    // Health Connect exposes both unit fields explicitly — prefer mg/dL, and
    // convert ONLY the explicit mmol field (no magnitude guessing).
    const mgdl = pickMgdl({
      mgdl: r.level?.inMilligramsPerDeciliter ?? null,
      mmol: r.level?.inMillimolesPerLiter ?? null,
    });
    const when = new Date(r.time ?? r.startTime);
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
    if (Platform.OS === "android") return await readRealGlucoseAndroid();
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
