/**
 * Pins the entry file: the background health task must be defined before
 * expo-router boots, inside try/catch (the view tree may never mount in a
 * headless WorkManager start).
 *
 * Run: npx tsx scripts/healthEntryOrder.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { planRestoreSteps } from "../lib/db/undoSql";

let failed = 0;
function ok(name: string, cond: boolean): void {
  if (!cond) {
    failed++;
    console.log(`  x ${name}`);
  }
}

const root = join(import.meta.dirname, "..");
const entry = readFileSync(join(root, "index.js"), "utf8");
const bg = entry.indexOf('require("./lib/services/healthBackground")');
const router = entry.indexOf('require("expo-router/entry")');
ok("healthBackground is required", bg !== -1);
ok("expo-router entry is required", router !== -1);
ok("healthBackground comes before expo-router entry", bg !== -1 && bg < router);
const tryAt = entry.lastIndexOf("try {", bg);
const catchAt = entry.indexOf("catch", bg);
ok("healthBackground require sits in a try/catch", tryAt !== -1 && catchAt !== -1 && catchAt < router);

const snap = {
  meals: [{ id: "m1", health_uuid: "U1" }],
  injections: [{ id: "i1", health_uuid: "U2" }],
};
const steps = planRestoreSteps(snap);
for (const s of steps) {
  if (s.op !== "insert") continue;
  ok(`${s.table} restored with health_uuid NULL`, s.rows.every((r) => r.health_uuid === null));
}
ok("snapshot itself is not mutated", snap.meals[0].health_uuid === "U1");

const undo = readFileSync(join(root, "lib/db/undo.ts"), "utf8");
ok("restoreDeletion re-mirrors restored records", /await remirrorRestoredRecords\(snap\)/.test(undo));
ok("restored meal announced as fresh save", /emitMealSaved\(meal, null\)/.test(undo));
ok("restored injection announced as fresh save", /emitInjectionSaved\(injection, null\)/.test(undo));

const logs = readFileSync(join(root, "lib/db/logs.ts"), "utf8");
const inj = readFileSync(join(root, "lib/db/injections.ts"), "utf8");
ok("deleteMealLog reads uuid atomically", /DELETE FROM meal_logs WHERE id = \? RETURNING health_uuid/.test(logs));
ok("deleteInjection reads uuid atomically", /DELETE FROM injection_logs WHERE id = \? RETURNING health_uuid/.test(inj));
const importSql = readFileSync(join(root, "lib/db/healthImportSql.ts"), "utf8");
ok("health import dedup runs inside the exclusive transaction", /withExclusiveTransactionAsync\(async \(txn\)[\s\S]*?importChunk\(txn/.test(importSql) && /async function importChunk[\s\S]*?FROM sugar_logs[\s\S]*?planGlucoseImport/.test(importSql) && /importHealthSamples\(db, profileId, samples, uuid\)/.test(logs));

console.log(failed === 0 ? "health entry order: all passed" : `health entry order: ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
