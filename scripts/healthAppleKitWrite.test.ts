/**
 * healthAppleKit write/delete/permission harness. The native module is replaced
 * by a fake whose functions enforce the REAL @kingstinct/react-native-healthkit
 * 14.0.2 signatures (Nitro throws on a wrong argument count), so a call shape
 * that only the dev mock tolerated fails here.
 *
 * Run: npx tsx scripts/healthAppleKitWrite.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import Module from "node:module";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ": " + detail : ""}`);
  }
}
function eq<T>(name: string, actual: T, expected: T): void {
  ok(name, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

const BG = "HKQuantityTypeIdentifierBloodGlucose";
const AuthorizationStatus = { notDetermined: 0, sharingDenied: 1, sharingAuthorized: 2 };

type Saved = {
  identifier: string;
  unit: string;
  value: number;
  start: Date;
  end: Date;
  metadata: Record<string, unknown> | undefined;
};
const saved: Saved[] = [];
const deleted: { identifier: string; filter: unknown }[] = [];
const authRequests: unknown[] = [];
let status = AuthorizationStatus.sharingAuthorized;
let statusAfterRequest: number | null = null;
let requestThrows = false;
let saveReturnsUndefined = false;
let failWhenMetadata = false;
let saveCalls = 0;

function nitroArity(name: string, got: number, min: number, max: number): void {
  if (got < min || got > max) {
    throw new Error(`${name} expected ${min}-${max} arguments, but received ${got}`);
  }
}

interface FakeHK {
  AuthorizationStatus: typeof AuthorizationStatus;
  isHealthDataAvailable: () => boolean;
  authorizationStatusFor: (...args: unknown[]) => number;
  requestAuthorization: (...args: unknown[]) => Promise<boolean>;
  saveQuantitySample: (...args: unknown[]) => Promise<{ uuid: string } | undefined>;
  deleteObjects: (...args: unknown[]) => Promise<number>;
  queryQuantitySamples: (...args: unknown[]) => Promise<unknown[]>;
}

const fakeHK: FakeHK = {
  AuthorizationStatus,
  isHealthDataAvailable: () => true,
  authorizationStatusFor: (...args: unknown[]) => {
    nitroArity("authorizationStatusFor", args.length, 1, 1);
    ok("authorizationStatusFor gets the glucose identifier", args[0] === BG);
    return status;
  },
  requestAuthorization: async (...args: unknown[]) => {
    nitroArity("requestAuthorization", args.length, 1, 1);
    authRequests.push(args[0]);
    if (requestThrows) throw new Error("request failed");
    if (statusAfterRequest !== null) status = statusAfterRequest;
    return true;
  },
  saveQuantitySample: async (...args: unknown[]) => {
    nitroArity("saveQuantitySample", args.length, 5, 6);
    saveCalls++;
    const [identifier, unit, value, start, end, metadata] = args;
    if (typeof identifier !== "string") throw new Error("identifier must be a string");
    if (typeof unit !== "string") throw new Error("unit must be a string");
    if (typeof value !== "number") throw new Error("value must be a number");
    if (!(start instanceof Date) || !(end instanceof Date)) throw new Error("start/end must be Date");
    if (failWhenMetadata && metadata !== undefined) throw new Error("invalid metadata");
    saved.push({ identifier, unit, value, start, end, metadata: metadata as Saved["metadata"] });
    return saveReturnsUndefined ? undefined : { uuid: "hk-uuid-1" };
  },
  deleteObjects: async (...args: unknown[]) => {
    nitroArity("deleteObjects", args.length, 2, 2);
    deleted.push({ identifier: args[0] as string, filter: args[1] });
    return 1;
  },
  queryQuantitySamples: async (...args: unknown[]) => {
    nitroArity("queryQuantitySamples", args.length, 2, 2);
    return [];
  },
};

const M = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
const realLoad = M._load;
M._load = function (request: string, ...rest: unknown[]) {
  if (request === "@kingstinct/react-native-healthkit") return fakeHK;
  return realLoad.call(this, request, ...rest);
};

async function main(): Promise<void> {
  const { healthAppleKit } = await import("../lib/services/healthAppleKit");
  console.log("zerospike healthAppleKit write test");

  console.log("\nA. writeGlucose uses the positional v14 signature");
  {
    const id = await healthAppleKit.writeGlucose(123.4, "2026-09-09T12:00:00.000Z").catch((e) => `THROW:${e.message}`);
    eq("returns the sample uuid", id, "hk-uuid-1");
    eq("one sample saved", saved.length, 1);
    eq("identifier", saved[0]?.identifier, BG);
    eq("unit", saved[0]?.unit, "mg/dL");
    eq("value rounded", saved[0]?.value, 123);
    eq("start", saved[0]?.start.toISOString(), "2026-09-09T12:00:00.000Z");
    eq("end", saved[0]?.end.toISOString(), "2026-09-09T12:00:00.000Z");
  }

  console.log("\nB. deleteGlucose");
  {
    await healthAppleKit.deleteGlucose("hk-uuid-1");
    eq("deleteObjects called once", deleted.length, 1);
    eq("glucose identifier", deleted[0]?.identifier, BG);
    eq("uuid filter", JSON.stringify(deleted[0]?.filter), JSON.stringify({ uuids: ["hk-uuid-1"] }));
  }

  console.log("\nC. readRecentGlucose query shape");
  {
    const out = await healthAppleKit.readRecentGlucose(30, 10).catch(() => null);
    ok("query resolves", Array.isArray(out));
  }

  console.log("\nD. requestWritePermission reflects the real authorization status");
  {
    status = AuthorizationStatus.notDetermined;
    statusAfterRequest = AuthorizationStatus.sharingAuthorized;
    eq("granted -> true", await healthAppleKit.requestWritePermission(), true);
    status = AuthorizationStatus.notDetermined;
    statusAfterRequest = AuthorizationStatus.sharingDenied;
    eq("denied -> false", await healthAppleKit.requestWritePermission(), false);
    eq("request asked for glucose share", JSON.stringify(authRequests[0]), JSON.stringify({ toShare: [BG], toRead: [] }));
  }

  console.log("\nE. hardening");
  {
    saved.length = 0;
    saveReturnsUndefined = true;
    eq("save resolving undefined -> null", await healthAppleKit.writeGlucose(100, "2026-09-09T12:00:00.000Z"), null);
    saveReturnsUndefined = false;

    saveCalls = 0;
    status = AuthorizationStatus.sharingDenied;
    eq("sharingDenied -> null", await healthAppleKit.writeGlucose(100, "2026-09-09T12:00:00.000Z"), null);
    eq("sharingDenied -> save not called", saveCalls, 0);

    status = AuthorizationStatus.sharingAuthorized;
    saveCalls = 0;
    eq("invalid date -> null", await healthAppleKit.writeGlucose(100, "not a date"), null);
    eq("invalid date -> save not called", saveCalls, 0);

    authRequests.length = 0;
    statusAfterRequest = null;
    eq("already authorized -> true", await healthAppleKit.requestWritePermission(), true);

    status = AuthorizationStatus.notDetermined;
    statusAfterRequest = null;
    requestThrows = true;
    eq("requestAuthorization throws -> false", await healthAppleKit.requestWritePermission(), false);
    requestThrows = false;
    status = AuthorizationStatus.sharingAuthorized;
  }

  console.log("\nF. idempotency metadata");
  {
    saved.length = 0;
    const meta = { recordId: "log-1", version: 1760000000000, mealContext: "after_meal" as const };
    const id = await healthAppleKit.writeGlucose(110, "2026-09-09T12:00:00.000Z", meta);
    eq("uuid returned", id, "hk-uuid-1");
    eq("one save", saved.length, 1);
    const md = saved[0]?.metadata;
    eq("sync identifier", md?.HKMetadataKeySyncIdentifier, "log-1");
    eq("sync version", md?.HKMetadataKeySyncVersion, 1760000000000);
    eq("user entered", md?.HKWasUserEntered, true);
    eq("postprandial", md?.HKBloodGlucoseMealTime, 2);

    saved.length = 0;
    await healthAppleKit.writeGlucose(110, "2026-09-09T12:00:00.000Z", { ...meta, mealContext: null });
    eq("no meal time when context unknown", saved[0]?.metadata?.HKBloodGlucoseMealTime, undefined);

    saved.length = 0;
    await healthAppleKit.writeGlucose(110, "2026-09-09T12:00:00.000Z");
    eq("no meta -> no metadata arg", saved[0]?.metadata, undefined);
  }

  console.log("\nG. safety net: a JS-side metadata rejection retries once without it");
  {
    saved.length = 0;
    saveCalls = 0;
    failWhenMetadata = true;
    const meta = { recordId: "log-2", version: 5, mealContext: null };
    const id = await healthAppleKit.writeGlucose(120, "2026-09-09T12:00:00.000Z", meta);
    failWhenMetadata = false;
    eq("write still lands", id, "hk-uuid-1");
    eq("two native calls", saveCalls, 2);
    eq("sample saved without metadata", saved[0]?.metadata, undefined);
    eq("same value", saved[0]?.value, 120);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.log("fatal", e);
  process.exit(1);
});
