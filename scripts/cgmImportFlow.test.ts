/**
 * CGM-A2: the Health sync loop in lib/services/health.ts, driven through the
 * shared fakes (scripts/healthTestHarness.ts): paging, the anchor, sensor
 * marking, thinning across pages, deletes the source reported, and an
 * interrupted read.
 *
 * Run: npx tsx scripts/cgmImportFlow.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (c: number) => void };
import { eq, fake, finish, kv, ok, resetAll, rows, section } from "./healthTestHarness";

const BASE = Date.now() - 3 * 86_400_000;
const at = (minutes: number) => new Date(Math.floor(BASE / 60_000) * 60_000 + minutes * 60_000).toISOString();
const sensor = (minutes: number, mgdl: number, id: string, extra: Record<string, unknown> = {}) => ({
  value: mgdl,
  date: at(minutes),
  period_tag: "unset",
  externalId: id,
  sourceApp: "com.sensor.a",
  deviceText: null,
  userEntered: false,
  ...extra,
});
const mine = () => rows.sugar.filter((r) => r.profile_id === "P");

async function main(): Promise<void> {
  const S = await import("../lib/services/health");
  console.log("zerospike cgm import flow test");

  section("A. a 1 minute sensor backfill is read in pages and thinned");
  {
    resetAll("ios");
    fake.glucose = Array.from({ length: 5000 }, (_, i) => sensor(i, 100 + (i % 40), `s-${i}`));
    const r = await S.importHealthGlucose("P", "manual");
    eq("status ok", r.status, "ok");
    eq("three pages of 2000, 2000 and 1000", fake.pages.join(","), "2000,2000,1000");
    eq("all 5000 samples were read", r.read, 5000);
    const stored = mine();
    ok("about a fifth is stored (5 minute spacing)", stored.length >= 995 && stored.length <= 1005, String(stored.length));
    ok("every row is marked as a sensor reading", stored.every((x) => x.is_cgm === 1));
    ok("with the app and the id", stored.every((x) => x.source_app === "com.sensor.a" && !!x.external_id));
    const times = stored.map((x) => Date.parse(x.logged_at)).sort((a, b) => a - b);
    ok("neighbours are at least 270 s apart, also across page borders", times.every((t, i) => i === 0 || t - times[i - 1] >= 270_000));
    eq("the anchor is the last page's cursor", kv.get("zerospike.healthHkAnchor.P"), "5000");
    eq("a second sync reads only what is new", (await S.importHealthGlucose("P", "manual")).inserted, 0);
    eq("it asked from the anchor (nothing left)", fake.pages[fake.pages.length - 1], 0);
  }

  section("B. a hand-typed Health reading and a meter are not sensor readings");
  {
    resetAll("ios");
    const cadence = Array.from({ length: 60 }, (_, i) => sensor(i * 5, 100 + (i % 20), `c-${i}`));
    const typed = sensor(152, 111, "typed-1", { userEntered: true });
    const meter = [0, 120, 240].map((m, i) => ({
      value: 130 + i * 7,
      date: at(1000 + m),
      period_tag: "unset",
      externalId: `m-${i}`,
      sourceApp: "com.meter",
      userEntered: false,
    }));
    fake.glucose = [...cadence, typed, ...meter];
    await S.importHealthGlucose("P", "manual");
    const typedRow = rows.sugar.find((x) => x.external_id === "typed-1");
    ok("the typed reading in a sensor's app is stored", !!typedRow);
    eq("but not marked as a sensor reading", typedRow?.is_cgm, 0);
    const meterRows = rows.sugar.filter((x) => x.source_app === "com.meter");
    eq("a meter's three readings are stored", meterRows.length, 3);
    ok("and are not sensor readings", meterRows.every((x) => x.is_cgm === 0));
    ok("their time is snapped to the minute", meterRows.every((x) => x.logged_at.endsWith(":00.000Z")));
    eq("the sensor stream is marked", rows.sugar.filter((x) => x.is_cgm === 1).length, 60);
  }

  section("C. a thin first sync is judged with what the app already delivered");
  {
    resetAll("ios");
    fake.glucose = Array.from({ length: 8 }, (_, i) => sensor(i * 5, 100 + i, `a-${i}`));
    await S.importHealthGlucose("P", "manual");
    eq("8 readings are not enough: not a sensor yet", rows.sugar.filter((x) => x.is_cgm === 1).length, 0);
    kv.delete("zerospike.healthHkAnchor.P");
    fake.glucose = Array.from({ length: 38 }, (_, i) => sensor(i * 5, 100 + (i % 9), `a-${i}`));
    await S.importHealthGlucose("P", "manual");
    ok("38 within the day: the stream qualifies", rows.sugar.filter((x) => x.is_cgm === 1).length >= 30);
    const lateBefore = rows.sugar.length;
    kv.delete("zerospike.healthHkAnchor.P");
    fake.glucose = [sensor(38 * 5 + 300, 120, "after-change")];
    await S.importHealthGlucose("P", "manual");
    eq("one later reading", rows.sugar.length, lateBefore + 1);
    eq("is still a sensor reading (the source is known)", rows.sugar[rows.sugar.length - 1].is_cgm, 1);
  }

  section("D. a read that fails on page two keeps page one and its anchor");
  {
    resetAll("ios");
    fake.glucose = Array.from({ length: 4500 }, (_, i) => sensor(i * 5, 100 + (i % 40), `p-${i}`));
    fake.failPage = 2;
    const r = await S.importHealthGlucose("P", "manual");
    eq("status error", r.status, "error");
    ok("page one was imported", r.inserted > 0 && mine().length === r.inserted, `${r.inserted}/${mine().length}`);
    eq("the anchor stops after page one", kv.get("zerospike.healthHkAnchor.P"), "2000");
    fake.failPage = null;
    fake.pages.length = 0;
    const again = await S.importHealthGlucose("P", "manual");
    eq("the next sync continues from the anchor", again.status, "ok");
    eq("with 2500 samples left", again.read, 2500);
    eq("all 4500 readings are stored once", mine().length, 4500);
  }

  section("E. what the source deleted leaves, but only its own imported rows");
  {
    resetAll("ios");
    rows.sugar.push(
      { profile_id: "P", glucose_level_mgdl: 100, logged_at: at(-600), source: "health", source_app: "com.sensor.a", external_id: "gone", is_cgm: 1 },
      { profile_id: "P", glucose_level_mgdl: 101, logged_at: at(-590), source: "manual", source_app: null, external_id: "gone", is_cgm: 0 },
      { profile_id: "Q", glucose_level_mgdl: 102, logged_at: at(-580), source: "health", source_app: "com.sensor.a", external_id: "gone", is_cgm: 1 }
    );
    fake.deletedIds = ["gone"];
    fake.glucose = [];
    await S.importHealthGlucose("P", "manual");
    eq("P's imported row is gone", rows.sugar.filter((x) => x.profile_id === "P" && x.source === "health").length, 0);
    eq("P's typed row with the same id stays", rows.sugar.filter((x) => x.profile_id === "P" && x.source === "manual").length, 1);
    eq("another profile is untouched", rows.sugar.filter((x) => x.profile_id === "Q").length, 1);
  }

  section("F. Android: no anchor, the window is re-read, deletions come from the change feed");
  {
    resetAll("android");
    kv.set("zerospike.cgmSync.P", "true");
    await S.setHealthBackgroundEntitled(true);
    fake.glucose = Array.from({ length: 3 }, (_, i) => sensor(i * 5, 100 + i, `h-${i}`));
    const first = await S.syncHealthInBackground();
    eq("the background pass imports", first.result?.inserted, 3);
    eq("no anchor is stored on Android", kv.get("zerospike.healthHkAnchor.P"), undefined);
    fake.deletedIds = ["h-1"];
    fake.glucose = fake.glucose.filter((g) => g.externalId !== "h-1");
    const second = await S.syncHealthInBackground();
    eq("the pass runs", second.ran, true);
    eq("a record deleted in Health Connect leaves with its import", mine().filter((x) => x.external_id === "h-1").length, 0);
    eq("and the token is committed after the pass", fake.commits, 2);
  }

  finish();
}

void ok;
main().catch((e) => {
  console.log("fatal", e);
  process.exit(1);
});
