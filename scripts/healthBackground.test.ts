/**
 * Smoke test for the carbs/insulin writes and the iOS background observer in
 * healthAppleKit, and the own-source filter on the insulin summary.
 * Run: npx tsx scripts/healthBackground.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import Module from "node:module";

let passed = 0;
let failed = 0;
function eq<T>(name: string, actual: T, expected: T): void {
  if (actual === expected) passed++;
  else {
    failed++;
    console.log(`  x ${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  }
}

const CARBS = "HKQuantityTypeIdentifierDietaryCarbohydrates";
const INSULIN = "HKQuantityTypeIdentifierInsulinDelivery";
const saved: { identifier: string; unit: string; value: number; metadata: Record<string, unknown> | undefined }[] = [];
const deleted: { identifier: string; filter: unknown }[] = [];
const calls: string[] = [];
let observerCb: ((a: { typeIdentifier: string; errorMessage?: string }) => void) | null = null;
let removed = 0;

const fakeHK = {
  AuthorizationStatus: { notDetermined: 0, sharingDenied: 1, sharingAuthorized: 2 },
  UpdateFrequency: { immediate: 1 },
  authorizationStatusFor: () => 2,
  requestAuthorization: async () => true,
  saveQuantitySample: async (identifier: string, unit: string, value: number, _s: Date, _e: Date, metadata?: Record<string, unknown>) => {
    saved.push({ identifier, unit, value, metadata });
    return { uuid: `u-${saved.length}` };
  },
  deleteObjects: async (identifier: string, filter: unknown) => {
    deleted.push({ identifier, filter });
    return 1;
  },
  queryQuantitySamples: async () => [
    { quantity: 4, metadata: { HKInsulinDeliveryReason: 2 }, sourceRevision: { source: { bundleIdentifier: "com.greeneyeapp.zerospike" } } },
    { quantity: 6, metadata: { HKInsulinDeliveryReason: 2 }, sourceRevision: { source: { bundleIdentifier: "com.pump.app" } } },
    { quantity: 10, metadata: { HKInsulinDeliveryReason: 1 }, sourceRevision: { source: { bundleIdentifier: "com.pump.app" } } },
  ],
  configureBackgroundTypes: async (ids: string[], f: number) => {
    calls.push(`configure:${ids.join(",")}:${f}`);
    return true;
  },
  enableBackgroundDelivery: async (id: string, f: number) => {
    calls.push(`enable:${id}:${f}`);
    return true;
  },
  subscribeToChanges: (id: string, cb: typeof observerCb) => {
    calls.push(`subscribe:${id}`);
    observerCb = cb;
    return { remove: () => { removed++; } };
  },
  clearBackgroundTypes: async () => { calls.push("clear"); return true; },
  disableBackgroundDelivery: async () => { calls.push("disable"); return true; },
};

// Registration (CGM-E): fakes for lib/services/healthBackground.ts
const reg = {
  os: "android" as string,
  blocker: null as string | null,
  nightscout: false,
  registered: false,
  calls: [] as string[],
  taskBody: null as null | (() => Promise<unknown>),
  sourcePassFailed: false,
};
const fakeTM = {
  isTaskDefined: () => false,
  defineTask: (_name: string, body: () => Promise<unknown>) => {
    reg.taskBody = body;
  },
  isTaskRegisteredAsync: async () => reg.registered,
};
const fakeBT = {
  BackgroundTaskResult: { Success: 1, Failed: 2 },
  BackgroundTaskStatus: { Restricted: 1, Available: 2 },
  getStatusAsync: async () => 2,
  registerTaskAsync: async (_name: string, opts: { minimumInterval: number }) => {
    reg.calls.push(`register:${opts.minimumInterval}`);
    reg.registered = true;
  },
  unregisterTaskAsync: async () => {
    reg.calls.push("unregister");
    reg.registered = false;
  },
};

const M = Module as unknown as { _load: (request: string, parent?: { filename?: string }, ...rest: unknown[]) => unknown };
const realLoad = M._load;
M._load = function (request: string, parent?: { filename?: string }, ...rest: unknown[]) {
  if (request === "@kingstinct/react-native-healthkit") return fakeHK;
  if (parent?.filename?.endsWith("healthBackground.ts")) {
    switch (request) {
      case "react-native":
        return { Platform: { get OS() { return reg.os; } } };
      case "../analytics":
        return { logCrash: () => {} };
      case "../safeNative":
        return { safeRequire: (load: () => unknown) => { try { return load(); } catch { return null; } } };
      case "./health":
        return { getHealthBackgroundBlocker: async () => reg.blocker };
      case "./sourceSync":
        return {
          nightscoutBackgroundWanted: async () => reg.nightscout,
          syncSourcesInBackground: async () => ({ failed: reg.sourcePassFailed }),
        };
      case "./healthAppleKit":
        return {
          healthAppleKit: {
            startBackgroundObserver: async () => { reg.calls.push("ios-observer"); return true; },
            stopBackgroundObserver: async () => { reg.calls.push("ios-stop"); },
          },
        };
      case "./healthConnect":
        return { healthConnect: { requestBackgroundReadPermission: async () => true } };
      case "expo-task-manager":
        return fakeTM;
      case "expo-background-task":
        return fakeBT;
    }
  }
  return realLoad.call(this, request, parent, ...rest);
} as typeof M._load;

async function main(): Promise<void> {
  const { healthAppleKit } = await import("../lib/services/healthAppleKit");
  console.log("zerospike healthBackground smoke test");
  const meta = { recordId: "m-1", version: 7, mealContext: null };

  const c = await healthAppleKit.writeCarbs(42.34, "2026-09-09T12:00:00.000Z", meta);
  eq("carbs uuid", c, "u-1");
  eq("carbs identifier", saved[0]?.identifier, CARBS);
  eq("carbs unit", saved[0]?.unit, "g");
  eq("carbs rounded to 0.1", saved[0]?.value, 42.3);
  eq("carbs sync id", saved[0]?.metadata?.HKMetadataKeySyncIdentifier, "m-1");

  await healthAppleKit.writeInsulin(4.5, "bolus", "2026-09-09T12:00:00.000Z", meta);
  await healthAppleKit.writeInsulin(20, "basal", "2026-09-09T12:00:00.000Z");
  eq("insulin identifier", saved[1]?.identifier, INSULIN);
  eq("insulin unit", saved[1]?.unit, "IU");
  eq("bolus reason 2", saved[1]?.metadata?.HKInsulinDeliveryReason, 2);
  eq("basal reason 1 without sync meta", saved[2]?.metadata?.HKInsulinDeliveryReason, 1);
  eq("user entered without sync meta", saved[2]?.metadata?.HKWasUserEntered, true);

  await healthAppleKit.deleteCarbsBatch(["a", "b"]);
  await healthAppleKit.deleteInsulinBatch(["c"]);
  eq("carbs delete identifier", deleted[0]?.identifier, CARBS);
  eq("insulin delete identifier", deleted[1]?.identifier, INSULIN);

  const summary = await healthAppleKit.readSummary(30);
  eq("own insulin not counted: bolus", summary.insulin?.bolusUnits, 6);
  eq("own insulin not counted: basal", summary.insulin?.basalUnits, 10);
  eq("own insulin not counted: count", summary.insulin?.count, 2);

  let fired = 0;
  const started = await healthAppleKit.startBackgroundObserver(() => { fired++; });
  eq("observer started", started, true);
  eq("background calls", calls.join("|"), "configure:HKQuantityTypeIdentifierBloodGlucose:1|enable:HKQuantityTypeIdentifierBloodGlucose:1|subscribe:HKQuantityTypeIdentifierBloodGlucose");
  observerCb?.({ typeIdentifier: "x" });
  observerCb?.({ typeIdentifier: "x", errorMessage: "boom" });
  eq("callback fires once, error ignored", fired, 1);
  await healthAppleKit.stopBackgroundObserver();
  eq("subscription removed", removed, 1);

  // Registration condition (CGM-E)
  console.log("registration: Health and Nightscout");
  const { planBackground } = await import("../lib/nightscout/background");
  const plan = (platform: string, healthBlocker: string | null, nightscoutWanted: boolean) =>
    JSON.stringify(planBackground({ platform, healthBlocker, nightscoutWanted }));
  eq("android: health ready -> task", plan("android", null, false), '{"androidTask":true,"iosObserver":false}');
  eq("android: health blocked, no nightscout -> nothing", plan("android", "sync_off", false), '{"androidTask":false,"iosObserver":false}');
  eq("android: health blocked, nightscout wanted -> task", plan("android", "sync_off", true), '{"androidTask":true,"iosObserver":false}');
  eq("android: no provider at all, nightscout wanted -> task", plan("android", "no_provider", true), '{"androidTask":true,"iosObserver":false}');
  eq("ios: health ready -> observer only", plan("ios", null, true), '{"androidTask":false,"iosObserver":true}');
  eq("ios: health blocked, nightscout wanted -> still nothing (no BGTask)", plan("ios", "sync_off", true), '{"androidTask":false,"iosObserver":false}');
  eq("web -> nothing", plan("web", null, true), '{"androidTask":false,"iosObserver":false}');

  reg.os = "android";
  const bg = await import("../lib/services/healthBackground");
  eq("android task defined at module scope", typeof reg.taskBody, "function");

  reg.blocker = "sync_off";
  reg.nightscout = false;
  let st = await bg.registerHealthBackground();
  eq("android, health off, no nightscout: inactive", st.active, false);
  eq("android, health off, no nightscout: not registered", reg.calls.includes("register:15"), false);

  reg.nightscout = true;
  st = await bg.registerHealthBackground();
  eq("android, health off, nightscout connected: registered", st.active, true);
  eq("registered with the 15 minute floor", reg.calls.filter((c) => c === "register:15").length, 1);

  reg.nightscout = false;
  st = await bg.registerHealthBackground();
  eq("nightscout disconnected and health off: unregistered", st.active, false);
  eq("unregister called", reg.calls.includes("unregister"), true);

  reg.blocker = null;
  st = await bg.registerHealthBackground();
  eq("android, health ready: registered", st.active, true);

  eq("task body runs the combined pass: success", await reg.taskBody?.(), 1);
  reg.sourcePassFailed = true;
  eq("task body: a failed pass reports Failed", await reg.taskBody?.(), 2);
  reg.sourcePassFailed = false;

  reg.os = "ios";
  reg.calls.length = 0;
  reg.registered = false;
  reg.blocker = "sync_off";
  reg.nightscout = true;
  st = await bg.registerHealthBackground();
  eq("ios, health off, nightscout connected: nothing registered", st.active, false);
  eq("ios: no background task registered, observer not started", reg.calls.filter((c) => c.startsWith("register") || c === "ios-observer").length, 0);
  reg.blocker = null;
  st = await bg.registerHealthBackground();
  eq("ios, health ready: observer started", reg.calls.includes("ios-observer"), true);
  eq("ios never registers a WorkManager style task", reg.calls.some((c) => c.startsWith("register")), false);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.log("fatal", e);
  process.exit(1);
});
