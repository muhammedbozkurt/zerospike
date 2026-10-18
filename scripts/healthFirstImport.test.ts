declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { firstImportOutcome } from "../lib/healthFirstImport";

let failed = 0;
function ok(name: string, cond: boolean): void {
  if (!cond) {
    failed++;
    console.log(`  FAIL ${name}`);
  }
}

const empty = { status: "ok" as const, inserted: 0, read: 0 };
ok("ios first empty shows note", firstImportOutcome(empty, true, false).showEmptyNote);
ok("ios first empty marks done", firstImportOutcome(empty, true, false).markDone);
ok("ios first with data: no note", !firstImportOutcome({ ...empty, read: 5, inserted: 5 }, true, false).showEmptyNote);
ok("ios first with data marks done", firstImportOutcome({ ...empty, read: 5, inserted: 5 }, true, false).markDone);
ok("second time: no note", !firstImportOutcome(empty, true, true).showEmptyNote);
ok("android never", !firstImportOutcome(empty, false, false).showEmptyNote);
ok("android never marks", !firstImportOutcome(empty, false, false).markDone);
ok("denied: no note", !firstImportOutcome({ ...empty, status: "denied" }, true, false).showEmptyNote);
ok("error: not done", !firstImportOutcome({ ...empty, status: "error" }, true, false).markDone);

const idx = readFileSync(join(__dirname, "../app/(tabs)/index.tsx"), "utf8");
ok("dashboard wires firstImportOutcome", idx.includes("firstImportOutcome(") && idx.includes("dashboard.healthFirstImportEmpty"));

console.log(failed ? `${failed} failed` : "all passed");
if (failed) process.exit(1);
