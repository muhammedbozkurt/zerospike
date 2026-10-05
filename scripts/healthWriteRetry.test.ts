/**
 * lib/healthWriteRetry.ts correctness harness (2.4/2.3.5's health-write
 * observability/self-heal work). No jest, same standalone style as
 * scripts/healthProfile.test.ts.
 *
 * Pure things under test:
 *  1. selectHealthRetryCandidates - which QUEUED rows the foreground/manual-
 *     sync retry re-attempts. CONSENT SCOPE (2.3.5 fix): a row is a
 *     candidate ONLY when its id is in the caller's pending-write queue -
 *     never merely because it looks unmirrored. Also: in-flight rows are
 *     skipped (double-write guard), oldest-first, capped.
 *  2. buildRetryStatusRecord - the one status record a whole retry pass
 *     writes, count-aware on failure.
 *  3. healthWriteStatusKey - which i18n key the Settings > Data status line
 *     shows for a stored write-status record.
 *
 * A few source-grep checks at the end pin the actual wiring (the pure
 * function is only useful if health.ts and its callers really call it),
 * the same belt-and-suspenders style scripts/healthImport.test.ts and
 * scripts/healthProfile.test.ts already use for this module - including the
 * 2.3.5 fixes that are inherently side-effectful (the pending queue, the
 * uuid-link double-write guard) and so cannot be pure-unit-tested here.
 *
 * Run: npx tsx scripts/healthWriteRetry.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  HEALTH_PENDING_QUEUE_MAX,
  HEALTH_RETRY_MAX_ROWS,
  HEALTH_RETRY_WINDOW_DAYS,
  buildRetryStatusRecord,
  healthWriteStatusKey,
  isRetryPassOpen,
  pruneWritePendingQueue,
  selectHealthRetryCandidates,
  type PendingWriteEntry,
  type RetryCandidateRow,
} from "../lib/healthWriteRetry";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ": " + detail : ""}`);
  }
}
function eq<T>(name: string, actual: T, expected: T): void {
  ok(name, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
function section(title: string): void {
  console.log(`\n${title}`);
}

console.log("zerospike health write retry test");

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-09-09T12:00:00.000Z");
const NO_INFLIGHT: string[] = [];

function row(over: Partial<RetryCandidateRow> & { id: string }): RetryCandidateRow {
  return {
    id: over.id,
    source: over.source ?? "manual",
    healthkit_uuid: over.healthkit_uuid ?? null,
    logged_at: over.logged_at ?? new Date(NOW).toISOString(),
  };
}

section("A. CONSENT SCOPE: only rows in the pending queue are ever candidates");
{
  const rows = [
    row({ id: "queued-and-pending" }),
    row({ id: "not-queued-but-looks-pending" }), // no uuid, not a health row - would have qualified under the OLD scan-based rule
  ];
  const out = selectHealthRetryCandidates(rows, ["queued-and-pending"], NO_INFLIGHT, NOW);
  eq("only the queued row is a candidate", out.length, 1);
  eq("it is the right row", out[0]?.id, "queued-and-pending");
}

section("B. a queued row that no longer looks pending is still filtered defensively");
{
  const rows = [
    row({ id: "queued-but-already-mirrored", healthkit_uuid: "uuid-1" }),
    row({ id: "queued-but-health-import", source: "health" }),
  ];
  const out = selectHealthRetryCandidates(
    rows,
    ["queued-but-already-mirrored", "queued-but-health-import"],
    NO_INFLIGHT,
    NOW
  );
  eq("neither row survives the defensive filter", out.length, 0);
}

section("C. an in-flight row is skipped even while queued (double-write guard)");
{
  const rows = [row({ id: "in-flight" }), row({ id: "not-in-flight" })];
  const out = selectHealthRetryCandidates(rows, ["in-flight", "not-in-flight"], ["in-flight"], NOW);
  eq("only the row NOT in flight is a candidate", out.length, 1);
  eq("it is the right row", out[0]?.id, "not-in-flight");
}

section("D. the retry window is exactly HEALTH_RETRY_WINDOW_DAYS days");
{
  eq("window constant is 7 days", HEALTH_RETRY_WINDOW_DAYS, 7);
  const justInside = row({
    id: "just-inside",
    logged_at: new Date(NOW - (HEALTH_RETRY_WINDOW_DAYS * DAY_MS - 60_000)).toISOString(),
  });
  const justOutside = row({
    id: "just-outside",
    logged_at: new Date(NOW - (HEALTH_RETRY_WINDOW_DAYS * DAY_MS + 60_000)).toISOString(),
  });
  const out = selectHealthRetryCandidates(
    [justInside, justOutside],
    ["just-inside", "just-outside"],
    NO_INFLIGHT,
    NOW
  );
  eq("one row survives the window filter", out.length, 1);
  eq("the row just inside the window is kept", out[0]?.id, "just-inside");
}

section("E. a row dated after now (clock skew) is never a candidate");
{
  const future = row({ id: "future", logged_at: new Date(NOW + DAY_MS).toISOString() });
  const out = selectHealthRetryCandidates([future], ["future"], NO_INFLIGHT, NOW);
  eq("future-dated row is dropped", out.length, 0);
}

section("F. oldest-first, so a long backlog fills in order rather than skipping the oldest forever");
{
  const rows = [
    row({ id: "newest", logged_at: new Date(NOW - 1 * DAY_MS).toISOString() }),
    row({ id: "oldest", logged_at: new Date(NOW - 5 * DAY_MS).toISOString() }),
    row({ id: "middle", logged_at: new Date(NOW - 3 * DAY_MS).toISOString() }),
  ];
  const out = selectHealthRetryCandidates(
    rows,
    ["newest", "oldest", "middle"],
    NO_INFLIGHT,
    NOW
  );
  eq("ordered oldest to newest", out.map((r) => r.id).join(","), "oldest,middle,newest");
}

section("G. capped at HEALTH_RETRY_MAX_ROWS, keeping the oldest ones");
{
  eq("cap constant is 50", HEALTH_RETRY_MAX_ROWS, 50);
  const rows = Array.from({ length: 60 }, (_, i) =>
    row({
      id: `row-${i}`,
      // 60 distinct minutes apart, all inside the window, oldest first as i grows.
      logged_at: new Date(NOW - (60 - i) * 60_000).toISOString(),
    })
  );
  const allIds = rows.map((r) => r.id);
  const out = selectHealthRetryCandidates(rows, allIds, NO_INFLIGHT, NOW, HEALTH_RETRY_WINDOW_DAYS, 50);
  eq("capped at 50", out.length, 50);
  eq("kept the oldest one", out[0]?.id, "row-0");
  eq("dropped the newest ten", out.some((r) => r.id === "row-59"), false);
}

section("H. buildRetryStatusRecord: one record per pass, count-aware");
{
  eq("nothing attempted -> no record", buildRetryStatusRecord(0, 0, "2026-01-01T00:00:00.000Z"), null);
  eq(
    "all succeeded -> success, no count",
    JSON.stringify(buildRetryStatusRecord(3, 3, "2026-01-01T00:00:00.000Z")),
    JSON.stringify({ result: "success", atIso: "2026-01-01T00:00:00.000Z" })
  );
  eq(
    "some failed -> failed, WITH the failed count (not the attempted count)",
    JSON.stringify(buildRetryStatusRecord(5, 3, "2026-01-01T00:00:00.000Z")),
    JSON.stringify({ result: "failed", atIso: "2026-01-01T00:00:00.000Z", failedCount: 2 })
  );
  eq(
    "all failed -> failed count equals attempted",
    JSON.stringify(buildRetryStatusRecord(4, 0, "2026-01-01T00:00:00.000Z")),
    JSON.stringify({ result: "failed", atIso: "2026-01-01T00:00:00.000Z", failedCount: 4 })
  );
}

section("I. healthWriteStatusKey picks the right i18n key");
{
  eq("no record -> nothing to show", healthWriteStatusKey(null), null);
  eq(
    "success -> success key",
    healthWriteStatusKey({ result: "success", atIso: new Date(NOW).toISOString() }),
    "settings.healthWriteLastSuccess"
  );
  eq(
    "failed -> failed key",
    healthWriteStatusKey({ result: "failed", atIso: new Date(NOW).toISOString(), failedCount: 2 }),
    "settings.healthWriteLastFailed"
  );
}

function pending(id: string, queuedAtIso: string): PendingWriteEntry {
  return { id, queuedAtIso };
}

section("H2. pruneWritePendingQueue: drops what has aged out of the QUEUE (not the reading)");
{
  const justInside = pending(
    "just-inside",
    new Date(NOW - (HEALTH_RETRY_WINDOW_DAYS * DAY_MS - 60_000)).toISOString()
  );
  const justOutside = pending(
    "just-outside",
    new Date(NOW - (HEALTH_RETRY_WINDOW_DAYS * DAY_MS + 60_000)).toISOString()
  );
  const out = pruneWritePendingQueue([justInside, justOutside], NOW);
  eq("only the entry queued within the window survives", out.length, 1);
  eq("it is the right one", out[0]?.id, "just-inside");
}

section("H3. pruneWritePendingQueue: hard cap, oldest-QUEUED dropped first");
{
  eq("cap constant is 200", HEALTH_PENDING_QUEUE_MAX, 200);
  // 250 entries, all comfortably inside the window, oldest-queued first.
  const entries = Array.from({ length: 250 }, (_, i) =>
    pending(`entry-${i}`, new Date(NOW - (250 - i) * 60_000).toISOString())
  );
  const out = pruneWritePendingQueue(entries, NOW);
  eq("capped at 200", out.length, 200);
  eq("dropped the oldest-queued (entry-0)", out.some((e) => e.id === "entry-0"), false);
  eq("kept the most-recently-queued (entry-249)", out.some((e) => e.id === "entry-249"), true);
  eq("order preserved (still oldest-to-newest)", out[0]?.id, "entry-50");
}

section("H4. pruneWritePendingQueue: window prune and cap compose (window runs first)");
{
  // 60 fresh entries (within window) + 5 stale ones (outside window). The
  // cap (set to 50 for this test) must apply to the 60 SURVIVORS, not to
  // the original 65 - a stale entry must never occupy a cap slot a fresh
  // one could have used.
  const fresh = Array.from({ length: 60 }, (_, i) =>
    pending(`fresh-${i}`, new Date(NOW - (60 - i) * 60_000).toISOString())
  );
  const stale = Array.from({ length: 5 }, (_, i) =>
    pending(`stale-${i}`, new Date(NOW - (HEALTH_RETRY_WINDOW_DAYS * DAY_MS + i * DAY_MS)).toISOString())
  );
  const out = pruneWritePendingQueue([...stale, ...fresh], NOW, HEALTH_RETRY_WINDOW_DAYS, 50);
  eq("every stale entry is gone", out.some((e) => e.id.startsWith("stale-")), false);
  eq("capped at 50 of the fresh ones", out.length, 50);
  eq("kept the newest fresh entries", out.some((e) => e.id === "fresh-59"), true);
}

section("I2. isRetryPassOpen: the SAME per-profile rule as shouldWriteToHealth, re-askable per row");
{
  eq(
    "enabled + matching profile -> open",
    isRetryPassOpen({ enabled: true, profileId: "p1" }, "p1"),
    true
  );
  eq(
    "toggle off -> closed even for the right profile",
    isRetryPassOpen({ enabled: false, profileId: "p1" }, "p1"),
    false
  );
  eq(
    "scope resolved for a DIFFERENT profile -> closed",
    isRetryPassOpen({ enabled: true, profileId: "p2" }, "p1"),
    false
  );
  eq(
    "no profile resolved at all -> closed",
    isRetryPassOpen({ enabled: true, profileId: null }, "p1"),
    false
  );
}

section("I3. 'closes mid-pass' scenario: a fresh isRetryPassOpen check per row stops a for-loop in place");
{
  // Models exactly what health.ts's retry loop does: re-check before every
  // row, `break` the moment it is no longer open. Pure/synchronous stand-in
  // for the real per-row readHealthWriteScope() call.
  const rowsToTry = ["r1", "r2", "r3", "r4"];
  const scopeByRow: Record<string, { enabled: boolean; profileId: string | null }> = {
    r1: { enabled: true, profileId: "p1" },
    r2: { enabled: true, profileId: "p1" },
    r3: { enabled: false, profileId: "p1" }, // toggle switched off right here
    r4: { enabled: true, profileId: "p1" },
  };
  const attempted: string[] = [];
  for (const id of rowsToTry) {
    if (!isRetryPassOpen(scopeByRow[id], "p1")) break;
    attempted.push(id);
  }
  eq("stops exactly at the row where the toggle closed", attempted.join(","), "r1,r2");
  ok("never reaches the row after the close", !attempted.includes("r4"));
}

section("J. wiring: health.ts and its callers actually use this module");
{
  const health = readFileSync(
    join(import.meta.dirname, "..", "lib", "services", "health.ts"),
    "utf8"
  );
  ok("health.ts imports selectHealthRetryCandidates", /selectHealthRetryCandidates/.test(health));
  ok("health.ts imports buildRetryStatusRecord", /buildRetryStatusRecord/.test(health));
  ok("health.ts exports retryPendingHealthWrites", /export async function retryPendingHealthWrites/.test(health));
  ok(
    "the retry is gated on the same per-profile scope as any other write",
    /if \(!scope\.enabled \|\| scope\.profileId !== profileId\) return none;/.test(health)
  );
  ok(
    "writeGlucoseToHealthIfEnabled now reports success/failure to its caller",
    /export async function writeGlucoseToHealthIfEnabled\(log: SugarLog\): Promise<boolean>/.test(health)
  );
  ok(
    "a session-capped announce helper exists",
    /export function shouldAnnounceHealthWriteFailure/.test(health)
  );

  section("J1. CONSENT SCOPE wiring (2.3.5): a pending queue, fed only from a real failed attempt");
  ok("a per-profile pending-write queue key exists", /HEALTH_WRITE_PENDING_KEY/.test(health));
  ok("getPendingWriteEntries reads the queue", /async function getPendingWriteEntries/.test(health));
  ok("addPendingWriteId queues a row", /async function addPendingWriteId/.test(health));
  ok("removePendingWriteIds drops rows from the queue", /async function removePendingWriteIds/.test(health));
  ok(
    "a failed fresh write queues its OWN row (not a broader scan)",
    /healthWriteFailureNoticePending = true;\s*\n\s*await addPendingWriteId\(log\.profile_id, log\.id\);/.test(
      health
    )
  );
  ok(
    "retryPendingHealthWrites reads the queue rather than scanning all logs",
    /const pendingIds = prunedEntries\.map\(\(e\) => e\.id\);/.test(health)
  );
  ok(
    "the old broad date-range log scan is gone from the retry path",
    !/listSugarLogs\(profileId, HEALTH_RETRY_MAX_ROWS/.test(health)
  );

  section("J1b. updateGlucoseInHealth (correction path) queues on failure too - 2.3.5 fix #1");
  ok(
    "updateGlucoseInHealth takes the row's own id (queued on failure)",
    /export async function updateGlucoseInHealth\(\s*\/\*\*[\s\S]{0,400}logId: string,/.test(health)
  );
  ok(
    "recordProfileId is still the LAST parameter (regression lock, see healthProfile.test.ts F)",
    /recordProfileId: string \| null\n\): Promise<string \| null>/.test(health)
  );
  ok(
    "a failed correction write queues logId under recordProfileId",
    /healthWriteFailureNoticePending = true;[\s\S]{0,400}await addPendingWriteId\(recordProfileId, logId\);/.test(
      health
    )
  );
  const calcSrc = readFileSync(join(import.meta.dirname, "..", "app", "calculator.tsx"), "utf8");
  ok(
    "calculator.tsx's meal-edit correction path passes the row id and announces on failure",
    /updateGlucoseInHealth\(\s*row\.id,\s*row\.healthkit_uuid,/.test(calcSrc) &&
      /if \(!uuid && shouldAnnounceHealthWriteFailure\(\)\)/.test(calcSrc)
  );
  const glucoseEditSrc = readFileSync(
    join(import.meta.dirname, "..", "lib", "services", "glucoseEdit.ts"),
    "utf8"
  );
  ok(
    "glucoseEdit.ts's dashboard correction path passes the row id too",
    /updateGlucoseInHealth\(\s*previous\.id,\s*previous\.healthkit_uuid,/.test(glucoseEditSrc)
  );

  section("J1c. queue growth (2.3.5 fix #2): pruned on every add AND on every retry pass");
  ok(
    "addPendingWriteId prunes before persisting",
    /async function addPendingWriteId[\s\S]{0,400}pruneWritePendingQueue/.test(health)
  );
  ok(
    "retryPendingHealthWrites prunes at the START of the pass",
    /const prunedEntries = await writeQueueLock\(async \(\) => \{[\s\S]{0,200}pruneWritePendingQueue\(current, nowMs\)/.test(
      health
    )
  );
  ok(
    "the pruned queue is actually persisted (under the queue lock)",
    /pruned\.length !== current\.length\) await savePendingWriteEntries\(profileId, pruned\);/.test(health)
  );

  section("J1d. mid-pass toggle-off (2.3.5 fix #3): scope re-read fresh per row, break not continue");
  ok(
    "the loop re-reads scope for every row rather than reusing the pass-start read",
    /for \(const row of candidates\) \{\s*\n\s*\/\/[\s\S]{0,400}const freshScope = await readHealthWriteScope\(profileId\);/.test(
      health
    )
  );
  ok(
    "a closed gate BREAKS the whole pass, not just this row",
    /if \(!isRetryPassOpen\(freshScope, profileId\)\) break;/.test(health)
  );

  section("J2. double-write guards (2.3.5): in-flight set + uuid-link-failure delete-and-requeue");
  ok("a module-level in-flight id set exists", /const healthWriteInFlightIds = new Set<string>\(\);/.test(health));
  ok(
    "a fresh write marks its row in-flight before attempting the native write",
    /healthWriteInFlightIds\.add\(log\.id\);/.test(health)
  );
  ok(
    "a fresh write always clears its in-flight mark (finally)",
    /healthWriteInFlightIds\.delete\(log\.id\);/.test(health)
  );
  ok(
    "the retry pass also marks/clears its own in-flight rows",
    /healthWriteInFlightIds\.add\(row\.id\);/.test(health) &&
      /healthWriteInFlightIds\.delete\(row\.id\);/.test(health)
  );
  ok(
    "the retry pass hands the in-flight set to the selector so it skips them",
    /selectHealthRetryCandidates\(\s*rows,\s*pendingIds,\s*healthWriteInFlightIds,/.test(health)
  );
  // A successful native write whose uuid never got linked locally (DB
  // hiccup) is revoked from Health and re-queued, in BOTH the fresh-write
  // and the retry path - never left as a silent orphan a later write could
  // duplicate.
  const linkFailureBlocks = health.split("catch (err) {").length - 1;
  ok(
    "at least one uuid-link failure path exists to guard",
    linkFailureBlocks >= 1,
    `found ${linkFailureBlocks} catch (err) blocks`
  );
  ok(
    "the fresh-write path deletes the orphaned sample and re-queues on a link failure",
    /catch \(err\) \{[\s\S]{0,800}await addPendingWriteId\(log\.profile_id, log\.id\);/.test(health)
  );
  ok(
    "the retry path deletes the orphaned sample on its own link failure",
    /succeededIds\.push\(row\.id\);[\s\S]{0,300}await deleteGlucoseFromHealth\(uuid\);/.test(health)
  );

  const index = readFileSync(join(import.meta.dirname, "..", "app", "(tabs)", "index.tsx"), "utf8");
  ok("dashboard foreground listener retries pending writes", /retryPendingHealthWrites\(profileId\)/.test(index));
  ok("dashboard manual sync also retries pending writes", /retryPendingHealthWrites\(activeProfile\.id\)/.test(index));

  const calc = readFileSync(join(import.meta.dirname, "..", "app", "calculator.tsx"), "utf8");
  ok(
    "calculator.tsx announces a genuine write failure",
    /shouldAnnounceHealthWriteFailure/.test(calc)
  );

  const rows = readFileSync(
    join(import.meta.dirname, "..", "components", "useJournalRows.tsx"),
    "utf8"
  );
  ok(
    "the undo re-mirror path announces a genuine write failure too",
    /shouldAnnounceHealthWriteFailure/.test(rows)
  );

  const appleKit = readFileSync(
    join(import.meta.dirname, "..", "lib", "services", "healthAppleKit.ts"),
    "utf8"
  );
  ok(
    "iOS checks write authorization before every write",
    /authorizationStatusFor\("HKQuantityTypeIdentifierBloodGlucose"\)/.test(appleKit)
  );

  const hc = readFileSync(
    join(import.meta.dirname, "..", "lib", "services", "healthConnect.ts"),
    "utf8"
  );
  ok(
    "Android checks the granted write permission before every write",
    /getGrantedPermissions\(\)/.test(hc) && /accessType === "write" && p\.recordType === "BloodGlucose"/.test(hc)
  );

  const settingsData = readFileSync(
    join(import.meta.dirname, "..", "app", "settings", "data.tsx"),
    "utf8"
  );
  ok("settings/data.tsx shows the last-write status line", /healthWriteStatusKey\(writeStatus\)/.test(settingsData));
  ok(
    "the status line shows date + time, not time alone (2.3.5 fix)",
    /formatDate\(writeStatus\.atIso\).*formatTime\(writeStatus\.atIso\)/.test(settingsData)
  );

  const editSheet = readFileSync(
    join(import.meta.dirname, "..", "components", "InjectionEditSheet.tsx"),
    "utf8"
  );
  ok(
    "InjectionEditSheet re-derives the product when the type toggle changes (2.3.5 fix)",
    /typeChanged/.test(editSheet)
  );
}

section("K. idempotent write wiring (sync id + version) and retry orphan guard");
{
  const health = readFileSync(join(import.meta.dirname, "..", "lib", "services", "health.ts"), "utf8");
  const retry = health.slice(health.indexOf("export async function retryPendingHealthWrites"));
  ok("fresh write carries buildHealthWriteMeta(log)", /buildHealthWriteMeta\(log\)/.test(health));
  ok("retry carries buildHealthWriteMeta(row)", /buildHealthWriteMeta\(row\)/.test(retry));
  ok(
    "retry re-checks the row exists before linking, and revokes the sample if gone",
    /if \(!\(await getSugarLog\(row\.id\)\)\) \{\s*await deleteGlucoseFromHealth\(uuid\);\s*continue;/.test(retry)
  );
  ok(
    "edit writes before revoking and never revokes the uuid it just got back",
    /oldUuid && oldUuid !== uuid/.test(health) && health.indexOf("buildHealthWriteMeta({ id: logId") < health.indexOf("oldUuid !== uuid")
  );
  const hc = readFileSync(join(import.meta.dirname, "..", "lib", "services", "healthConnect.ts"), "utf8");
  ok("Android writes clientRecordId + clientRecordVersion", /clientRecordId: meta\.recordId, clientRecordVersion: meta\.version/.test(hc));
  ok("Android read loop guard still skips our own dataOrigin", /dataOrigin !== OWN_BUNDLE_ID/.test(hc));
  const ak = readFileSync(join(import.meta.dirname, "..", "lib", "services", "healthAppleKit.ts"), "utf8");
  ok("iOS read loop guard still skips our own bundle", /bundleIdentifier !== OWN_BUNDLE_ID/.test(ak));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
