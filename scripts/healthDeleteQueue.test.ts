/**
 * lib/healthDeleteQueue.ts harness: the pending Health-delete queue rules and
 * the wiring of delete robustness. Run: npx tsx scripts/healthDeleteQueue.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  HEALTH_DELETE_PASS_MAX,
  HEALTH_DELETE_QUEUE_MAX,
  HEALTH_DELETE_WINDOW_DAYS,
  enqueueDeletes,
  normalizeDeleteEntries,
  ownHealthUuids,
  pruneDeleteQueue,
  removeDeleted,
  selectDeletePass,
  type PendingDeleteEntry,
} from "../lib/healthDeleteQueue";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  FAIL ${name}`);
  }
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-10-05T12:00:00Z");
const entry = (uuid: string, daysAgo = 0): PendingDeleteEntry => ({
  uuid,
  queuedAtIso: new Date(NOW - daysAgo * DAY).toISOString(),
});

console.log("A. only our own ids are collected");
const own = ownHealthUuids([
  { source: "manual", healthkit_uuid: "a" },
  { source: "manual", healthkit_uuid: "a" },
  { source: "health", healthkit_uuid: "imported" },
  { source: "manual", healthkit_uuid: null },
  { source: "manual", healthkit_uuid: "" },
  { source: "manual", healthkit_uuid: "b" },
]);
ok("deduped, imports and empties excluded", own.join() === "a,b");

console.log("B. enqueue");
ok("adds new ids", enqueueDeletes([], ["a", "b"], NOW).length === 2);
ok("no duplicates", enqueueDeletes([entry("a")], ["a", "b"], NOW).map((e) => e.uuid).join() === "a,b");
ok("ignores empty ids", enqueueDeletes([], ["", "a"], NOW).length === 1);

console.log("C. prune");
ok("window is 30 days", HEALTH_DELETE_WINDOW_DAYS === 30);
ok("aged entries drop", pruneDeleteQueue([entry("old", 31), entry("new", 1)], NOW).map((e) => e.uuid).join() === "new");
const big = Array.from({ length: HEALTH_DELETE_QUEUE_MAX + 5 }, (_, i) => entry(`u${i}`));
const pruned = pruneDeleteQueue(big, NOW);
ok("cap keeps the newest", pruned.length === HEALTH_DELETE_QUEUE_MAX && pruned[pruned.length - 1].uuid === `u${HEALTH_DELETE_QUEUE_MAX + 4}`);

console.log("D. pass and removal");
ok("pass is capped, oldest first", selectDeletePass(big).length === HEALTH_DELETE_PASS_MAX && selectDeletePass(big)[0] === "u0");
ok("removeDeleted drops only the done ids", removeDeleted([entry("a"), entry("b")], ["a"]).map((e) => e.uuid).join() === "b");

console.log("E. storage tolerance");
ok("non-array reads empty", normalizeDeleteEntries({}, "x").length === 0);
ok("bare string and object both read", normalizeDeleteEntries(["a", { uuid: "b", queuedAtIso: "t" }, 5, null], "n").length === 2);

console.log("F. wiring");
const root = join(import.meta.dirname, "..");
const health = readFileSync(join(root, "lib", "services", "health.ts"), "utf8");
ok("failed single delete is queued", /await queueHealthDeletes\(\[uuid\]\)/.test(health));
ok("retry runs from the write retry triggers", /await retryPendingHealthDeletes\(\);/.test(health));
ok("collection goes through ownHealthUuids", /ownHealthUuids\(await listHealthMirrorRows\(profileId\)\)/.test(health));
const data = readFileSync(join(root, "app", "settings", "data.tsx"), "utf8");
ok("clear revokes copies before the rows go", /revokeHealthCopiesBeforeDelete\(activeProfile\.id\);\s*await clearAllLogs/.test(data));
ok("profile delete revokes copies before the delete", /revokeHealthCopiesBeforeDelete\(activeProfile\.id\);[\s\S]*?await deleteProfile/.test(data));
const hc = readFileSync(join(root, "lib", "services", "healthConnect.ts"), "utf8");
ok("Health Connect delete reports failure", /async function deleteGlucoseBatch[\s\S]*?throw new Error/.test(hc));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
