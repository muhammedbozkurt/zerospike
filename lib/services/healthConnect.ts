import AsyncStorage from "@react-native-async-storage/async-storage";
import { logCrash } from "../analytics";
import {
  carbRecordName,
  hasValidSyncKey,
  toRelationToMeal,
  type HealthWriteMeta,
} from "../healthMeta";
import { autoPeriodTagFor } from "../periodTag";
import { pickMgdl, snapIso } from "./healthMath";
import { OWN_BUNDLE_ID } from "./healthTypes";
import type {
  GlucosePage,
  GlucosePageRequest,
  GlucoseSample,
  HealthConnectStatus,
  HealthProvider,
  HealthSummary,
  HealthWriteKind,
  InsulinKind,
} from "./healthTypes";

/**
 * Android Health Connect provider. Every function `require()`s the native
 * module INSIDE itself, never at module scope, so this file can be statically
 * imported by the health.ts facade without pulling Health Connect into a
 * bundle that never runs on iOS.
 *
 *   react-native-health-connect 4.1.3 (BloodGlucose record type)
 *
 * getSdkStatus()/initialize() gate every other call: nothing here runs before
 * initialize() has resolved true. specimenSource/mealType/relationToMeal are
 * required fields on a write: UNKNOWN (0) unless the reading carries a stated
 * meal relation (fasting / before / after meal), see lib/healthMeta.ts.
 */

let initialized = false;

/** Raw getSdkStatus() values (react-native-health-connect 4.x). */
/** App-language translation, loaded on first use so the plain-node health tests
 *  that import this file do not pull expo-localization. i18next falls back to en. */
function recordNameT(key: string): string {
  const i18n = (require("../i18n") as typeof import("../i18n")).default;
  return i18n.t(key) as string;
}

const SDK_UNAVAILABLE = 1;
const SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED = 2;
const SDK_AVAILABLE = 3;

async function getStatus(): Promise<HealthConnectStatus> {
  try {
    const HC = require("react-native-health-connect");
    const status = await HC.getSdkStatus();
    if (status === SDK_UNAVAILABLE) return "unavailable";
    if (status === SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) return "update_required";
    return "available";
  } catch {
    return "unavailable";
  }
}

/** getSdkStatus() then initialize(): no HC API runs before this resolves true. */
async function ensureReady(): Promise<boolean> {
  if (initialized) return true;
  try {
    const HC = require("react-native-health-connect");
    const status = await HC.getSdkStatus();
    if (status !== SDK_AVAILABLE) return false;
    initialized = await HC.initialize();
    return initialized;
  } catch {
    return false;
  }
}

async function isAvailable(): Promise<boolean> {
  return ensureReady();
}

type GrantedPermission = { accessType: string; recordType: string };

function permissionsEqual(a: GrantedPermission[], b: GrantedPermission[]): boolean {
  const key = (p: GrantedPermission) => `${p.accessType}:${p.recordType}`;
  const sa = [...a].map(key).sort();
  const sb = [...b].map(key).sort();
  return sa.length === sb.length && sa.every((v, i) => v === sb[i]);
}

// Persistent-block detection (X: user denied twice / restricted from Settings):
// the system permission sheet silently no-ops instead of showing again, so the
// only signal is that the granted-permission list did not change across a
// request. Read by health.ts to point the user at Settings instead of
// re-prompting forever.
let readPermissionBlocked = false;
let writePermissionBlocked = false;

async function requestReadPermissions(): Promise<boolean> {
  try {
    if (!(await ensureReady())) return false;
    const HC = require("react-native-health-connect");
    const before: GrantedPermission[] = await HC.getGrantedPermissions();
    // Already granted: this runs on every sync (health.ts's importHealthGlucose)
    // including the silent background sync on app open, so a user who already
    // said yes once must never see the system permission Activity fire again.
    if (before.some((p) => p.accessType === "read" && p.recordType === "BloodGlucose")) {
      readPermissionBlocked = false;
      return true;
    }
    const granted: GrantedPermission[] = await HC.requestPermission([
      { accessType: "read", recordType: "BloodGlucose" },
    ]);
    const ok = granted.some((p) => p.accessType === "read" && p.recordType === "BloodGlucose");
    if (ok) {
      readPermissionBlocked = false;
      return true;
    }
    const after: GrantedPermission[] = await HC.getGrantedPermissions();
    readPermissionBlocked = permissionsEqual(before, after);
    return false;
  } catch {
    return false;
  }
}

