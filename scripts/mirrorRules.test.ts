/**
 * FIX-K (OPUS-8): sensor mirror rules 4b/4c are decided per SOURCE APP, not per
 * single row. Real SQL on node:sqlite.
 *
 *  F1  a meal-linked (or labelled) stored row never becomes a sensor row
 *  F2  one coincidence does not turn a glucometer app into a sensor, and the
 *      knownCgm hint needs a count, not one row
 *  F3  a stored mirror row whose sensor original was thinned away still folds
 *  R6-R8 reverse-order mirror of a mirroring app (history = reflector)
 *  A1  a mirroring app's 12 copies are not stored
 *  E1  a glucometer reading 60 s from a sensor value stays
 *
 * Run: npx tsx scripts/mirrorRules.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import { DatabaseSync } from "node:sqlite";

import * as Sql from "../lib/db/healthImportSql";
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
  const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
  db.exec(`
    CREATE TABLE user_profiles (id TEXT PRIMARY KEY NOT NULL);
    CREATE TABLE sugar_logs (
      id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL,
      glucose_level_mgdl INTEGER NOT NULL, period_tag TEXT NOT NULL DEFAULT 'unset',
      source TEXT NOT NULL DEFAULT 'manual', logged_at TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]', healthkit_uuid TEXT,
      source_app TEXT, external_id TEXT, is_cgm INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE meal_logs (id TEXT PRIMARY KEY, profile_id TEXT, sugar_log_id TEXT);
    CREATE INDEX idx_meal_sugar_log ON meal_logs (sugar_log_id);
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
  const host: HealthImportHost = {
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
  return { db, host, txn };
}

let seq = 0;
const nid = () => `n${++seq}`;
const NOW = Date.parse("2026-10-27T12:00:00.000Z");
const T = (min: number, sec = 0) => new Date(NOW - 6 * 3600_000 + min * 60_000 + sec * 1000).toISOString();
const count = (db: DatabaseSync, where = "1=1") =>
  (db.prepare(`SELECT COUNT(*) AS c FROM sugar_logs WHERE ${where}`).get() as { c: number }).c;
const dose = (db: DatabaseSync) => (db.prepare(recentManualSugarSql(false)).all("P", T(-600)) as unknown[]).length;

const meter = (min: number, sec: number, mg: number, ext: string, app = "com.ascensia.contour"): ImportedGlucoseRow => ({
  at: T(min, sec), mgdl: mg, source: "health", sourceApp: app, externalId: ext, isCgm: false,
});
const ns = (min: number, sec: number, mg: number, ext: string): ImportedGlucoseRow => ({
  at: T(min, sec), mgdl: mg, source: "nightscout", sourceApp: null, externalId: ext, isCgm: true,
});

/** An app that has copied a Nightscout sensor value 10 s late, eight times, in
 *  the past: stored rows, written straight into the tables. */
function seedMirrorHistory(db: DatabaseSync, app: string, n = 8, daysAgo = 2): void {
  const base = NOW - daysAgo * 86_400_000;
  const ins = db.prepare(
    "INSERT INTO sugar_logs (id, profile_id, glucose_level_mgdl, source, logged_at, source_app, external_id, is_cgm) VALUES (?, 'P', ?, ?, ?, ?, ?, ?)"
  );
  for (let i = 0; i < n; i++) {
    const at = base + i * 600_000;
    const mg = 100 + i * 4;
    ins.run(`hs${app}${i}`, mg, "nightscout", new Date(at).toISOString(), null, `hist-ns-${app}-${i}`, 1);
    ins.run(`hm${app}${i}`, mg, "health", new Date(at + 10_000).toISOString(), app, `hist-m-${app}-${i}`, 0);
  }
}

