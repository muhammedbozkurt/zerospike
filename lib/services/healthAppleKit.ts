import { autoPeriodTagFor } from "../periodTag";
import { pickMgdl, snapIso } from "./healthMath";
import { OWN_BUNDLE_ID } from "./healthTypes";
import type { GlucoseSample, HealthProvider, HealthSummary } from "./healthTypes";

/**
 * Apple HealthKit provider (iOS only). Every function `require()`s the native
 * module INSIDE itself, never at module scope, so this file can be statically
 * imported by the health.ts facade without pulling HealthKit into a bundle
 * that never runs on iOS.
 *
 *   @kingstinct/react-native-healthkit (HKQuantityType bloodGlucose /
 *   insulinDelivery / appleExerciseTime)
 */

async function isAvailable(): Promise<boolean> {
  try {
    const HK = require("@kingstinct/react-native-healthkit");
    return await HK.isHealthDataAvailable();
  } catch {
    return false;
  }
}

async function requestReadPermissions(): Promise<boolean> {
  try {
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
  } catch {
    return false;
  }
}

async function requestWritePermission(): Promise<boolean> {
  try {
    const HK = require("@kingstinct/react-native-healthkit");
    await HK.requestAuthorization({
      toShare: ["HKQuantityTypeIdentifierBloodGlucose"],
      toRead: [],
    });
    return true;
  } catch {
    return false;
  }
}

async function readRecentGlucose(windowDays: number, max: number): Promise<GlucoseSample[]> {
  const HK = require("@kingstinct/react-native-healthkit");
  const from = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  // v14 (Nitro) moved the date range into filter.date and made the identifier a
  // string literal (the HKQuantityTypeIdentifier enum was removed).
  const samples = await HK.queryQuantitySamples("HKQuantityTypeIdentifierBloodGlucose", {
    limit: max,
    ascending: false,
    unit: "mg/dL",
    filter: { date: { startDate: from } },
  });
  return (samples ?? [])
    // Loop guard: NEVER re-import a sample we wrote ourselves, or a
    // mirror-then-import cycle would double every manual reading. HealthKit tags
    // each sample with the writing app's bundle in sourceRevision.
    .filter((s: any) => s?.sourceRevision?.source?.bundleIdentifier !== OWN_BUNDLE_ID)
    .map((s: any) => {
      const when = new Date(s.endDate ?? s.startDate);
      // The query above requests unit "mg/dL", so s.quantity is ALREADY mg/dL,
      // it must NOT pass through any mmol heuristic (that inverted true sub-30
      // hypos into fake highs). snapIso collapses ms-drift re-reads on dedup.
      const mgdl = pickMgdl({ mgdl: Number(s.quantity) });
      return {
        value: mgdl == null ? 0 : Math.round(mgdl),
        date: snapIso(when.toISOString()),
        period_tag: autoPeriodTagFor("health_import", {}),
      };
    });
}

async function writeGlucose(mgdl: number, dateIso: string): Promise<string | null> {
  const HK = require("@kingstinct/react-native-healthkit");
  const when = new Date(dateIso);
  const res = await HK.saveQuantitySample("HKQuantityTypeIdentifierBloodGlucose", {
    unit: "mg/dL",
    quantity: Math.round(mgdl),
    start: when,
    end: when,
  });
  // v14 returns the new sample's UUID string (older shapes: an object).
  if (typeof res === "string") return res;
  return res?.uuid ?? null;
}

async function deleteGlucose(id: string): Promise<void> {
  const HK = require("@kingstinct/react-native-healthkit");
  await HK.deleteObjects("HKQuantityTypeIdentifierBloodGlucose", { uuids: [id] });
}

async function readInsulin(windowDays: number): Promise<HealthSummary["insulin"]> {
  const HK = require("@kingstinct/react-native-healthkit");
  const from = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const samples = await HK.queryQuantitySamples("HKQuantityTypeIdentifierInsulinDelivery", {
    limit: 2000,
    ascending: false,
    unit: "IU",
    filter: { date: { startDate: from } },
  });
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

async function readExerciseMinutes(windowDays: number): Promise<number> {
  const HK = require("@kingstinct/react-native-healthkit");
  const from = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const samples = await HK.queryQuantitySamples("HKQuantityTypeIdentifierAppleExerciseTime", {
    limit: 3000,
    ascending: false,
    unit: "min",
    filter: { date: { startDate: from } },
  });
  let mins = 0;
  for (const s of samples ?? []) mins += Number(s.quantity) || 0;
  return Math.round(mins);
}

/** Exercise minutes + insulin delivery split (iOS/HealthKit only; DIY Loop
 *  users). Returns whatever was read so far on error, never throws. */
async function readSummary(windowDays: number): Promise<HealthSummary> {
  const out: HealthSummary = { activeMinutes: null, insulin: null };
  try {
    out.insulin = await readInsulin(windowDays);
    out.activeMinutes = await readExerciseMinutes(windowDays);
  } catch {
    // leave whatever was read; never throw to the facade
  }
  return out;
}

export const healthAppleKit: HealthProvider = {
  isAvailable,
  requestReadPermissions,
  requestWritePermission,
  readRecentGlucose,
  writeGlucose,
  deleteGlucose,
  readSummary,
};
