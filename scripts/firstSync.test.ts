/**
 * lib/firstSync.ts harness: in a sensor mode the home guide's first step is the
 * "first sync", not the first manual reading, and it counts as done once a
 * sensor reading has arrived. Also pins the closing card's lines per mode
 * (lib/revealPlan.ts) and the wrapper in lib/services/firstLog.ts.
 * Run: npx tsx scripts/firstSync.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void; cwd: () => string };
declare const __dirname: string;
declare function require(id: string): any;

import {
  firstStepKindOf,
  firstSyncKey,
  isFirstSyncDone,
  noteFirstSync,
  type FirstSyncDeps,
} from "../lib/firstSync";
import { buildRevealPlan } from "../lib/revealPlan";

let passed = 0;
let failed = 0;
function eq(name: string, got: unknown, want: unknown): void {
  if (JSON.stringify(got) === JSON.stringify(want)) passed++;
  else {
    failed++;
    console.log(`  FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}
function ok(name: string, cond: boolean): void {
  eq(name, cond, true);
}

const fs = require("fs") as { readFileSync: (p: string, enc: string) => string };
const nodePath = require("path") as { join: (...p: string[]) => string };
const ROOT = nodePath.join(__dirname, "..");
const src = (rel: string) => fs.readFileSync(nodePath.join(ROOT, rel), "utf8");

type Mode = "manual" | "cgm" | "nightscout";

function rig(mode: Mode, readings: number) {
  const flags = new Set<string>();
  const state = { readings, countCalls: 0, failCount: false, failWrite: false };
  const deps: FirstSyncDeps = {
    readFlag: async (id) => flags.has(id),
    writeFlag: async (id) => {
      if (state.failWrite) throw new Error("write");
      flags.add(id);
    },
    getMode: async () => mode,
    countReadings: async () => {
      state.countCalls++;
      if (state.failCount) throw new Error("count");
      return state.readings;
    },
  };
  return { deps, flags, state };
}

async function main(): Promise<void> {
  console.log("A. which step the home guide leads with");
  eq("manual leads with the first reading", firstStepKindOf("manual"), "log");
  eq("cgm leads with the first sync", firstStepKindOf("cgm"), "sync");
  eq("nightscout leads with the first sync", firstStepKindOf("nightscout"), "sync");
  eq("the flag is per profile", firstSyncKey("p1") !== firstSyncKey("p2"), true);

  console.log("B. first sync is done once a sensor reading has arrived");
  {
    const r = rig("cgm", 0);
    eq("nothing yet: not done", await noteFirstSync("p1", r.deps), false);
    eq("and nothing is remembered", r.flags.size, 0);
    r.state.readings = 3;
    eq("readings arrived: done", await noteFirstSync("p1", r.deps), true);
    eq("and remembered for this profile", r.flags.has("p1"), true);
    eq("the flag alone answers afterwards", await isFirstSyncDone("p1", r.deps), true);
    r.state.readings = 0;
    r.state.countCalls = 0;
    eq("done stays done even if the readings are gone", await noteFirstSync("p1", r.deps), true);
    eq("without counting again", r.state.countCalls, 0);
    eq("another profile is not done", await isFirstSyncDone("p2", r.deps), false);
  }

  console.log("C. manual mode never completes a sync");
  {
    const r = rig("manual", 50);
    eq("manual: not done even with readings", await noteFirstSync("p1", r.deps), false);
    eq("and nothing is written", r.flags.size, 0);
    eq("and nothing is counted", r.state.countCalls, 0);
  }

  console.log("D. nightscout counts too");
  {
    const r = rig("nightscout", 1);
    eq("one reading is enough", await noteFirstSync("p1", r.deps), true);
  }

  console.log("E. failures read as not done");
  {
    const r = rig("cgm", 4);
    r.state.failCount = true;
    eq("a failed count is not done", await noteFirstSync("p1", r.deps), false);
    r.state.failCount = false;
    r.state.failWrite = true;
    eq("a failed write is not done", await noteFirstSync("p1", r.deps), false);
    r.state.failWrite = false;
    eq("and a retry succeeds", await noteFirstSync("p1", r.deps), true);
  }

  console.log("F. the closing card lists the first sync in sensor modes");
  {
    const base = {
      rows: [],
      postMeal: true,
      lowFollowup: true,
      alarmKitAvailable: false,
      alarmAuthorized: false,
    };
    const kinds = (m?: Mode) => buildRevealPlan({ ...base, ...(m ? { cgmMode: m } : {}) }).map((i) => i.kind);
    eq("manual: unchanged", kinds("manual"), ["postMeal", "lowFollowup"]);
    eq("no mode given: unchanged", kinds(), ["postMeal", "lowFollowup"]);
    eq("cgm: the first sync leads", kinds("cgm"), ["firstSync", "postMeal", "lowFollowup"]);
    eq("nightscout: the connection note leads", kinds("nightscout"), ["connectSource", "postMeal", "lowFollowup"]);
    const row = {
      id: "m1",
      type: "med" as const,
      label: null,
      time: "08:00",
      enabled: 1,
      alarm_enabled: 0,
    };
    eq(
      "medication reminders stay listed in a sensor mode",
      buildRevealPlan({ ...base, rows: [row], cgmMode: "cgm" }).map((i) => i.kind),
      ["firstSync", "med", "postMeal", "lowFollowup"]
    );
  }

  console.log("G. the service wrapper");
  {
    const s = src("lib/services/firstLog.ts");
    ok("it re-exports the pure step choice", /firstStepKindOf/.test(s));
    ok("it builds the real deps from the cgm state and counts", /getCgmMode/.test(s) && /countCgmReadingsSince/.test(s));
    ok("the flag lives in AsyncStorage", /AsyncStorage\.setItem\(firstSyncKey/.test(s) || /writeFlag/.test(s));
    ok("the dashboard gets a read and a refresh", /export async function refreshFirstSync\(/.test(s) && /export async function readFirstSyncDone\(/.test(s));
    const count = src("lib/services/firstLog.ts").split("const COUNT_SQL")[1] ?? "";
    ok("first_log's own counts are untouched", !/sync/i.test(count.split("};")[0]));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.log("threw", e);
  process.exit(1);
});
