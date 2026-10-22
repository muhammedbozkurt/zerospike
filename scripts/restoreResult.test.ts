/**
 * restore_result from the paywall and from Settings > Restore purchases goes
 * through one helper: success / empty / error. Run from the repo root:
 *
 *   npx tsx scripts/restoreResult.test.ts
 */
import { readFileSync } from "node:fs";

declare const require: { (id: string): any };

let passed = 0;
let failed = 0;
function eq<T>(name: string, actual: T, expected: T): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed++;
  else {
    failed++;
    console.log(`  x ${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  }
}

const logged: { name: string; params: unknown }[] = [];
const Module = require("module");
const realLoad = Module._load;
Module._load = function (request: string) {
  if (request === "./index") return { logEvent: (name: string, params: unknown) => void logged.push({ name, params }) };
  return realLoad.apply(this, arguments);
};

const { logRestoreResult, restoreResultOf } = require("../lib/analytics/restoreResult");

eq("restored maps to success", restoreResultOf("restored"), "success");
eq("none maps to empty", restoreResultOf("none"), "empty");
eq("error maps to error", restoreResultOf("error"), "error");

logRestoreResult("restored");
logRestoreResult("none");
logRestoreResult("error");
eq(
  "one restore_result per call with its result",
  logged,
  [
    { name: "restore_result", params: { result: "success" } },
    { name: "restore_result", params: { result: "empty" } },
    { name: "restore_result", params: { result: "error" } },
  ]
);

const settings = readFileSync("app/settings/app.tsx", "utf8");
const paywall = readFileSync("app/paywall.tsx", "utf8");
eq("Settings logs it right after restore()", /const result = await restore\(\);\s*logRestoreResult\(result\);/.test(settings), true);
eq("the paywall uses the same helper", /const result = await restore\(\);\s*logRestoreResult\(result\);/.test(paywall), true);
eq("the paywall no longer hand-builds the event", /logEvent\("restore_result"/.test(paywall), false);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
