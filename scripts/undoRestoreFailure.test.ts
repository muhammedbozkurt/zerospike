/**
 * G9: a failed "Undo" restore must not lose the deleted rows for good.
 *
 *   - restoreBatch reports what is still un-restored when a snapshot throws
 *   - the failed remainder restores on the second attempt
 *   - the hook keeps the batch on failure, tells the user and logs the crash
 *   - the toast action's promise is awaited and caught
 *
 * Run: npx sucrase-node scripts/undoRestoreFailure.test.ts
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

const Module = require("module");
const realLoad = Module._load;
Module._load = function (request: string, parent: any) {
  const from = parent && typeof parent.filename === "string" ? parent.filename : "";
  if (/[\\/]lib[\\/]db[\\/]undo\.ts$/.test(from)) {
    if (request === "./index") return { getDb: async () => ({}) };
    if (request === "./healthRecordHooks") return { emitInjectionSaved() {}, emitMealSaved() {} };
    if (request === "./logs") return { getMealLog: async () => null };
    if (request === "./injections") return { getInjection: async () => null };
  }
  return realLoad.apply(this, arguments);
};

async function main(): Promise<void> {
  const undo = require("../lib/db/undo");
  const snaps = [{ sugar_logs: [{ id: "a" }] }, { sugar_logs: [{ id: "b" }] }, { sugar_logs: [{ id: "c" }] }];
  const idOf = (s: any) => s.sugar_logs[0].id;

  console.log("\nrestoreBatch");
  ok("restoreBatch exists", typeof undo.restoreBatch === "function");
  if (typeof undo.restoreBatch !== "function") {
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(1);
  }

  const done: string[] = [];
  let boom = true;
  const restore = async (s: any) => {
    if (idOf(s) === "b" && boom) throw new Error("disk full");
    done.push(idOf(s));
  };

  const first = await undo.restoreBatch(snaps, restore);
  eq("first attempt restored the snapshot before the failure", done, ["a"]);
  eq("the failing snapshot and the rest stay un-restored", first.failed.map(idOf), ["b", "c"]);
  eq("the restored one is reported", first.restored.map(idOf), ["a"]);
  ok("the error is handed back", first.error instanceof Error);

  boom = false;
  const second = await undo.restoreBatch(first.failed, restore);
  eq("second attempt restores the remainder", done, ["a", "b", "c"]);
  eq("nothing left after the retry", second.failed.length, 0);
  ok("no error on success", second.error === undefined);

  const empty = await undo.restoreBatch([], restore);
  eq("empty batch is a clean no-op", empty.failed.length, 0);

  console.log("\nuseUndoBatch / Feedback wiring (source guards)");
  const hook = readFileSync(join(__dirname, "..", "components", "useUndoBatch.ts"), "utf8");
  ok("hook restores through restoreBatch", hook.includes("restoreBatch("));
  ok("hook no longer loops restoreDeletion unguarded", !/for \(const s of snaps\) await restoreDeletion/.test(hook));
  ok("hook puts failed snapshots back into the batch", /batchRef\.current = \[\.\.\.failed/.test(hook));
  ok("hook toasts common.saveFailed", hook.includes('t("common.saveFailed")'));
  ok("hook logs the crash", /logCrash\(/.test(hook));
  ok("failure toast carries the Undo action again", /offerUndo\(t\("common\.saveFailed"\)/.test(hook) && /onPress: undoAll/.test(hook));

  const fb = readFileSync(join(__dirname, "..", "components", "Feedback.tsx"), "utf8");
  const runAt = fb.indexOf("const runToastAction");
  const runBody = fb.slice(runAt, fb.indexOf("const confirm = useCallback"));
  ok("toast action promise is caught", /\.catch\(/.test(runBody));
  ok("toast action no longer fires bare", !/^\s*action\?\.onPress\(\);\s*$/m.test(runBody));

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}
main();
