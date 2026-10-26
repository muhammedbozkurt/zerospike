/**
 * The one-time "switch to CGM mode?" question on the home screen: it is due
 * only while the profile is manual, sensor data was found and no answer was
 * recorded; either answer is stored once, so the question never returns; and
 * accepting emits cgm_mode_set + cgm_offer, declining only cgm_offer.
 * Run: npx tsx scripts/cgmHomeOffer.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import { readFileSync } from "node:fs";
import { join } from "node:path";
import Module from "node:module";

const kv = new Map<string, string>();
const rig = { setFails: false };
const AsyncStorage = {
  getItem: async (k: string) => (kv.has(k) ? kv.get(k)! : null),
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
  const flow = await import("../lib/cgm/offerFlow");
  const events = await import("../lib/cgm/importEvents");

  const found = async () => 40;
  const none = async () => 0;
  const logged: [string, Record<string, string>][] = [];
  const log = (name: string, params: Record<string, string>) => {
    logged.push([name, params]);
  };
  const seen: string[] = [];
  const off = events.subscribeCgmChanges((c) => seen.push(`${c.kind}:${c.profileId}`));

  console.log("A. when the question is due");
  eq("manual + sensor data + unanswered is due", await state.shouldOfferCgmSwitch("p1", { countRecent: found }), true);
  eq("no sensor data is not due", await state.shouldOfferCgmSwitch("p1", { countRecent: none }), false);
  eq("11 readings is below the detection floor", await state.shouldOfferCgmSwitch("p1", { countRecent: async () => 11 }), false);
  eq("a failed count is not due", await state.shouldOfferCgmSwitch("p1", { countRecent: async () => { throw new Error("db"); } }), false);

  console.log("B. accepting");
  await flow.answerCgmOffer("p1", "accepted", { log });
  eq("the profile is now cgm", await state.getCgmMode("p1"), "cgm");
  eq("the answer is recorded", await state.getCgmOfferAnswer("p1"), "accepted");
  eq("both events went out, in order", logged.map(([n, p]) => `${n}:${JSON.stringify(p)}`), [
    'cgm_mode_set:{"mode":"cgm"}',
    'cgm_offer:{"action":"accepted"}',
  ]);
  eq("the mode change is published for the screens", seen, ["mode:p1"]);
  eq("it is never asked again", await state.shouldOfferCgmSwitch("p1", { countRecent: found }), false);

  console.log("C. declining");
  logged.length = 0;
  eq("another profile is still due", await state.shouldOfferCgmSwitch("p2", { countRecent: found }), true);
  await flow.answerCgmOffer("p2", "declined", { log });
  eq("the profile stays manual", await state.getCgmMode("p2"), "manual");
  eq("the answer is recorded", await state.getCgmOfferAnswer("p2"), "declined");
  eq("only the offer event goes out", logged.map(([n, p]) => `${n}:${JSON.stringify(p)}`), ['cgm_offer:{"action":"declined"}']);
  eq("it is never asked again", await state.shouldOfferCgmSwitch("p2", { countRecent: found }), false);
  eq("and fresh sensor data does not bring it back", await state.shouldOfferCgmSwitch("p2", { countRecent: async () => 500 }), false);

  console.log("D. a mode set by hand is never second-guessed");
  await state.setCgmMode("p3", "nightscout");
  eq("an active mode is not offered the switch", await state.shouldOfferCgmSwitch("p3", { countRecent: found }), false);

  console.log("E. a failed write reports nothing and keeps the question");
  logged.length = 0;
  rig.setFails = true;
  let threw = false;
  try {
    await flow.answerCgmOffer("p4", "accepted", { log });
  } catch {
    threw = true;
  }
  rig.setFails = false;
  eq("the failure reaches the caller", threw, true);
  eq("no event is emitted for a switch that did not stick", logged.length, 0);
  eq("the profile is still due", await state.shouldOfferCgmSwitch("p4", { countRecent: found }), true);
  off();

  console.log("F. wiring");
  const root = join(import.meta.dirname, "..");
  const offer = readFileSync(join(root, "components/CgmSwitchOffer.tsx"), "utf8");
  eq("the card answers through answerCgmOffer with the analytics sink", /answerCgmOffer\(profileId, action, \{ log: logEvent \}\)/.test(offer), true);
  eq("the card asks shouldOfferCgmSwitch", /shouldOfferCgmSwitch\(profileId\)/.test(offer), true);
  eq("the card is silent in screenshot mode", /isScreenshotMode\(\)/.test(offer), true);
  const index = readFileSync(join(root, "app/(tabs)/index.tsx"), "utf8");
  eq("the dashboard renders the card", /<CgmSwitchOffer/.test(index), true);

  console.log(`\ncgmHomeOffer: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
