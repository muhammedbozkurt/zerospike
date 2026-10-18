/**
 * Shared fakes for scripts/healthRecords.test.ts and healthSyncState.test.ts:
 * installs the module hook (react-native, AsyncStorage, the db modules and the
 * three native providers) so lib/services/health.ts and lib/healthRecords.ts
 * load under plain tsx. Import this file FIRST, then dynamic-import the lib.
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (c: number) => void };
import Module from "node:module";

import { planHealthImport, type ExistingSugarReading } from "../lib/db/healthImportSql";

(globalThis as any).__DEV__ = false;

export const kv = new Map<string, string>();
export const PLATFORM = { OS: "ios" as string };
export const crashes: unknown[] = [];

export interface Sample {
  kind: "carbs" | "insulin";
  value: number;
  insulinKind?: string;
  dateIso: string;
  meta: any;
}

export const fake = {
  samples: new Map<string, Sample>(),
  seq: 0,
  ops: [] as string[],
  failWrites: 0,
  failDeletes: false,
  authorized: true,
  requestGrant: true,
  available: true,
  readGranted: true,
  readGrantedThrows: false,
  bgGranted: true,
  glucose: [] as { value: number; date: string; period_tag: string }[],
  readThrows: false,
  readCalls: 0,
  requestReadCalls: 0,
  peekChanged: true,
  commits: 0,
  readDelayMs: 0,
  observerCb: null as null | (() => void),
  observerStops: 0,
  observerStarts: 0,
  observerOk: true,
  summary: { activeMinutes: null as number | null, insulin: null as any },
  summaryThrows: false,
};

export const rows = {
  meals: new Map<string, any>(),
  shots: new Map<string, any>(),
  sugar: [] as { profile_id: string; glucose_level_mgdl: number; logged_at: string; source: string }[],
  profiles: [{ id: "P" }, { id: "Q" }] as { id: string }[],
};

export function resetAll(platform: "ios" | "android" | "web" = "ios"): void {
  PLATFORM.OS = platform;
  kv.clear();
  crashes.length = 0;
  fake.samples.clear();
  Object.assign(fake, {
    seq: 0, ops: [], failWrites: 0, failDeletes: false, authorized: true, requestGrant: true,
    available: true, readGranted: true, readGrantedThrows: false, bgGranted: true, glucose: [],
    readThrows: false, readCalls: 0, requestReadCalls: 0, peekChanged: true, commits: 0,
    readDelayMs: 0, observerCb: null, observerStops: 0, observerStarts: 0, observerOk: true,
    summary: { activeMinutes: null, insulin: null }, summaryThrows: false,
  });
  rows.meals.clear();
  rows.shots.clear();
  rows.sugar.length = 0;
  rows.profiles = [{ id: "P" }, { id: "Q" }];
  kv.set("zerospike.activeProfile", "P");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export { sleep };

function write(kind: "carbs" | "insulin", value: number, dateIso: string, meta: any, insulinKind?: string) {
  if (fake.failWrites > 0) {
    fake.failWrites--;
    return Promise.resolve(null);
  }
  const uuid = `s-${++fake.seq}`;
  fake.samples.set(uuid, { kind, value, insulinKind, dateIso, meta });
  fake.ops.push(`write:${kind}:${uuid}`);
  return Promise.resolve(uuid);
}
function del(kind: "carbs" | "insulin", ids: string[]) {
  if (fake.failDeletes) return Promise.reject(new Error("store refused"));
  for (const id of ids) {
    fake.samples.delete(id);
    fake.ops.push(`delete:${kind}:${id}`);
  }
  return Promise.resolve();
}

export const provider = {
  isAvailable: async () => fake.available,
  requestReadPermissions: async () => {
    fake.requestReadCalls++;
    return true;
  },
  requestWritePermission: async () => true,
  requestReadWritePermissions: async () => ({ read: true, write: true }),
  isWriteAuthorized: async () => true,
  readRecentGlucose: async () => {
    fake.readCalls++;
    if (fake.readDelayMs) await sleep(fake.readDelayMs);
    if (fake.readThrows) throw new Error("read failed");
    return fake.glucose;
  },
  writeGlucose: async () => null,
  deleteGlucose: async () => {},
  deleteGlucoseBatch: async () => {},
  readSummary: async () => {
    if (fake.summaryThrows) throw new Error("boom");
    return fake.summary;
  },
  writeCarbs: (g: number, d: string, m: any) => write("carbs", g, d, m),
  writeInsulin: (u: number, k: string, d: string, m: any) => write("insulin", u, d, m, k),
  deleteCarbsBatch: (ids: string[]) => del("carbs", ids),
  deleteInsulinBatch: (ids: string[]) => del("insulin", ids),
  requestKindWritePermission: async () => {
    fake.ops.push("requestKind");
    if (fake.requestGrant) fake.authorized = true;
    return fake.requestGrant;
  },
  isKindWriteAuthorized: async () => fake.authorized,
  isReadGranted: async () => {
    if (fake.readGrantedThrows) throw new Error("grant lookup failed");
    return fake.readGranted;
  },
  startBackgroundObserver: async (cb: () => void) => {
    fake.observerStarts++;
    fake.observerCb = cb;
    return fake.observerOk;
  },
  stopBackgroundObserver: async () => {
    fake.observerStops++;
  },
  hasBackgroundReadPermission: async () => fake.bgGranted,
  requestBackgroundReadPermission: async () => {
    fake.bgGranted = true;
    return true;
  },
  peekGlucoseChanges: async () => ({
    changed: fake.peekChanged,
    commit: async () => {
      fake.commits++;
    },
  }),
};

export const tasks = {
  defined: new Map<string, () => Promise<unknown>>(),
  registered: new Set<string>(),
  registerArgs: [] as unknown[],
  status: 3,
};

const dbLogs = {
  getSugarLog: async () => null,
  insertHealthSugarLogs: async (profileId: string, samples: any[]) => {
    const existing: ExistingSugarReading[] = rows.sugar
      .filter((r) => r.profile_id === profileId)
      .map((r) => ({ logged_at: r.logged_at, glucose_level_mgdl: r.glucose_level_mgdl }));
    const toInsert = planHealthImport(samples, existing);
    for (const s of toInsert) {
      rows.sugar.push({
        profile_id: profileId,
        glucose_level_mgdl: Math.round(s.glucose_level_mgdl),
        logged_at: s.logged_at,
        source: "health",
      });
    }
    return toInsert.length;
  },
  listHealthBackfillRows: async () => [],
  listHealthMirrorRows: async () => [],
  listLinkedHealthUuids: async () => [],
  listHealthUuidLinks: async () => [],
  setSugarLogHealthUuid: async () => false,
  getMealLog: async (id: string) => (rows.meals.has(id) ? { ...rows.meals.get(id) } : null),
  setMealHealthUuid: async (id: string, uuid: string | null) => {
    const r = rows.meals.get(id);
    if (r) r.health_uuid = uuid;
    return r != null;
  },
  listMealHealthUuids: async (profileId: string) =>
    [...rows.meals.values()].filter((r) => r.profile_id === profileId && r.health_uuid).map((r) => r.health_uuid),
};
const dbInjections = {
  getInjection: async (id: string) => (rows.shots.has(id) ? { ...rows.shots.get(id) } : null),
  setInjectionHealthUuid: async (id: string, uuid: string | null) => {
    const r = rows.shots.get(id);
    if (r) r.health_uuid = uuid;
    return r != null;
  },
  listInjectionHealthUuids: async (profileId: string) =>
    [...rows.shots.values()].filter((r) => r.profile_id === profileId && r.health_uuid).map((r) => r.health_uuid),
};
const dbProfiles = {
  getProfile: async (id: string) => rows.profiles.find((p) => p.id === id) ?? null,
  listProfiles: async () => rows.profiles,
};

const AsyncStorage = {
  getItem: async (k: string) => (kv.has(k) ? kv.get(k)! : null),
  setItem: async (k: string, v: string) => void kv.set(k, v),
  removeItem: async (k: string) => void kv.delete(k),
};

const M = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
const realLoad = M._load;
M._load = function (request: string, ...rest: unknown[]) {
  if (request === "react-native") return { Platform: PLATFORM, Linking: { openURL: async () => {} } };
  if (request === "@react-native-async-storage/async-storage") return { __esModule: true, default: AsyncStorage };
  if (request.endsWith("/healthAppleKit")) {
    return { healthAppleKit: provider, prepareHealthKitWrite: async () => {} };
  }
  if (request.endsWith("/healthConnect")) {
    return {
      healthConnect: provider,
      getHealthConnectStatus: async () => "available",
      isReadPermissionBlocked: () => false,
      isWritePermissionBlocked: () => false,
    };
  }
  if (request.endsWith("/healthMock")) return { healthMock: provider };
  if (request.endsWith("/db/logs")) return dbLogs;
  if (request.endsWith("/db/injections")) return dbInjections;
  if (request.endsWith("/db/profiles")) return dbProfiles;
  if (request.endsWith("/analytics")) {
    return { logCrash: (e: unknown) => void crashes.push(e), logEvent: () => {} };
  }
  if (request === "expo-task-manager") {
    return {
      isTaskDefined: (n: string) => tasks.defined.has(n),
      defineTask: (n: string, fn: () => Promise<unknown>) => void tasks.defined.set(n, fn),
      isTaskRegisteredAsync: async (n: string) => tasks.registered.has(n),
    };
  }
  if (request === "expo-background-task") {
    return {
      BackgroundTaskResult: { Success: 1, Failed: 2 },
      BackgroundTaskStatus: { Restricted: 1, Available: 2 },
      getStatusAsync: async () => tasks.status,
      registerTaskAsync: async (n: string, o: unknown) => {
        tasks.registered.add(n);
        tasks.registerArgs.push(o);
      },
      unregisterTaskAsync: async (n: string) => void tasks.registered.delete(n),
    };
  }
  return realLoad.call(this, request, ...rest);
};

let passed = 0;
let failed = 0;
export function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ` (${detail})` : ""}`);
  }
}
export function eq<T>(name: string, actual: T, expected: T): void {
  ok(name, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
export function section(t: string): void {
  console.log(`\n${t}`);
}
export function finish(): void {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

export async function until(cond: () => boolean, ms = 2000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await sleep(2);
  }
  return cond();
}

export const NOW_ISO = "2026-10-05T12:00:00.000Z";
export const meal = (over: Record<string, unknown> = {}) => ({
  id: "m1", profile_id: "P", logged_at: NOW_ISO, calculated_carbs_g: 40, health_uuid: null, note: null, ...over,
});
export const shot = (over: Record<string, unknown> = {}) => ({
  id: "i1", profile_id: "P", logged_at: NOW_ISO, dose_units: 4, insulin_type: "bolus", health_uuid: null, note: null, ...over,
});
