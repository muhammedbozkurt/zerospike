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

async function main() {
  const H = await import(join(import.meta.dirname, "..", "lib", "services", "health.ts"));
  for (const p of ["android", "ios"] as const) {
    console.log(`=== ${p}`);

    reset(p);
    console.log("A. failed delete, undo re-mirror, foreground retry");
    const r = addRow("R1", 10);
    await H.writeGlucoseToHealthIfEnabled({ ...r });
    const u1 = rows.get("R1")!.healthkit_uuid;
    rows.delete("R1");
    failDeletes(1);
    await H.deleteGlucoseFromHealth(u1);
    const back = addRow("R1", 10);
    await H.writeGlucoseToHealthIfEnabled({ ...back });
    await sleep(5);
    await H.retryPendingHealthWrites("P");
    const linked = rows.get("R1")!.healthkit_uuid;
    ok(`${p} A: the re-linked sample still exists`, linked != null && storeOf().has(linked));
    ok(`${p} A: exactly one sample for the reading`, [...storeOf().values()].filter((x) => x.clientRecordId === "R1").length === 1);

    reset(p);
    console.log("B. backfill racing a bulk clear");
    for (let i = 0; i < 6; i++) addRow(`B${i}`, 60 * (i + 1));
    let cleared = false;
    const run = H.backfillGlucoseToHealth("P", 7);
    const poll = (async () => {
      while (!cleared) {
        await sleep(0);
        if ([...rows.values()].some((x) => x.healthkit_uuid)) {
          await H.revokeHealthCopiesBeforeDelete("P");
          rows.clear();
          cleared = true;
        }
      }
    })();
    await run;
    await poll;
    ok(`${p} B: no orphan sample left in the store`, storeOf().size === 0);

    reset(p);
    console.log("C. delete retry cost while the store is down");
    const q = Array.from({ length: 300 }, (_, i) => ({ uuid: `x-${i}`, queuedAtIso: new Date().toISOString() }));
    store.set(DEL_KEY, JSON.stringify(q));
    failDeletes(1e9);
    hcDeleteCalls = 0;
    const calls0 = hkDeleteTotal;
    await H.retryPendingHealthDeletes();
    const calls = PLATFORM === "android" ? hcDeleteCalls : hkDeleteTotal - calls0;
    ok(`${p} C: a failing pass stops after the first single (${calls} calls)`, calls <= 2);
    ok(`${p} C: queue is kept`, JSON.parse(store.get(DEL_KEY)!).length === 300);

    reset(p);
    console.log("D. reading edited while the backfill runs");
    for (let i = 0; i < 4; i++) addRow(`D${i}`, 60 * (4 - i));
    const runD = H.backfillGlucoseToHealth("P", 7);
    await sleep(1);
    rows.get("D3")!.glucose_level_mgdl = 250;
    await runD;
    const d3 = rows.get("D3")!;
    ok(`${p} D: Health holds the edited value`, storeOf().get(d3.healthkit_uuid!)?.value === 250);

    reset(p);
    console.log("E. concurrent failed deletes");
    failDeletes(2);
    await Promise.all([H.deleteGlucoseFromHealth("u-A"), H.deleteGlucoseFromHealth("u-B")]);
    const queued = JSON.parse(store.get(DEL_KEY) ?? "[]").map((e: any) => e.uuid).sort().join();
    ok(`${p} E: both ids are queued`, queued === "u-A,u-B");
  }

  reset("android");
  console.log("F. undo re-links the uuid while a delete pass is mid-flight");
  const f = addRow("F1", 5);
  await H.writeGlucoseToHealthIfEnabled({ ...f });
  const fu = rows.get("F1")!.healthkit_uuid!;
  rows.delete("F1");
  hcDeleteFailures = 1;
  await H.deleteGlucoseFromHealth(fu);
  onDelete = async () => {
    const b = addRow("F1", 5);
    await H.writeGlucoseToHealthIfEnabled({ ...b });
  };
  await H.retryPendingHealthDeletes();
  await H.retryPendingHealthWrites("P");
  const lf = rows.get("F1")!.healthkit_uuid;
  ok("F: the row ends up linked to a sample that exists", lf != null && hc.has(lf));

  reset("android");
  console.log("G. a permanently refused id at the head of the queue");
  const q2 = [{ uuid: "bad-0", queuedAtIso: new Date(Date.now() - 1000).toISOString() }].concat(
    Array.from({ length: 5 }, (_, i) => ({ uuid: `ok-${i}`, queuedAtIso: new Date().toISOString() }))
  );
  for (const e of q2) hc.set(e.uuid, { uuid: e.uuid, version: 0, value: 1 });
  store.set(DEL_KEY, JSON.stringify(q2));
  poison = "bad-0";
  for (let pass = 0; pass < 3; pass++) await H.retryPendingHealthDeletes();
  poison = "";
  ok("G: the ids behind it are deleted", ![...hc.keys()].some((k) => k.startsWith("ok-")));

  reset("android");
  console.log("H. the DB throws inside a retry");
  store.set(DEL_KEY, JSON.stringify([{ uuid: "h-1", queuedAtIso: new Date().toISOString() }]));
  linkedThrows = 1;
  const r1 = await H.retryPendingHealthDeletes().then(() => "resolved", () => "rejected");
  ok("H: delete retry swallows a DB error", r1 === "resolved");
  linkedThrows = 1;
  const r2 = await H.retryPendingHealthWrites("P").then(() => "resolved", () => "rejected");
  ok("H: write retry swallows a DB error", r2 === "resolved");
  hcDeleteFailures = 1;
  let hung = true;
  const t = setTimeout(() => {}, 500);
  await H.deleteGlucoseFromHealth("h-2");
  await H.retryPendingHealthDeletes();
  hung = false;
  clearTimeout(t);
  ok("H: the queue lock still works afterwards", !hung && JSON.parse(store.get(DEL_KEY) ?? "[]").length >= 0);
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}
main().catch((e) => {
  console.log("HARNESS ERROR", e);
  process.exit(1);
});
