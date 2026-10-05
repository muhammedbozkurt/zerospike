/**
 * Race regressions for the Health write/delete paths, replayed on fake
 * HealthKit and Health Connect stores (HC upsert keeps the uuid, HealthKit
 * replace makes a new one). Scenarios: A stale queued delete vs re-linked uuid,
 * B backfill racing a bulk clear, C delete retry cost when the store is down,
 * D backfill vs an edit, E concurrent queue writes.
 * Run: npx tsx scripts/healthRaces.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (c: number) => void };
import Module from "node:module";
import { join } from "node:path";

let PLATFORM: "ios" | "android" = "android";
(globalThis as any).__DEV__ = false;

// ---- in-memory AsyncStorage
const store = new Map<string, string>();
const AsyncStorage = {
  getItem: async (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: async (k: string, v: string) => void store.set(k, v),
  removeItem: async (k: string) => void store.delete(k),
};

let linkedThrows = 0;
let poison = "";
let onDelete: null | (() => Promise<void>) = null;

// ---- in-memory sugar_logs
type Row = {
  id: string; profile_id: string; glucose_level_mgdl: number; period_tag: string;
  source: string; logged_at: string; tags: string[]; healthkit_uuid: string | null;
};
const rows = new Map<string, Row>();
const logs = {
  getSugarLog: async (id: string) => (rows.has(id) ? { ...rows.get(id)! } : null),
  insertHealthSugarLogs: async () => 0,
  listHealthBackfillRows: async (pid: string, since: string) =>
    [...rows.values()].filter((r) => r.profile_id === pid && r.source !== "health" && r.healthkit_uuid == null && r.logged_at >= since).map((r) => ({ ...r })),
  listHealthMirrorRows: async (pid: string) =>
    [...rows.values()].filter((r) => r.profile_id === pid && r.healthkit_uuid != null).map((r) => ({ source: r.source, healthkit_uuid: r.healthkit_uuid })),
  listLinkedHealthUuids: async (uuids: string[]) => {
    if (linkedThrows > 0) {
      linkedThrows--;
      throw new Error("db busy");
    }
    return [...rows.values()].filter((r) => r.healthkit_uuid != null && uuids.includes(r.healthkit_uuid)).map((r) => r.healthkit_uuid);
  },
  listHealthUuidLinks: async (uuids: string[]) =>
    [...rows.values()].filter((r) => r.healthkit_uuid != null && uuids.includes(r.healthkit_uuid)).map((r) => ({ id: r.id, profile_id: r.profile_id, healthkit_uuid: r.healthkit_uuid })),
  setSugarLogHealthUuid: async (id: string, uuid: string | null) => {
    const r = rows.get(id);
    if (r) r.healthkit_uuid = uuid;
  },
};
const profiles = {
  getProfile: async (id: string) => (id === "P" ? { id: "P" } : null),
  listProfiles: async () => [{ id: "P" }],
};

// ---- fake Health Connect: clientRecordId upsert keeps the record uuid
type Rec = { uuid: string; clientRecordId?: string; version: number; value: number };
const hc = new Map<string, Rec>();
let hcSeq = 0;
let hcDeleteFailures = 0;
let hcDeleteCalls = 0;
let hcInsertCalls = 0;
const fakeHC = {
  getSdkStatus: async () => 3,
  SdkAvailabilityStatus: { SDK_AVAILABLE: 3 },
  initialize: async () => true,
  getGrantedPermissions: async () => [
    { accessType: "read", recordType: "BloodGlucose" },
    { accessType: "write", recordType: "BloodGlucose" },
  ],
  insertRecords: async (recs: any[]) => {
    hcInsertCalls++; await new Promise((r) => setTimeout(r, 3));
    const r = recs[0];
    const cid = r.metadata?.clientRecordId;
    const existing = cid ? [...hc.values()].find((x) => x.clientRecordId === cid) : undefined;
    if (existing) {
      if (r.metadata.clientRecordVersion > existing.version) {
        existing.version = r.metadata.clientRecordVersion;
        existing.value = r.level.value;
      }
      return [existing.uuid];
    }
    const uuid = `hc-${++hcSeq}`;
    hc.set(uuid, { uuid, clientRecordId: cid, version: r.metadata?.clientRecordVersion ?? 0, value: r.level.value });
    return [uuid];
  },
  deleteRecordsByUuids: async (_t: string, ids: string[]) => {
    hcDeleteCalls++;
    if (onDelete) {
      const f = onDelete;
      onDelete = null;
      await f();
    }
    if (poison && ids.includes(poison)) throw new Error("poison");
    if (hcDeleteFailures > 0) { hcDeleteFailures--; throw new Error("transient"); }
    for (const id of ids) hc.delete(id);
  },
  readRecords: async () => ({ records: [] }),
};

// ---- fake HealthKit: sync identifier replace makes a NEW uuid, old one removed
const hk = new Map<string, Rec>();
let hkSeq = 0;
let hkDeleteFailures = 0;
let hkDeleteTotal = 0;
const fakeHK = {
  AuthorizationStatus: { notDetermined: 0, sharingDenied: 1, sharingAuthorized: 2 },
  isHealthDataAvailable: () => true,
  authorizationStatusFor: () => 2,
  requestAuthorization: async () => true,
  saveQuantitySample: async (_id: string, _u: string, value: number, _s: Date, _e: Date, meta?: any) => {
    await new Promise((r) => setTimeout(r, 3)); const sid = meta?.HKMetadataKeySyncIdentifier;
    const ver = meta?.HKMetadataKeySyncVersion ?? 0;
    const existing = sid ? [...hk.values()].find((x) => x.clientRecordId === sid) : undefined;
    if (existing && ver <= existing.version) return { uuid: `hk-ignored-${++hkSeq}` };
    if (existing) hk.delete(existing.uuid);
    const uuid = `hk-${++hkSeq}`;
    hk.set(uuid, { uuid, clientRecordId: sid, version: ver, value });
    return { uuid };
  },
  deleteObjects: async (_t: string, f: { uuids: string[] }) => {
    hkDeleteTotal++;
    if (hkDeleteFailures > 0) { hkDeleteFailures--; throw new Error("transient"); }
    for (const id of f.uuids) hk.delete(id);
    return f.uuids.length;
  },
};

const PLATFORM_OBJ = { OS: "android" as string };
const M = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
const realLoad = M._load;
M._load = function (request: string, ...rest: unknown[]) {
  if (request === "react-native") return { Platform: PLATFORM_OBJ, Linking: { openURL: async () => {} } };
  if (request === "@react-native-async-storage/async-storage") return { __esModule: true, default: AsyncStorage };
  if (request === "react-native-health-connect") return fakeHC;
  if (request === "@kingstinct/react-native-healthkit") return fakeHK;
  if (request.endsWith("/db/logs")) return logs;
  if (request.endsWith("/db/profiles")) return profiles;
  if (request.endsWith("/analytics")) return { logCrash: () => {}, logEvent: () => {} };
  return realLoad.call(this, request, ...rest);
};

function addRow(id: string, minutesAgo: number): Row {
  const r: Row = {
    id, profile_id: "P", glucose_level_mgdl: 120, period_tag: "fasting", source: "manual",
    logged_at: new Date(Date.now() - minutesAgo * 60000).toISOString(), tags: [], healthkit_uuid: null,
  };
  rows.set(id, r);
  return r;
}
const storeOf = () => (PLATFORM === "android" ? hc : hk);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));


let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  FAIL ${name}`);
  }
}

function reset(p: "ios" | "android") {
  PLATFORM = p;
  PLATFORM_OBJ.OS = p;
  store.clear();
  rows.clear();
  hc.clear();
  hk.clear();
  hcDeleteFailures = 0;
  hkDeleteFailures = 0;
  hcDeleteCalls = 0;
  hcInsertCalls = 0;
  linkedThrows = 0;
  poison = "";
  onDelete = null;
  store.set("zerospike.activeProfile", "P");
  store.set("zerospike.healthWriteEnabled.P", "1");
}
const DEL_KEY = "zerospike.healthDeletePending";
const failDeletes = (n: number) => {
  if (PLATFORM === "android") hcDeleteFailures = n;
  else hkDeleteFailures = n;
};

(logs as any).updateSugarLog = async (id: string, p: any) => { const r = rows.get(id); if (r && p.glucose_level_mgdl != null) r.glucose_level_mgdl = p.glucose_level_mgdl; return r ? { ...r } : null; };
async function main() {
  const REPO = "/Users/muhammedbozkurt/Desktop/Others/zerospike";
  const H = await import(join(REPO, "lib", "services", "health.ts"));
  const E = await import(join(REPO, "lib", "services", "glucoseEdit.ts"));
  for (const p of ["android", "ios"] as const) {
    reset(p);
    console.log(`=== ${p} I. edit while the first write is in flight`);
    const r = addRow("I1", 1);
    r.glucose_level_mgdl = 123;
    const snapshot = { ...r, kind: "glucose" } as any; // UI snapshot, healthkit_uuid null
    const w = H.writeGlucoseToHealthIfEnabled({ ...r });
    await sleep(1);
    await E.applyGlucoseCorrection(snapshot, 140, "fasting", [], null);
    await w; await sleep(30);
    const mine = [...storeOf().values()].filter((x) => x.clientRecordId === "I1");
    console.log("  store:", JSON.stringify(mine.map((x) => x.value)), "row:", rows.get("I1")!.glucose_level_mgdl);
    ok(`${p} I: one sample`, mine.length === 1);
    ok(`${p} I: sample holds the edited value 140`, mine[0]?.value === 140);
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}
main().catch((e) => { console.log("HARNESS ERROR", e); process.exit(1); });
