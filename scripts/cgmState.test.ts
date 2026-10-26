/**
 * lib/cgm/state.ts harness: manual is the default and nothing but the user
 * changes it; finding sensor data only makes the one-time question available;
 * the answer is recorded once.
 * Run: npx tsx scripts/cgmState.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import Module from "node:module";
import { DatabaseSync } from "node:sqlite";

import { V29_COLUMNS, V29_INDEXES } from "../lib/db/v29Sql";

const kv = new Map<string, string>();
const rig = { getFails: false, setFails: false };
const AsyncStorage = {
  getItem: async (k: string) => {
    if (rig.getFails) throw new Error("read failed");
    return kv.has(k) ? kv.get(k)! : null;
  },
  setItem: async (k: string, v: string) => {
    if (rig.setFails) throw new Error("write failed");
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

async function main(): Promise<void> {
  const state = await import("../lib/cgm/state");
  const events = await import("../lib/cgm/importEvents");
  const sql = await import("../lib/db/cgmSql");

  console.log("A. manual is the default");
  eq("nothing stored reads manual", await state.getCgmMode("p1"), "manual");
  eq("garbage reads manual", state.parseCgmMode("auto"), "manual");
  eq("a read error reads manual", await (async () => { rig.getFails = true; const m = await state.getCgmMode("p1"); rig.getFails = false; return m; })(), "manual");
  eq("manual is not a sensor mode", state.isCgmModeActive("manual"), false);
  eq("cgm is", state.isCgmModeActive("cgm"), true);
  eq("nightscout is", state.isCgmModeActive("nightscout"), true);

  console.log("B. only the user sets the mode, per profile");
  const seen: string[] = [];
  const off = events.subscribeCgmChanges((c) => seen.push(`${c.kind}:${c.profileId}`));
  await state.setCgmMode("p1", "cgm");
  eq("p1 is cgm", await state.getCgmMode("p1"), "cgm");
  eq("p2 is untouched", await state.getCgmMode("p2"), "manual");
  eq("a mode change is published", seen, ["mode:p1"]);
  await state.setCgmMode("p1", "manual");
  eq("back to manual", await state.getCgmMode("p1"), "manual");
  rig.setFails = true;
  let threw = false;
  try {
    await state.setCgmMode("p1", "cgm");
  } catch {
    threw = true;
  }
  rig.setFails = false;
  eq("a failed write reaches the caller", threw, true);
  eq("and the mode did not move", await state.getCgmMode("p1"), "manual");
  off();

  console.log("C. detection never changes the mode");
  {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE sugar_logs (id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, glucose_level_mgdl INTEGER, source TEXT, logged_at TEXT NOT NULL);");
    for (const c of V29_COLUMNS) db.exec(`ALTER TABLE sugar_logs ADD COLUMN ${c.name} ${c.type};`);
    for (const s of V29_INDEXES) db.exec(s);
    const NOW = Date.parse("2026-10-27T12:00:00.000Z");
    const ins = db.prepare("INSERT INTO sugar_logs (id, profile_id, glucose_level_mgdl, source, logged_at, is_cgm) VALUES (?, ?, 110, 'health', ?, 1);");
    for (let i = 0; i < 11; i++) ins.run(`a${i}`, "p1", new Date(NOW - i * 300000).toISOString());
    const count = (profileId: string) => Promise.resolve((db.prepare(sql.CGM_COUNT_SINCE_SQL).get(profileId, sql.cgmWindowStartIso(NOW)) as { c: number }).c);
    eq("11 readings in 24 hours is not detected", await state.shouldOfferCgmSwitch("p1", { countRecent: count }), false);
    ins.run("a11", "p1", new Date(NOW - 11 * 300000).toISOString());
    eq("12 readings is detected", await state.shouldOfferCgmSwitch("p1", { countRecent: count }), true);
    eq("detecting changed nothing: still manual", await state.getCgmMode("p1"), "manual");
    ins.run("old", "p2", new Date(NOW - 30 * 3600000).toISOString());
    eq("readings older than 24 hours do not count", await count("p2"), 0);
    const plan = (db.prepare("EXPLAIN QUERY PLAN " + sql.CGM_COUNT_SINCE_SQL).all("p1", "x") as { detail: string }[]).map((r) => r.detail).join(" ");
    eq("the count reads idx_sugar_cgm", plan.includes("idx_sugar_cgm"), true);
    db.close();

    console.log("D. the question is asked once");
    const yes = () => Promise.resolve(40);
    const no = () => Promise.resolve(0);
    eq("detected + manual + unanswered: offered", await state.shouldOfferCgmSwitch("q1", { countRecent: yes }), true);
    eq("nothing detected: not offered", await state.shouldOfferCgmSwitch("q1", { countRecent: no }), false);
    eq("a failing count is not an offer", await state.shouldOfferCgmSwitch("q1", { countRecent: () => Promise.reject(new Error("db")) }), false);
    await state.markCgmOfferShown("q1", "declined");
    eq("after declining it never comes back", await state.shouldOfferCgmSwitch("q1", { countRecent: yes }), false);
    eq("declining left the profile manual", await state.getCgmMode("q1"), "manual");
    eq("the answer is recorded", await state.getCgmOfferAnswer("q1"), "declined");

    eq("a second profile is asked on its own", await state.shouldOfferCgmSwitch("q2", { countRecent: yes }), true);
    await state.markCgmOfferShown("q2", "accepted");
    eq("accepting records it", await state.getCgmOfferAnswer("q2"), "accepted");
    eq("accepting moves the profile to cgm", await state.getCgmMode("q2"), "cgm");
    eq("an accepted profile is not asked again", await state.shouldOfferCgmSwitch("q2", { countRecent: yes }), false);

    await state.setCgmMode("q3", "nightscout");
    eq("a profile already on a sensor mode is not asked", await state.shouldOfferCgmSwitch("q3", { countRecent: yes }), false);
    eq("offerIsDue needs all three", [
      state.offerIsDue({ detected: true, mode: "manual", answered: false }),
      state.offerIsDue({ detected: false, mode: "manual", answered: false }),
      state.offerIsDue({ detected: true, mode: "cgm", answered: false }),
      state.offerIsDue({ detected: true, mode: "manual", answered: true }),
    ], [true, false, false, false]);
  }

  console.log("E. keys are profile scoped and registered");
  eq("mode key", state.cgmModeKey("p1"), "zerospike.cgmMode.p1");
  eq("offer key", state.cgmOfferKey("p1"), "zerospike.cgmOffer.p1");
  const keys = await import("../lib/profileScopedKeys");
  const bases = keys.PROFILE_SCOPED_KEY_BASES as readonly string[];
  eq("both bases are in the profile sweep", bases.includes(state.CGM_MODE_KEY) && bases.includes(state.CGM_OFFER_KEY), true);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
