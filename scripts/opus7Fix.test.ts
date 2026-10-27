/**
 * FIX-J (OPUS-7): reverse-order sensor mirror (R6-R8), plus source checks for
 * the smaller findings. Real SQL on node:sqlite.
 *
 * Run: npx tsx scripts/opus7Fix.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

import {
  importGlucoseRows,
  type HealthImportHost,
  type HealthImportSql,
  type ImportedGlucoseRow,
} from "../lib/db/healthImportSql";
import { V28_CREATE } from "../lib/db/v28Sql";
import { V29_INDEXES } from "../lib/db/v29Sql";
import { V30_CREATE } from "../lib/db/v30Sql";
import { recentManualSugarSql } from "../lib/db/cgmSql";
import { deleteNightscoutReadingsWith } from "../lib/nightscout/localData";
import {
  connectNightscout,
  disconnectNightscout,
  nightscoutSecretKey,
  readNightscoutState,
  type NsDeps,
} from "../lib/nightscout/sync";

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
  const sensor = (sec: number, mg: number, ext = "ns1"): ImportedGlucoseRow => ({
    at: T(10, sec), mgdl: mg, source: "nightscout", sourceApp: null, externalId: ext, isCgm: true,
  });
  const mirror = (sec: number, mg: number, ext = "h1"): ImportedGlucoseRow => ({
    at: T(10, sec), mgdl: mg, source: "health", sourceApp: "com.mirror", externalId: ext, isCgm: false,
  });
  const dose = (db: DatabaseSync) => (db.prepare(recentManualSugarSql(false)).all("P", T(-15)) as unknown[]).length;
  const cgmRows = (db: DatabaseSync) => count(db, `SELECT COUNT(*) AS c FROM sugar_logs WHERE is_cgm = 1 AND logged_at >= '${T(0)}'`);
  const recent = (db: DatabaseSync) => count(db, `SELECT COUNT(*) AS c FROM sugar_logs WHERE logged_at >= '${T(0)}'`);
  console.log("1. reverse order: the mirror arrives before the sensor value (nothing is dropped or converted)");
  {
    const a = makeDb();
    await importGlucoseRows(a.host, "P", [mirror(0, 120), sensor(17, 120)], nid, NOW);
    eq("R6 same batch (mirror 17 s earlier): both rows stored", recent(a.db), 2);
    eq("R6 only the sensor row is a sensor row", cgmRows(a.db), 1);
    eq("R6 dose path empty (the mirror is a sensor twin)", dose(a.db), 0);

    const b = makeDb();
    await importGlucoseRows(b.host, "P", [mirror(0, 120)], nid, NOW);
    eq("R7 mirror stored first, plain row", cgmRows(b.db), 0);
    eq("R7 before the sensor value arrives it is the only reading", dose(b.db), 1);
    await importGlucoseRows(b.host, "P", [sensor(17, 120)], nid, NOW);
    eq("R7 sensor arrives later: both rows stored", recent(b.db), 2);
    eq("R7 the mirror row stays a plain row", (b.db.prepare("SELECT is_cgm AS v FROM sugar_logs WHERE external_id='h1'").get() as { v: number }).v, 0);
    eq("R7 dose path empty once the sensor value is there", dose(b.db), 0);
    eq("R7 re-import of both adds nothing", (await importGlucoseRows(b.host, "P", [mirror(0, 120), sensor(17, 120)], nid, NOW)), 0);
    eq("R7 still two rows", recent(b.db), 2);

    const c = makeDb();
    await importGlucoseRows(c.host, "P", [mirror(5, 120)], nid, NOW);
    await importGlucoseRows(c.host, "P", [sensor(0, 121)], nid, NOW);
    eq("R8 dv 1, mirror 5 s later: sensor row and mirror row", cgmRows(c.db) === 1 && recent(c.db) === 2, true);
    eq("R8 dose path empty", dose(c.db), 0);
  }

  console.log("1b. rows that must never change");
  {
    const t = makeDb();
    t.db.prepare("INSERT INTO sugar_logs (id, profile_id, glucose_level_mgdl, period_tag, source, logged_at, source_app, external_id, is_cgm) VALUES ('t1','P',120,'fasting','health',?, 'com.mirror','h9',0)").run(T(10, 0));
    await importGlucoseRows(t.host, "P", [sensor(10, 120)], nid, NOW);
    eq("a labelled row stays a hand-read row", (t.db.prepare("SELECT is_cgm AS v FROM sugar_logs WHERE id='t1'").get() as { v: number }).v, 0);
    eq("and the sensor value is its own row", cgmRows(t.db), 1);

    const m = makeDb();
    m.db.prepare("INSERT INTO sugar_logs (id, profile_id, glucose_level_mgdl, period_tag, source, logged_at, is_cgm) VALUES ('m1','P',120,'unset','manual',?,0)").run(T(10, 0));
    await importGlucoseRows(m.host, "P", [sensor(10, 120)], nid, NOW);
    eq("a manual row is never converted", (m.db.prepare("SELECT is_cgm AS v FROM sugar_logs WHERE id='m1'").get() as { v: number }).v, 0);
    eq("a typed row is never a sensor twin: it stays in the dose path", dose(m.db), 1);

    const far = makeDb();
    await importGlucoseRows(far.host, "P", [mirror(0, 120)], nid, NOW);
    await importGlucoseRows(far.host, "P", [sensor(40, 120)], nid, NOW);
    // FIX-N (OPUS-10): within 150 s of a sensor row of another stream an
    // imported row stays out of the dose path whatever its value; farther it is
    // its own measurement.
    eq("a row 40 s away is out of the dose path (value-independent proximity)", dose(far.db), 0);
    eq("and nothing was converted", cgmRows(far.db), 1);
    const farther = makeDb();
    await importGlucoseRows(farther.host, "P", [mirror(0, 120)], nid, NOW);
    await importGlucoseRows(farther.host, "P", [sensor(200, 120)], nid, NOW);
    eq("a row 200 s from the sensor row stays its own measurement (dose path)", dose(farther.db), 1);

    const meter = makeDb();
    await importGlucoseRows(meter.host, "P", [mirror(0, 120)], nid, NOW);
    await importGlucoseRows(meter.host, "P", [sensor(10, 125)], nid, NOW);
    eq("a value 5 mg/dL off is out of the dose path too (FIX-N: value-independent)", dose(meter.db), 0);
    eq("and both rows exist", count(meter.db), 2);
  }

  console.log("3. the Nightscout row honours the build flag and the secure store");
  {
    const src = readFileSync("app/settings/data-sources.tsx", "utf8");
    ok(
      "data-sources reads the flag from sourceAvailability",
      /import \{ nightscoutAvailable as nightscoutEnabled \} from "\.\.\/\.\.\/lib\/cgm\/sourceAvailability"/.test(src)
    );
    ok("and combines it with the secure store", /nsAvailable = nightscoutEnabled\(\) && nightscoutAvailable\(\)/.test(src));
  }

  console.log("4. profile delete clears Nightscout and waits for idle before the delete");
  {
    const src = readFileSync("app/settings/data.tsx", "utf8");
    const fn = src.slice(src.indexOf("async function onDeleteProfile"));
    ok(
      "clear, idle, then deleteProfile",
      /clearNightscoutForProfile\(activeProfile\.id\);[\s\S]*?awaitNightscoutIdle\(activeProfile\.id\);[\s\S]*?await deleteProfile\(activeProfile\.id\)/.test(fn)
    );
    ok("no clear after the delete", !/await deleteProfile\(activeProfile\.id\)[\s\S]*?clearNightscoutForProfile/.test(fn.slice(0, fn.indexOf("\n  }\n"))));
  }

  console.log("5. deleting Nightscout rows unlinks meal_logs.sugar_log_id");
  {
    const { db, host } = makeDb(V28_CREATE, false);
    await importGlucoseRows(host, "P", [sensor(0, 120)], nid, NOW);
    const id = (db.prepare("SELECT id FROM sugar_logs").get() as { id: string }).id;
    db.prepare("INSERT INTO meal_logs (id, profile_id, sugar_log_id) VALUES ('ml', 'P', ?)").run(id);
    eq("one Nightscout row removed", await deleteNightscoutReadingsWith(host, "P"), 1);
    eq("meal link cleared", (db.prepare("SELECT sugar_log_id AS v FROM meal_logs WHERE id='ml'").get() as { v: string | null }).v, null);
  }

  console.log("6. a disconnect during connect leaves no 'connected, no secret' state");
  {
    const store = new Map<string, string>();
    const sec = new Map<string, string>();
    const resp = (body: unknown) => ({ status: 200, url: "", headers: { get: () => null }, text: async () => JSON.stringify(body) }) as unknown as Response;
    const NSNOW = Date.UTC(2026, 9, 27, 12, 0, 0);
    const deps: NsDeps = {
      storage: { getItem: async (k) => store.get(k) ?? null, setItem: async (k, v) => void store.set(k, v), removeItem: async (k) => void store.delete(k) },
      secure: { get: async (k) => sec.get(k) ?? null, set: async (k, v) => void sec.set(k, v), remove: async (k) => void sec.delete(k) },
      fetchImpl: (async (u: string) => {
        if (u.includes("verifyauth")) return resp({ message: { canRead: true, canWrite: false } });
        return resp(Array.from({ length: 3 }, (_, i) => ({ _id: `i${i}`, type: "sgv", sgv: 100 + i, date: NSNOW - 60_000 * (i + 1) })));
      }) as unknown as typeof fetch,
      now: () => NSNOW,
      insert: async (_p, rows) => rows.length,
    };
    const key = nightscoutSecretKey("p1");
    const realSet = deps.secure!.set;
    let hit = false;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    deps.secure = {
      ...deps.secure!,
      set: async (k, v) => {
        await realSet(k, v);
        hit = true;
        await gate;
      },
    };
    const conn = connectNightscout("p1", { url: "https://ns.example.com", token: "tok-0123456789abcdef" }, deps);
    while (!hit) await new Promise((r) => setTimeout(r, 1));
    await disconnectNightscout("p1", { ...deps, secure: { ...deps.secure!, set: realSet } });
    release();
    const res = await conn;
    const st = await readNightscoutState("p1", deps);
    eq("state and secret agree", st.connected, sec.has(key));
    eq("connect did not report success", res.ok, false);
    eq("not connected", st.connected, false);
  }

  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}
main();
