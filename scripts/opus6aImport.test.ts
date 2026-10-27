/**
 * FIX-G (OPUS-6a): CGM import findings, each as a permanent scenario against the
 * REAL SQL on node:sqlite.
 *
 *  1. a non-sensor Health app mirroring a stored sensor value (<= 10 s, +-1 mg/dL)
 *     is not stored again as a hand-read row; a meter reading a minute away stays
 *  2. a database that reached v28/v30 before the source-delete marker existed is
 *     repaired on open (marker table, current trigger)
 *  3. readings of one app written within 30 s of each other count once for the
 *     cadence detector
 *  4. a source delete / retention fold on the transaction connection (foreign
 *     keys off) still clears meal_logs.sugar_log_id
 *
 * Run: npx tsx scripts/opus6aImport.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import { DatabaseSync } from "node:sqlite";

import {
  deleteImportedGlucose,
  importGlucoseRows,
  type HealthImportHost,
  type HealthImportSql,
  type ImportedGlucoseRow,
} from "../lib/db/healthImportSql";
import { V28_CREATE } from "../lib/db/v28Sql";
import { V29_INDEXES } from "../lib/db/v29Sql";
import { V30_CREATE } from "../lib/db/v30Sql";
import { recentManualSugarSql } from "../lib/db/cgmSql";
import { repairV28SourceDeleteGuard } from "../lib/db/migrations";
import { detectCgmSource } from "../lib/cgm/detect";
import { runCgmRetention } from "../lib/cgm/retention";

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

/** foreignKeys false mimics expo-sqlite's Transaction connection (foreign_keys=0). */
function makeDb(v28: string[] = V28_CREATE, foreignKeys = true) {
  const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: foreignKeys });
  db.exec(`
    CREATE TABLE user_profiles (id TEXT PRIMARY KEY NOT NULL);
    CREATE TABLE sugar_logs (
      id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL,
      glucose_level_mgdl INTEGER NOT NULL, period_tag TEXT NOT NULL DEFAULT 'unset',
      source TEXT NOT NULL DEFAULT 'manual', logged_at TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]', healthkit_uuid TEXT,
      source_app TEXT, external_id TEXT, is_cgm INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (profile_id) REFERENCES user_profiles (id) ON DELETE CASCADE
    );
    CREATE TABLE meal_logs (id TEXT PRIMARY KEY, profile_id TEXT, sugar_log_id TEXT,
      FOREIGN KEY (sugar_log_id) REFERENCES sugar_logs (id) ON DELETE SET NULL);
    INSERT INTO user_profiles VALUES ('P');
  `);
  for (const s of v28) db.exec(s);
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
const count = (db: DatabaseSync, sql = "SELECT COUNT(*) AS c FROM sugar_logs") =>
  (db.prepare(sql).get() as { c: number }).c;

const NOW = Date.parse("2026-10-27T12:00:00.000Z");
const T = (min: number, sec = 0) => new Date(NOW - 6 * 3600_000 + min * 60_000 + sec * 1000).toISOString();

