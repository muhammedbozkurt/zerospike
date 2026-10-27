/**
 * FIX-F (OPUS-5a): data-loss findings of the CGM import, each as a permanent
 * scenario against the REAL SQL on node:sqlite.
 *
 *  1. a glucometer reading next to a sensor row is kept (cross-source dedupe only
 *     drops a duplicate of a sensor value, never a non-sensor candidate)
 *  2. a labelled 2.4 row is never turned into a sensor reading by take-over
 *  3. the take-over UPDATE does not die on the UNIQUE external-id index
 *  4. a future-dated sample holds the sync anchor back (hasRetryableFutureRow)
 *  5. v29 back-fill and retention leave labelled / id-less rows alone; the hourly
 *     summaries are readable for the exports
 *  6. repeated timestamps do not pass for a sensor cadence
 *  7. Health Connect changes are drained to the end
 *  8. a source-side delete leaves no tombstone, a user delete does
 *  9. one mmol/L factor
 * 10. the reminder transaction takes the write lock up front
 *
 * Run: npx tsx scripts/opus5aImport.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  deleteImportedGlucose,
  hasRetryableFutureRow,
  importGlucoseRows,
  planGlucoseImport,
  type HealthImportHost,
  type HealthImportSql,
  type ImportedGlucoseRow,
} from "../lib/db/healthImportSql";
import { V28_CREATE } from "../lib/db/v28Sql";
import { V29_INDEXES, findCgmRunIds } from "../lib/db/v29Sql";
import { V30_CREATE } from "../lib/db/v30Sql";
import { detectCgmSource } from "../lib/cgm/detect";
import { runCgmRetention } from "../lib/cgm/retention";
import { drainChanges, type ChangesPage } from "../lib/services/healthChangesCore";
import { countHourlyRows, forEachHourlyPage } from "../lib/db/sugarHourly";
import { MGDL_PER_MMOL } from "../lib/glucose";
import { pickMgdl } from "../lib/services/healthMath";

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
  ok(name, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

function makeDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE user_profiles (id TEXT PRIMARY KEY NOT NULL);
    CREATE TABLE meal_logs (id TEXT PRIMARY KEY, sugar_log_id TEXT);
    CREATE TABLE sugar_logs (
      id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL,
      glucose_level_mgdl INTEGER NOT NULL, period_tag TEXT NOT NULL DEFAULT 'manual',
      source TEXT NOT NULL DEFAULT 'manual', logged_at TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]', healthkit_uuid TEXT,
      source_app TEXT, external_id TEXT, is_cgm INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (profile_id) REFERENCES user_profiles (id) ON DELETE CASCADE
    );
    INSERT INTO user_profiles VALUES ('P');
  `);
  for (const s of V28_CREATE) db.exec(s);
  for (const s of V29_INDEXES) db.exec(s);
  for (const s of V30_CREATE) db.exec(s);
  const txn: HealthImportSql = {
    execAsync: async (sql) => void db.exec(sql),
    getAllAsync: async <T,>(sql: string, params: (string | number | null)[] = []) =>
      db.prepare(sql).all(...(params as never[])) as T[],
    runAsync: async (sql, params = []) => void db.prepare(sql).run(...(params as never[])),
    prepareAsync: async (sql) => {
      const st = db.prepare(sql);
      return { executeAsync: async (p) => void st.run(...(p as never[])), finalizeAsync: async () => {} };
    },
  };
  const host: HealthImportHost & { getAllAsync: HealthImportSql["getAllAsync"] } = {
    getAllAsync: txn.getAllAsync,
    withExclusiveTransactionAsync: async (task) => {
      db.exec("BEGIN");
      try {
        await task(txn);
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
  return { db, host };
}

let seq = 0;
const nid = () => `n${++seq}`;
type Row = { id: string; logged_at: string; v: number; source: string; app: string | null; ext: string | null; is_cgm: number; tag: string };
const all = (db: DatabaseSync) =>
  db
    .prepare(
      "SELECT id, logged_at, glucose_level_mgdl AS v, source, source_app AS app, external_id AS ext, is_cgm, period_tag AS tag FROM sugar_logs ORDER BY logged_at"
    )
    .all() as unknown as Row[];

const NOW = Date.parse("2026-10-27T12:00:00.000Z");
const T = (min: number, sec = 0) => new Date(NOW - 6 * 3600_000 + min * 60_000 + sec * 1000).toISOString();

async function main(): Promise<void> {
  console.log("1. glucometer reading beside a sensor row");
  {
    const { db, host } = makeDb();
    const cgm: ImportedGlucoseRow[] = Array.from({ length: 40 }, (_, i) => ({
      at: T(i * 5), mgdl: 100 + (i % 7), source: "health", sourceApp: "com.dexcom.G7", externalId: `d${i}`, isCgm: true,
    }));
    await importGlucoseRows(host, "P", cgm, nid, NOW);
    const meter: ImportedGlucoseRow = { at: T(51), mgdl: 104, source: "health", sourceApp: "com.meter", externalId: "m1", isCgm: false };
    const n = await importGlucoseRows(host, "P", [meter], nid, NOW);
    eq("meter stored next to a stored sensor row", n, 1);
    ok("meter row present", all(db).some((r) => r.ext === "m1" && r.is_cgm === 0));

    // same batch: sensor and meter together
    const b = makeDb();
    const both: ImportedGlucoseRow[] = [
      { at: T(10), mgdl: 103, source: "health", sourceApp: "com.dexcom.G7", externalId: "s", isCgm: true },
      { at: T(11), mgdl: 104, source: "health", sourceApp: "com.meter", externalId: "m", isCgm: false },
    ];
    eq("meter kept in the same batch as the sensor row", await importGlucoseRows(b.host, "P", both, nid, NOW), 2);

    // a sensor value is never dropped for a stored non-sensor row (the mirror is
    // told apart when rows are read, not on import)
    const c = makeDb();
    await importGlucoseRows(c.host, "P", [both[1]], nid, NOW);
    eq("sensor value next to a stored meter reading is kept", await importGlucoseRows(c.host, "P", [both[0]], nid, NOW), 1);

    // two sensors of different apps still collapse
    const d = makeDb();
    const twin: ImportedGlucoseRow[] = [
      { at: T(10), mgdl: 120, source: "health", sourceApp: "a", externalId: "x", isCgm: true },
      { at: T(10, 30), mgdl: 120, source: "health", sourceApp: "b", externalId: "y", isCgm: true },
    ];
    eq("two apps' sensor twins collapse", await importGlucoseRows(d.host, "P", twin, nid, NOW), 1);

    // planner level
    const plan = planGlucoseImport(
      [{ atMs: 1_000_000, mgdl: 104, source: "health", sourceApp: "m", externalId: "m", isCgm: false }],
      [{ id: "e", atMs: 940_000, mgdl: 103, source: "health", sourceApp: "d", externalId: "d", isCgm: true }]
    );
    eq("planner keeps a non-sensor candidate beside a sensor row", plan.insert.length, 1);
  }

  console.log("2. labelled 2.4 row is not taken over by a sensor sample");
  {
    const { db, host } = makeDb();
    db.prepare(
      "INSERT INTO sugar_logs (id, profile_id, glucose_level_mgdl, period_tag, source, logged_at) VALUES ('old-meter','P',121,'fasting','health',?)"
    ).run(T(60));
    await importGlucoseRows(
      host,
      "P",
      [
        { at: T(59), mgdl: 120, source: "health", sourceApp: "com.dexcom.G7", externalId: "d59", isCgm: true },
        { at: T(60), mgdl: 121, source: "health", sourceApp: "com.meter", externalId: "meter-uuid", isCgm: false },
      ],
      nid,
      NOW
    );
    const old = all(db).find((r) => r.id === "old-meter");
    ok("labelled row survives", !!old);
    eq("labelled row stays a glucometer reading", old?.is_cgm, 0);
    eq("labelled row keeps its tag", old?.tag, "fasting");
    ok("the sensor sample is its own row, not the labelled one", all(db).some((r) => r.ext === "d59" && r.is_cgm === 1 && r.id !== "old-meter"));

    // an untagged legacy sensor-looking row (same value, a minute apart) is still taken over
    const b = makeDb();
    b.db.prepare(
      "INSERT INTO sugar_logs (id, profile_id, glucose_level_mgdl, period_tag, source, logged_at) VALUES ('old','P',120,'unset','health',?)"
    ).run(T(60));
    await importGlucoseRows(
      b.host, "P",
      [{ at: T(59, 30), mgdl: 120, source: "health", sourceApp: "com.dexcom.G7", externalId: "d", isCgm: true }],
      nid, NOW
    );
    const rows = all(b.db);
    eq("legacy untagged row is taken over, not duplicated", rows.length, 1);
    eq("and becomes a sensor row", rows[0]?.is_cgm, 1);
  }

  console.log("3. take-over does not fail on the UNIQUE external-id index");
  {
    const { db, host } = makeDb();
    db.prepare(
      "INSERT INTO sugar_logs (id, profile_id, glucose_level_mgdl, source, logged_at, source_app, external_id, is_cgm) VALUES ('moved','P',140,'health',?, 'com.x', 'rec-1', 0)"
    ).run(T(0));
    db.prepare("INSERT INTO sugar_logs (id, profile_id, glucose_level_mgdl, source, logged_at) VALUES ('old','P',150,'health',?)").run(T(120));
    let err = "";
    for (let k = 0; k < 2; k++) {
      try {
        await importGlucoseRows(
          host, "P",
          [
            { at: T(120), mgdl: 150, source: "health", sourceApp: "com.x", externalId: "rec-1", isCgm: false },
            { at: T(200), mgdl: 99, source: "health", sourceApp: "com.x", externalId: "rec-2", isCgm: false },
          ],
          nid, NOW
        );
      } catch (e) {
        err = String((e as Error).message);
      }
    }
    eq("no UNIQUE failure", err, "");
    ok("rec-2 stored", all(db).some((r) => r.ext === "rec-2"));
    eq("rec-1 still exists once", all(db).filter((r) => r.ext === "rec-1").length, 1);
  }

  console.log("4. future-dated sample holds the anchor");
  {
    ok("+10 min is retried", hasRetryableFutureRow([{ at: new Date(NOW + 10 * 60_000).toISOString() }], NOW));
    ok("+2 min is accepted by the import, nothing to retry", !hasRetryableFutureRow([{ at: new Date(NOW + 2 * 60_000).toISOString() }], NOW));
    ok("a year ahead is dropped for good, never holds the anchor", !hasRetryableFutureRow([{ at: new Date(NOW + 365 * 86_400_000).toISOString() }], NOW));
    ok("past rows", !hasRetryableFutureRow([{ at: new Date(NOW - 60_000).toISOString() }], NOW));
    const src = readFileSync(join(__dirname, "..", "lib", "services", "health.ts"), "utf8");
    ok("sync loop gates the anchor write on the hold flag", /!holdAnchor\)\s*await writeHealthAnchor/.test(src));
  }

  console.log("5. v29 back-fill and retention");
  {
    const base = Date.parse("2025-01-01T00:00:00.000Z");
    const rows: { id: string; profile_id: string; logged_at: string; period_tag: string }[] = [];
    for (let i = 0; i < 40; i++) rows.push({ id: `c${i}`, profile_id: "P", logged_at: new Date(base + i * 5 * 60_000).toISOString(), period_tag: "unset" });
    rows.push({ id: "meter", profile_id: "P", logged_at: new Date(base + 52 * 60_000).toISOString(), period_tag: "fasting" });
    rows.sort((a, b) => (a.logged_at < b.logged_at ? -1 : 1));
    const ids = findCgmRunIds(rows);
    ok("labelled meter row is not marked", !ids.includes("meter"));
    eq("the 40 sensor rows still are", ids.length, 40);

    const { db, host } = makeDb();
    const ins = db.prepare(
      "INSERT INTO sugar_logs (id, profile_id, glucose_level_mgdl, period_tag, source, logged_at, is_cgm, external_id) VALUES (?, 'P', 111, ?, 'health', ?, 1, ?)"
    );
    for (const r of rows) ins.run(r.id, r.period_tag, r.logged_at, r.id === "meter" ? null : `ext-${r.id}`);
    // legacy: marked by v29 (no id), tagged but marked (e.g. already in a 2.5 dev DB)
    ins.run("legacy-nox", "unset", new Date(base + 3 * 3600_000).toISOString(), null);
    ins.run("tagged-ext", "fasting", new Date(base + 4 * 3600_000).toISOString(), "ext-tagged");
    ins.run("meter2", "fasting", new Date(base + 53 * 60_000).toISOString(), null);
    const res = await runCgmRetention(host, "P", NOW);
    eq("only imported, unlabelled sensor rows fold", res.folded, 40);
    const left = new Set(all(db).map((r) => r.id));
    ok("meter row stays", left.has("meter") && left.has("meter2"));
    ok("id-less back-filled row stays", left.has("legacy-nox"));
    ok("labelled row with an id stays", left.has("tagged-ext"));
    const h = db.prepare("SELECT SUM(n) AS n FROM sugar_hourly").get() as { n: number };
    eq("hourly rows summarize exactly the folded readings", h.n, 40);

    // the exports read them, paged
    const range = { start: base - 86_400_000, end: base + 30 * 86_400_000 };
    eq("hourly count for the range", await countHourlyRows(host, "P", range), 4);
    const pages: number[] = [];
    const seen: string[] = [];
    await forEachHourlyPage(host, "P", range, async (r) => {
      pages.push(r.length);
      for (const x of r) seen.push(x.hour_utc);
    }, 3);
    eq("two pages of 3 + 1", pages.join(","), "3,1");
    ok("oldest first", seen.join() === [...seen].sort().join());
    eq("outside the range is empty", await countHourlyRows(host, "P", { start: 0, end: base - 1 }), 0);
  }

  console.log("6. repeated timestamps are not a cadence");
  {
    const day0 = NOW - 20 * 3600_000;
    const dup: { atMs: number }[] = [];
    for (let r = 0; r < 6; r++) for (let d = 0; d < 6; d++) dup.push({ atMs: day0 + r * 3 * 3600_000 });
    eq("6 readings written 6 times each are not a sensor", detectCgmSource(dup, { sourceApp: "com.meter.sync" }).isCgm, false);
    const real: { atMs: number }[] = [];
    for (let i = 0; i < 48; i++) real.push({ atMs: day0 + i * 5 * 60_000 });
    eq("a real 5 minute stream still is", detectCgmSource(real, { sourceApp: "x" }).isCgm, true);
    const realTwice = [...real, ...real];
    eq("and still is when every reading is repeated", detectCgmSource(realTwice, { sourceApp: "x" }).isCgm, true);
  }

  console.log("7. Health Connect changes are drained");
  {
    const pages: Record<string, ChangesPage> = {
      t0: { nextChangesToken: "t1", hasMore: true, upsertionChanges: [{}], deletionChanges: [{ recordId: "a" }] },
      t1: { nextChangesToken: "t2", hasMore: true, deletionChanges: [{ recordId: "b" }, { recordId: "a" }] },
      t2: { nextChangesToken: "t3", hasMore: false, deletionChanges: [{ recordId: "c" }] },
    };
    const asked: string[] = [];
    const r = await drainChanges(async (t) => (asked.push(t), pages[t]), "t0");
    eq("all pages read", asked.join(), "t0,t1,t2");
    eq("every deletion collected once", r.deletedIds.sort().join(), "a,b,c");
    eq("token is the last one", r.next, "t3");
    eq("changed", r.changed, true);
    const exp = await drainChanges(async () => ({ changesTokenExpired: true, nextChangesToken: "n" }), "t0");
    eq("expired token asks for a full read", exp.expired, true);
    const calm = await drainChanges(async () => ({ nextChangesToken: "z", hasMore: false }), "t0");
    eq("nothing changed", calm.changed, false);
    const stuck = await drainChanges(async () => ({ nextChangesToken: "again", hasMore: true }), "t0", 5);
    eq("a runaway feed stops", stuck.next, "again");
    const hc = readFileSync(join(__dirname, "..", "lib", "services", "healthConnect.ts"), "utf8");
    ok("peekGlucoseChanges drains through drainChanges", hc.includes("drainChanges((t) =>"));
  }

  console.log("8. source-side delete leaves no tombstone");
  {
    const { db, host } = makeDb();
    const first: ImportedGlucoseRow[] = [0, 5, 10].map((m, i) => ({
      at: T(m), mgdl: 120 + i, source: "health", sourceApp: "app", externalId: `u${i}`, isCgm: true,
    }));
    await importGlucoseRows(host, "P", first, nid, NOW);
    eq("source deletes three", await deleteImportedGlucose(host, "P", "health", ["u0", "u1", "u2"]), 3);
    const tomb = () => (db.prepare("SELECT COUNT(*) AS c FROM health_import_tombstones").get() as { c: number }).c;
    eq("no tombstones from the source's delete", tomb(), 0);
    eq("no marker left behind", (db.prepare("SELECT COUNT(*) AS c FROM health_import_source_delete").get() as { c: number }).c, 0);
    const again = first.map((r, i) => ({ ...r, externalId: `v${i}` }));
    eq("re-written samples (new ids) are imported again", await importGlucoseRows(host, "P", again, nid, NOW), 3);
    db.prepare("DELETE FROM sugar_logs WHERE external_id = 'v0'").run();
    eq("the user's own delete still leaves one", tomb(), 1);
    eq("and that reading stays gone", await importGlucoseRows(host, "P", [{ ...again[0], externalId: "w0" }], nid, NOW), 0);
  }

  console.log("9. one mmol/L factor");
  {
    eq("mmol field converts with the app's constant", pickMgdl({ mmol: 5.5 }), 5.5 * MGDL_PER_MMOL);
    const hc = readFileSync(join(__dirname, "..", "lib", "services", "healthConnect.ts"), "utf8");
    ok("Health Connect reads mg/dL straight, no own factor", !/\*\s*18(\.0)?\b|\/\s*18(\.0)?\b/.test(hc));
  }

  console.log("10. reminder transaction takes the write lock up front");
  {
    const src = readFileSync(join(__dirname, "..", "lib", "db", "reminders.ts"), "utf8");
    const start = src.indexOf("export async function inReminderTransaction");
    const body = src.slice(start, src.indexOf("\n}\n", start));
    ok("BEGIN IMMEDIATE", body.includes("BEGIN IMMEDIATE"));
    ok("no deferred withTransactionAsync", !body.includes("withTransactionAsync"));
    ok("rolls back on a throw", body.includes("ROLLBACK"));
  }

  console.log(`\nopus5aImport: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.log("crash", e);
  process.exit(1);
});
