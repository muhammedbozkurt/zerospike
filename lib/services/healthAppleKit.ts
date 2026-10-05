import { logCrash } from "../analytics";
import { toHealthKitMetadata, type HealthWriteMeta } from "../healthMeta";
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

type HKModule = typeof import("@kingstinct/react-native-healthkit");

function loadHK(): HKModule {
  return require("@kingstinct/react-native-healthkit");
}

async function isAvailable(): Promise<boolean> {
  try {
    const HK = loadHK();
    return await HK.isHealthDataAvailable();
  } catch {
    return false;
  }
}

async function requestReadPermissions(): Promise<boolean> {
  try {
    const HK = loadHK();
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

async function requestReadWritePermissions(): Promise<{ read: boolean; write: boolean }> {
  try {
    const HK = loadHK();
    await HK.requestAuthorization({
      toShare: ["HKQuantityTypeIdentifierBloodGlucose"],
      toRead: [
        "HKQuantityTypeIdentifierBloodGlucose",
        "HKQuantityTypeIdentifierInsulinDelivery",
        "HKQuantityTypeIdentifierAppleExerciseTime",
      ],
    });
    return {
      read: true,
      write:
        HK.authorizationStatusFor("HKQuantityTypeIdentifierBloodGlucose") ===
        HK.AuthorizationStatus.sharingAuthorized,
    };
  } catch {
    return { read: false, write: false };
  }
}

async function isWriteAuthorized(): Promise<boolean> {
  try {
    const HK = loadHK();
    return (
      HK.authorizationStatusFor("HKQuantityTypeIdentifierBloodGlucose") ===
      HK.AuthorizationStatus.sharingAuthorized
    );
  } catch {
    return false;
  }
}

async function requestWritePermission(): Promise<boolean> {
  try {
    const HK = loadHK();
    await HK.requestAuthorization({
      toShare: ["HKQuantityTypeIdentifierBloodGlucose"],
      toRead: [],
    });
    return (
      HK.authorizationStatusFor("HKQuantityTypeIdentifierBloodGlucose") ===
      HK.AuthorizationStatus.sharingAuthorized
    );
  } catch {
    return false;
  }
}

async function readRecentGlucose(windowDays: number, max: number): Promise<GlucoseSample[]> {
  const HK = loadHK();
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
    .filter((s) => s.sourceRevision?.source?.bundleIdentifier !== OWN_BUNDLE_ID)
    .map((s) => {
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

/**
 * Write (share) authorization for BloodGlucose, checked right before every
 * write (2.4): authorizationStatusFor is synchronous and, for a SHARE type
 * (unlike the read side), reliably reports notDetermined / sharingDenied /
 * sharingAuthorized. A first-ever write used to just call saveQuantitySample
 * cold - which works once requestWritePermission has already run (the
 * settings toggle), but a stale/blocked permission would otherwise reach the
 * native call to fail regardless. notDetermined re-prompts once; anything
 * else that is not "authorized" fails the write here, before it is attempted.
 */
async function ensureWriteAuthorized(HK: HKModule): Promise<boolean> {
  try {
    const statusFor = () => HK.authorizationStatusFor("HKQuantityTypeIdentifierBloodGlucose");
    const isAuthorized = () => statusFor() === HK.AuthorizationStatus.sharingAuthorized;
    if (isAuthorized()) return true;
    if (statusFor() !== HK.AuthorizationStatus.notDetermined) return false; // sharingDenied
    // requestAuthorization's OWN resolved value only says the request
    // completed without error, never whether it was granted - HealthKit
    // deliberately never reveals that to the completion handler, even for a
    // share (write) type. authorizationStatusFor is the one call that
    // reports the real decision, so it is re-checked after the prompt closes
    // rather than trusting what requestAuthorization resolved to.
    await HK.requestAuthorization({
      toShare: ["HKQuantityTypeIdentifierBloodGlucose"],
      toRead: [],
    });
    return isAuthorized();
  } catch {
    // authorizationStatusFor is not expected to throw, but if it does, fall
    // through to the actual write rather than blocking it on an unrelated bug.
    return true;
  }
}

async function writeGlucose(
  mgdl: number,
  dateIso: string,
  meta?: HealthWriteMeta
): Promise<string | null> {
  const HK = loadHK();
  if (!(await ensureWriteAuthorized(HK))) return null;
  const when = new Date(dateIso);
  if (Number.isNaN(when.getTime())) return null;
  const value = Math.round(mgdl);
  const plain = () =>
    HK.saveQuantitySample("HKQuantityTypeIdentifierBloodGlucose", "mg/dL", value, when, when);
  if (!meta) return (await plain())?.uuid ?? null;
  try {
    // Verified against the iOS 18.6 HealthKit binary and the library's
    // anyMapToDictionary (Helpers.swift:428): string/bool/Double values reach
    // HealthKit as NSString/NSNumber under the literal HK* key strings.
    // toHealthKitMetadata only emits values HealthKit accepts: it rejects an
    // invalid sync identifier/version with a native exception that no JS
    // try/catch can catch.
    const res = await HK.saveQuantitySample(
      "HKQuantityTypeIdentifierBloodGlucose",
      "mg/dL",
      value,
      when,
      when,
      toHealthKitMetadata(meta)
    );
    return res?.uuid ?? null;
  } catch (err) {
    // Covers a plain JS-side rejection only. Retries the same write once
    // without metadata (the sample is then just not idempotent).
    logCrash(err, { screen: "health", op: "saveWithMetadata" });
    return (await plain())?.uuid ?? null;
  }
}

async function deleteGlucoseBatch(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const HK = loadHK();
  await HK.deleteObjects("HKQuantityTypeIdentifierBloodGlucose", { uuids: ids });
}

async function deleteGlucose(id: string): Promise<void> {
  await deleteGlucoseBatch([id]);
}

async function readInsulin(windowDays: number): Promise<HealthSummary["insulin"]> {
  const HK = loadHK();
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
  const HK = loadHK();
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
  requestReadWritePermissions,
  isWriteAuthorized,
  readRecentGlucose,
  writeGlucose,
  deleteGlucose,
  deleteGlucoseBatch,
  readSummary,
};
