/**
 * G253-FIX-A, health side (A-1, A-2, A-7): who may import and how far back,
 * the silent open-time run never raising a permission sheet, and the Health
 * switch being saved only after the grant. Real lib/services/health.ts and
 * lib/healthConnectFlow.ts through the shared fakes.
 *
 * Run: npx tsx scripts/g253FixAHealth.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
import { eq, fake, finish, kv, ok, provider, resetAll, rows, section } from "./healthTestHarness";

const BASE = Date.now() - 3 * 3_600_000;
const sample = (minutes: number, mgdl: number, id: string) => ({
  value: mgdl,
  date: new Date(BASE + minutes * 60_000).toISOString(),
  period_tag: "unset",
  externalId: id,
  sourceApp: "com.sensor.a",
  deviceText: null,
  userEntered: false,
});

async function main(): Promise<void> {
  const S = await import("../lib/services/health");
  const policy = await import("../lib/cgm/importPolicy");
  const { connectHealthSync } = await import("../lib/cgm/connectSync");
  const { createHealthFlow, realClock } = await import("../lib/healthConnectFlow");
  console.log("zerospike G253 fix A health test");

  const asked: { windowDays: number; cursor: string | null }[] = [];
  const realPage = provider.readGlucosePage;
  provider.readGlucosePage = async (req: { cursor: string | null; pageSize: number; windowDays?: number }) => {
    asked.push({ windowDays: req.windowDays ?? -1, cursor: req.cursor });
    return realPage(req);
  };

  section("A-1. who may import");
  eq("Pro: full", policy.healthImportPlan({ isPro: true, mode: "manual" }), "full");
  eq("Pro in CGM mode: full", policy.healthImportPlan({ isPro: true, mode: "cgm" }), "full");
  eq("free in CGM mode: the 24 hour import", policy.healthImportPlan({ isPro: false, mode: "cgm" }), "free24h");
  eq("free, manual: none", policy.healthImportPlan({ isPro: false, mode: "manual" }), "none");
  eq("free, Nightscout: none (it is a Pro source)", policy.healthImportAllowed({ isPro: false, mode: "nightscout" }), false);
  eq("the free span is one day", policy.FREE_IMPORT_WINDOW_DAYS, 1);

  section("A-1. the free import reads one day and keeps the anchor free");
  resetAll("ios");
  fake.glucose = [sample(0, 120, "a"), sample(5, 125, "b"), sample(10, 130, "c")];
  asked.length = 0;
  const free = await S.importHealthGlucose("P", "foreground", { freeWindow: true });
  eq("free import ok", free.status, "ok");
  eq("rows came in", rows.sugar.length, 3);
  eq("asked for a 1 day window", asked[0]?.windowDays, 1);
  eq("started without an anchor", asked[0]?.cursor, null);
  ok("no sync anchor was saved", ![...kv.keys()].some((k) => k.startsWith("zerospike.healthHkAnchor")));

  section("A-1. the Pro import after it still reads the full window");
  asked.length = 0;
  const pro = await S.importHealthGlucose("P", "manual");
  eq("pro import ok", pro.status, "ok");
  eq("asked for the 90 day iOS window", asked[0]?.windowDays, 90);
  eq("first Pro read has no anchor", asked[0]?.cursor, null);
  ok("the Pro import saves its anchor", [...kv.keys()].some((k) => k.startsWith("zerospike.healthHkAnchor")));

  section("A-1. Android: the free window is one day, Pro is thirty");
  resetAll("android");
  fake.glucose = [sample(0, 118, "x")];
  asked.length = 0;
  await S.importHealthGlucose("P", "foreground", { freeWindow: true });
  eq("android free: 1 day", asked[0]?.windowDays, 1);
  asked.length = 0;
  await S.importHealthGlucose("P", "manual");
  eq("android Pro: 30 days", asked[0]?.windowDays, 30);

  section("A-7. the silent run never raises the system sheet");
  resetAll("android");
  fake.readGranted = false;
  const silent = await S.importHealthGlucose("P", "foreground");
  eq("open-time run without a grant is denied", silent.status, "denied");
  eq("and asked for nothing", fake.requestReadCalls, 0);
  const tap = await S.importHealthGlucose("P", "manual");
  eq("a tap does ask", fake.requestReadCalls, 1);
  ok("tap result is a status", typeof tap.status === "string");

  section("A-7. the switch is saved only after the grant");
  const flow = () => createHealthFlow({ isBlocked: () => false, clock: realClock });
  const flagLog: boolean[] = [];
  const run = (grant: boolean) =>
    connectHealthSync(flow(), {
      setBusy: () => {},
      request: async () => ({ read: grant }),
      writeFlag: async (on) => void flagLog.push(on),
      importNow: async () => ({ status: "ok", inserted: 0, read: 0 }),
      onDenied: async () => {},
      onDone: async () => {},
    });
  eq("denied result", await run(false), "denied");
  eq("a refusal never writes the switch on", flagLog.includes(true), false);
  eq("a refusal clears it", flagLog.join(","), "false");
  flagLog.length = 0;
  eq("granted result", await run(true), "done");
  eq("a grant writes it on", flagLog.join(","), "true");

  // A request still open when the person switches off (or the run is superseded)
  // must not leave the switch on behind them.
  flagLog.length = 0;
  const f = flow();
  let release: (v: { read: boolean }) => void = () => {};
  const pending = connectHealthSync(f, {
    setBusy: () => {},
    request: () => new Promise((res) => (release = res)),
    writeFlag: async (on) => void flagLog.push(on),
    importNow: async () => null,
    onDenied: async () => {},
    onDone: async () => {},
  });
  await new Promise((r) => setTimeout(r, 1300));
  f.cancel();
  release({ read: true });
  await pending;
  eq("a cancelled run writes nothing", flagLog.length, 0);

  finish();
}

void main();