async function main(): Promise<void> {
  console.log("1. a second Health app mirroring a stored sensor value");
  {
    const { db, host } = makeDb();
    const ns: ImportedGlucoseRow[] = Array.from({ length: 36 }, (_, i) => ({
      at: T(i * 5), mgdl: 140 + (i % 9), source: "nightscout", sourceApp: null, externalId: `ns${i}`, isCgm: true,
    }));
    await importGlucoseRows(host, "P", ns, nid, NOW);
    const mirror: ImportedGlucoseRow[] = ns
      .filter((_, i) => i % 3 === 0)
      .map((r, k) => ({
        at: new Date(Date.parse(r.at) + (k % 2 === 0 ? 5_000 : 10_000)).toISOString(),
        mgdl: r.mgdl + (k % 2 === 0 ? 0 : 1),
        source: "health" as const,
        sourceApp: "com.example.sugarwidget",
        externalId: `hk${k}`,
        isCgm: false,
      }));
    eq("mirror of stored sensor rows is not stored", await importGlucoseRows(host, "P", mirror, nid, NOW), 0);
    eq("nothing reaches the dose path", (db.prepare(recentManualSugarSql(false)).all("P", T(-15)) as unknown[]).length, 0);

    const b = makeDb();
    const both: ImportedGlucoseRow[] = [
      { at: T(10), mgdl: 103, source: "health", sourceApp: "com.dexcom.G7", externalId: "s", isCgm: true },
      { at: T(10, 4), mgdl: 103, source: "health", sourceApp: "com.example.sugarwidget", externalId: "m", isCgm: false },
    ];
    eq("mirror inside the same batch is dropped", await importGlucoseRows(b.host, "P", both, nid, NOW), 1);
    eq("and the sensor row is the one that stays", count(b.db, "SELECT COUNT(*) AS c FROM sugar_logs WHERE is_cgm = 1"), 1);

    // opus5a item 1 stays: a meter reading a minute away (+-1) is its own measurement
    const c = makeDb();
    const meterBatch: ImportedGlucoseRow[] = [
      { at: T(10), mgdl: 103, source: "health", sourceApp: "com.dexcom.G7", externalId: "s", isCgm: true },
      { at: T(11), mgdl: 104, source: "health", sourceApp: "com.meter", externalId: "m", isCgm: false },
    ];
    eq("meter 60 s away is kept (same batch)", await importGlucoseRows(c.host, "P", meterBatch, nid, NOW), 2);
    const d = makeDb();
    await importGlucoseRows(d.host, "P", [meterBatch[0]], nid, NOW);
    eq("meter 60 s away is kept (stored sensor)", await importGlucoseRows(d.host, "P", [meterBatch[1]], nid, NOW), 1);
    const e = makeDb();
    await importGlucoseRows(e.host, "P", [meterBatch[0]], nid, NOW);
    eq(
      "a differing value 5 s away is kept",
      await importGlucoseRows(e.host, "P", [{ ...meterBatch[1], at: T(10, 5), mgdl: 112 }], nid, NOW),
      1
    );
  }

  console.log("2. a database from before the marker table is repaired on open");
  {
    const OLD_V28 = V28_CREATE.filter((s) => !s.includes("health_import_source_delete (")).map((s) =>
      s.replace(/\s+AND NOT EXISTS \(SELECT 1 FROM health_import_source_delete\)/, "")
    );
    const { db, host } = makeDb(OLD_V28);
    await importGlucoseRows(host, "P", [{ at: T(10), mgdl: 130, source: "health", sourceApp: "a", externalId: "u1", isCgm: true }], nid, NOW);
    let threw = false;
    try {
      await deleteImportedGlucose(host, "P", "health", ["u1"]);
    } catch {
      threw = true;
    }
    ok("before the repair the source delete fails (the reported defect)", threw);

    const adapter = {
      execAsync: async (sql: string) => void db.exec(sql),
      getAllAsync: async (sql: string, p: unknown[] = []) => db.prepare(sql).all(...(p as never[])),
      withTransactionAsync: async (fn: () => Promise<void>) => {
        db.exec("BEGIN;");
        try {
          await fn();
          db.exec("COMMIT;");
        } catch (err) {
          db.exec("ROLLBACK;");
          throw err;
        }
      },
    } as unknown as Parameters<typeof repairV28SourceDeleteGuard>[0];
    await repairV28SourceDeleteGuard(adapter);
    await repairV28SourceDeleteGuard(adapter);
    eq("after the repair the source delete works", await deleteImportedGlucose(host, "P", "health", ["u1"]), 1);
    eq("and leaves no tombstone", count(db, "SELECT COUNT(*) AS c FROM health_import_tombstones"), 0);
    db.exec("INSERT INTO sugar_logs (id, profile_id, glucose_level_mgdl, source, logged_at) VALUES ('h','P',111,'health','2026-01-01T00:00:00.000Z')");
    db.exec("DELETE FROM sugar_logs WHERE id = 'h'");
    eq("the user's own delete still leaves one", count(db, "SELECT COUNT(*) AS c FROM health_import_tombstones"), 1);

    // a current database is left alone (no schema write on every open)
    const cur = makeDb();
    const stmts: string[] = [];
    const spy = {
      execAsync: async (sql: string) => void stmts.push(sql),
      getAllAsync: async (sql: string, p: unknown[] = []) => cur.db.prepare(sql).all(...(p as never[])),
      withTransactionAsync: async (fn: () => Promise<void>) => fn(),
    } as unknown as Parameters<typeof repairV28SourceDeleteGuard>[0];
    await repairV28SourceDeleteGuard(spy);
    eq("a current database gets no DDL", stmts.length, 0);
  }

  console.log("3. copies shifted by a second do not pass for a cadence");
  {
    const day0 = NOW - 20 * 3600_000;
    const copies: { atMs: number }[] = [];
    for (let r = 0; r < 6; r++) for (let d = 0; d < 6; d++) copies.push({ atMs: day0 + r * 3 * 3600_000 + d * 1000 });
    eq("6 daily readings x6 (1 s apart) are not a sensor", detectCgmSource(copies, { sourceApp: "com.meter.sync" }).isCgm, false);

    const fiveMin: { atMs: number }[] = [];
    for (let i = 0; i < 100; i++) for (let d = 0; d < 3; d++) fiveMin.push({ atMs: day0 + i * 5 * 60_000 + d * 1000 });
    eq("a real 5 minute stream (even with copies) is still a sensor", detectCgmSource(fiveMin, { sourceApp: "x" }).isCgm, true);
    const oneMin: { atMs: number }[] = [];
    for (let i = 0; i < 300; i++) oneMin.push({ atMs: day0 + i * 60_000 });
    eq("a 1 minute stream is still a sensor", detectCgmSource(oneMin, { sourceApp: "x" }).isCgm, true);
  }

  console.log("4. foreign keys off on the transaction connection");
  {
    const { db, host } = makeDb(V28_CREATE, false);
    eq("scratch connection has foreign_keys=0", (db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys, 0);
    await importGlucoseRows(host, "P", [{ at: T(10), mgdl: 130, source: "health", sourceApp: "a", externalId: "u1", isCgm: true }], nid, NOW);
    const id = (db.prepare("SELECT id FROM sugar_logs").get() as { id: string }).id;
    db.prepare("INSERT INTO meal_logs VALUES ('m1','P',?)").run(id);
    await deleteImportedGlucose(host, "P", "health", ["u1"]);
    eq("source delete clears the meal link", count(db, "SELECT COUNT(*) AS c FROM meal_logs WHERE sugar_log_id IS NOT NULL"), 0);
    eq("and keeps the meal", count(db, "SELECT COUNT(*) AS c FROM meal_logs"), 1);

    const r = makeDb(V28_CREATE, false);
    r.db.exec(`INSERT INTO sugar_logs (id, profile_id, glucose_level_mgdl, source, logged_at, is_cgm, external_id)
      VALUES ('old','P',120,'health','2024-01-01T10:00:00.000Z',1,'e-old'), ('new','P',121,'health','2026-10-01T10:00:00.000Z',1,'e-new');
      INSERT INTO meal_logs VALUES ('mo','P','old'), ('mn','P','new');`);
    const res = await runCgmRetention(r.host, "P", NOW);
    eq("retention folded the old row", res.folded, 1);
    eq("the folded row's meal link is cleared", count(r.db, "SELECT COUNT(*) AS c FROM meal_logs WHERE id = 'mo' AND sugar_log_id IS NULL"), 1);
    eq("a kept row's meal link stays", count(r.db, "SELECT COUNT(*) AS c FROM meal_logs WHERE id = 'mn' AND sugar_log_id = 'new'"), 1);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}
main();
