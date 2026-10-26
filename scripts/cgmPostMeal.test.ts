/**
 * lib/cgm/postMealLink.ts harness: in CGM mode the 2-hour value comes from the
 * sensor readings. The reading nearest the target within 15 minutes is taken;
 * until one exists the link waits, and a later import completes it. In manual
 * mode nothing here does anything.
 * Run: npx tsx scripts/cgmPostMeal.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import Module from "node:module";
import { DatabaseSync } from "node:sqlite";

import { V29_COLUMNS, V29_INDEXES } from "../lib/db/v29Sql";

const kv = new Map<string, string>();
const AsyncStorage = {
  getItem: async (k: string) => (kv.has(k) ? kv.get(k)! : null),
  setItem: async (k: string, v: string) => {
    kv.set(k, v);
  },
  removeItem: async (k: string) => {
    kv.delete(k);
  },
};
const M = Module as unknown as { _load: (...a: unknown[]) => unknown };
const realLoad = M._load;
M._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "@react-native-async-storage/async-storage") {
    return { __esModule: true, default: AsyncStorage };
  }
  return realLoad.call(this, request, ...rest);
};

let passed = 0;
let failed = 0;
function eq(name: string, got: unknown, want: unknown): void {
  if (JSON.stringify(got) === JSON.stringify(want)) passed++;
  else {
    failed++;
    console.log(`  FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

const MIN = 60_000;
const TARGET = Date.parse("2026-10-27T14:00:00.000Z");
const START = TARGET - 120 * MIN;
const iso = (ms: number) => new Date(ms).toISOString();
const reading = (id: string, offsetMin: number, value = 120) => ({
  id,
  logged_at: iso(TARGET + offsetMin * MIN),
  glucose_level_mgdl: value,
});

async function main(): Promise<void> {
  const link = await import("../lib/cgm/postMealLink");
  const state = await import("../lib/cgm/state");

  console.log("A. the reading nearest the target within 15 minutes");
  eq(
    "nearest wins",
    link.pickPostMealReading(TARGET, [reading("a", -10), reading("b", 4), reading("c", 20)])?.id,
    "b"
  );
  eq("outside 15 minutes is nothing", link.pickPostMealReading(TARGET, [reading("a", -16), reading("b", 16)]), null);
  eq("exactly 15 minutes counts", link.pickPostMealReading(TARGET, [reading("a", -15)])?.id, "a");
  eq("a tie takes the earlier reading", link.pickPostMealReading(TARGET, [reading("late", 5), reading("early", -5)])?.id, "early");
  eq("no readings is nothing", link.pickPostMealReading(TARGET, []), null);
  eq("an unreadable timestamp is skipped", link.pickPostMealReading(TARGET, [{ id: "x", logged_at: "nope", glucose_level_mgdl: 99 }, reading("ok", 3)])?.id, "ok");

  console.log("B. the outcome waits for the window to close");
  const pend = { startedAt: START, targetAt: TARGET };
  eq(
    "before the window closes it waits even with a reading",
    link.evaluatePostMealLink(pend, [reading("a", 0)], TARGET + 14 * MIN).kind,
    "pending"
  );
  eq(
    "once the window closed the nearest reading matches",
    link.evaluatePostMealLink(pend, [reading("a", 9), reading("b", -2)], TARGET + 15 * MIN).kind,
    "matched"
  );
  eq(
    "no reading yet: still waiting",
    link.evaluatePostMealLink(pend, [], TARGET + 40 * MIN).kind,
    "pending"
  );
  eq(
    "no reading after a day: expired",
    link.evaluatePostMealLink(pend, [], TARGET + 25 * 60 * MIN).kind,
    "expired"
  );
  eq(
    "a reading beats expiry",
    link.evaluatePostMealLink(pend, [reading("a", 1)], TARGET + 25 * 60 * MIN).kind,
    "matched"
  );

  console.log("C. delayed import completes the link, manual mode does nothing");
  const applied: string[] = [];
  let stored: ReturnType<typeof reading>[] = [];
  const deps = (nowMode: "manual" | "cgm") => ({
    getMode: async () => nowMode,
    readReadings: async () => stored,
    applyLink: async (_profileId: string, r: { id: string }) => {
      applied.push(r.id);
    },
  });
  await link.addPendingLink("p1", pend);
  await link.addPendingLink("p1", pend);
  eq("adding the same start twice keeps one entry", (await link.listPendingLinks("p1")).length, 1);
  eq("manual mode: nothing applied", (await link.resolvePendingPostMealLinks("p1", TARGET + 30 * MIN, deps("manual"))), 0);
  eq("manual mode keeps the entry", (await link.listPendingLinks("p1")).length, 1);
  eq("cgm, no data yet: nothing applied", await link.resolvePendingPostMealLinks("p1", TARGET + 30 * MIN, deps("cgm")), 0);
  eq("and the entry waits", (await link.listPendingLinks("p1")).length, 1);
  stored = [reading("r1", -12, 150), reading("r2", 3, 140)];
  eq("data arrives later: one link made", await link.resolvePendingPostMealLinks("p1", TARGET + 200 * MIN, deps("cgm")), 1);
  eq("the nearest reading was linked", applied, ["r2"]);
  eq("and the entry is gone", (await link.listPendingLinks("p1")).length, 0);
  eq("running it again links nothing more", await link.resolvePendingPostMealLinks("p1", TARGET + 210 * MIN, deps("cgm")), 0);

  console.log("D. entries are per profile and can be withdrawn");
  await link.addPendingLink("p1", pend);
  await link.addPendingLink("p2", { startedAt: START + MIN, targetAt: TARGET + MIN });
  eq("p2 does not see p1's entry", (await link.listPendingLinks("p2")).map((l) => l.startedAt), [START + MIN]);
  await link.removePendingLink("p1", START);
  eq("withdrawn", (await link.listPendingLinks("p1")).length, 0);
  eq("p2 untouched", (await link.listPendingLinks("p2")).length, 1);
  kv.set(link.postMealLinkKey("p3"), "{broken");
  eq("a corrupt store reads empty", (await link.listPendingLinks("p3")).length, 0);
  eq("the key is profile scoped", link.postMealLinkKey("p1"), "zerospike.cgmPostMealPending.p1");
  const keys = await import("../lib/profileScopedKeys");
  eq("registered in the profile sweep", (keys.PROFILE_SCOPED_KEY_BASES as readonly string[]).includes(link.POST_MEAL_LINK_KEY), true);

  console.log("E. expired entries are dropped when resolving");
  await link.addPendingLink("p4", pend);
  stored = [];
  eq("nothing linked", await link.resolvePendingPostMealLinks("p4", TARGET + 26 * 60 * MIN, deps("cgm")), 0);
  eq("the stale entry was pruned", (await link.listPendingLinks("p4")).length, 0);
  eq("mode helper agrees with state", state.isCgmModeActive("cgm"), true);

  console.log("F. the real SQL");
  {
    const db = new DatabaseSync(":memory:");
    db.exec(
      "CREATE TABLE sugar_logs (id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, glucose_level_mgdl INTEGER, period_tag TEXT, source TEXT, logged_at TEXT NOT NULL);"
    );
    for (const c of V29_COLUMNS) db.exec(`ALTER TABLE sugar_logs ADD COLUMN ${c.name} ${c.type};`);
    for (const s of V29_INDEXES) db.exec(s);
    const ins = db.prepare(
      "INSERT INTO sugar_logs (id, profile_id, glucose_level_mgdl, period_tag, source, logged_at, is_cgm) VALUES (?, ?, ?, ?, ?, ?, ?);"
    );
    ins.run("in1", "p1", 130, "unset", "health", iso(TARGET - 14 * MIN), 1);
    ins.run("in2", "p1", 135, "unset", "health", iso(TARGET + 15 * MIN), 1);
    ins.run("outEarly", "p1", 120, "unset", "health", iso(TARGET - 16 * MIN), 1);
    ins.run("manual", "p1", 118, "manual", "manual", iso(TARGET + 1 * MIN), 0);
    ins.run("other", "p2", 140, "unset", "health", iso(TARGET), 1);
    const rows = db
      .prepare(link.POST_MEAL_READINGS_SQL)
      .all("p1", iso(TARGET - 15 * MIN), iso(TARGET + 15 * MIN)) as { id: string }[];
    eq("only this profile's sensor readings inside the window", rows.map((r) => r.id), ["in1", "in2"]);
    const plan = (db.prepare("EXPLAIN QUERY PLAN " + link.POST_MEAL_READINGS_SQL).all("p1", "a", "b") as { detail: string }[])
      .map((r) => r.detail)
      .join(" ");
    eq("the lookup reads idx_sugar_cgm", plan.includes("idx_sugar_cgm"), true);

    db.prepare(link.POST_MEAL_TAG_SQL).run("in1", "p1");
    db.prepare(link.POST_MEAL_TAG_SQL).run("manual", "p1");
    db.prepare(link.POST_MEAL_TAG_SQL).run("other", "p1");
    const tag = (id: string) => (db.prepare("SELECT period_tag AS t FROM sugar_logs WHERE id = ?").get(id) as { t: string }).t;
    eq("an unset sensor reading becomes the 2-hour value", tag("in1"), "post_meal_2h");
    eq("a tag the user chose is left alone", tag("manual"), "manual");
    eq("another profile's reading is left alone", tag("other"), "unset");
    db.close();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
