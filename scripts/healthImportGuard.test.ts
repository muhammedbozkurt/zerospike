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

import { fake, resetAll } from "./healthTestHarness";
import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BUSY_TIMEOUT_SQL,
  HEALTH_IMPORT_CHUNK_SIZE,
  clearProfileLogs,
  deleteImportedGlucose,
  importGlucoseRows,
  importHealthSamples as importAt,
  type HealthImportHost,
  type HealthImportSql,
} from "../lib/db/healthImportSql";
import { V28_CREATE } from "../lib/db/v28Sql";
import { V29_INDEXES } from "../lib/db/v29Sql";
import { V30_CREATE } from "../lib/db/v30Sql";

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
    source_app TEXT,
    external_id TEXT,
    is_cgm INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (profile_id) REFERENCES user_profiles (id) ON DELETE CASCADE
  );
  CREATE TABLE meal_logs (id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL, sugar_log_id TEXT);
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
  for (const statement of V29_INDEXES) db.exec(statement);
  for (const statement of V30_CREATE) db.exec(statement);
  return { path, db };
}

/** Called after every non-PRAGMA statement of a transaction, with how many ran. */
type AfterStatement = (count: number) => void;

function adaptTxn(
  conn: DatabaseSync,
  log: string[],
  prepared: { sql: string }[],
  after?: AfterStatement
): HealthImportSql {
  let count = 0;
  const done = () => {
    count++;
    after?.(count);
  };
  return {
    execAsync: async (sql) => {
      log.push(sql);
      conn.exec(sql);
      if (!/^\s*PRAGMA/i.test(sql)) done();
    },
    getAllAsync: async <T>(sql: string, params: (string | number | null)[] = []) => {
      log.push(sql);
      const rows = conn.prepare(sql).all(...(params as never[])) as T[];
      done();
      return rows;
    },
    runAsync: async (sql, params = []) => {
      log.push(sql);
      conn.prepare(sql).run(...(params as never[]));
      done();
    },
    prepareAsync: async (sql) => {
      prepared.push({ sql });
      const stmt = conn.prepare(sql);
      return {
        executeAsync: async (params) => {
          log.push(`exec:${sql}`);
          stmt.run(...(params as never[]));
          done();
        },
        finalizeAsync: async () => {},
      };
    },
  };
}

interface TxnRecord {
  statements: string[];
  inserts: number;
  prepares: number;
}