async function requestWritePermission(): Promise<boolean> {
  try {
    if (!(await ensureReady())) return false;
    const HC = require("react-native-health-connect");
    const before: GrantedPermission[] = await HC.getGrantedPermissions();
    // Same already-granted short-circuit as requestReadPermissions: the write
    // toggle re-requests at point of use (settings/data.tsx), so turning it
    // off and back on must not re-trigger the system Activity either.
    if (before.some((p) => p.accessType === "write" && p.recordType === "BloodGlucose")) {
      writePermissionBlocked = false;
      return true;
    }
    const granted: GrantedPermission[] = await HC.requestPermission([
      { accessType: "write", recordType: "BloodGlucose" },
    ]);
    const ok = granted.some((p) => p.accessType === "write" && p.recordType === "BloodGlucose");
    if (ok) {
      writePermissionBlocked = false;
      return true;
    }
    const after: GrantedPermission[] = await HC.getGrantedPermissions();
    writePermissionBlocked = permissionsEqual(before, after);
    return false;
  } catch {
    return false;
  }
}

async function isWriteAuthorized(): Promise<boolean> {
  try {
    if (!(await ensureReady())) return false;
    const HC = require("react-native-health-connect");
    const granted: GrantedPermission[] = await HC.getGrantedPermissions();
    return granted.some((p) => p.accessType === "write" && p.recordType === "BloodGlucose");
  } catch {
    return false;
  }
}

async function requestReadWritePermissions(): Promise<{ read: boolean; write: boolean }> {
  try {
    if (!(await ensureReady())) return { read: false, write: false };
    const HC = require("react-native-health-connect");
    const has = (list: GrantedPermission[], accessType: string) =>
      list.some((p) => p.accessType === accessType && p.recordType === "BloodGlucose");
    const before: GrantedPermission[] = await HC.getGrantedPermissions();
    const missing: GrantedPermission[] = [];
    if (!has(before, "read")) missing.push({ accessType: "read", recordType: "BloodGlucose" });
    if (!has(before, "write")) missing.push({ accessType: "write", recordType: "BloodGlucose" });
    if (missing.length === 0) return { read: true, write: true };
    const granted: GrantedPermission[] = await HC.requestPermission(missing);
    const after: GrantedPermission[] = await HC.getGrantedPermissions();
    const read = has(granted, "read") || has(after, "read");
    const write = has(granted, "write") || has(after, "write");
    if (read) readPermissionBlocked = false;
    else readPermissionBlocked = permissionsEqual(before, after) && missing.some((p) => p.accessType === "read");
    if (write) writePermissionBlocked = false;
    else writePermissionBlocked = permissionsEqual(before, after) && missing.some((p) => p.accessType === "write");
    return { read, write };
  } catch {
    return { read: false, write: false };
  }
}

async function readRecentGlucose(windowDays: number, max: number): Promise<GlucoseSample[]> {
  if (!(await ensureReady())) return [];
  const HC = require("react-native-health-connect");
  const endTime = new Date();
  const startTime = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const result = await HC.readRecords("BloodGlucose", {
    timeRangeFilter: {
      operator: "between",
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
    },
    ascendingOrder: false,
    pageSize: max,
  });
  const records = Array.isArray(result) ? result : (result?.records ?? []);
  return records.filter(isForeignRecord).map((r: any) => toGlucoseSample(r, 60));
}

/** Loop guard: skip our own writes on import, or a mirror-then-import cycle
 *  would double every manual reading. NEVER use dataOriginFilter for this - it
 *  is an allowlist, not a blocklist, and putting our own package there doubles
 *  every sample instead of skipping it. */
function isForeignRecord(r: any): boolean {
  return r?.metadata?.dataOrigin !== OWN_BUNDLE_ID;
}

