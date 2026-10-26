/**
 * G3 + G17 (2.5.0): the Health import must not lock out other writes, and a
 * Health reading the user deleted or corrected must not come back.
 *
 * G3: the import's exclusive transaction runs on a connection of its own, and a
 * SQLite connection starts with busy_timeout 0, so any write that overlapped it
 * failed at once with "database is locked". Both connections now wait
 * (BUSY_TIMEOUT_SQL), and the import is cut into small transactions so a 90 day
 * CGM backfill never holds the write lock for seconds.
 *
 * G17: the dedupe only looked at rows that still exist, so a deleted or
 * corrected reading was re-imported by the next sync, and "Verileri sil" gave
 * the next 30/90 days of Health back. Deleting or changing a Health row now
 * leaves a tombstone (trigger), and clearing logs writes an import floor.
 *
 * Runs the REAL SQL against node:sqlite, the same arrangement as
 * scripts/migration.test.ts.
 *
 * Run: npx sucrase-node scripts/healthImportGuard.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void; execPath: string };

import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BUSY_TIMEOUT_SQL,
  HEALTH_IMPORT_CHUNK_SIZE,
  clearProfileLogs,
  importHealthSamples as importAt,
  type HealthImportHost,
  type HealthImportSql,
} from "../lib/db/healthImportSql";
import { V28_CREATE } from "../lib/db/v28Sql";

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
function section(title: string): void {
  console.log(`\n${title}`);
}

const root = mkdtempSync(join(tmpdir(), "zs-hig-"));
let dbSeq = 0;
function dbPath(): string {
  dbSeq++;
  return join(root, `t${dbSeq}.db`);
}

const SCHEMA = `
  PRAGMA journal_mode = WAL;
  CREATE TABLE user_profiles (id TEXT PRIMARY KEY NOT NULL);
  CREATE TABLE sugar_logs (
    id TEXT PRIMARY KEY NOT NULL,
    profile_id TEXT NOT NULL,
    glucose_level_mgdl INTEGER NOT NULL,
    period_tag TEXT NOT NULL DEFAULT 'manual',
    source TEXT NOT NULL DEFAULT 'manual',
    logged_at TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '[]',
    healthkit_uuid TEXT,
    FOREIGN KEY (profile_id) REFERENCES user_profiles (id) ON DELETE CASCADE
  );
  CREATE TABLE meal_logs (id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL);
  CREATE TABLE injection_logs (id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL);
  CREATE TABLE med_logs (id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL);
  INSERT INTO user_profiles VALUES ('p1');
  INSERT INTO user_profiles VALUES ('p2');
`;

function makeDb(): { path: string; db: DatabaseSync } {
  const path = dbPath();
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  for (const statement of V28_CREATE) db.exec(statement);
  return { path, db };
}

function adaptTxn(conn: DatabaseSync, log: string[]): HealthImportSql {
  return {
    execAsync: async (sql) => {
      log.push(sql);
      conn.exec(sql);
    },
    getAllAsync: async <T>(sql: string, params: (string | number | null)[] = []) => {
      log.push(sql);
      return conn.prepare(sql).all(...(params as never[])) as T[];
    },
    runAsync: async (sql, params = []) => {
      log.push(sql);
      conn.prepare(sql).run(...(params as never[]));
    },
  };
}

interface TxnRecord {
  statements: string[];
  inserts: number;
}

function makeHost(path: string): { host: HealthImportHost; txns: TxnRecord[] } {
  const txns: TxnRecord[] = [];
  const host: HealthImportHost = {
    withExclusiveTransactionAsync: async (task) => {
      const conn = new DatabaseSync(path);
      const statements: string[] = [];
      conn.exec("BEGIN");
      try {
        await task(adaptTxn(conn, statements));
        conn.exec("COMMIT");
      } catch (e) {
        conn.exec("ROLLBACK");
        throw e;
      } finally {
        conn.close();
      }
      txns.push({
        statements,
        inserts: statements.filter((s) => /INSERT INTO sugar_logs/.test(s)).length,
      });
    },
  };
  return { host, txns };
}

const T0 = Date.parse("2026-03-01T00:00:00.000Z");
const importHealthSamples = (
  host: HealthImportHost,
  profileId: string,
  samples: ReturnType<typeof sample>[],
  newId: () => string
) => importAt(host, profileId, samples, newId, T0 + 86_400_000);
const iso = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();
const sample = (mgdl: number, minutes: number) => ({
  glucose_level_mgdl: mgdl,
  period_tag: "unset" as const,
  logged_at: iso(minutes),
});
let idSeq = 0;
const newId = () => `id-${++idSeq}`;
const countRows = (db: DatabaseSync, where = "1=1") =>
  (db.prepare(`SELECT COUNT(*) AS c FROM sugar_logs WHERE ${where};`).get() as { c: number }).c;

async function main(): Promise<void> {
  console.log("zerospike health import guard test (G3, G17)");

  section("G3a. a write that overlaps another connection's lock");
  {
    const path = dbPath();
    const setup = new DatabaseSync(path);
    setup.exec("PRAGMA journal_mode = WAL; CREATE TABLE t (n INTEGER); INSERT INTO t VALUES (0);");
    setup.close();

    const holder = spawn(
      process.execPath,
      [
        "-e",
        `const { DatabaseSync } = require("node:sqlite");
         const c = new DatabaseSync(process.argv[1]);
         c.exec("BEGIN IMMEDIATE; INSERT INTO t VALUES (1);");
         process.stdout.write("held\\n");
         setTimeout(() => { c.exec("COMMIT"); c.close(); }, 700);`,
        path,
      ],
      { stdio: ["ignore", "pipe", "inherit"] }
    );
    await new Promise<void>((resolve) => {
      holder.stdout.once("data", () => resolve());
    });

    const bare = new DatabaseSync(path);
    let bareError = "";
    try {
      bare.prepare("INSERT INTO t VALUES (2);").run();
    } catch (e) {
      bareError = String(e);
    }
    ok("a connection without busy_timeout fails with 'locked'", /locked/i.test(bareError), bareError);
    bare.close();

    const waiting = new DatabaseSync(path);
    waiting.exec(BUSY_TIMEOUT_SQL);
    let waitError = "";
    const t = Date.now();
    try {
      waiting.prepare("INSERT INTO t VALUES (3);").run();
    } catch (e) {
      waitError = String(e);
    }
    eq("the same write waits for the lock and lands with BUSY_TIMEOUT_SQL", waitError, "");
    ok("it really waited for the holder", Date.now() - t >= 200, `${Date.now() - t} ms`);
    waiting.close();
    await new Promise<void>((resolve) => holder.on("exit", () => resolve()));

    const m = /PRAGMA busy_timeout = (\d+);/.exec(BUSY_TIMEOUT_SQL);
    ok("the timeout is between 3000 and 5000 ms", !!m && +m[1] >= 3000 && +m[1] <= 5000, BUSY_TIMEOUT_SQL);
  }

  section("G3b. both connections get the timeout");
  {
    const indexSrc = readFileSync(join(import.meta.dirname, "..", "lib", "db", "index.ts"), "utf8");
    ok(
      "getDb sets busy_timeout right after opening the main connection",
      /openDatabaseAsync\(DB_NAME\);\s*await dbInstance\.execAsync\(BUSY_TIMEOUT_SQL\)/.test(indexSrc) ||
        /openDatabaseAsync\(DB_NAME\);[\s\S]{0,200}execAsync\(BUSY_TIMEOUT_SQL\)/.test(indexSrc)
    );

    const { path } = makeDb();
    const { host, txns } = makeHost(path);
    await importHealthSamples(host, "p1", [sample(110, 0)], newId);
    ok(
      "the import transaction connection starts with the pragma",
      txns.length === 1 && txns[0].statements[0] === BUSY_TIMEOUT_SQL,
      JSON.stringify(txns[0]?.statements[0])
    );
    const cleared = makeHost(path);
    await clearProfileLogs(cleared.host, "p1", iso(10));
    ok(
      "the clear transaction connection starts with the pragma",
      cleared.txns.length === 1 && cleared.txns[0].statements[0] === BUSY_TIMEOUT_SQL
    );
  }

  section("G3c. the import is cut into small transactions");
  {
    const { path, db } = makeDb();
    const total = HEALTH_IMPORT_CHUNK_SIZE * 2 + 37;
    const samples = Array.from({ length: total }, (_, i) => sample(80 + (i % 90), i * 5));
    const { host, txns } = makeHost(path);
    const inserted = await importHealthSamples(host, "p1", samples, newId);
    eq("every new sample lands", inserted, total);
    eq("the rows are all in the table", countRows(db), total);
    eq("three transactions for two and a bit chunks", txns.length, 3);
    ok(
      "no transaction holds more than one chunk of inserts",
      txns.every((x) => x.inserts <= HEALTH_IMPORT_CHUNK_SIZE),
      JSON.stringify(txns.map((x) => x.inserts))
    );
    ok("the chunk is small", HEALTH_IMPORT_CHUNK_SIZE >= 100 && HEALTH_IMPORT_CHUNK_SIZE <= 1000);

    const again = makeHost(path);
    eq("a second run of the same window inserts nothing", await importHealthSamples(again.host, "p1", samples, newId), 0);

    const shuffled = [...samples].reverse().slice(0, 10);
    eq("an unsorted batch is handled too", await importHealthSamples(makeHost(path).host, "p1", shuffled, newId), 0);
    db.close();
  }

  section("G3d. chunk edges still dedupe against each other");
  {
    const { path, db } = makeDb();
    const edge = HEALTH_IMPORT_CHUNK_SIZE;
    const samples = Array.from({ length: edge + 1 }, (_, i) => sample(100 + i, i * 30));
    samples.push(sample(100 + edge, edge * 30 + 5));
    const n = await importHealthSamples(makeHost(path).host, "p1", samples, newId);
    eq("a same-value reading 5 minutes after the chunk boundary is a duplicate", n, edge + 1);
    db.close();
  }

  section("G17a. a deleted Health reading does not come back");
  {
    const { path, db } = makeDb();
    const samples = [sample(120, 0), sample(130, 60), sample(140, 120)];
    await importHealthSamples(makeHost(path).host, "p1", samples, newId);
    eq("three rows imported", countRows(db), 3);

    db.exec(`DELETE FROM sugar_logs WHERE glucose_level_mgdl = 130;`);
    eq("a tombstone was left", (db.prepare("SELECT COUNT(*) AS c FROM health_import_tombstones;").get() as { c: number }).c, 1);

    const n = await importHealthSamples(makeHost(path).host, "p1", samples, newId);
    eq("the next sync inserts nothing", n, 0);
    eq("the deleted reading stays gone", countRows(db, "glucose_level_mgdl = 130"), 0);

    const other = await importHealthSamples(makeHost(path).host, "p1", [sample(131, 61)], newId);
    eq("a different value at that time is a real new reading", other, 1);
    const p2 = await importHealthSamples(makeHost(path).host, "p2", [sample(130, 60)], newId);
    eq("another profile is not affected", p2, 1);
    db.close();
  }

  section("G17b. a corrected Health reading is not doubled");
  {
    const { path, db } = makeDb();
    await importHealthSamples(makeHost(path).host, "p1", [sample(150, 0)], newId);
    db.exec(`UPDATE sugar_logs SET glucose_level_mgdl = 140 WHERE source = 'health';`);
    const n = await importHealthSamples(makeHost(path).host, "p1", [sample(150, 0)], newId);
    eq("the original Health value does not return as a second row", n, 0);
    eq("one row, the corrected value", countRows(db, "glucose_level_mgdl = 140"), 1);
    eq("only that row exists", countRows(db), 1);

    db.exec(`UPDATE sugar_logs SET logged_at = '${iso(500)}' WHERE source = 'health';`);
    eq(
      "moving the reading in time blocks the original slot too",
      await importHealthSamples(makeHost(path).host, "p1", [sample(150, 0)], newId),
      0
    );
    db.close();
  }

  section("G17c. edits that keep the reading do not leave a tombstone");
  {
    const { path, db } = makeDb();
    await importHealthSamples(makeHost(path).host, "p1", [sample(150, 0)], newId);
    db.exec(`UPDATE sugar_logs SET period_tag = 'breakfast', tags = '["a"]' WHERE source = 'health';`);
    db.exec(`UPDATE sugar_logs SET healthkit_uuid = 'x' WHERE source = 'health';`);
    eq("label, tags and uuid link changes", (db.prepare("SELECT COUNT(*) AS c FROM health_import_tombstones;").get() as { c: number }).c, 0);

    db.exec(`INSERT INTO sugar_logs (id, profile_id, glucose_level_mgdl, source, logged_at) VALUES ('m1','p1',99,'manual','${iso(900)}');`);
    db.exec(`DELETE FROM sugar_logs WHERE id = 'm1';`);
    db.exec(`INSERT INTO sugar_logs (id, profile_id, glucose_level_mgdl, source, logged_at) VALUES ('m2','p1',99,'manual','${iso(900)}');`);
    db.exec(`UPDATE sugar_logs SET glucose_level_mgdl = 98 WHERE id = 'm2';`);
    eq("manual rows never leave one", (db.prepare("SELECT COUNT(*) AS c FROM health_import_tombstones;").get() as { c: number }).c, 0);
    db.close();
  }

  section("G17d. 'Verileri sil' keeps the window closed");
  {
    const { path, db } = makeDb();
    const old = [sample(110, 0), sample(120, 100), sample(130, 200)];
    await importHealthSamples(makeHost(path).host, "p1", old, newId);
    db.exec(`INSERT INTO sugar_logs (id, profile_id, glucose_level_mgdl, source, logged_at) VALUES ('mm','p1',177,'manual','${iso(50)}');`);
    db.exec(`INSERT INTO meal_logs VALUES ('ml','p1'); INSERT INTO meal_logs VALUES ('mlo','p2');`);
    db.exec(`INSERT INTO sugar_logs (id, profile_id, glucose_level_mgdl, source, logged_at) VALUES ('o2','p2',90,'manual','${iso(10)}');`);

    const clearedAt = iso(300);
    await clearProfileLogs(makeHost(path).host, "p1", clearedAt);
    eq("the profile's sugar rows are gone", countRows(db, "profile_id = 'p1'"), 0);
    eq("its meals are gone", (db.prepare("SELECT COUNT(*) AS c FROM meal_logs WHERE profile_id='p1';").get() as { c: number }).c, 0);
    eq("another profile's meals stay", (db.prepare("SELECT COUNT(*) AS c FROM meal_logs WHERE profile_id='p2';").get() as { c: number }).c, 1);
    eq("another profile's readings stay", countRows(db, "profile_id = 'p2'"), 1);
    eq(
      "no per-row tombstones for a bulk clear (the floor covers them)",
      (db.prepare("SELECT COUNT(*) AS c FROM health_import_tombstones;").get() as { c: number }).c,
      0
    );

    const back = await importHealthSamples(makeHost(path).host, "p1", [...old, sample(115, 20), sample(125, 299)], newId);
    eq("the next sync brings back nothing from before the clear", back, 0);

    const fresh = await importHealthSamples(makeHost(path).host, "p1", [sample(105, 310), sample(106, 400)], newId);
    eq("readings after the clear import normally", fresh, 2);

    db.exec(`DELETE FROM sugar_logs WHERE glucose_level_mgdl = 106;`);
    eq(
      "a later single delete still leaves a tombstone",
      await importHealthSamples(makeHost(path).host, "p1", [sample(106, 400)], newId),
      0
    );

    await clearProfileLogs(makeHost(path).host, "p1", iso(1000));
    eq(
      "clearing again moves the floor forward",
      await importHealthSamples(makeHost(path).host, "p1", [sample(105, 310), sample(107, 900)], newId),
      0
    );
    db.close();
  }

  section("G17f. tombstones out of every sync window are pruned");
  {
    const { path, db } = makeDb();
    db.exec(`INSERT INTO health_import_tombstones VALUES ('p1', '${iso(0)}', 100), ('p1', '${iso(60 * 24 * 170)}', 101);`);
    await importAt(makeHost(path).host, "p1", [sample(90, 60 * 24 * 200)], newId, T0 + 60 * 24 * 200 * 60_000);
    eq("the 200 day old one is gone, the 30 day old one stays", (db.prepare("SELECT glucose_level_mgdl AS g FROM health_import_tombstones;").all() as { g: number }[]).map((r) => r.g).join(","), "101");
    db.close();
  }

  section("G17e. the real wiring");
  {
    const logsSrc = readFileSync(join(import.meta.dirname, "..", "lib", "db", "logs.ts"), "utf8");
    const indexSrc = readFileSync(join(import.meta.dirname, "..", "lib", "db", "index.ts"), "utf8");
    const profSrc = readFileSync(join(import.meta.dirname, "..", "lib", "db", "profiles.ts"), "utf8");
    ok("insertHealthSugarLogs delegates to importHealthSamples", /importHealthSamples\(db, profileId, samples, uuid\)/.test(logsSrc));
    ok("clearAllLogs delegates to clearProfileLogs", /clearProfileLogs\(db, profileId, new Date\(\)\.toISOString\(\)\)/.test(indexSrc));
    ok("SCHEMA_VERSION is 29", /const SCHEMA_VERSION = 29;/.test(indexSrc));
    ok("the v27 -> v28 step runs the real migration", /currentVersion < 28\)\s*\{\s*await migrateToV28\(db\);/.test(indexSrc));
    ok("a fresh install creates the guard tables", /for \(const statement of V28_CREATE\)/.test(indexSrc));
    ok("deleteProfile drops the guard rows", /DELETE FROM health_import_tombstones WHERE profile_id = \?/.test(profSrc) && /DELETE FROM health_import_floor WHERE profile_id = \?/.test(profSrc));
  }

  rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.log("test crashed", e);
  process.exit(1);
});
