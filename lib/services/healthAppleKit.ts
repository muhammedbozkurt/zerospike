import { logCrash } from "../analytics";
import { carbEstimateMetadata, toHealthKitMetadata, type HealthWriteMeta } from "../healthMeta";
import { autoPeriodTagFor } from "../periodTag";
import { pickMgdl, snapIso } from "./healthMath";
import { OWN_BUNDLE_ID } from "./healthTypes";
import type {
  GlucosePage,
  GlucosePageRequest,
  GlucoseSample,
  HealthProvider,
  HealthSummary,
  HealthWriteKind,
  InsulinKind,
} from "./healthTypes";

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

const BLOOD_GLUCOSE = "HKQuantityTypeIdentifierBloodGlucose";
const DIETARY_CARBS = "HKQuantityTypeIdentifierDietaryCarbohydrates";
const INSULIN_DELIVERY = "HKQuantityTypeIdentifierInsulinDelivery";
type WriteIdentifier = typeof BLOOD_GLUCOSE | typeof DIETARY_CARBS | typeof INSULIN_DELIVERY;

const KIND_IDENTIFIER: Record<HealthWriteKind, WriteIdentifier> = {
  carbs: DIETARY_CARBS,
  insulin: INSULIN_DELIVERY,
};

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
  return (samples ?? []).filter(isForeignSample).map((s) => toGlucoseSample(s, 60));
}

/** HealthKit sample -> GlucoseSample. Every glucose query asks for unit
 *  "mg/dL", so s.quantity is ALREADY mg/dL and must NOT pass through any mmol
 *  heuristic (that inverted true sub-30 hypos into fake highs). snapIso
 *  collapses ms-drift re-reads on dedup. */
function toGlucoseSample(
  s: {
    uuid?: string;
    quantity: unknown;
    startDate: Date;
    endDate?: Date;
    metadata?: unknown;
    device?: { name?: string; manufacturer?: string; model?: string };
    sourceRevision?: { source?: { name?: string; bundleIdentifier?: string } };
  },
  snapSeconds: number
): GlucoseSample {
  const when = new Date(s.endDate ?? s.startDate);
  const mgdl = pickMgdl({ mgdl: Number(s.quantity) });
  const meta = (s.metadata ?? {}) as Record<string, unknown>;
  const typed = meta.HKWasUserEntered;
  const source = s.sourceRevision?.source;
  return {
    value: mgdl == null ? 0 : Math.round(mgdl),
    date: snapIso(when.toISOString(), snapSeconds),
    period_tag: autoPeriodTagFor("health_import", {}),
    externalId: s.uuid ? String(s.uuid) : null,
    sourceApp: source?.bundleIdentifier || source?.name || null,
    deviceText:
      [s.device?.name, s.device?.manufacturer, s.device?.model, source?.name]
        .filter(Boolean)
        .join(" ") || null,
    userEntered: typed === true || typed === 1,
  };
}

/** Loop guard: NEVER re-import a sample we wrote ourselves, or a
 *  mirror-then-import cycle would double every manual reading. HealthKit tags
 *  each sample with the writing app's bundle in sourceRevision. */
function isForeignSample(s: { sourceRevision?: { source?: { bundleIdentifier?: string } } }): boolean {
  return s.sourceRevision?.source?.bundleIdentifier !== OWN_BUNDLE_ID;
}

/**
 * One page of the anchored read. HealthKit hands back what changed since the
 * anchor - new samples AND the ids of deleted ones - so a sync after the first
 * reads only the new part. The anchor is the caller's to store, after the page
 * was imported. A full page means there may be more.
 */
async function readGlucosePage(request: GlucosePageRequest): Promise<GlucosePage> {
  const HK = loadHK();
  const from = new Date(Date.now() - request.windowDays * 24 * 60 * 60 * 1000);
  const ask = (anchor: string | null) =>
    HK.queryQuantitySamplesWithAnchor("HKQuantityTypeIdentifierBloodGlucose", {
      limit: request.pageSize,
      anchor: anchor ?? undefined,
      unit: "mg/dL",
      filter: { date: { startDate: from } },
    });
  let res;
  try {
    res = await ask(request.cursor);
  } catch (err) {
    // A stale or unreadable anchor must not wedge the sync for good: start over,
    // the import dedupes by sample id.
    if (request.cursor == null) throw err;
    res = await ask(null);
  }
  const raw = res?.samples ?? [];
  const next = res?.newAnchor ? String(res.newAnchor) : null;
  return {
    samples: raw.filter(isForeignSample).map((s) => toGlucoseSample(s, 1)),
    deletedIds: (res?.deletedSamples ?? []).map((d) => String(d.uuid)).filter(Boolean),
    cursor: next,
    hasMore: raw.length >= request.pageSize && next != null && next !== request.cursor,
  };
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
async function ensureWriteAuthorized(
  HK: HKModule,
  identifier: WriteIdentifier = BLOOD_GLUCOSE
): Promise<boolean> {
  try {
    const statusFor = () => HK.authorizationStatusFor(identifier);
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
      toShare: [identifier],
      toRead: [],
    });
    return isAuthorized();
  } catch {
    // authorizationStatusFor is not expected to throw, but if it does, fall
    // through to the actual write rather than blocking it on an unrelated bug.
    return true;
  }
}

/** The permission half of a write, for health.ts to run before it starts
 *  timing the native save (writeGlucose checks again; once decided, that check
 *  is a synchronous status read). */
