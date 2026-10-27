/**
 * FIX-P (OPUS-11): dose path sees a sensor row up to 6 h BEFORE a non-sensor row
 * (live edge: the sensor feed lags), and in a CGM context import rules 4 and 6
 * do not drop a non-sensor candidate for a non-manual non-sensor row of another
 * stream. Real SQL on node:sqlite.
 *
 * Run: npx tsx scripts/opus11Fix.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import { DatabaseSync } from "node:sqlite";
import * as H from "../lib/db/healthImportSql";
import { MATCHING_MANUAL_SUGAR_SQL, recentManualSugarSql } from "../lib/db/cgmSql";
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

type Row = H.ImportedGlucoseRow;
const NOW = Date.parse("2026-10-27T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
let seq = 0;
const nid = () => `n${++seq}`;

function makeDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE user_profiles (id TEXT PRIMARY KEY NOT NULL);
    CREATE TABLE med_logs (id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL, taken_at INTEGER NOT NULL, name TEXT, note TEXT, created_at INTEGER NOT NULL);
    CREATE TABLE foods (id TEXT PRIMARY KEY NOT NULL, name_tr TEXT, name_en TEXT, name_de TEXT, name_es TEXT, name_fr TEXT, name_it TEXT, name_pt TEXT, name_ar TEXT, name_ja TEXT, category TEXT);
    CREATE TABLE sugar_logs (id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL,
      glucose_level_mgdl INTEGER NOT NULL, period_tag TEXT NOT NULL DEFAULT 'unset',
      source TEXT NOT NULL DEFAULT 'manual', logged_at TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', healthkit_uuid TEXT,
      source_app TEXT, external_id TEXT, is_cgm INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE meal_logs (id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL, sugar_log_id TEXT, food_id TEXT,
      custom_food_name TEXT, portion_g REAL, calculated_carbs_g REAL, insulin_dose_units REAL,
      photo_uri_local TEXT, personal_note TEXT, logged_at TEXT NOT NULL, tags TEXT, meal_template_id TEXT);
    CREATE TABLE injection_logs (id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL, site TEXT, site_point INTEGER,
      dose_units REAL, insulin_type TEXT, bolus_kind TEXT, meal_log_id TEXT, note TEXT, source TEXT, logged_at TEXT NOT NULL, tags TEXT,
      insulin_product_id TEXT, insulin_product_other TEXT);
    CREATE INDEX idx_sugar_profile ON sugar_logs (profile_id, logged_at DESC);
    CREATE INDEX idx_meal_sugar_log ON meal_logs (sugar_log_id);
    CREATE INDEX idx_meal_profile ON meal_logs (profile_id, logged_at DESC);
    CREATE INDEX idx_inj_profile ON injection_logs (profile_id, logged_at DESC);
    INSERT INTO user_profiles VALUES ('P');`);
  for (const s of V28_CREATE) db.exec(s);
  for (const s of V29_INDEXES) db.exec(s);
  for (const s of V30_CREATE) db.exec(s);
  const txn: H.HealthImportSql = {
    execAsync: async (sql) => void db.exec(sql),
    getAllAsync: async <T,>(sql: string, params: (string | number | null)[] = []) => db.prepare(sql).all(...(params as never[])) as T[],
    runAsync: async (sql, params = []) => void db.prepare(sql).run(...(params as never[])),
    prepareAsync: async (sql) => { const st = db.prepare(sql); return { executeAsync: async (p) => void st.run(...(p as never[])), finalizeAsync: async () => {} }; },
  };
  const host = {
    withExclusiveTransactionAsync: async (task: (t: H.HealthImportSql) => Promise<void>) => { db.exec("BEGIN"); try { await task(txn); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } },
    getAllAsync: async <T,>(sql: string, params: (string | number | null)[] = []) => db.prepare(sql).all(...(params as never[])) as T[],
  };
  return { db, host };
}
const c1 = (db: DatabaseSync, sql: string, ...p: (string | number)[]) => (db.prepare(sql).get(...p) as { c: number }).c;

const nsS = (ms: number, mg: number): Row => ({ at: iso(ms), mgdl: mg, source: "nightscout", sourceApp: null, externalId: `ns${ms}`, isCgm: true });
const mir = (ms: number, mg: number): Row => ({ at: iso(ms), mgdl: mg, source: "health", sourceApp: "com.mirror", externalId: `m${ms}`, isCgm: false });
const meter = (ms: number, mg: number): Row => ({ at: iso(ms), mgdl: mg, source: "health", sourceApp: "com.contour", externalId: `c${ms}`, isCgm: false });
const dexH = (ms: number, mg: number): Row => ({ at: iso(ms), mgdl: mg, source: "health", sourceApp: "com.dexcom.G7", externalId: `d${ms}`, isCgm: true });
const recent = (db: DatabaseSync, since: number) => db.prepare(recentManualSugarSql(false)).all("P", iso(since)) as { id: string; glucose_level_mgdl: number; logged_at: string }[];
const match = (db: DatabaseSync, mg: number, at: number) => db.prepare(MATCHING_MANUAL_SUGAR_SQL).get("P", mg, iso(at - 900_000), iso(at + 900_000)) as { id: string } | undefined;
const v = (ms: number) => 120 + Math.round(50 * Math.sin(ms / 2_400_000));

const cnt = (db: DatabaseSync, app: string) => c1(db, "SELECT COUNT(*) c FROM sugar_logs WHERE source_app = ?", app);

(async () => {
  // E1: NS synced last at T-6 min, Health brings a mirror copy of the live value.
  {
    const { db, host } = makeDb(); const T = NOW;
    const ns: Row[] = []; for (let t = T - 3 * 3600_000; t <= T - 360_000; t += 300_000) ns.push(nsS(t, v(t)));
    await H.importGlucoseRows(host, "P", ns, nid, T - 360_000);
    await H.importGlucoseRows(host, "P", [mir(T - 20_000, v(T))], nid, T);
    ok("E1 calculator offer empty at live edge", recent(db, T - 15 * 60_000).length === 0, JSON.stringify(recent(db, T - 15 * 60_000)));
    ok("E1 entry guard / meal match finds no mirror row", !match(db, v(T), T));
    await H.importGlucoseRows(host, "P", [nsS(T, v(T))], nid, T + 60_000);
    ok("E1 after NS catches up: still empty", recent(db, T - 15 * 60_000).length === 0);
  }
  // E1b: Dexcom through Health 3 h late, live mirror app.
  {
    const { db, host } = makeDb(); const T = NOW;
    const dx: Row[] = []; for (let t = T - 24 * 3600_000; t <= T - 3 * 3600_000; t += 300_000) dx.push(dexH(t, v(t)));
    await H.importGlucoseRows(host, "P", [...dx, mir(T - 30_000, v(T))], nid, T);
    ok("E1b Dexcom 3 h late: calculator offer empty", recent(db, T - 15 * 60_000).length === 0, JSON.stringify(recent(db, T - 15 * 60_000)));
    ok("E1b meal match finds no mirror row", !match(db, v(T), T));
  }
  // E1 controls: typed, labelled and meal-linked rows stay offered.
  {
    const { db, host } = makeDb(); const T = NOW;
    const ns: Row[] = []; for (let t = T - 3 * 3600_000; t <= T - 360_000; t += 300_000) ns.push(nsS(t, v(t)));
    await H.importGlucoseRows(host, "P", ns, nid, T - 360_000);
    db.prepare("INSERT INTO sugar_logs (id, profile_id, glucose_level_mgdl, source, logged_at) VALUES ('man','P',130,'manual',?)").run(iso(T - 60_000));
    db.prepare("INSERT INTO sugar_logs (id, profile_id, glucose_level_mgdl, source, period_tag, logged_at, source_app) VALUES ('tag','P',131,'health','fasting',?, 'com.contour')").run(iso(T - 120_000));
    db.prepare("INSERT INTO sugar_logs (id, profile_id, glucose_level_mgdl, source, logged_at, source_app) VALUES ('lnk','P',132,'health',?, 'com.contour')").run(iso(T - 180_000));
    db.prepare("INSERT INTO meal_logs (id, profile_id, sugar_log_id, logged_at) VALUES ('m1','P','lnk',?)").run(iso(T - 180_000));
    const ids = recent(db, T - 15 * 60_000).map((r) => r.id).sort().join(",");
    ok("E1 control: manual, labelled and meal-linked rows offered", ids === "lnk,man,tag", ids);
  }
  {
    const { db } = makeDb(); const T = NOW;
    db.prepare("INSERT INTO sugar_logs (id, profile_id, glucose_level_mgdl, source, logged_at, source_app, is_cgm) VALUES ('s','P',120,'nightscout',?,NULL,1)").run(iso(T - 7 * 3600_000));
    db.prepare("INSERT INTO sugar_logs (id, profile_id, glucose_level_mgdl, source, logged_at, source_app) VALUES ('f','P',140,'health',?, 'com.contour')").run(iso(T - 60_000));
    ok("E1 control: sensor 7 h earlier does not hide a fingerstick", recent(db, T - 15 * 60_000).length === 1);
    db.prepare("UPDATE sugar_logs SET logged_at = ? WHERE id = 's'").run(iso(T - 5 * 3600_000));
    ok("E1 sensor 5 h earlier puts the row in a CGM context", recent(db, T - 15 * 60_000).length === 0);
  }
  // E2: Health batch (1 min mirror + meter) vs Nightscout, both orders.
  for (const variant of ["rule6", "rule4"] as const) {
    const T = NOW;
    const mirRows: Row[] = []; for (let t = T - 20 * 60_000; t <= T; t += 60_000) mirRows.push(mir(t + 10_000, v(t)));
    const mAt = variant === "rule6" ? T - 14 * 60_000 : T - 8 * 60_000 - 60_000;
    const mVal = variant === "rule6" ? v(T - 4 * 60_000) : v(T - 8 * 60_000) + 1;
    const meterRow = meter(mAt, mVal);
    const nsBatch = (): Row[] => { const ns: Row[] = []; for (let t = T - 30 * 60_000; t <= T; t += 60_000) ns.push(nsS(t, v(t))); return ns; };
    {
      const { db, host } = makeDb();
      await H.importGlucoseRows(host, "P", nsBatch(), nid, T);
      await H.importGlucoseRows(host, "P", [...mirRows, meterRow], nid, T + 60_000);
      ok(`E2 ${variant} NS stored first: meter kept`, cnt(db, "com.contour") === 1, String(cnt(db, "com.contour")));
      const before = c1(db, "SELECT COUNT(*) c FROM sugar_logs");
      await H.importGlucoseRows(host, "P", [...mirRows, meterRow], nid, T + 120_000);
      ok(`E2 ${variant} idempotent re-read`, c1(db, "SELECT COUNT(*) c FROM sugar_logs") === before);
    }
    {
      // sensor feed lags: its last row is 25 min old, no sensor row within 150 s of the meter
      const { db, host } = makeDb();
      const ns: Row[] = []; for (let t = T - 3 * 3600_000; t <= T - 25 * 60_000; t += 60_000) ns.push(nsS(t, v(t)));
      await H.importGlucoseRows(host, "P", ns, nid, T - 25 * 60_000);
      await H.importGlucoseRows(host, "P", [...mirRows, meterRow], nid, T);
      ok(`E2d ${variant} sensor feed lags 25 min: meter kept`, cnt(db, "com.contour") === 1, String(cnt(db, "com.contour")));
      await H.importGlucoseRows(host, "P", [...mirRows, meterRow], nid, T + 60_000);
      ok(`E2d ${variant} lag, re-read idempotent`, cnt(db, "com.contour") === 1);
    }
    {
      const { db, host } = makeDb();
      const dx: Row[] = []; for (let t = T - 30 * 60_000; t <= T; t += 300_000) dx.push(dexH(t, v(t)));
      await H.importGlucoseRows(host, "P", [...mirRows, meterRow, ...dx], nid, T);
      ok(`E2 ${variant} sensor in same batch: meter kept`, cnt(db, "com.contour") === 1, String(cnt(db, "com.contour")));
    }
    {
      const { db, host } = makeDb();
      await H.importGlucoseRows(host, "P", [...mirRows, meterRow], nid, T);
      await H.importGlucoseRows(host, "P", nsBatch(), nid, T + 60_000);
      await H.importGlucoseRows(host, "P", [...mirRows, meterRow], nid, T + 120_000);
      ok(`E2 ${variant} Health first, NS later, re-read: meter kept`, cnt(db, "com.contour") === 1, String(cnt(db, "com.contour")));
    }
  }
  // E2c control: NS first, the same Health batch.
  {
    const { db, host } = makeDb(); const T = NOW;
    const ns: Row[] = []; for (let t = T - 30 * 60_000; t <= T; t += 60_000) ns.push(nsS(t, v(t)));
    await H.importGlucoseRows(host, "P", ns, nid, T);
    const mirRows: Row[] = []; for (let t = T - 20 * 60_000; t <= T; t += 60_000) mirRows.push(mir(t + 10_000, v(t)));
    await H.importGlucoseRows(host, "P", [...mirRows, meter(T - 14 * 60_000, v(T - 4 * 60_000))], nid, T + 60_000);
    ok("E2c NS first control: meter kept", cnt(db, "com.contour") === 1);
  }
  // Unchanged: same-stream de-duplication and typed rows still block inside a CGM context.
  {
    const { db, host } = makeDb(); const T = NOW;
    const ns: Row[] = []; for (let t = T - 60 * 60_000; t <= T; t += 300_000) ns.push(nsS(t, v(t)));
    await H.importGlucoseRows(host, "P", ns, nid, T);
    await H.importGlucoseRows(host, "P", [meter(T - 600_000, 140), { ...meter(T - 300_000, 140), externalId: "c2" }], nid, T);
    ok("same stream, same value in 15 min: one row", cnt(db, "com.contour") === 1, String(cnt(db, "com.contour")));
    db.prepare("INSERT INTO sugar_logs (id, profile_id, glucose_level_mgdl, source, logged_at) VALUES ('man','P',150,'manual',?)").run(iso(T - 1_200_000));
    await H.importGlucoseRows(host, "P", [{ ...meter(T - 1_150_000, 150), sourceApp: "com.accuchek", externalId: "a1" }], nid, T);
    ok("typed reading still blocks the same Health value", cnt(db, "com.accuchek") === 0);
  }
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
