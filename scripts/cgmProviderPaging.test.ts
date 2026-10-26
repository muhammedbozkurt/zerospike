/**
 * CGM-A2: the paged glucose reads of the two real providers, against fakes of
 * the native modules that enforce the real call shapes.
 *
 *  - Apple Health: queryQuantitySamplesWithAnchor, unit "mg/dL", uuid ->
 *    externalId, HKWasUserEntered, bundle id, deleted samples, the anchor, a
 *    full page meaning "maybe more", a stale anchor restarting once.
 *  - Health Connect: readRecords with pageToken, record id, dataOrigin,
 *    specimenSource, recordingMethod, mg/dL field only, the time range riding
 *    along with the token.
 *
 * Run: npx tsx scripts/cgmProviderPaging.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import Module from "node:module";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  x ${name}${detail ? ": " + detail : ""}`);
  }
}
function eq<T>(name: string, actual: T, expected: T): void {
  ok(name, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
function section(t: string): void {
  console.log(`\n${t}`);
}

// ── fake HealthKit ────────────────────────────────────────────────────────
interface AnchorCall {
  identifier: unknown;
  options: any;
  argc: number;
}
const anchorCalls: AnchorCall[] = [];
let anchorResponses: any[] = [];
let anchorThrowsOnAnchor = false;

const fakeHK = {
  isHealthDataAvailable: () => true,
  queryQuantitySamplesWithAnchor: async (...args: unknown[]) => {
    anchorCalls.push({ identifier: args[0], options: args[1], argc: args.length });
    if (args.length !== 2) throw new Error("queryQuantitySamplesWithAnchor expects 2 arguments");
    if (anchorThrowsOnAnchor && (args[1] as any).anchor) throw new Error("bad anchor");
    return anchorResponses.shift() ?? { samples: [], deletedSamples: [], newAnchor: "" };
  },
};

// ── fake Health Connect ───────────────────────────────────────────────────
const hcCalls: { type: string; options: any }[] = [];
let hcResponses: any[] = [];
const fakeHC = {
  getSdkStatus: async () => 3,
  initialize: async () => true,
  readRecords: async (type: string, options: any) => {
    hcCalls.push({ type, options });
    return hcResponses.shift() ?? { records: [] };
  },
};

const store = new Map<string, string>();
const AsyncStorage = {
  getItem: async (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: async (k: string, v: string) => void store.set(k, v),
  removeItem: async (k: string) => void store.delete(k),
};

const M = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
const realLoad = M._load;
M._load = function (request: string, ...rest: unknown[]) {
  if (request === "@kingstinct/react-native-healthkit") return fakeHK;
  if (request === "react-native-health-connect") return fakeHC;
  if (request === "@react-native-async-storage/async-storage") return { __esModule: true, default: AsyncStorage };
  return realLoad.call(this, request, ...rest);
};

const hk = (over: Record<string, unknown> = {}) => ({
  uuid: "u-1",
  quantity: 112,
  unit: "mg/dL",
  startDate: new Date("2026-03-01T10:00:00.400Z"),
  endDate: new Date("2026-03-01T10:00:00.400Z"),
  metadata: {},
  sourceRevision: { source: { name: "Sensor App", bundleIdentifier: "com.sensor.a" } },
  ...over,
});

async function main(): Promise<void> {
  const { healthAppleKit } = await import("../lib/services/healthAppleKit");
  const { healthConnect } = await import("../lib/services/healthConnect");
  console.log("zerospike cgm provider paging test");

  section("A. Apple Health: one anchored page");
  {
    anchorCalls.length = 0;
    anchorResponses = [
      {
        samples: [
          hk(),
          hk({ uuid: "u-2", quantity: 22, metadata: { HKWasUserEntered: true } }),
          hk({ uuid: "own", sourceRevision: { source: { name: "zerospike", bundleIdentifier: "com.greeneyeapp.zerospike" } } }),
          hk({ uuid: "u-4", device: { name: "G7", manufacturer: "Dexcom, Inc.", model: "G7" } }),
        ],
        deletedSamples: [{ uuid: "gone-1" }, { uuid: "gone-2" }],
        newAnchor: "anchor-2",
      },
    ];
    const page = await healthAppleKit.readGlucosePage({ windowDays: 90, cursor: "anchor-1", pageSize: 4 });
    const call = anchorCalls[0];
    eq("the blood glucose identifier", call.identifier, "HKQuantityTypeIdentifierBloodGlucose");
    eq("exactly two arguments (Nitro)", call.argc, 2);
    eq("the unit is mg/dL", call.options.unit, "mg/dL");
    eq("the page size is the limit", call.options.limit, 4);
    eq("the stored anchor is sent", call.options.anchor, "anchor-1");
    ok("the window start is about 90 days back", Math.abs(Date.now() - call.options.filter.date.startDate.getTime() - 90 * 86_400_000) < 5000);
    eq("our own write is dropped", page.samples.length, 3);
    eq("the uuid is the external id", page.samples[0].externalId, "u-1");
    eq("the bundle id is the source app", page.samples[0].sourceApp, "com.sensor.a");
    eq("the value is the mg/dL quantity, rounded", page.samples[0].value, 112);
    eq("a sub-30 value stays mg/dL (no mmol guess)", page.samples[1].value, 22);
    eq("HKWasUserEntered marks a typed reading", page.samples[1].userEntered, true);
    eq("others are not typed", page.samples[0].userEntered, false);
    eq("the date is kept to the second", page.samples[0].date, "2026-03-01T10:00:00.000Z");
    ok("the device text carries the maker", (page.samples[2].deviceText ?? "").includes("Dexcom"));
    eq("deleted samples come through", page.deletedIds.join(","), "gone-1,gone-2");
    eq("the new anchor is the cursor", page.cursor, "anchor-2");
    eq("a full page (4 raw samples) means maybe more", page.hasMore, true);
  }

  section("B. Apple Health: end of the data, first read, stale anchor");
  {
    anchorCalls.length = 0;
    anchorResponses = [{ samples: [hk()], deletedSamples: [], newAnchor: "a-9" }];
    const last = await healthAppleKit.readGlucosePage({ windowDays: 90, cursor: null, pageSize: 2000 });
    eq("a short page ends the read", last.hasMore, false);
    eq("no anchor on the first read", anchorCalls[0].options.anchor, undefined);

    anchorCalls.length = 0;
    anchorThrowsOnAnchor = true;
    anchorResponses = [{ samples: [hk()], deletedSamples: [], newAnchor: "fresh" }];
    const healed = await healthAppleKit.readGlucosePage({ windowDays: 90, cursor: "stale", pageSize: 2000 });
    anchorThrowsOnAnchor = false;
    eq("a stale anchor restarts without one", anchorCalls.length, 2);
    eq("and still reads the samples", healed.samples.length, 1);

    const failing = { ...fakeHK };
    anchorResponses = [];
    anchorThrowsOnAnchor = false;
    let threw = false;
    const original = fakeHK.queryQuantitySamplesWithAnchor;
    fakeHK.queryQuantitySamplesWithAnchor = async () => {
      throw new Error("native failure");
    };
    try {
      await healthAppleKit.readGlucosePage({ windowDays: 90, cursor: null, pageSize: 10 });
    } catch {
      threw = true;
    }
    fakeHK.queryQuantitySamplesWithAnchor = original;
    void failing;
    eq("a native failure rejects (an empty page would hide it)", threw, true);
  }

  section("C. Health Connect: pages with a token");
  {
    hcCalls.length = 0;
    hcResponses = [
      {
        records: [
          {
            time: "2026-03-01T10:00:00.400Z",
            level: { inMilligramsPerDeciliter: 118.4, inMillimolesPerLiter: 6.57 },
            specimenSource: 1,
            metadata: { id: "rec-1", dataOrigin: "com.sensor.b", recordingMethod: 2, device: { manufacturer: "Abbott", model: "Libre" } },
          },
          {
            time: "2026-03-01T09:55:00.000Z",
            level: { inMilligramsPerDeciliter: 95 },
            specimenSource: 2,
            metadata: { id: "rec-2", dataOrigin: "com.meter", recordingMethod: 3 },
          },
          {
            time: "2026-03-01T09:50:00.000Z",
            level: { inMilligramsPerDeciliter: 90 },
            specimenSource: 0,
            metadata: { id: "rec-own", dataOrigin: "com.greeneyeapp.zerospike", recordingMethod: 3 },
          },
        ],
        pageToken: "tok-2",
      },
      { records: [{ time: "2026-03-01T09:40:00.000Z", level: { inMilligramsPerDeciliter: 100 }, specimenSource: 0, metadata: { id: "rec-3", dataOrigin: "com.sensor.b" } }] },
    ];
    const first = await healthConnect.readGlucosePage({ windowDays: 30, cursor: null, pageSize: 1000 });
    eq("BloodGlucose is read", hcCalls[0].type, "BloodGlucose");
    eq("newest first", hcCalls[0].options.ascendingOrder, false);
    eq("page size", hcCalls[0].options.pageSize, 1000);
    eq("no token on the first call", hcCalls[0].options.pageToken, undefined);
    eq("our own package is dropped", first.samples.length, 2);
    eq("the record id is the external id", first.samples[0].externalId, "rec-1");
    eq("dataOrigin is the source app", first.samples[0].sourceApp, "com.sensor.b");
    eq("the mg/dL field is used as is", first.samples[0].value, 118);
    eq("specimen source rides along", first.samples[0].specimenSource, 1);
    eq("recording method rides along", first.samples[0].recordingMethod, 2);
    eq("MANUAL_ENTRY marks a typed reading", first.samples[1].userEntered, true);
    eq("an automatic one is not typed", first.samples[0].userEntered, false);
    ok("the device text carries maker and model", (first.samples[0].deviceText ?? "").includes("Libre"));
    eq("a token means more", first.hasMore, true);
    ok("the cursor carries the token", (first.cursor ?? "").includes("tok-2"));

    const second = await healthConnect.readGlucosePage({ windowDays: 30, cursor: first.cursor, pageSize: 1000 });
    eq("the token goes back", hcCalls[1].options.pageToken, "tok-2");
    eq("with the SAME time range", JSON.stringify(hcCalls[1].options.timeRangeFilter), JSON.stringify(hcCalls[0].options.timeRangeFilter));
    eq("the last page has no token", second.hasMore, false);
    eq("and no cursor", second.cursor, null);
  }

  section("D. Health Connect: a bare array and a repeated token end the read");
  {
    hcCalls.length = 0;
    hcResponses = [[{ time: "2026-03-01T09:40:00.000Z", level: { inMilligramsPerDeciliter: 100 }, metadata: { id: "x" } }]];
    const arr = await healthConnect.readGlucosePage({ windowDays: 30, cursor: null, pageSize: 10 });
    eq("an array result is one page", arr.samples.length, 1);
    eq("and the end", arr.hasMore, false);
    hcResponses = [{ records: [{ time: "2026-03-01T09:40:00.000Z", level: { inMilligramsPerDeciliter: 100 }, metadata: { id: "y" } }], pageToken: "same" }];
    const cursor = JSON.stringify({ token: "same", startTime: "2026-02-01T00:00:00.000Z", endTime: "2026-03-01T00:00:00.000Z" });
    const stuck = await healthConnect.readGlucosePage({ windowDays: 30, cursor, pageSize: 10 });
    eq("a token that did not advance ends the read", stuck.hasMore, false);
    const legacy = await healthConnect.readRecentGlucose(30, 5).catch(() => null);
    ok("the one-shot read still resolves", Array.isArray(legacy));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.log("test crashed", e);
  process.exit(1);
});