export async function prepareHealthKitWrite(): Promise<boolean> {
  try {
    return await ensureWriteAuthorized(loadHK());
  } catch {
    return false;
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
    // without metadata (the sample is then just not idempotent). It cannot
    // leave a second sample: health.ts writes a reading one operation at a
    // time with a strictly rising version (so a "not newer" refusal needs a
    // clock set backwards), and revokes the row's previous sample once this
    // one is linked.
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
    // Loop guard for the summary: insulin this app wrote (the write switch)
    // must not be counted again as delivery read back from Health.
    if (s.sourceRevision?.source?.bundleIdentifier === OWN_BUNDLE_ID) continue;
    const units = Number(s.quantity) || 0;
    // HKInsulinDeliveryReason metadata: 1 = basal, 2 = bolus.
    const reason = s?.metadata?.HKInsulinDeliveryReason;
    if (reason === 2) bolus += units;
    else basal += units;
    count++;
  }
  return { basalUnits: Math.round(basal), bolusUnits: Math.round(bolus), count };
}

async function writeKindSample(
  kind: HealthWriteKind,
  unit: "g" | "IU",
  value: number,
  dateIso: string,
  meta: HealthWriteMeta | undefined,
  extra: Record<string, string | number | boolean>
): Promise<string | null> {
  const HK = loadHK();
  const identifier = KIND_IDENTIFIER[kind];
  if (!(await ensureWriteAuthorized(HK, identifier))) return null;
  const when = new Date(dateIso);
  if (Number.isNaN(when.getTime()) || !Number.isFinite(value) || value <= 0) return null;
  const plainMeta = { HKWasUserEntered: true, ...extra };
  const plain = () => HK.saveQuantitySample(identifier, unit, value, when, when, plainMeta);
  if (!meta) return (await plain())?.uuid ?? null;
  try {
    const res = await HK.saveQuantitySample(identifier, unit, value, when, when, {
      ...toHealthKitMetadata(meta),
      ...extra,
    });
    return res?.uuid ?? null;
  } catch (err) {
    logCrash(err, { screen: "health", op: `saveWithMetadata.${kind}` });
    return (await plain())?.uuid ?? null;
  }
}

async function writeCarbs(
  grams: number,
  dateIso: string,
  meta?: HealthWriteMeta
): Promise<string | null> {
  return writeKindSample(
    "carbs",
    "g",
    Math.round(grams * 10) / 10,
    dateIso,
    meta,
    carbEstimateMetadata(meta?.estimated)
  );
}

async function writeInsulin(
  units: number,
  kind: InsulinKind,
  dateIso: string,
  meta?: HealthWriteMeta
): Promise<string | null> {
  // HKInsulinDeliveryReason is mandatory on InsulinDelivery: 1 basal, 2 bolus.
  return writeKindSample("insulin", "IU", Math.round(units * 100) / 100, dateIso, meta, {
    HKInsulinDeliveryReason: kind === "basal" ? 1 : 2,
  });
}

async function deleteKindBatch(kind: HealthWriteKind, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const HK = loadHK();
  await HK.deleteObjects(KIND_IDENTIFIER[kind], { uuids: ids });
}

async function requestKindWritePermission(kind: HealthWriteKind): Promise<boolean> {
  try {
    const HK = loadHK();
    const identifier = KIND_IDENTIFIER[kind];
    await HK.requestAuthorization({ toShare: [identifier], toRead: [] });
    return HK.authorizationStatusFor(identifier) === HK.AuthorizationStatus.sharingAuthorized;
  } catch {
    return false;
  }
}

async function isKindWriteAuthorized(kind: HealthWriteKind): Promise<boolean> {
  try {
    const HK = loadHK();
    return (
      HK.authorizationStatusFor(KIND_IDENTIFIER[kind]) === HK.AuthorizationStatus.sharingAuthorized
    );
  } catch {
    return false;
  }
}

let observerSub: { remove: () => void } | null = null;

async function startBackgroundObserver(onChange: () => void): Promise<boolean> {
  try {
    if (observerSub) return true;
    const HK = loadHK();
    const immediate = HK.UpdateFrequency?.immediate ?? 1;
    // Persisted natively so a terminated app is relaunched with its observer
    // (BackgroundDeliveryManager); the JS subscription below receives the
    // change once the bridge is up.
    await HK.configureBackgroundTypes([BLOOD_GLUCOSE], immediate);
    const enabled = await HK.enableBackgroundDelivery(BLOOD_GLUCOSE, immediate);
    observerSub = HK.subscribeToChanges(BLOOD_GLUCOSE, (args) => {
      if (args.errorMessage) return;
      onChange();
    });
    return enabled !== false;
  } catch (err) {
    logCrash(err, { screen: "health", op: "startBackgroundObserver" });
    return false;
  }
}

async function stopBackgroundObserver(): Promise<void> {
  try {
    observerSub?.remove();
    observerSub = null;
    const HK = loadHK();
    await HK.clearBackgroundTypes();
    await HK.disableBackgroundDelivery(BLOOD_GLUCOSE);
  } catch {
    // best-effort: nothing to undo if the module is unavailable
  }
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
  readGlucosePage,
  writeGlucose,
  deleteGlucose,
  deleteGlucoseBatch,
  readSummary,
  writeCarbs,
  writeInsulin,
  deleteCarbsBatch: (ids) => deleteKindBatch("carbs", ids),
  deleteInsulinBatch: (ids) => deleteKindBatch("insulin", ids),
  requestKindWritePermission,
  isKindWriteAuthorized,
  isReadGranted: async () => true,
  startBackgroundObserver,
  stopBackgroundObserver,
  hasBackgroundReadPermission: async () => true,
  requestBackgroundReadPermission: async () => true,
  peekGlucoseChanges: async () => ({ changed: true, commit: async () => {} }),
};