/** Health Connect record -> GlucoseSample. Health Connect exposes both mg/dL and
 *  mmol/L; only the mg/dL field is ever read here (CEVRIM YAPMA - no
 *  conversion), matching iOS's already-mg/dL query. */
function toGlucoseSample(r: any, snapSeconds: number): GlucoseSample {
  const mgdl = pickMgdl({ mgdl: r?.level?.inMilligramsPerDeciliter });
  const recordingMethod = Number.isFinite(r?.metadata?.recordingMethod)
    ? Number(r.metadata.recordingMethod)
    : null;
  const specimen = Number.isFinite(r?.specimenSource) ? Number(r.specimenSource) : null;
  const device = r?.metadata?.device;
  return {
    value: mgdl == null ? 0 : Math.round(mgdl),
    date: snapIso(r.time, snapSeconds),
    period_tag: autoPeriodTagFor("health_import", {}),
    externalId: typeof r?.metadata?.id === "string" && r.metadata.id ? r.metadata.id : null,
    sourceApp: typeof r?.metadata?.dataOrigin === "string" && r.metadata.dataOrigin ? r.metadata.dataOrigin : null,
    deviceText: [device?.manufacturer, device?.model].filter(Boolean).join(" ") || null,
    userEntered: recordingMethod === 3,
    specimenSource: specimen,
    recordingMethod,
  };
}

/**
 * One page of the Health Connect window. Records come newest first; the page
 * token continues the same read. Health Connect has no per-record anchor for
 * reading, so every sync re-reads its (30 day) window and the import dedupes
 * by record id.
 */
async function readGlucosePage(request: GlucosePageRequest): Promise<GlucosePage> {
  if (!(await ensureReady())) return { samples: [], deletedIds: [], cursor: null, hasMore: false };
  const HC = require("react-native-health-connect");
  // The page token continues ONE read, so the time range travels with it.
  let range: { token: string; startTime: string; endTime: string } | null = null;
  if (request.cursor) {
    try {
      const parsed = JSON.parse(request.cursor);
      if (parsed && typeof parsed.token === "string") range = parsed;
    } catch {
      range = null;
    }
  }
  const endTime = range?.endTime ?? new Date().toISOString();
  const startTime =
    range?.startTime ?? new Date(Date.now() - request.windowDays * 24 * 60 * 60 * 1000).toISOString();
  const result = await HC.readRecords("BloodGlucose", {
    timeRangeFilter: { operator: "between", startTime, endTime },
    ascendingOrder: false,
    pageSize: request.pageSize,
    ...(range ? { pageToken: range.token } : {}),
  });
  const records: any[] = Array.isArray(result) ? result : (result?.records ?? []);
  const token: string | null =
    !Array.isArray(result) && typeof result?.pageToken === "string" && result.pageToken
      ? result.pageToken
      : null;
  return {
    samples: records.filter(isForeignRecord).map((r) => toGlucoseSample(r, 1)),
    deletedIds: [],
    cursor: token ? JSON.stringify({ token, startTime, endTime }) : null,
    hasMore: token != null && token !== range?.token && records.length > 0,
  };
}

async function writeGlucose(
  mgdl: number,
  dateIso: string,
  meta?: HealthWriteMeta
): Promise<string | null> {
  if (!(await ensureReady())) return null;
  try {
    const HC = require("react-native-health-connect");
    // Checked right before every write (2.4): requestWritePermission already
    // ran at point of use (the settings toggle), but access can be revoked
    // from system Settings afterwards without this app being told - the same
    // class of gap HealthKit's authorizationStatusFor closes on iOS. Skipping
    // straight to null here (rather than letting insertRecords fail on its
    // own) is what lets the caller's failure-toast/retry logic (health.ts)
    // treat this the same as any other failed write.
    const granted: GrantedPermission[] = await HC.getGrantedPermissions();
    if (!granted.some((p) => p.accessType === "write" && p.recordType === "BloodGlucose")) {
      return null;
    }
    const ids: string[] = await HC.insertRecords([
      {
        recordType: "BloodGlucose",
        time: new Date(dateIso).toISOString(),
        level: { value: Math.round(mgdl), unit: "milligramsPerDeciliter" },
        specimenSource: 0, // UNKNOWN
        mealType: 0, // UNKNOWN
        relationToMeal: toRelationToMeal(meta?.mealContext ?? null),
        // MANUAL_ENTRY. A clientRecordId makes insertRecords an upsert: the same
        // id with a greater version replaces the record instead of adding one.
        metadata: meta && hasValidSyncKey(meta)
          ? { recordingMethod: 3, clientRecordId: meta.recordId, clientRecordVersion: meta.version }
          : { recordingMethod: 3 },
      },
    ]);
    return ids?.[0] ?? null;
  } catch (err) {
    logCrash(err, { screen: "health", op: "insertRecords" });
    return null;
  }
}

