/**
 * lib/healthBackfill.ts harness: which rows the one-time "send past readings"
 * action may write, plus wiring checks. Run: npx tsx scripts/healthBackfill.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  HEALTH_BACKFILL_BATCH,
  chunkBatches,
  selectBackfillCandidates,
  type BackfillRow,
} from "../lib/healthBackfill";

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
const row = (id: string, over: Partial<BackfillRow> = {}, daysAgo = 1): BackfillRow => ({
  id,
  profile_id: "p1",
  source: "manual",
  healthkit_uuid: null,
  logged_at: new Date(NOW - daysAgo * DAY).toISOString(),
  ...over,
});
const none = new Set<string>();
const ids = (rs: BackfillRow[]) => rs.map((r) => r.id);

console.log("A. eligibility");
ok("manual, no uuid, in window is picked", ids(selectBackfillCandidates([row("a")], "p1", none, NOW, 7)).join() === "a");
ok("health import is never picked", selectBackfillCandidates([row("a", { source: "health" })], "p1", none, NOW, 90).length === 0);
ok("row with a uuid is never picked", selectBackfillCandidates([row("a", { healthkit_uuid: "u" })], "p1", none, NOW, 90).length === 0);
ok("other profile is never picked", selectBackfillCandidates([row("a", { profile_id: "p2" })], "p1", none, NOW, 90).length === 0);
ok("in-flight row is skipped", selectBackfillCandidates([row("a")], "p1", new Set(["a"]), NOW, 90).length === 0);
ok("future row is skipped", selectBackfillCandidates([row("a", {}, -1)], "p1", none, NOW, 90).length === 0);
ok("bad date is skipped", selectBackfillCandidates([row("a", { logged_at: "nope" })], "p1", none, NOW, 90).length === 0);

console.log("B. window and order");
const rows = [row("old", {}, 40), row("mid", {}, 20), row("new", {}, 2)];
ok("7 days keeps only the newest", ids(selectBackfillCandidates(rows, "p1", none, NOW, 7)).join() === "new");
ok("30 days drops the 40 day row", ids(selectBackfillCandidates(rows, "p1", none, NOW, 30)).join() === "mid,new");
ok("90 days keeps all, oldest first", ids(selectBackfillCandidates(rows, "p1", none, NOW, 90)).join() === "old,mid,new");
ok("cap keeps the oldest", ids(selectBackfillCandidates(rows, "p1", none, NOW, 90, 2)).join() === "old,mid");

console.log("C. rerun after an interrupted pass");
const afterLink = rows.map((r) => (r.id === "old" ? { ...r, healthkit_uuid: "u1" } : r));
ok("already linked rows drop out, the rest stay", ids(selectBackfillCandidates(afterLink, "p1", none, NOW, 90)).join() === "mid,new");

console.log("D. batches");
const many = Array.from({ length: HEALTH_BACKFILL_BATCH * 2 + 3 }, (_, i) => i);
const b = chunkBatches(many);
ok("batch count", b.length === 3);
ok("batch sizes", b[0].length === HEALTH_BACKFILL_BATCH && b[2].length === 3);
ok("empty input", chunkBatches([]).length === 0);

console.log("E. wiring");
const health = readFileSync(join(import.meta.dirname, "..", "lib", "services", "health.ts"), "utf8");
ok("facade uses the selector", /selectBackfillCandidates/.test(health));
ok(
  "backfill writes through the shared idempotent-meta helper, inside the row lock",
  /const outcome = await withRowLock\(stale\.id,[\s\S]{0,300}mirrorStoredRow\(row, \[\]\)/.test(health) &&
    /nextWriteMeta\(row\)/.test(health)
);
ok("backfill re-checks the switch per row", /isRetryPassOpen\(await readHealthWriteScope\(profileId\), profileId\)/.test(health));
const data = readFileSync(join(import.meta.dirname, "..", "app", "settings", "data.tsx"), "utf8");
ok("settings shows the section without Pro", /const wantsHealthSection = hasHealthProvider\(\);/.test(data));
ok("settings has the backfill action", /backfill\.pickWindow/.test(data));
ok("settings has retry now", /retryPendingHealthWrites/.test(data));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
