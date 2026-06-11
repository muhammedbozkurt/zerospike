import { Platform } from "react-native";
import { addSugarLog, sugarLogExistsAt } from "../db/logs";
import type { PeriodTag } from "../db/types";

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

export interface GlucoseSample {
  value: number; // mg/dL
  date: string; // ISO timestamp
  period_tag: PeriodTag;
}

function pickTagForHour(hour: number): PeriodTag {
  if (hour < 9) return "fasting";
  if (hour >= 22 || hour < 1) return "bedtime";
  return "manual";
}

/** mmol/L readings (typically < 30) are converted to mg/dL. */
function toMgdl(value: number): number {
  return value > 0 && value < 30 ? value * 18 : value;
}

// ── Availability & permissions ─────────────────────────────────────────────

export async function isHealthAvailable(): Promise<boolean> {
  if (DEBUG_MOCK_HEALTH) {
    return Platform.OS === "ios" || Platform.OS === "android";
  }
  try {
    if (Platform.OS === "ios") {
      const HealthKit = require("@kingstinct/react-native-healthkit").default;
      return await HealthKit.isHealthDataAvailable();
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
      const HealthKit = require("@kingstinct/react-native-healthkit").default;
      const { HKQuantityTypeIdentifier } = require("@kingstinct/react-native-healthkit");
      await HealthKit.requestAuthorization([HKQuantityTypeIdentifier.bloodGlucose], []);
      return true;
    }
    if (Platform.OS === "android") {
      const { initialize, requestPermission } = require("react-native-health-connect");
      await initialize();
      const granted = await requestPermission([
        { accessType: "read", recordType: "BloodGlucose" },
      ]);
      return Array.isArray(granted) ? granted.length > 0 : Boolean(granted);
    }
  } catch {
    return false;
  }
  return false;
}

// ── Reads ──────────────────────────────────────────────────────────────────

function readMockGlucose(count: number): GlucoseSample[] {
  const now = Date.now();
  const samples: GlucoseSample[] = [];
  let baseline = 95 + Math.round(Math.random() * 20);
  for (let i = count - 1; i >= 0; i--) {
    const ts = new Date(now - i * 30 * 60 * 1000);
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

async function readRealGlucoseIOS(count: number): Promise<GlucoseSample[]> {
  const HealthKit = require("@kingstinct/react-native-healthkit").default;
  const { HKQuantityTypeIdentifier } = require("@kingstinct/react-native-healthkit");
  const samples = await HealthKit.queryQuantitySamples(
    HKQuantityTypeIdentifier.bloodGlucose,
    { limit: count, ascending: false, unit: "mg/dL" }
  );
  return (samples ?? []).map((s: any) => {
    const when = new Date(s.endDate ?? s.startDate);
    return {
      value: Math.round(toMgdl(Number(s.quantity))),
      date: when.toISOString(),
      period_tag: pickTagForHour(when.getHours()),
    };
  });
}

async function readRealGlucoseAndroid(count: number): Promise<GlucoseSample[]> {
  const { initialize, readRecords } = require("react-native-health-connect");
  await initialize();
  const end = new Date();
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  const res = await readRecords("BloodGlucose", {
    timeRangeFilter: {
      operator: "between",
      startTime: start.toISOString(),
      endTime: end.toISOString(),
    },
    ascendingOrder: false,
    pageSize: count,
  });
  const records = res?.records ?? res ?? [];
  return records.map((r: any) => {
    const mgdl =
      r.level?.inMilligramsPerDeciliter ??
      toMgdl(Number(r.level?.inMillimolesPerLiter ?? 0));
    const when = new Date(r.time);
    return {
      value: Math.round(mgdl),
      date: when.toISOString(),
      period_tag: pickTagForHour(when.getHours()),
    };
  });
}

export async function readRecentGlucose(count = 6): Promise<GlucoseSample[]> {
  if (DEBUG_MOCK_HEALTH) return readMockGlucose(count);
  try {
    if (Platform.OS === "ios") return await readRealGlucoseIOS(count);
    if (Platform.OS === "android") return await readRealGlucoseAndroid(count);
  } catch {
    return [];
  }
  return [];
}

// ── Import into local SQLite ───────────────────────────────────────────────

/**
 * Pulls recent glucose readings from the platform health store (or the mock in
 * dev) into the profile's local log, skipping anything already imported.
 * Returns the number of newly inserted rows.
 */
export async function importHealthGlucose(profileId: string): Promise<number> {
  const granted = await requestHealthPermissions();
  if (!granted) return 0;

  const samples = await readRecentGlucose();
  let inserted = 0;
  for (const s of samples) {
    if (!Number.isFinite(s.value) || s.value <= 0) continue;
    if (await sugarLogExistsAt(profileId, s.date, "health")) continue;
    await addSugarLog({
      profile_id: profileId,
      glucose_level_mgdl: s.value,
      period_tag: s.period_tag,
      source: "health",
      logged_at: s.date,
    });
    inserted++;
  }
  return inserted;
}