async function deleteGlucoseBatch(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  if (!(await ensureReady())) throw new Error("health connect unavailable");
  const HC = require("react-native-health-connect");
  await HC.deleteRecordsByUuids("BloodGlucose", ids, []);
}

async function deleteGlucose(id: string): Promise<void> {
  await deleteGlucoseBatch([id]);
}

/** Health Connect has no insulin-delivery record type and this app does not
 *  read exercise/steps on Android, so the Pro summary is always empty here. */
async function readSummary(_windowDays: number): Promise<HealthSummary> {
  return { activeMinutes: null, insulin: null };
}

const NUTRITION = "Nutrition";
const CHANGES_TOKEN_KEY = "zerospike.healthHcChangesToken";

async function writeCarbs(
  grams: number,
  dateIso: string,
  meta?: HealthWriteMeta
): Promise<string | null> {
  if (!(await ensureReady())) return null;
  try {
    const HC = require("react-native-health-connect");
    const granted: GrantedPermission[] = await HC.getGrantedPermissions();
    if (!granted.some((p) => p.accessType === "write" && p.recordType === NUTRITION)) return null;
    const value = Math.round(grams * 10) / 10;
    const start = new Date(dateIso);
    if (Number.isNaN(start.getTime()) || !Number.isFinite(value) || value <= 0) return null;
    // An interval record: Health Connect wants endTime after startTime.
    const end = new Date(start.getTime() + 60_000);
    const ids: string[] = await HC.insertRecords([
      {
        recordType: NUTRITION,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        totalCarbohydrate: { value, unit: "grams" },
        mealType: 0, // UNKNOWN
        // A rewrite replaces the whole record, so the name (and estimate mark)
        // follows every edit. It never takes part in clientRecordId upserts.
        name: carbRecordName(meta?.estimated, (k) => recordNameT(k)),
        metadata:
          meta && hasValidSyncKey(meta)
            ? { recordingMethod: 3, clientRecordId: meta.recordId, clientRecordVersion: meta.version }
            : { recordingMethod: 3 },
      },
    ]);
    return ids?.[0] ?? null;
  } catch (err) {
    logCrash(err, { screen: "health", op: "insertNutrition" });
    return null;
  }
}

/** Health Connect has no insulin record type: nothing is ever written. */
async function writeInsulin(
  _units: number,
  _kind: InsulinKind,
  _dateIso: string,
  _meta?: HealthWriteMeta
): Promise<string | null> {
  return null;
}

async function deleteCarbsBatch(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  if (!(await ensureReady())) throw new Error("health connect unavailable");
  const HC = require("react-native-health-connect");
  await HC.deleteRecordsByUuids(NUTRITION, ids, []);
}

async function deleteInsulinBatch(_ids: string[]): Promise<void> {}

async function requestKindWritePermission(kind: HealthWriteKind): Promise<boolean> {
  if (kind !== "carbs") return false;
  try {
    if (!(await ensureReady())) return false;
    const HC = require("react-native-health-connect");
    const has = (list: GrantedPermission[]) =>
      list.some((p) => p.accessType === "write" && p.recordType === NUTRITION);
    const before: GrantedPermission[] = await HC.getGrantedPermissions();
    if (has(before)) {
      writePermissionBlocked = false;
      return true;
    }
    const granted: GrantedPermission[] = await HC.requestPermission([
      { accessType: "write", recordType: NUTRITION },
    ]);
    if (has(granted)) {
      writePermissionBlocked = false;
      return true;
    }
    const after: GrantedPermission[] = await HC.getGrantedPermissions();
    writePermissionBlocked = permissionsEqual(before, after);
    return false;
  } catch {
    return false;
  }
}

