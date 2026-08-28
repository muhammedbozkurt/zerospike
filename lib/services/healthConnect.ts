import { autoPeriodTagFor } from "../periodTag";
import { pickMgdl, snapIso } from "./healthMath";
import { OWN_BUNDLE_ID } from "./healthTypes";
import type {
  GlucoseSample,
  HealthConnectStatus,
  HealthProvider,
  HealthSummary,
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
 * required fields on a write and are always UNKNOWN (0) - this app has no
 * clinical context for a manually typed reading.
 */

let initialized = false;

/** Raw getSdkStatus() values (react-native-health-connect 4.x). */
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
  return records
    // Loop guard: skip our own writes on import, or a mirror-then-import cycle
    // would double every manual reading. NEVER use dataOriginFilter for this -
    // it is an allowlist, not a blocklist, and putting our own package there
    // doubles every sample instead of skipping it.
    .filter((r: any) => r?.metadata?.dataOrigin !== OWN_BUNDLE_ID)
    .map((r: any) => {
      // Health Connect exposes both mg/dL and mmol/L; only the mg/dL field is
      // ever read here (CEVRIM YAPMA - no conversion), matching iOS's
      // already-mg/dL query.
      const mgdl = pickMgdl({ mgdl: r?.level?.inMilligramsPerDeciliter });
      return {
        value: mgdl == null ? 0 : Math.round(mgdl),
        date: snapIso(r.time),
        period_tag: autoPeriodTagFor("health_import", {}),
      };
    });
}

async function writeGlucose(mgdl: number, dateIso: string): Promise<string | null> {
  if (!(await ensureReady())) return null;
  try {
    const HC = require("react-native-health-connect");
    const ids: string[] = await HC.insertRecords([
      {
        recordType: "BloodGlucose",
        time: new Date(dateIso).toISOString(),
        level: { value: Math.round(mgdl), unit: "milligramsPerDeciliter" },
        specimenSource: 0, // UNKNOWN
        mealType: 0, // UNKNOWN
        relationToMeal: 0, // UNKNOWN
        metadata: { recordingMethod: 3 }, // MANUAL_ENTRY
      },
    ]);
    return ids?.[0] ?? null;
  } catch {
    return null;
  }
}

async function deleteGlucose(id: string): Promise<void> {
  if (!(await ensureReady())) return;
  try {
    const HC = require("react-native-health-connect");
    await HC.deleteRecordsByUuids("BloodGlucose", [id], []);
  } catch {
    // swallow: a failed mirror-delete must never block the local delete
  }
}

/** Health Connect has no insulin-delivery record type and this app does not
 *  read exercise/steps on Android, so the Pro summary is always empty here. */
async function readSummary(_windowDays: number): Promise<HealthSummary> {
  return { activeMinutes: null, insulin: null };
}

export const healthConnect: HealthProvider = {
  isAvailable,
  requestReadPermissions,
  requestWritePermission,
  readRecentGlucose,
  writeGlucose,
  deleteGlucose,
  readSummary,
};

export { getStatus as getHealthConnectStatus };
export function isReadPermissionBlocked(): boolean {
  return readPermissionBlocked;
}
export function isWritePermissionBlocked(): boolean {
  return writePermissionBlocked;
}
