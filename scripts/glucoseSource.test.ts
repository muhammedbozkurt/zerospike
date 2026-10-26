/**
 * lib/glucoseSource.ts harness: "did the user type this?" is an allowlist, and
 * every place that used to ask `source !== 'health'` now asks it. A Nightscout
 * row must not be written back to Health, must not count as a first log, and
 * must not feed the personal figures.
 *
 * Run: npx tsx scripts/glucoseSource.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

import { GLUCOSE_SOURCES, USER_ENTERED_SQL, isUserEntered } from "../lib/glucoseSource";
import { selectBackfillCandidates } from "../lib/healthBackfill";
import { ownHealthUuids } from "../lib/healthDeleteQueue";
import { selectHealthRetryCandidates } from "../lib/healthWriteRetry";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  FAIL ${name}`);
  }
}
const read = (rel: string) => readFileSync(join(import.meta.dirname, "..", rel), "utf8");

console.log("A. the rule");
ok("manual is user-entered", isUserEntered("manual"));
for (const s of ["health", "nightscout", "dexcom", "", "calculator"]) {
  ok(`${s || "(empty)"} is not user-entered`, !isUserEntered(s));
}
ok("null and undefined are not user-entered", !isUserEntered(null) && !isUserEntered(undefined));
ok("the known sources include nightscout", GLUCOSE_SOURCES.includes("nightscout"));

console.log("B. the SQL fragment agrees with the function");
{
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE sugar_logs (id TEXT, source TEXT);");
  for (const s of ["manual", "health", "nightscout"]) {
    db.prepare("INSERT INTO sugar_logs VALUES (?, ?);").run(s, s);
  }
  const rows = db.prepare(`SELECT id FROM sugar_logs WHERE ${USER_ENTERED_SQL};`).all() as { id: string }[];
  ok("only the manual row matches", rows.length === 1 && rows[0].id === "manual");
  db.close();
}

console.log("C. a Nightscout row is never mirrored back or deleted from Health");
{
  const NOW = Date.parse("2026-10-05T12:00:00Z");
  const at = new Date(NOW - 3600000).toISOString();
  const mk = (id: string, source: string) => ({
    id,
    profile_id: "p1",
    source,
    healthkit_uuid: null as string | null,
    logged_at: at,
  });
  const rows = [mk("m", "manual"), mk("h", "health"), mk("n", "nightscout")];
  const back = selectBackfillCandidates(rows, "p1", new Set(), NOW, 7).map((r) => r.id);
  ok("backfill takes only the manual row", back.join() === "m");
  const retry = selectHealthRetryCandidates(rows, ["m", "h", "n"], [], NOW).map((r) => r.id);
  ok("the retry pass takes only the manual row", retry.join() === "m");
  const owned = ownHealthUuids([
    { source: "manual", healthkit_uuid: "u1" },
    { source: "nightscout", healthkit_uuid: "u2" },
    { source: "health", healthkit_uuid: "u3" },
  ]);
  ok("the delete queue takes only the manual row's uuid", owned.join() === "u1");
}

console.log("D. the 16 former denylist points are bound to the helper");
{
  const points: { file: string; needle: RegExp }[] = [
    { file: "app/(tabs)/index.tsx", needle: /!isUserEntered\(log\.source\)/ },
    { file: "components/JournalItem.tsx", needle: /!isUserEntered\(entry\.source\)/ },
    { file: "components/useJournalRows.tsx", needle: /!isUserEntered\(String\(row\.source/ },
    { file: "lib/insights.ts", needle: /isUserEntered\(x\.source\)/ },
    { file: "lib/healthBackfill.ts", needle: /isUserEntered\(r\.source\)/ },
    { file: "lib/healthDeleteQueue.ts", needle: /!isUserEntered\(r\.source\)/ },
    { file: "lib/healthWriteRetry.ts", needle: /isUserEntered\(r\.source\)/ },
    { file: "lib/trialTimeline.ts", needle: /isUserEntered\(l\.source\)/ },
    { file: "lib/db/logs.ts", needle: /\$\{USER_ENTERED_SQL\}\$\{sql\}/ },
    { file: "lib/db/logs.ts", needle: /\$\{USER_ENTERED_SQL\} AND healthkit_uuid IS NULL/ },
    { file: "lib/services/firstLog.ts", needle: /\$\{USER_ENTERED_SQL\}/ },
    { file: "lib/services/health.ts", needle: /!isUserEntered\(log\.source\)/ },
    { file: "lib/services/health.ts", needle: /!row \|\| !isUserEntered\(row\.source\)\) return true/ },
    { file: "lib/services/health.ts", needle: /!row \|\| !isUserEntered\(row\.source\)\) return none/ },
    { file: "lib/services/health.ts", needle: /!current \|\| !isUserEntered\(current\.source\)/ },
    { file: "lib/services/health.ts", needle: /row\.healthkit_uuid != null \|\| !isUserEntered\(row\.source\)/ },
  ];
  ok("sixteen points are pinned", points.length === 16);
  for (const p of points) {
    ok(`${p.file}: ${p.needle.source.slice(0, 48)}`, p.needle.test(read(p.file)));
  }
  for (const f of new Set(points.map((p) => p.file))) {
    const src = read(f);
    ok(`${f} no longer compares a source to 'health'`, !/source\s*(?:===|!==|!=|=)\s*['"]health['"]/.test(src.replace(/OLD\.source = 'health'/g, "")));
  }
}

console.log("E. first log and personal figures");
{
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE sugar_logs (id TEXT, source TEXT);");
  db.exec("INSERT INTO sugar_logs VALUES ('n1','nightscout'), ('n2','nightscout'), ('h1','health');");
  const count = (db.prepare(`SELECT COUNT(*) AS c FROM (SELECT 1 FROM sugar_logs WHERE ${USER_ENTERED_SQL} LIMIT 2);`).get() as { c: number }).c;
  ok("imported rows do not make the next manual reading a non-first one", count === 0);
  db.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
