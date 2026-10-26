/**
 * G25: emergency contacts storage must not hide failures.
 *
 *   - getItem throws: the strict reader throws (never an empty list that a
 *     later write would turn into data loss); the SOS reader still degrades
 *     to an empty list so that screen keeps working
 *   - setItem throws: the error reaches the caller
 *   - the screen blocks writes while the list is unreadable, writes before it
 *     updates its state, and does not start a second write mid-flight
 *
 * Run: npx sucrase-node scripts/emergencyStorage.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };
declare const require: any;
declare const __dirname: string;

import { readFileSync } from "node:fs";
import { join } from "node:path";

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
  ok(name, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

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
};

const Module = require("module");
const realLoad = Module._load;
Module._load = function (request: string) {
  if (request === "@react-native-async-storage/async-storage") {
    return { __esModule: true, default: AsyncStorage };
  }
  return realLoad.apply(this, arguments);
};

async function rejects(p: Promise<unknown>): Promise<boolean> {
  try {
    await p;
    return false;
  } catch {
    return true;
  }
}

async function main(): Promise<void> {
  const em = require("../lib/services/emergency");
  const contacts = [{ name: "Anne", phone: "+905321112233" }];

  console.log("\nstorage");
  await em.setEmergencyContacts(contacts);
  eq("round trip", await em.getEmergencyContacts(), contacts);

  rig.getFails = true;
  ok("strict reader exists", typeof em.readEmergencyContacts === "function");
  if (typeof em.readEmergencyContacts === "function") {
    ok("getItem throws: strict reader throws instead of returning []", await rejects(em.readEmergencyContacts()));
  }
  eq("getItem throws: SOS reader still degrades to []", await em.getEmergencyContacts(), []);
  rig.getFails = false;
  if (typeof em.readEmergencyContacts === "function") {
    eq("strict reader returns the stored list when healthy", await em.readEmergencyContacts(), contacts);
    kv.delete("zerospike.emergencyContacts");
    eq("no stored value is an honest empty list", await em.readEmergencyContacts(), []);
  }

  rig.setFails = true;
  ok("setItem throws: the error reaches the caller", await rejects(em.setEmergencyContacts(contacts)));
  rig.setFails = false;

  console.log("\nscreen wiring (source guards)");
  const src = readFileSync(join(__dirname, "..", "app", "emergency-contacts.tsx"), "utf8");
  ok("screen loads through the strict reader", src.includes("readEmergencyContacts()"));
  ok("screen shows the load failure", src.includes('t("emergency.loadFailed")'));
  const persistAt = src.indexOf("async function persist");
  const persistBody = src.slice(persistAt, src.indexOf("async function saveContact"));
  ok("persist blocks writes while the list is unreadable", /loadFailed/.test(persistBody));
  const writeAt = persistBody.indexOf("await setEmergencyContacts");
  ok("persist refuses until the list is loaded", /!contactsLoaded\s*\|\|\s*loadFailed/.test(persistBody));
  ok("add form is inert until the list is loaded", /pointerEvents=\{contactsLoaded \? "auto" : "none"\}/.test(src));
  ok("persist writes before it updates state", writeAt !== -1 && writeAt < persistBody.indexOf("setContacts(next)"));
  ok("persist toasts a write failure", persistBody.includes("common.saveFailed"));
  ok("persist rejects a second write mid-flight", /writing\.current/.test(persistBody));

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}
main();
