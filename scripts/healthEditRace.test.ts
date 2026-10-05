/**
 * Device QA races on a reading's Health mirror, replayed on fake HealthKit and
 * Health Connect stores whose native calls take a configurable time, so a
 * second operation on the same reading can start while the first is in flight.
 * HealthKit is modelled refusing a not-newer sync version with an error (the
 * case that made the metadata-free fallback add a second sample).
 *
 *   I  edit one moment after logging, first write still in flight
 *   J  two quick edits, the first one's write slower than the second's
 *   K  log, delete and undo while writes and revokes are in flight
 *   L  the one-time question answered yes, then an edit
 *   M  delete while the first write is in flight (no orphan)
 *   N  why the lock matters: two unserialized writes of one reading
 *   O  a refused version (clock set back) still leaves one sample
 *   P  the calculator's meal edit while the reading's first write is in flight
 *   Q  the reading is deleted between the orphan check and the link
 *   R  correction in flight, delete, undo whose write fails, then the retry
 *   S  a native write that never returns (timeout, late landing)
 *   T  a correction whose write comes back empty keeps the old sample
 *   H  a correction's write times out, then lands late
 *   V  the HealthKit permission sheet stays up longer than the timeout
 *
 * Every scenario ends with: exactly one sample in the store, holding the
 * row's current value, and the row linked to it (or nothing when deleted).
 * Run: npx tsx scripts/healthEditRace.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (c: number) => void };
import Module from "node:module";
import { join } from "node:path";

(globalThis as any).__DEV__ = false;

const kv = new Map<string, string>();
const AsyncStorage = {
  getItem: async (k: string) => (kv.has(k) ? kv.get(k)! : null),
  setItem: async (k: string, v: string) => void kv.set(k, v),
  removeItem: async (k: string) => void kv.delete(k),
};

type Row = {
  id: string; profile_id: string; glucose_level_mgdl: number; period_tag: string;
  source: string; logged_at: string; tags: string[]; healthkit_uuid: string | null;
};
const rows = new Map<string, Row>();
/** Called after every getSugarLog, with how many times that row was read. */
let afterRead: ((id: string, n: number) => void) | null = null;
const reads = new Map<string, number>();
const logs = {
  getSugarLog: async (id: string) => {
    const r = rows.has(id) ? { ...rows.get(id)! } : null;
    const n = (reads.get(id) ?? 0) + 1;
    reads.set(id, n);
    afterRead?.(id, n);
    return r;
  },
  /** One statement in the app (DELETE ... RETURNING): no link can land between. */
  deleteSugarLog: async (id: string) => {
    const uuid = rows.get(id)?.healthkit_uuid ?? null;
    rows.delete(id);
    return uuid;
  },
  updateSugarLog: async (id: string, p: Partial<Row>) => {
    const r = rows.get(id);
    if (r && p.glucose_level_mgdl != null) r.glucose_level_mgdl = p.glucose_level_mgdl;
    return r ? { ...r } : null;
  },
  insertHealthSugarLogs: async () => 0,
  listHealthBackfillRows: async () => [],
  listHealthMirrorRows: async () => [],
  listLinkedHealthUuids: async (uuids: string[]) =>
    [...rows.values()].filter((r) => r.healthkit_uuid != null && uuids.includes(r.healthkit_uuid)).map((r) => r.healthkit_uuid),
  listHealthUuidLinks: async (uuids: string[]) =>
    [...rows.values()]
      .filter((r) => r.healthkit_uuid != null && uuids.includes(r.healthkit_uuid))
      .map((r) => ({ id: r.id, profile_id: r.profile_id, healthkit_uuid: r.healthkit_uuid })),
  setSugarLogHealthUuid: async (id: string, uuid: string | null) => {
    const r = rows.get(id);
    if (r) r.healthkit_uuid = uuid;
    return r != null;
  },
};
const profiles = {
  getProfile: async (id: string) => (id === "P" ? { id: "P" } : null),
  listProfiles: async () => [{ id: "P" }],
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Per-call native latency: the next write/delete takes the next queued value. */
let writeDelays: number[] = [];
let deleteDelays: number[] = [];
const nextWriteDelay = () => writeDelays.shift() ?? 2;
const nextDeleteDelay = () => deleteDelays.shift() ?? 1;
/** Native write controls: fail the next N writes (HC throws, HK returns no
 *  sample), or park the next one until releaseHung() lets it land. */
let failWrites = 0;
let hangNext = false;
let releaseHung: (() => void) | null = null;
/** Native calls still running (a parked write counts once released). */
let nativeInFlight = 0;
function tracked<T>(call: () => Promise<T>): Promise<T> {
  nativeInFlight++;
  return call().finally(() => nativeInFlight--);
}
function gate<T>(land: () => Promise<T>, failed: () => T): Promise<T> {
  if (failWrites > 0) {
    failWrites--;
    return Promise.resolve(failed());
  }
  if (hangNext) {
    hangNext = false;
    return new Promise<T>((resolve, reject) => {
      releaseHung = () => void tracked(land).then(resolve, reject);
    });
  }
  return tracked(land);
}

type Rec = { uuid: string; syncId?: string; version: number; value: number };

// Health Connect: clientRecordId upsert keeps the uuid; a not-newer version is ignored.
const hc = new Map<string, Rec>();
let hcSeq = 0;
const fakeHC = {
  getSdkStatus: async () => 3,
  initialize: async () => true,
  getGrantedPermissions: async () => [{ accessType: "write", recordType: "BloodGlucose" }],
  insertRecords: (recs: any[]) =>
    gate(() => hcInsert(recs), () => {
      throw new Error("write refused");
    }),
  deleteRecordsByUuids: (_t: string, ids: string[]) =>
    tracked(async () => {
      await sleep(nextDeleteDelay());
      for (const id of ids) hc.delete(id);
    }),
  readRecords: async () => ({ records: [] }),
};
async function hcInsert(recs: any[]): Promise<string[]> {
  const r = recs[0];
  const cid = r.metadata?.clientRecordId;
  const ver = r.metadata?.clientRecordVersion ?? 0;
  await sleep(nextWriteDelay());
  const existing = cid ? [...hc.values()].find((x) => x.syncId === cid) : undefined;
  if (existing) {
    if (ver > existing.version) {
      existing.version = ver;
      existing.value = r.level.value;
    }
    return [existing.uuid];
  }
  const uuid = `hc-${++hcSeq}`;
  hc.set(uuid, { uuid, syncId: cid, version: ver, value: r.level.value });
  return [uuid];
}

// HealthKit: same sync id + higher version replaces with a NEW uuid; a
// not-newer version is refused with an error (the JS side sees a rejection).
const hk = new Map<string, Rec>();
let hkSeq = 0;
let hkRefusals = 0;
/** HealthKit share status (2 authorized, 0 not determined) and how long the
 *  permission sheet stays up before the user allows writing. */
let hkStatus = 2;
let hkSheetMs = 0;
const fakeHK = {
  AuthorizationStatus: { notDetermined: 0, sharingDenied: 1, sharingAuthorized: 2 },
  isHealthDataAvailable: () => true,
  authorizationStatusFor: () => hkStatus,
  requestAuthorization: async () => {
    await sleep(hkSheetMs);
    hkStatus = 2;
    return true;
  },
  saveQuantitySample: (_id: string, _u: string, value: number, _s: Date, _e: Date, meta?: any) =>
    gate(() => hkSave(value, meta), () => undefined as { uuid: string } | undefined),
  deleteObjects: (_t: string, f: { uuids: string[] }) =>
    tracked(async () => {
      await sleep(nextDeleteDelay());
      for (const id of f.uuids) hk.delete(id);
      return f.uuids.length;
    }),
};
async function hkSave(value: number, meta?: any): Promise<{ uuid: string }> {
  await sleep(nextWriteDelay());
  const sid = meta?.HKMetadataKeySyncIdentifier;
  const ver = meta?.HKMetadataKeySyncVersion ?? 0;
  const existing = sid ? [...hk.values()].find((x) => x.syncId === sid) : undefined;
  if (existing && ver <= existing.version) {
    hkRefusals++;
    throw new Error("sync version is not newer than the existing object");
  }
  if (existing) hk.delete(existing.uuid);
  const uuid = `hk-${++hkSeq}`;
  hk.set(uuid, { uuid, syncId: sid, version: ver, value });
  return { uuid };
}

const PLATFORM = { OS: "android" as string };
const M = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
const realLoad = M._load;
M._load = function (request: string, ...rest: unknown[]) {
  if (request === "react-native") return { Platform: PLATFORM, Linking: { openURL: async () => {} } };
  if (request === "@react-native-async-storage/async-storage") return { __esModule: true, default: AsyncStorage };
  if (request === "react-native-health-connect") return fakeHC;
  if (request === "@kingstinct/react-native-healthkit") return fakeHK;
  if (request.endsWith("/db/logs")) return logs;
  if (request.endsWith("/db/profiles")) return profiles;
  if (request.endsWith("/analytics")) return { logCrash: () => {}, logEvent: () => {} };
  return realLoad.call(this, request, ...rest);
};

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ` (${detail})` : ""}`);
  }
}

const storeOf = () => (PLATFORM.OS === "android" ? hc : hk);
function reset(p: "android" | "ios", writeOn = true) {
  PLATFORM.OS = p;
  kv.clear();
  rows.clear();
  hc.clear();
  hk.clear();
  writeDelays = [];
  deleteDelays = [];
  hkRefusals = 0;
  hkStatus = 2;
  hkSheetMs = 0;
  failWrites = 0;
  hangNext = false;
  releaseHung = null;
  afterRead = null;
  reads.clear();
  kv.set("zerospike.activeProfile", "P");
  kv.set("zerospike.healthWriteEnabled.P", writeOn ? "1" : "0");
}
function addRow(id: string, mgdl: number): Row {
  const r: Row = {
    id, profile_id: "P", glucose_level_mgdl: mgdl, period_tag: "fasting", source: "manual",
    logged_at: new Date(Date.now() - 60000).toISOString(), tags: [], healthkit_uuid: null,
  };
  rows.set(id, r);
  return r;
}
/** What a screen holds: the row as it was when the list last loaded. */
const uiCopy = (id: string) => ({ ...rows.get(id)!, kind: "glucose" }) as any;
let H: any;
/** Waits until no native call runs and no reading has a Health operation
 *  queued (fixed sleeps were flaky on a loaded machine). */
async function settle(): Promise<void> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    await sleep(2);
    const idle = await Promise.race([H.healthIdleForTests().then(() => true), sleep(500).then(() => false)]);
    if (idle && nativeInFlight === 0) {
      await sleep(2);
      if (nativeInFlight === 0) return;
    }
  }
  // A reading whose lock is never released fails here instead of hanging.
  ok("Health operations went idle", false);
}

/** One sample, holding the row's value, and the row linked to it. Samples of
 *  the `others` readings are left out of the count. */
function expectSingle(tag: string, id: string, others: string[] = []) {
  const all = [...storeOf().values()].filter((x) => !others.includes(x.syncId ?? ""));
  const row = rows.get(id);
  const desc = `store ${JSON.stringify(all.map((x) => x.value))}, row ${row?.glucose_level_mgdl}, link ${row?.healthkit_uuid}`;
  ok(`${tag}: exactly one sample`, all.length === 1, desc);
  ok(`${tag}: the sample holds the current value`, all[0]?.value === row?.glucose_level_mgdl, desc);
  ok(`${tag}: the row is linked to that sample`, row?.healthkit_uuid != null && row.healthkit_uuid === all[0]?.uuid, desc);
}

async function main() {
  H = await import(join(import.meta.dirname, "..", "lib", "services", "health.ts"));
  const E = await import(join(import.meta.dirname, "..", "lib", "services", "glucoseEdit.ts"));
  const { buildHealthWriteMeta } = await import(join(import.meta.dirname, "..", "lib", "healthMeta.ts"));

  for (const p of ["android", "ios"] as const) {
    console.log(`=== ${p}`);

    reset(p);
    console.log("I. edit one moment after logging, first write still in flight");
    addRow("I1", 123);
    const ui = uiCopy("I1");
    writeDelays = [25, 2];
    void H.writeGlucoseToHealthIfEnabled({ ...rows.get("I1")! });
    await sleep(3);
    await E.applyGlucoseCorrection(ui, 140, "fasting", [], null);
    await settle();
    expectSingle(`${p} I`, "I1");

    reset(p);
    console.log("J. two quick edits, the first one's write the slower");
    addRow("J1", 130);
    await H.writeGlucoseToHealthIfEnabled({ ...rows.get("J1")! });
    const linked = uiCopy("J1");
    writeDelays = [25, 2];
    await E.applyGlucoseCorrection(linked, 135, "fasting", [], null);
    await sleep(1);
    await E.applyGlucoseCorrection(linked, 136, "fasting", [], null);
    await settle();
    expectSingle(`${p} J`, "J1");
    ok(`${p} J: no version was refused`, hkRefusals === 0, `${hkRefusals} refusals`);

    reset(p);
    console.log("K1. log, delete and undo while the first write is in flight");
    addRow("K1", 118);
    writeDelays = [25, 2];
    void H.writeGlucoseToHealthIfEnabled({ ...rows.get("K1")! });
    await sleep(3);
    const snap = { ...rows.get("K1")! };
    rows.delete("K1");
    void H.deleteGlucoseRowFromHealth("K1", null);
    await sleep(3);
    rows.set("K1", { ...snap, healthkit_uuid: null });
    void H.writeGlucoseToHealthIfEnabled({ ...snap, healthkit_uuid: null });
    await settle();
    expectSingle(`${p} K1`, "K1");

    reset(p);
    console.log("K2. delete a linked reading, undo while the revoke is still running");
    addRow("K2", 121);
    await H.writeGlucoseToHealthIfEnabled({ ...rows.get("K2")! });
    const linkedK2 = { ...rows.get("K2")! };
    rows.delete("K2");
    deleteDelays = [25];
    void H.deleteGlucoseRowFromHealth("K2", linkedK2.healthkit_uuid);
    await sleep(3);
    rows.set("K2", { ...linkedK2, healthkit_uuid: null });
    void H.writeGlucoseToHealthIfEnabled({ ...linkedK2, healthkit_uuid: null });
    await settle();
    expectSingle(`${p} K2`, "K2");

    reset(p, false);
    console.log("L1. mirror off: log, correct, then answer the one-time question yes");
    addRow("L1", 130);
    const askedAbout = { ...rows.get("L1")! };
    await H.writeGlucoseToHealthIfEnabled({ ...askedAbout });
    await E.applyGlucoseCorrection(uiCopy("L1"), 135, "fasting", [], null);
    await H.setHealthWriteEnabled(true, "P");
    await H.writeGlucoseToHealthIfEnabled(askedAbout);
    await settle();
    expectSingle(`${p} L1`, "L1");

    reset(p, false);
    console.log("L2. question answered yes, edit while that write is in flight");
    addRow("L2", 130);
    const asked = { ...rows.get("L2")! };
    const uiL2 = uiCopy("L2");
    await H.setHealthWriteEnabled(true, "P");
    writeDelays = [25, 2];
    void H.writeGlucoseToHealthIfEnabled(asked);
    await sleep(3);
    await E.applyGlucoseCorrection(uiL2, 135, "fasting", [], null);
    await settle();
    expectSingle(`${p} L2`, "L2");

    reset(p);
    console.log("M. delete while the first write is in flight");
    addRow("M1", 150);
    writeDelays = [25];
    void H.writeGlucoseToHealthIfEnabled({ ...rows.get("M1")! });
    await sleep(3);
    rows.delete("M1");
    void H.deleteGlucoseRowFromHealth("M1", null);
    await settle();
    ok(`${p} M: no orphan sample left`, storeOf().size === 0, `${storeOf().size} left`);

    reset(p);
    console.log("P1. calculator meal edit while the reading's first write is in flight");
    addRow("P1", 123);
    writeDelays = [25, 2];
    void H.writeGlucoseToHealthIfEnabled({ ...rows.get("P1")! });
    await sleep(3);
    // app/calculator.tsx: update the row, read it back, rewrite (no link gate).
    await logs.updateSugarLog("P1", { glucose_level_mgdl: 140 });
    const calcRow = (await logs.getSugarLog("P1"))!;
    const calcOn = await H.getHealthWriteEnabled(calcRow.profile_id);
    const calcRes = await H.updateGlucoseInHealth("P1", calcRow.healthkit_uuid ?? null, calcRow.profile_id);
    await settle();
    ok(`${p} P1: the edit saw the mirror on and no failure`, calcOn && !calcRes.failed && calcRes.uuid != null);
    expectSingle(`${p} P1`, "P1");

    reset(p, false);
    console.log("P2. correcting a reading that was never mirrored reports nothing");
    addRow("P2", 123);
    await H.setHealthWriteEnabled(true, "P");
    const never = await H.updateGlucoseInHealth("P2", null, "P");
    ok(`${p} P2: nothing written, nothing reported`, storeOf().size === 0 && never.uuid === null && !never.failed);

    reset(p);
    console.log("Q. the reading is deleted between the orphan check and the link");
    addRow("Q1", 130);
    afterRead = (id, n) => {
      // read 1: the locked write's own read; read 2: its orphan check.
      if (id !== "Q1" || n !== 2) return;
      afterRead = null;
      void logs.deleteSugarLog("Q1").then((u) => H.deleteGlucoseRowFromHealth("Q1", u));
    };
    await H.writeGlucoseToHealthIfEnabled({ ...rows.get("Q1")! });
    await settle();
    ok(`${p} Q: no orphan sample left`, storeOf().size === 0, `${storeOf().size} left`);

    reset(p);
    console.log("R. correction in flight, delete, undo whose write fails, then the retry");
    addRow("R1", 130);
    await H.writeGlucoseToHealthIfEnabled({ ...rows.get("R1")! });
    writeDelays = [25];
    void E.applyGlucoseCorrection(uiCopy("R1"), 140, "fasting", [], null);
    await sleep(5);
    const snapR = { ...rows.get("R1")! };
    void H.deleteGlucoseRowFromHealth("R1", await logs.deleteSugarLog("R1"));
    await sleep(2);
    rows.set("R1", { ...snapR, healthkit_uuid: null });
    failWrites = 1;
    void H.writeGlucoseToHealthIfEnabled({ ...snapR, healthkit_uuid: null });
    await settle();
    const linkR = rows.get("R1")!.healthkit_uuid;
    ok(`${p} R: the row never points at a revoked sample`, linkR == null || storeOf().has(linkR), `link ${linkR}`);
    await H.retryPendingHealthWrites("P");
    await settle();
    expectSingle(`${p} R`, "R1");

    reset(p);
    console.log("S. a native write that never returns does not hold the reading");
    H.setHealthNativeTimeoutForTests(30);
    addRow("S1", 100);
    addRow("S2", 110);
    hangNext = true;
    void H.writeGlucoseToHealthIfEnabled({ ...rows.get("S1")! });
    await sleep(3);
    await H.writeGlucoseToHealthIfEnabled({ ...rows.get("S2")! });
    ok(`${p} S: another reading is written meanwhile`, rows.get("S2")!.healthkit_uuid != null);
    await sleep(45);
    await E.applyGlucoseCorrection(uiCopy("S1"), 150, "fasting", [], null);
    await settle();
    const rs = await H.retryPendingHealthWrites("P");
    ok(`${p} S: after the timeout the retry writes the reading`, rs.succeeded === 1, JSON.stringify(rs));
    releaseHung?.();
    await settle();
    H.setHealthNativeTimeoutForTests(null);
    expectSingle(`${p} S (late write landed)`, "S1", ["S2"]);

    reset(p);
    console.log("T. a correction whose write comes back empty keeps the old sample");
    addRow("T1", 130);
    await H.writeGlucoseToHealthIfEnabled({ ...rows.get("T1")! });
    const keptT = rows.get("T1")!.healthkit_uuid!;
    await logs.updateSugarLog("T1", { glucose_level_mgdl: 135 });
    failWrites = 1;
    const tr = await H.updateGlucoseInHealth("T1", keptT, "P");
    ok(`${p} T: reported as failed`, tr.failed && tr.uuid === null);
    ok(`${p} T: the old sample and its link are kept`, storeOf().has(keptT) && rows.get("T1")!.healthkit_uuid === keptT);
    await H.retryPendingHealthWrites("P");
    await settle();
    expectSingle(`${p} T (after the retry)`, "T1");

    reset(p);
    console.log("H. a correction's write times out, then lands late");
    H.setHealthNativeTimeoutForTests(30);
    addRow("H1", 130);
    await H.writeGlucoseToHealthIfEnabled({ ...rows.get("H1")! });
    writeDelays = [60];
    await E.applyGlucoseCorrection(uiCopy("H1"), 145, "fasting", [], null);
    await sleep(70);
    await settle();
    H.setHealthNativeTimeoutForTests(null);
    // Before any retry: the late write must not leave the reading out of Health.
    expectSingle(`${p} H (late write landed, no retry yet)`, "H1");
  }

  reset("ios");
  console.log("=== ios V. the permission sheet stays up longer than the native timeout");
  H.setHealthNativeTimeoutForTests(30);
  hkStatus = 0;
  hkSheetMs = 60;
  addRow("V1", 128);
  const okV = await H.writeGlucoseToHealthIfEnabled({ ...rows.get("V1")! });
  await settle();
  H.setHealthNativeTimeoutForTests(null);
  ok("ios V: no failure is reported while the user decides", okV === true);
  expectSingle("ios V", "V1");

  // N/O are HealthKit-only: Health Connect ignores a not-newer version
  // instead of refusing it, so it never reaches a metadata-free retry.
  reset("ios");
  console.log("=== ios N. two unserialized writes of one reading (what the lock prevents)");
  const n = addRow("N1", 130);
  writeDelays = [25, 2];
  const older = H.writeGlucoseToHealth(130, n.logged_at, buildHealthWriteMeta(n, 1000));
  await sleep(1);
  const newer = H.writeGlucoseToHealth(135, n.logged_at, buildHealthWriteMeta(n, 2000));
  await Promise.all([older, newer]);
  ok("ios N: the refused older write comes back as a second, metadata-free sample", hk.size === 2 && hkRefusals === 1);

  reset("ios");
  console.log("=== ios O. a refused version (clock set back) still leaves one sample");
  addRow("O1", 130);
  hk.set("hk-future", { uuid: "hk-future", syncId: "O1", version: Date.now() + 864e5, value: 130 });
  rows.get("O1")!.healthkit_uuid = "hk-future";
  await E.applyGlucoseCorrection(uiCopy("O1"), 140, "fasting", [], null);
  await settle();
  ok("ios O: the write was refused and fell back", hkRefusals === 1, `${hkRefusals} refusals`);
  expectSingle("ios O", "O1");

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}
main().catch((e) => {
  console.log("HARNESS ERROR", e);
  process.exit(1);
});
