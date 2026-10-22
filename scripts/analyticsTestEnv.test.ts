/**
 * Standalone harness for "test traffic stays out of usage analytics": the pure
 * rule (lib/analytics/testEnvironment.ts) and the REAL Supabase sink with only
 * the native edge stubbed (the way scripts/analyticsConsent.test.ts does it).
 * Emulators and simulators, dev builds, screenshot mode and Firebase Test Lab /
 * Play pre-launch devices send nothing even with consent granted; a real device
 * does. Run from the repo root:
 *
 *   npx tsc scripts/analyticsTestEnv.test.ts lib/analytics/consent.ts \
 *     lib/analytics/eventSchema.ts lib/analytics/deleteDevice.ts \
 *     lib/analytics/once.ts \
 *     --ignoreConfig --ignoreDeprecations 6.0 \
 *     --outDir .tmp --module commonjs --target es2019 \
 *     --moduleResolution node --skipLibCheck --esModuleInterop \
 *   && node .tmp/scripts/analyticsTestEnv.test.js
 */

declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void; env: Record<string, string | undefined> };
declare const require: {
  (id: string): any;
  cache: Record<string, unknown>;
};
declare function setTimeout(fn: () => void, ms: number): unknown;

import { CONSENT_KEY } from "../lib/analytics/consent";
import type * as TestEnvApi from "../lib/analytics/testEnvironment";
import { V24_CREATE_ANALYTICS_QUEUE } from "../lib/db/v24Sql";
// Type-only: makes tsc compile the real sink next to this file.
import type * as FacadeApi from "../lib/analytics/index";
import type * as SupabaseSinkApi from "../lib/analytics/supabaseSink";