async function main(): Promise<void> {
  console.log("1. F1: a meal-linked stored row never becomes a sensor row");
  for (const reflector of [false, true]) {
    const { db, host } = makeDb();
    if (reflector) seedMirrorHistory(db, "com.ascensia.contour");
    await importGlucoseRows(host, "P", [meter(10, 0, 72, "hk-m1")], nid, NOW);
    const id = (db.prepare("SELECT id FROM sugar_logs WHERE external_id='hk-m1'").get() as { id: string }).id;
    db.prepare("INSERT INTO meal_logs VALUES ('meal1','P',?)").run(id);
    const base = dose(db);
    await importGlucoseRows(host, "P", [ns(10, 3, 73, "ns-1")], nid, NOW);
    const row = db.prepare("SELECT is_cgm FROM sugar_logs WHERE id=?").get(id) as { is_cgm: number };
    eq(`F1${reflector ? " (mirroring app)" : ""}: the linked row stays a hand-read row`, row.is_cgm, 0);
    eq(`F1${reflector ? " (mirroring app)" : ""}: dose path keeps the reading`, dose(db), base);
  }

  console.log("2. F2: one coincidence does not make a glucometer app a sensor");
  {
    const { db, host } = makeDb();
    await importGlucoseRows(host, "P", [meter(10, 0, 72, "hk-m1")], nid, NOW);
    await importGlucoseRows(host, "P", [ns(10, 20, 73, "ns-1")], nid, NOW);
    eq("F2: 20 s apart, not a mirror of a known app: the meter row stays plain", count(db, "external_id='hk-m1' AND is_cgm=0"), 1);
    await importGlucoseRows(host, "P", [meter(240, 0, 180, "hk-m2")], nid, NOW);
    eq("F2: the next reading of that app is stored as a hand reading", count(db, "external_id='hk-m2' AND is_cgm=0"), 1);
    ok("F2: and sits in the dose path / journal", dose(db) >= 2);

    // The exact-copy case (3 s) does convert the one row, but one row is no history.
    const b = makeDb();
    await importGlucoseRows(b.host, "P", [meter(10, 0, 72, "hk-m1")], nid, NOW);
    await importGlucoseRows(b.host, "P", [ns(10, 3, 72, "ns-1")], nid, NOW);
    eq("F2: a 3 s exact copy is still folded into the sensor row", count(b.db, "external_id='hk-m1' AND is_cgm=1"), 1);
    const sql = (Sql as Record<string, unknown>).knownCgmSql as undefined | ((clause: string) => string);
    const minRows = (Sql as Record<string, unknown>).KNOWN_CGM_MIN_ROWS as number | undefined;
    ok("F2: knownCgmSql / KNOWN_CGM_MIN_ROWS are exported", typeof sql === "function" && minRows === 12);
    if (typeof sql === "function" && typeof minRows === "number") {
      const q = sql("source_app = ?");
      const since = new Date(NOW - 30 * 86_400_000).toISOString();
      const known = (d: DatabaseSync) => ((d.prepare(q).get("P", "health", "com.ascensia.contour", since) as { c: number }).c >= minRows);
      eq("F2: one sensor row: knownCgm false", known(b.db), false);
      const ins = b.db.prepare(
        "INSERT INTO sugar_logs (id, profile_id, glucose_level_mgdl, source, logged_at, source_app, external_id, is_cgm) VALUES (?, 'P', 100, 'health', ?, 'com.ascensia.contour', ?, 1)"
      );
      for (let i = 0; i < 10; i++) ins.run(`k${i}`, T(100 + i * 5), `kx${i}`);
      eq("F2: 11 sensor rows: knownCgm false", known(b.db), false);
      ins.run("k10", T(200), "kx10");
      eq("F2: 12 sensor rows: knownCgm true", known(b.db), true);
    }
  }

  console.log("3. F3: a mirroring app's stored row folds even when the sensor original is thinned away");
  {
    const { db, host } = makeDb();
    seedMirrorHistory(db, "com.mirror");
    await importGlucoseRows(host, "P", [{ at: T(11, 0), mgdl: 140, source: "health", sourceApp: "com.mirror", externalId: "mx", isCgm: false }], nid, NOW);
    const stream: ImportedGlucoseRow[] = [];
    for (let i = 0; i <= 10; i++) stream.push(ns(10 + i, 0, 130 + i * 10, `s${i}`));
    await importGlucoseRows(host, "P", stream, nid, NOW);
    eq("F3: the mirror row is a sensor row now", count(db, "external_id='mx' AND is_cgm=1"), 1);
    eq("F3: dose path holds no mirror copy", dose(db), 0);
  }

  console.log("4. R6-R8: reverse order mirror of a mirroring app");
  {
    const mirror = (sec: number, mg: number, ext = "h1"): ImportedGlucoseRow => ({
      at: T(10, sec), mgdl: mg, source: "health", sourceApp: "com.mirror", externalId: ext, isCgm: false,
    });
    const sensor = (sec: number, mg: number): ImportedGlucoseRow => ({
      at: T(10, sec), mgdl: mg, source: "nightscout", sourceApp: null, externalId: "ns1", isCgm: true,
    });
    const a = makeDb();
    seedMirrorHistory(a.db, "com.mirror");
    await importGlucoseRows(a.host, "P", [mirror(0, 120), sensor(17, 120)], nid, NOW);
    eq("R6: sensor row kept, mirror not stored", count(a.db, "external_id IN ('ns1','h1') AND is_cgm=1"), 1);
    eq("R6: mirror absent", count(a.db, "external_id='h1'"), 0);
    eq("R6: dose path empty", dose(a.db), 0);

    const b = makeDb();
    seedMirrorHistory(b.db, "com.mirror");
    await importGlucoseRows(b.host, "P", [mirror(0, 120)], nid, NOW);
    eq("R7: mirror stored first, plain row", count(b.db, "external_id='h1' AND is_cgm=0"), 1);
    await importGlucoseRows(b.host, "P", [sensor(17, 120)], nid, NOW);
    eq("R7: that row is a sensor row now", count(b.db, "external_id='h1' AND is_cgm=1"), 1);
    eq("R7: dose path empty", dose(b.db), 0);
    eq("R7: re-import adds nothing", await importGlucoseRows(b.host, "P", [mirror(0, 120), sensor(17, 120)], nid, NOW), 0);

    const c = makeDb();
    seedMirrorHistory(c.db, "com.mirror");
    await importGlucoseRows(c.host, "P", [mirror(5, 120)], nid, NOW);
    await importGlucoseRows(c.host, "P", [sensor(0, 121)], nid, NOW);
    eq("R8: dv 1, mirror 5 s later: sensor row", count(c.db, "external_id='h1' AND is_cgm=1"), 1);
    eq("R8: dose path empty", dose(c.db), 0);

    const lone = makeDb();
    await importGlucoseRows(lone.host, "P", [mirror(0, 120)], nid, NOW);
    await importGlucoseRows(lone.host, "P", [sensor(17, 120)], nid, NOW);
    eq("R7 without history: a single 17 s match is a fingerstick, it stays", count(lone.db, "external_id='h1' AND is_cgm=0"), 1);
    eq("R7 without history: the fingerstick is the only row (a typed-like neighbour wins, as for a manual row)", count(lone.db), 1);
  }

  console.log("5. A1: a mirroring app's copies of stored sensor values are not stored");
  {
    const { db, host } = makeDb();
    const sens: ImportedGlucoseRow[] = Array.from({ length: 36 }, (_, i) => ns(i * 5, 0, 140 + (i % 9), `ns${i}`));
    await importGlucoseRows(host, "P", sens, nid, NOW);
    const mir: ImportedGlucoseRow[] = sens
      .filter((_, i) => i % 3 === 0)
      .map((r, k) => ({ at: new Date(Date.parse(r.at) + 30_000).toISOString(), mgdl: r.mgdl, source: "health" as const, sourceApp: "com.example.sugarwidget", externalId: `hk${k}`, isCgm: false }));
    eq("A1: 12 of 12 copies dropped", await importGlucoseRows(host, "P", mir, nid, NOW), 0);
    eq("A1: dose path empty", dose(db), 0);
  }

  console.log("6. E1 and statistics");
  {
    const { db, host } = makeDb();
    await importGlucoseRows(host, "P", [ns(10, 0, 120, "ns1")], nid, NOW);
    eq("E1: a glucometer reading 60 s away is stored", await importGlucoseRows(host, "P", [meter(11, 0, 120, "m1")], nid, NOW), 1);
    eq("E1: and is a hand reading", count(db, "external_id='m1' AND is_cgm=0"), 1);

    // 7 readings of a glucometer app, 1 coincidence (14 %): not a mirroring app.
    const g = makeDb();
    const sens: ImportedGlucoseRow[] = Array.from({ length: 40 }, (_, i) => ns(i * 5, 0, 100 + i, `ns${i}`));
    await importGlucoseRows(g.host, "P", sens, nid, NOW);
    const mine: ImportedGlucoseRow[] = [
      meter(0, 20, 100, "g0"), meter(33, 0, 222, "g1"), meter(61, 0, 150, "g2"), meter(93, 0, 60, "g3"),
      meter(121, 0, 180, "g4"), meter(152, 0, 90, "g5"), meter(181, 0, 77, "g6"),
    ];
    // g0 sits 20 s after ns0 (100), same value: the coincidence
    eq("stat: 7 readings, one coincidence: all 7 are stored", await importGlucoseRows(g.host, "P", mine, nid, NOW), 7);
    eq("stat: the coincident reading is kept as a hand reading", count(g.db, "external_id='g0' AND is_cgm=0"), 1);
    eq("stat: nothing of that app became a sensor row", count(g.db, "source_app='com.ascensia.contour' AND is_cgm=1"), 0);

    // A tagged stored row is the user's, even for a mirroring app.
    const t = makeDb();
    seedMirrorHistory(t.db, "com.mirror");
    t.db.prepare("INSERT INTO sugar_logs (id, profile_id, glucose_level_mgdl, period_tag, source, logged_at, source_app, external_id, is_cgm) VALUES ('tg','P',120,'fasting','health',?, 'com.mirror','h9',0)").run(T(10, 0));
    await importGlucoseRows(t.host, "P", [ns(10, 10, 120, "ns9")], nid, NOW);
    eq("tagged row never converted", count(t.db, "id='tg' AND is_cgm=0"), 1);
  }

  console.log("7. the reflector decision is O(n log n)");
  {
    const find = (Sql as Record<string, unknown>).findMirrorStreams as
      | undefined
      | ((plain: { atMs: number; mgdl: number; stream: string }[], sensor: { atMs: number; mgdl: number; stream: string }[]) => Set<string>);
    ok("findMirrorStreams is exported", typeof find === "function");
    if (typeof find === "function") {
      const N = 26_000;
      const sensor = Array.from({ length: N }, (_, i) => ({ atMs: i * 300_000, mgdl: 100 + (i % 50), stream: "ns" }));
      const plain = sensor.map((s) => ({ atMs: s.atMs + 20_000, mgdl: s.mgdl, stream: "mirror" }));
      const t0 = Date.now();
      const set = find(plain, sensor);
      const ms = Date.now() - t0;
      ok("26k x 26k decided under 2 s", ms < 2000, `${ms} ms`);
      eq("the mirror is found", set.has("mirror"), true);
      const five = find(plain.slice(0, 5), sensor);
      eq("5 matching readings are not enough", five.has("mirror"), false);
      const six = find(plain.slice(0, 6), sensor);
      eq("6 of 6 are", six.has("mirror"), true);
      const mixed = plain.slice(0, 10).map((p, i) => (i < 7 ? p : { ...p, mgdl: p.mgdl + 40 }));
      eq("7 of 10 (70 %) is not", find(mixed, sensor).has("mirror"), false);
      const eight = plain.slice(0, 10).map((p, i) => (i < 8 ? p : { ...p, mgdl: p.mgdl + 40 }));
      eq("8 of 10 (80 %) is", find(eight, sensor).has("mirror"), true);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
