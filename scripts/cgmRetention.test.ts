/**
 * CGM-A2: the 365 day retention of sensor readings (schema v30). Runs the REAL
 * SQL against node:sqlite.
 *
 * Raw sensor readings (is_cgm = 1) older than 365 days become one sugar_hourly
 * row per hour and source (n, mean, min, max); hand-typed readings are never
 * folded or deleted; a re-run changes nothing.
 *
 * Run: npx tsx scripts/cgmRetention.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { BUSY_TIMEOUT_SQL, type HealthImportSql } from "../lib/db/healthImportSql";
import {
  retentionCutoffMs,
  runCgmRetention,
  runCgmRetentionIfDue,
  type RetentionHost,
} from "../lib/cgm/retention";
import { CGM_RAW_KEEP_DAYS, V30_CREATE } from "../lib/db/v30Sql";
import { V28_CREATE } from "../lib/db/v28Sql";
import { V29_INDEXES } from "../lib/db/v29Sql";

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
function section(t: string): void {
  console.log(`\n${t}`);
}

const NOW = Date.parse("2027-06-15T12:34:56.000Z");
const DAY = 86_400_000;
const HOUR = 3_600_000;
const CUTOFF = retentionCutoffMs(NOW);
const iso = (ms: number) => new Date(ms).toISOString();

function makeDb(): { db: DatabaseSync; host: RetentionHost } {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE user_profiles (id TEXT PRIMARY KEY NOT NULL);
    CREATE TABLE sugar_logs (
      id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL,
      glucose_level_mgdl INTEGER NOT NULL, period_tag TEXT NOT NULL DEFAULT 'manual',
      source TEXT NOT NULL DEFAULT 'manual', logged_at TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]', healthkit_uuid TEXT,
      source_app TEXT, external_id TEXT, is_cgm INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (profile_id) REFERENCES user_profiles (id) ON DELETE CASCADE
    );
    INSERT INTO user_profiles VALUES ('p1');
    INSERT INTO user_profiles VALUES ('p2');
  `);
  for (const s of V28_CREATE) db.exec(s);
  for (const s of V29_INDEXES) db.exec(s);
  for (const s of V30_CREATE) db.exec(s);
  const txn: HealthImportSql = {
    execAsync: async (sql) => void db.exec(sql),
    getAllAsync: async <T>(sql: string, params: (string | number | null)[] = []) =>
      db.prepare(sql).all(...(params as never[])) as T[],
    runAsync: async (sql, params = []) => void db.prepare(sql).run(...(params as never[])),
    prepareAsync: async (sql) => {
      const st = db.prepare(sql);
      return { executeAsync: async (p) => void st.run(...(p as never[])), finalizeAsync: async () => {} };
    },
  };
  const host: RetentionHost = {
    getAllAsync: async <T>(sql: string, params: (string | number | null)[] = []) =>
      db.prepare(sql).all(...(params as never[])) as T[],
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
function add(
  db: DatabaseSync,
  profile: string,
  atMs: number,
  mgdl: number,
  over: { source?: string; isCgm?: number; app?: string | null } = {}
): void {
  db.prepare(
    `INSERT INTO sugar_logs (id, profile_id, glucose_level_mgdl, source, logged_at, source_app, external_id, is_cgm, period_tag)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`
  ).run(
    `r${++seq}`,
    profile,
    mgdl,
    over.source ?? "health",
    iso(atMs),
    over.app === undefined ? "com.sensor.a" : over.app,
    over.source === "manual" ? null : `e${seq}`,
    over.isCgm ?? 1,
    over.source === "manual" ? "manual" : "unset"
  );
}
const count = (db: DatabaseSync, where = "1=1", table = "sugar_logs") =>
  (db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE ${where};`).get() as { c: number }).c;

async function main(): Promise<void> {
  console.log("zerospike cgm retention test");

  section("A. the boundary: 365 days, on an hour edge");
  {
    eq("the constant is 365 days", CGM_RAW_KEEP_DAYS, 365);
    eq("the cutoff is on an hour boundary", CUTOFF % HOUR, 0);
    ok("it is at most 365 days back and within an hour of it", NOW - CUTOFF >= 365 * DAY && NOW - CUTOFF < 365 * DAY + HOUR, String(NOW - CUTOFF));
    const { db, host } = makeDb();
    add(db, "p1", CUTOFF - 1000, 100);
    add(db, "p1", CUTOFF, 110);
    add(db, "p1", CUTOFF + 1000, 120);
    const r = await runCgmRetention(host, "p1", NOW);
    eq("one reading is older than the cutoff", r.folded, 1);
    eq("the reading AT the cutoff stays raw", count(db, `logged_at = '${iso(CUTOFF)}'`), 1);
    eq("the newer one stays too", count(db, `logged_at = '${iso(CUTOFF + 1000)}'`), 1);
    eq("the older one is gone", count(db, `logged_at = '${iso(CUTOFF - 1000)}'`), 0);
    db.close();
  }

  section("B. the summary is exact, per hour and per source");
  {
    const { db, host } = makeDb();
    const hour1 = CUTOFF - 3 * HOUR;
    const hour2 = CUTOFF - 2 * HOUR;
    [100, 110, 120, 130].forEach((v, i) => add(db, "p1", hour1 + i * 5 * 60_000, v));
    [90, 95].forEach((v, i) => add(db, "p1", hour2 + i * 60_000, v));
    add(db, "p1", hour2 + 10 * 60_000, 200, { source: "nightscout", app: "ns" });
    await runCgmRetention(host, "p1", NOW);
    const rows = db
      .prepare("SELECT hour_utc, source, n, mean, min, max FROM sugar_hourly WHERE profile_id = 'p1' ORDER BY hour_utc, source;")
      .all() as { hour_utc: string; source: string; n: number; mean: number; min: number; max: number }[];
    eq("three summary rows", rows.length, 3);
    eq("hour 1 health", JSON.stringify(rows[0]), JSON.stringify({ hour_utc: iso(hour1), source: "health", n: 4, mean: 115, min: 100, max: 130 }));
    eq("hour 2 health", JSON.stringify(rows[1]), JSON.stringify({ hour_utc: iso(hour2), source: "health", n: 2, mean: 92.5, min: 90, max: 95 }));
    eq("hour 2 nightscout is its own row", JSON.stringify(rows[2]), JSON.stringify({ hour_utc: iso(hour2), source: "nightscout", n: 1, mean: 200, min: 200, max: 200 }));
    eq("every raw reading was removed", count(db, "is_cgm = 1"), 0);
    eq("the counts add up to what was folded", rows.reduce((a, r) => a + r.n, 0), 7);
    db.close();
  }

  section("C. typed readings are never folded or deleted");
  {
    const { db, host } = makeDb();
    const old = CUTOFF - 40 * DAY;
    add(db, "p1", old, 140, { source: "manual", isCgm: 0, app: null });
    add(db, "p1", old + 1000, 141, { source: "manual", isCgm: 1, app: null });
    add(db, "p1", old + 2000, 150, { source: "health", isCgm: 0 });
    add(db, "p1", old + 3000, 160, { source: "health", isCgm: 1 });
    const before = db.prepare("SELECT * FROM sugar_logs WHERE source = 'manual' OR is_cgm = 0 ORDER BY id;").all();
    await runCgmRetention(host, "p1", NOW);
    eq("only the sensor reading went", count(db), 3);
    eq("the typed rows are byte for byte the same", JSON.stringify(db.prepare("SELECT * FROM sugar_logs WHERE source = 'manual' OR is_cgm = 0 ORDER BY id;").all()), JSON.stringify(before));
    eq("a malformed manual row marked as sensor is still not folded", count(db, "source = 'manual' AND is_cgm = 1"), 1);
    eq("and the summary holds just the sensor reading", (db.prepare("SELECT SUM(n) AS n FROM sugar_hourly;").get() as { n: number }).n, 1);
    db.close();
  }

  section("D. idempotent, and a profile at a time");
  {
    const { db, host } = makeDb();
    for (let i = 0; i < 50; i++) add(db, "p1", CUTOFF - 5 * DAY + i * 5 * 60_000, 100 + (i % 30));
    for (let i = 0; i < 20; i++) add(db, "p2", CUTOFF - 5 * DAY + i * 5 * 60_000, 150);
    for (let i = 0; i < 10; i++) add(db, "p1", NOW - DAY + i * 5 * 60_000, 110);
    const first = await runCgmRetention(host, "p1", NOW);
    eq("50 readings folded", first.folded, 50);
    eq("the other profile is untouched", count(db, "profile_id = 'p2'"), 20);
    eq("recent readings stay raw", count(db, "profile_id = 'p1'"), 10);
    const snap = JSON.stringify(db.prepare("SELECT * FROM sugar_hourly ORDER BY profile_id, hour_utc, source;").all());
    const again = await runCgmRetention(host, "p1", NOW);
    eq("a second run folds nothing", again.folded, 0);
    eq("and changes nothing", JSON.stringify(db.prepare("SELECT * FROM sugar_hourly ORDER BY profile_id, hour_utc, source;").all()), snap);
    await runCgmRetention(host, "p2", NOW);
    eq("the other profile folds on its own run", count(db, "profile_id = 'p2'"), 0);
    eq("p2 has its own summary", count(db, "profile_id = 'p2'", "sugar_hourly") > 0, true);
    db.close();
  }

  section("E. a replay into an hour that already has a row merges, never doubles");
  {
    const { db, host } = makeDb();
    const hour = CUTOFF - 4 * HOUR;
    add(db, "p1", hour + 1000, 100);
    add(db, "p1", hour + 2000, 120);
    await runCgmRetention(host, "p1", NOW);
    add(db, "p1", hour + 3000, 160);
    await runCgmRetention(host, "p1", NOW);
    const row = db.prepare("SELECT n, mean, min, max FROM sugar_hourly WHERE profile_id = 'p1';").get() as { n: number; mean: number; min: number; max: number };
    eq("one row still", count(db, "1=1", "sugar_hourly"), 1);
    eq("n merged", row.n, 3);
    eq("mean merged: (100+120+160)/3", Math.round(row.mean * 1000), Math.round((380 / 3) * 1000));
    eq("min kept", row.min, 100);
    eq("max widened", row.max, 160);
    db.close();
  }

  section("F. a long backlog goes in slices, each its own transaction");
  {
    const { db, host } = makeDb();
    for (let d = 0; d < 100; d++) add(db, "p1", CUTOFF - (d + 1) * DAY, 100 + (d % 20));
    let txns = 0;
    const counting: RetentionHost = {
      getAllAsync: host.getAllAsync,
      withExclusiveTransactionAsync: async (task) => {
        txns++;
        await host.withExclusiveTransactionAsync(task);
      },
    };
    const r = await runCgmRetention(counting, "p1", NOW);
    eq("100 readings folded", r.folded, 100);
    ok("in at least 3 slices", r.slices >= 3, String(r.slices));
    eq("one transaction per slice", txns, r.slices);
    eq("nothing raw is left before the cutoff", count(db, "is_cgm = 1"), 0);
    eq("100 daily rows in the summary", count(db, "1=1", "sugar_hourly"), 100);
    db.close();
  }

  section("G. no tombstones for rows that can never come back");
  {
    const { db, host } = makeDb();
    for (let i = 0; i < 30; i++) add(db, "p1", CUTOFF - 10 * DAY + i * 5 * 60_000, 100 + i);
    await runCgmRetention(host, "p1", NOW);
    eq("the delete trigger's tombstones are dropped with the rows", count(db, "1=1", "health_import_tombstones"), 0);
    add(db, "p1", NOW - 5 * DAY, 130, { isCgm: 0 });
    db.exec(`DELETE FROM sugar_logs WHERE glucose_level_mgdl = 130;`);
    await runCgmRetention(host, "p1", NOW);
    eq("a recent user delete keeps its tombstone", count(db, "1=1", "health_import_tombstones"), 1);
    db.close();
  }

  section("H. at most once a day");
  {
    const { db, host } = makeDb();
    add(db, "p1", CUTOFF - 3 * DAY, 100);
    const first = await runCgmRetentionIfDue(host, "p1", NOW);
    ok("the first call runs", first != null && first.folded === 1);
    add(db, "p1", CUTOFF - 3 * DAY + 1000, 101);
    eq("the second call within the day does nothing", await runCgmRetentionIfDue(host, "p1", NOW + 23 * HOUR), null);
    eq("so the new old reading is still raw", count(db, "is_cgm = 1"), 1);
    const next = await runCgmRetentionIfDue(host, "p1", NOW + 25 * HOUR);
    ok("25 hours later it runs again", next != null && next.folded === 1);
    eq("another profile has its own clock", (await runCgmRetentionIfDue(host, "p2", NOW + 25 * HOUR)) != null, true);
    db.exec(`UPDATE cgm_retention_state SET last_run_at = '${iso(NOW + 10 * DAY)}' WHERE profile_id = 'p1';`);
    ok("a stamp from the future (clock moved back) does not block forever", (await runCgmRetentionIfDue(host, "p1", NOW + 26 * HOUR)) != null);
    db.close();
  }

  section("I. a profile delete takes its summaries and clock with it");
  {
    const { db, host } = makeDb();
    add(db, "p2", CUTOFF - DAY, 100);
    await runCgmRetentionIfDue(host, "p2", NOW);
    eq("p2 has a summary and a state row", count(db, "profile_id = 'p2'", "sugar_hourly") + count(db, "profile_id = 'p2'", "cgm_retention_state"), 2);
    db.exec("DELETE FROM user_profiles WHERE id = 'p2';");
    eq("both are gone with the profile", count(db, "profile_id = 'p2'", "sugar_hourly") + count(db, "profile_id = 'p2'", "cgm_retention_state"), 0);
    db.close();
  }

  section("J. the first statement of a slice is a write");
  {
    const { db } = makeDb();
    add(db, "p1", CUTOFF - DAY, 100);
    const seen: string[] = [];
    const txn: HealthImportSql = {
      execAsync: async (sql) => void (seen.push(sql), db.exec(sql)),
      getAllAsync: async <T>(sql: string, params: (string | number | null)[] = []) =>
        (seen.push(sql), db.prepare(sql).all(...(params as never[])) as T[]),
      runAsync: async (sql, params = []) => void (seen.push(sql), db.prepare(sql).run(...(params as never[]))),
      prepareAsync: async () => {
        throw new Error("unused");
      },
    };
    const host: RetentionHost = {
      getAllAsync: async <T>(sql: string, params: (string | number | null)[] = []) =>
        db.prepare(sql).all(...(params as never[])) as T[],
      withExclusiveTransactionAsync: async (task) => {
        db.exec("BEGIN");
        await task(txn);
        db.exec("COMMIT");
      },
    };
    await runCgmRetention(host, "p1", NOW);
    eq("pragma first", seen[0], BUSY_TIMEOUT_SQL);
    ok("then the fold (a write), before any read", /^INSERT INTO sugar_hourly/.test(seen[1] ?? ""), seen[1]?.slice(0, 40));
    db.close();
  }

  section("K. the wiring");
  {
    const logsSrc = readFileSync(join(import.meta.dirname, "..", "lib", "db", "logs.ts"), "utf8");
    const indexSrc = readFileSync(join(import.meta.dirname, "..", "lib", "db", "index.ts"), "utf8");
    ok("insertImportedGlucose runs the once-a-day fold after a sensor import", /runCgmRetentionIfDue\(db, profileId\)/.test(logsSrc));
    ok("a failing fold never fails the import", /try \{\s*const folded = await runCgmRetentionIfDue/.test(logsSrc));
    ok("a fresh install creates the retention tables", /for \(const statement of V30_CREATE\)/.test(indexSrc));
    ok("Verileri sil clears the summaries", /DELETE FROM sugar_hourly WHERE profile_id = \?/.test(readFileSync(join(import.meta.dirname, "..", "lib", "db", "healthImportSql.ts"), "utf8")));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.log("test crashed", e);
  process.exit(1);
});