async function isKindWriteAuthorized(kind: HealthWriteKind): Promise<boolean> {
  if (kind !== "carbs") return false;
  try {
    if (!(await ensureReady())) return false;
    const HC = require("react-native-health-connect");
    const granted: GrantedPermission[] = await HC.getGrantedPermissions();
    return granted.some((p) => p.accessType === "write" && p.recordType === NUTRITION);
  } catch {
    return false;
  }
}

async function isReadGranted(): Promise<boolean> {
  try {
    if (!(await ensureReady())) return false;
    const HC = require("react-native-health-connect");
    const granted: GrantedPermission[] = await HC.getGrantedPermissions();
    return granted.some((p) => p.accessType === "read" && p.recordType === "BloodGlucose");
  } catch {
    return false;
  }
}

async function hasBackgroundReadPermission(): Promise<boolean> {
  try {
    if (!(await ensureReady())) return false;
    const HC = require("react-native-health-connect");
    const granted: GrantedPermission[] = await HC.getGrantedPermissions();
    return granted.some(
      (p) => p.accessType === "read" && p.recordType === "BackgroundAccessPermission"
    );
  } catch {
    return false;
  }
}

async function requestBackgroundReadPermission(): Promise<boolean> {
  try {
    if (!(await ensureReady())) return false;
    if (await hasBackgroundReadPermission()) return true;
    const HC = require("react-native-health-connect");
    const granted: GrantedPermission[] = await HC.requestPermission([
      { accessType: "read", recordType: "BackgroundAccessPermission" },
    ]);
    return granted.some(
      (p) => p.accessType === "read" && p.recordType === "BackgroundAccessPermission"
    );
  } catch {
    return false;
  }
}

/** Without a stored token, or when it expired, the answer is "changed" so the
 *  caller does a full window read; a fresh token is stored on commit(). */
async function peekGlucoseChanges(): Promise<{
  changed: boolean;
  deletedIds?: string[];
  commit(): Promise<void>;
}> {
  const full = { changed: true, commit: async () => {} };
  try {
    if (!(await ensureReady())) return full;
    const HC = require("react-native-health-connect");
    const token = await AsyncStorage.getItem(CHANGES_TOKEN_KEY);
    const res = await HC.getChanges(
      token
        ? { changesToken: token }
        : { recordTypes: ["BloodGlucose"] }
    );
    const next: string | undefined = res?.nextChangesToken;
    const commit = async () => {
      if (next) await AsyncStorage.setItem(CHANGES_TOKEN_KEY, next);
    };
    if (!token || res?.changesTokenExpired || res?.hasMore) return { changed: true, commit };
    const changed =
      (res?.upsertionChanges?.length ?? 0) > 0 || (res?.deletionChanges?.length ?? 0) > 0;
    const deletedIds: string[] = (res?.deletionChanges ?? [])
      .map((d: any) => d?.recordId)
      .filter((id: unknown): id is string => typeof id === "string" && id.length > 0);
    return { changed, deletedIds, commit };
  } catch {
    return full;
  }
}

export const healthConnect: HealthProvider = {
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
  deleteCarbsBatch,
  deleteInsulinBatch,
  requestKindWritePermission,
  isKindWriteAuthorized,
  isReadGranted,
  startBackgroundObserver: async () => false,
  stopBackgroundObserver: async () => {},
  hasBackgroundReadPermission,
  requestBackgroundReadPermission,
  peekGlucoseChanges,
};

export { getStatus as getHealthConnectStatus };
export function isReadPermissionBlocked(): boolean {
  return readPermissionBlocked;
}
export function isWritePermissionBlocked(): boolean {
  return writePermissionBlocked;
}