function makeHost(
  path: string,
  after?: AfterStatement
): { host: HealthImportHost; txns: TxnRecord[] } {
  const txns: TxnRecord[] = [];
  const host: HealthImportHost = {
    withExclusiveTransactionAsync: async (task) => {
      const conn = new DatabaseSync(path);
      const statements: string[] = [];
      const prepared: { sql: string }[] = [];
      conn.exec("BEGIN");
      try {
        await task(adaptTxn(conn, statements, prepared, after));
        conn.exec("COMMIT");
      } catch (e) {
        conn.exec("ROLLBACK");
        throw e;
      } finally {
        conn.close();
      }
      txns.push({
        statements,
        inserts: statements.filter((s) => /^exec:\s*INSERT INTO sugar_logs/.test(s)).length,
        prepares: prepared.length,
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
) => importAt(host, profileId, samples, newId, T0 + 10 * 86_400_000);
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
    db.exec(`INSERT INTO meal_logs (id, profile_id) VALUES ('ml','p1'); INSERT INTO meal_logs (id, profile_id) VALUES ('mlo','p2');`);
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
    ok("SCHEMA_VERSION is 30", /const SCHEMA_VERSION = 30;/.test(indexSrc));
    ok("the v27 -> v28 step runs the real migration", /currentVersion < 28\)\s*\{\s*await migrateToV28\(db\);/.test(indexSrc));
    ok("a fresh install creates the guard tables", /for \(const statement of V28_CREATE\)/.test(indexSrc));
    ok("deleteProfile drops the guard rows", /DELETE FROM health_import_tombstones WHERE profile_id = \?/.test(profSrc) && /DELETE FROM health_import_floor WHERE profile_id = \?/.test(profSrc));
  }

  section("G3e. every chunk starts with a write, so another writer cannot strand it");
  {
    // expo-sqlite opens an exclusive transaction with a plain (deferred) BEGIN. A
    // chunk whose first statement is a read pins a read snapshot; when another
    // connection commits meanwhile, the chunk's first write fails at once with
    // "database is locked" and busy_timeout cannot help. A write first takes the
    // lock under the timeout, and the other writer waits instead.
    const { path, db } = makeDb();
    const total = HEALTH_IMPORT_CHUNK_SIZE * 2 + 37;
    const samples = Array.from({ length: total }, (_, i) => sample(80 + (i % 90), i * 5));
    let competing = 0;
    let competitorWon = 0;
    const host = makeHost(path, (count) => {
      if (count !== 1) return;
      competing++;
      const other = new DatabaseSync(path);
      try {
        other.prepare("INSERT INTO user_profiles VALUES (?);").run(`rival-${competing}`);
        competitorWon++;
      } catch {
        // blocked by the import's lock: exactly what a first-statement write buys
      } finally {
        other.close();
      }
    });
    let failure = "";
    let n = 0;
    try {
      n = await importHealthSamples(host.host, "p1", samples, newId);
    } catch (e) {
      failure = String(e);
    }
    eq("no chunk fails with 'locked'", failure, "");
    eq("every sample lands", n, total);
    eq("three chunks ran", competing, 3);
    eq("a rival write never slipped between a chunk's BEGIN and its first write", competitorWon, 0);
    ok(
      "the first statement after the pragma is a write in every chunk",
      host.txns.every((x) => /^(UPDATE|DELETE|INSERT)/i.test(x.statements[1] ?? "")),
      JSON.stringify(host.txns.map((x) => (x.statements[1] ?? "").slice(0, 20)))
    );
    db.close();
  }

  section("G3f. one prepared INSERT per chunk, chunks of 200");
  {
    eq("the chunk size is 200", HEALTH_IMPORT_CHUNK_SIZE, 200);
    const { path, db } = makeDb();
    const total = HEALTH_IMPORT_CHUNK_SIZE * 2 + 5;
    const samples = Array.from({ length: total }, (_, i) => sample(80 + (i % 90), i * 5));
    const { host, txns } = makeHost(path);
    await importHealthSamples(host, "p1", samples, newId);
    eq("three transactions", txns.length, 3);
    ok("one prepareAsync per chunk", txns.every((x) => x.prepares === 1), JSON.stringify(txns.map((x) => x.prepares)));
    eq("205 executes of the prepared statement in total", txns.reduce((a, x) => a + x.inserts, 0), total);
    ok("the insert is never run through runAsync", txns.every((x) => !x.statements.some((s) => /^INSERT INTO sugar_logs/.test(s))));
    db.close();
  }

  section("G17g. a floor set while the device clock was ahead heals itself");
  {
    const { path, db } = makeDb();
    const realNow = T0 + 24 * 60 * 60_000;
    // "Verileri sil" while the clock ran three days fast.
    await clearProfileLogs(makeHost(path).host, "p1", new Date(realNow + 3 * 86_400_000).toISOString());
    const first = await importAt(makeHost(path).host, "p1", [{ glucose_level_mgdl: 100, period_tag: "unset", logged_at: new Date(realNow - 30 * 60_000).toISOString() }], newId, realNow);
    eq("a reading from before the (corrected) clear moment stays closed", first, 0);
    const floor = (db.prepare("SELECT floor_at FROM health_import_floor WHERE profile_id = 'p1';").get() as { floor_at: string }).floor_at;
    eq("the floor was pulled back to the real now", floor, new Date(realNow).toISOString());
    const later = realNow + 2 * 60 * 60_000;
    const next = await importAt(makeHost(path).host, "p1", [{ glucose_level_mgdl: 105, period_tag: "unset", logged_at: new Date(realNow + 60 * 60_000).toISOString() }], newId, later);
    eq("readings after it import again instead of waiting three days", next, 1);
    db.close();
  }

  section("G3g. importGlucoseOnce never rejects");
  {
    resetAll("ios");
    const S = await import("../lib/services/health");
    fake.glucose = [{ value: 120, date: new Date().toISOString(), period_tag: "unset" }];
    fake.importThrows = true;
    let rejected = "";
    let status = "";
    try {
      status = (await S.importHealthGlucose("P", "background")).status;
    } catch (e) {
      rejected = String(e);
    }
    eq("a locked database does not reject the import", rejected, "");
    eq("it reports status error", status, "error");
    eq("and the last sync says read_failed", (await S.getHealthLastSync())?.error, "read_failed");
    fake.importThrows = false;
    eq("the next pass is fine again", (await S.importHealthGlucose("P", "background")).status, "ok");
  }

  section("CGM-A2a. the real SQL: ids, take-over, deletes and the hourly summaries");
  {
    const { path, db } = makeDb();
    const cgm = (minutes: number, mgdl: number, id: string, app = "com.sensor.a") => ({
      at: iso(minutes),
      mgdl,
      source: "health" as const,
      sourceApp: app,
      externalId: id,
      isCgm: true,
    });
    const run = (rows: ReturnType<typeof cgm>[]) => importGlucoseRows(makeHost(path).host, "p1", rows, newId, T0 + 10 * 86_400_000);

    eq("a flat sensor stretch lands whole", await run([cgm(0, 110, "a"), cgm(5, 110, "b"), cgm(10, 110, "c")]), 3);
    eq("a second run of the same ids adds nothing", await run([cgm(0, 110, "a"), cgm(5, 110, "b")]), 0);
    eq("the columns are written", (db.prepare("SELECT COUNT(*) AS c FROM sugar_logs WHERE source_app = 'com.sensor.a' AND is_cgm = 1 AND external_id IS NOT NULL;").get() as { c: number }).c, 3);

    // A typed row: never taken over, never deleted. A sensor reading beside it is
    // kept (the import never drops a sensor value for a non-sensor row).
    db.exec(`INSERT INTO sugar_logs (id, profile_id, glucose_level_mgdl, source, logged_at) VALUES ('typed','p1',150,'manual','${iso(100)}');`);
    eq("a sensor reading beside a typed row is kept", await run([cgm(101, 150, "t1")]), 1);
    eq("the typed row is unchanged", JSON.stringify(db.prepare("SELECT source, external_id, is_cgm, glucose_level_mgdl FROM sugar_logs WHERE id = 'typed';").get()), JSON.stringify({ source: "manual", external_id: null, is_cgm: 0, glucose_level_mgdl: 150 }));

    // An old Health row (no ids) is taken over once.
    db.exec(`INSERT INTO sugar_logs (id, profile_id, glucose_level_mgdl, source, logged_at, period_tag) VALUES ('old','p1',130,'health','${iso(200)}','unset');`);
    eq("a reading an old release imported is not doubled", await run([cgm(200.5, 130, "u-old")]), 0);
    const owned = db.prepare("SELECT external_id, source_app, is_cgm FROM sugar_logs WHERE id = 'old';").get() as { external_id: string; source_app: string; is_cgm: number };
    eq("it got the id, the app and the sensor flag", `${owned.external_id}|${owned.source_app}|${owned.is_cgm}`, "u-old|com.sensor.a|1");
    eq("the take-over left no tombstone", (db.prepare("SELECT COUNT(*) AS c FROM health_import_tombstones;").get() as { c: number }).c, 0);

    // A source delete removes only its own imported rows.
    db.exec(`INSERT INTO sugar_logs (id, profile_id, glucose_level_mgdl, source, logged_at, external_id) VALUES ('typed2','p1',90,'manual','${iso(300)}','b');`);
    const deleting = makeHost(path);
    const removed = await deleteImportedGlucose(deleting.host, "p1", "health", ["b", "nope"]);
    eq("one imported row removed", removed, 1);
    ok("the source-delete marker is the first statement after the pragma, then the delete", /^INSERT OR IGNORE INTO health_import_source_delete/.test(deleting.txns[0].statements[1] ?? "") && /^UPDATE meal_logs SET sugar_log_id = NULL/.test(deleting.txns[0].statements[2] ?? "") && /^DELETE FROM sugar_logs/.test(deleting.txns[0].statements[3] ?? ""));
    eq("the typed row sharing that id stays", countRows(db, "id = 'typed2'"), 1);
    eq("a manual source cannot be deleted through this door", await deleteImportedGlucose(makeHost(path).host, "p1", "manual" as never, ["b"]), 0);

    // Future-dated and out-of-range sensor values are not stored.
    eq("a reading from the future is rejected", await run([cgm(60 * 24 * 11, 120, "f1")]), 0);
    eq("a sensor value outside 20..600 is rejected", await run([cgm(400, 19, "lo"), cgm(410, 601, "hi")]), 0);
    eq("a typed source cannot be imported", await importGlucoseRows(makeHost(path).host, "p1", [{ at: iso(500), mgdl: 120, source: "manual" as never, isCgm: false }], newId, T0 + 10 * 86_400_000), 0);

    // Verileri sil wipes the summaries too.
    db.exec(`INSERT INTO sugar_hourly VALUES ('p1', '2024-01-01T00:00:00.000Z', 'health', 12, 110.5, 90, 130);`);
    await clearProfileLogs(makeHost(path).host, "p1", iso(1000));
    eq("the hourly summaries are cleared with the readings", (db.prepare("SELECT COUNT(*) AS c FROM sugar_hourly;").get() as { c: number }).c, 0);
    db.close();
  }

  rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.log("test crashed", e);
  process.exit(1);
});