const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: new (path: string) => any };

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ": " + detail : ""}`);
  }
}
function eq<T>(name: string, actual: T, expected: T): void {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
function section(title: string): void {
  console.log(`\n${title}`);
}
const settle = (ms = 30): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const base = { isDevice: true, dev: false, screenshot: false, testLab: false };

function rule(): void {
  section("A. the rule");
  installStubs();
  const { isTestEnvironment } = require("../lib/analytics/testEnvironment") as typeof TestEnvApi;
  eq("a real device in a release build sends", isTestEnvironment(base), false);
  eq("an emulator or simulator does not", isTestEnvironment({ ...base, isDevice: false }), true);
  eq("a dev build does not", isTestEnvironment({ ...base, dev: true }), true);
  eq("screenshot mode does not", isTestEnvironment({ ...base, screenshot: true }), true);
  eq("a Firebase Test Lab / pre-launch device does not", isTestEnvironment({ ...base, testLab: true }), true);
  eq("an unknown isDevice counts as a real device", isTestEnvironment({ ...base, isDevice: null }), false);
  eq("and so does a missing one", isTestEnvironment({ ...base, isDevice: undefined }), false);
}

const TRACK_URL = "https://track.test/fn";
const DEVICE_ID = "0b1f6a52-3c1e-4e0e-9a0e-2f7b2f2a9d11";

const rig = {
  os: "ios",
  isDevice: true as boolean | undefined,
  testLab: false,
  dev: false,
  screenshot: false,
  db: null as any,
  fetches: 0,
  bytes: 0,
  listeners: [] as ((s: string) => void)[],
};

let installed = false;
function installStubs(): void {
  if (installed) return;
  installed = true;
  const Module = require("module");
  const realLoad = Module._load;
  const storage = {
    async getItem(key: string) {
      if (key === CONSENT_KEY) return "granted";
      if (key === "zerospike.deviceId") return DEVICE_ID;
      return null;
    },
    async setItem() {},
    async removeItem() {},
  };
  Module._load = function (request: string, parent: any) {
    const from = parent && typeof parent.filename === "string" ? parent.filename : "";
    if (!/[\\/]lib[\\/](analytics|identity|uuid|appVersion)/.test(from)) return realLoad.apply(this, arguments);
    switch (request) {
      case "react-native":
        return {
          Platform: { OS: rig.os, Version: "17.0" },
          AppState: {
            currentState: "active",
            addEventListener(_t: string, l: (s: string) => void) {
              rig.listeners.push(l);
              return { remove() {} };
            },
          },
        };
      case "../screenshotMode":
        return { isScreenshotMode: () => rig.screenshot };
      case "@react-native-async-storage/async-storage":
        return { __esModule: true, default: storage };
      case "expo-constants":
        return { __esModule: true, default: { expoConfig: { extra: { trackFnUrl: TRACK_URL }, version: "8.8.8" } } };
      case "expo-application":
        return { __esModule: true, nativeBuildVersion: "94", nativeApplicationVersion: "2.4.0" };
      case "expo-device":
        return { __esModule: true, osVersion: "17.0", isDevice: rig.isDevice };
      case "expo-modules-core":
        return { requireOptionalNativeModule: () => ({ isTestLab: () => rig.testLab }) };
      case "expo-crypto":
        return {
          getRandomBytes: (n: number) => Uint8Array.from({ length: n }, (_, i) => (rig.bytes++ * 31 + i * 7 + 3) & 255),
        };
      case "../db/index":
        return {
          getDb: async () => ({
            runAsync: async (sql: string, params: unknown[] = []) => rig.db.prepare(sql).run(...params),
            getAllAsync: async (sql: string, params: unknown[] = []) => rig.db.prepare(sql).all(...params),
          }),
        };
      case "../i18n":
        return { currentLang: () => "en" };
      default:
        return realLoad.apply(this, arguments);
    }
  };
  (globalThis as any).fetch = async () => {
    rig.fetches++;
    return { status: 202, headers: { get: () => null }, json: async () => ({}) };
  };
}

async function run(setup: Partial<typeof rig>): Promise<{ fetches: number; queued: number }> {
  installStubs();
  Object.assign(rig, { os: "ios", isDevice: true, testLab: false, dev: false, screenshot: false, fetches: 0, listeners: [] }, setup);
  (globalThis as any).__DEV__ = rig.dev;
  if (rig.db) rig.db.close();
  rig.db = new DatabaseSync(":memory:");
  rig.db.exec(V24_CREATE_ANALYTICS_QUEUE);
  for (const key of Object.keys(require.cache)) {
    if (/[\\/]lib[\\/](analytics|identity)[\\/]/.test(key) || /[\\/]lib[\\/](uuid|appVersion)\.js$/.test(key)) {
      delete require.cache[key];
    }
  }
  require("../lib/analytics/index") as typeof FacadeApi;
  const sink = require("../lib/analytics/supabaseSink") as typeof SupabaseSinkApi;
  sink.initSupabaseSink();
  sink.setAnalyticsIsPro(false);
  await settle();
  for (const l of [...rig.listeners]) l("background");
  await settle();
  return { fetches: rig.fetches, queued: rig.db.prepare("SELECT COUNT(*) AS c FROM analytics_queue").get().c };
}

async function sinkScenarios(): Promise<void> {
  section("B. the real sink, consent granted");
  const real = await run({});
  ok("a real iPhone sends", real.fetches > 0, `fetches ${real.fetches}`);

  const realAndroid = await run({ os: "android", isDevice: true, testLab: false });
  ok("a real Android phone sends", realAndroid.fetches > 0, `fetches ${realAndroid.fetches}`);

  const simulator = await run({ isDevice: false });
  eq("a simulator or emulator sends nothing and queues nothing", [simulator.fetches, simulator.queued], [0, 0]);

  const dev = await run({ dev: true });
  eq("a dev build sends nothing and queues nothing", [dev.fetches, dev.queued], [0, 0]);

  const shots = await run({ screenshot: true });
  eq("screenshot mode sends nothing and queues nothing", [shots.fetches, shots.queued], [0, 0]);

  const lab = await run({ os: "android", testLab: true });
  eq("a Firebase Test Lab / pre-launch device sends nothing and queues nothing", [lab.fetches, lab.queued], [0, 0]);

  const labOnIos = await run({ os: "ios", testLab: true });
  ok("the test-lab flag is only read on Android", labOnIos.fetches > 0);

  process.env.EXPO_PUBLIC_ANALYTICS_DEV = "1";
  const devOptIn = await run({ dev: true });
  ok("EXPO_PUBLIC_ANALYTICS_DEV=1 still lets a dev build on a real device try the function", devOptIn.fetches > 0);
  const devOptInSim = await run({ dev: true, isDevice: false });
  eq("but not a simulator", devOptInSim.fetches, 0);
  delete process.env.EXPO_PUBLIC_ANALYTICS_DEV;
}

async function main(): Promise<void> {
  console.log("zerospike analytics test-environment test");
  rule();
  await sinkScenarios();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.log("test crashed:", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
