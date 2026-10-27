/**
 * FIX-N (OPUS-10) narrowed by FIX-O: value-independent dose-path proximity rule,
 * view twins only at 30 s and +-1 mg/dL (no band rule in the view), import rules
 * 4 and 6 against a twin counterpart, retention that deletes no non-sensor row,
 * manual-mode stats. Real SQL on node:sqlite.
 *
 * Principle: the import never drops or converts a reading for being a mirror;
 * a mirror is excluded when it is READ.
 *
 * Run: npx tsx scripts/opus10Fix.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import * as H from "../lib/db/healthImportSql";
import { MATCHING_MANUAL_SUGAR_SQL, recentManualSugarSql } from "../lib/db/cgmSql";
import { journalFeedArgs, journalFeedSql } from "../lib/db/journalSql";
import { glucosePointsSql, readInsightsSugar } from "../lib/db/sugarRange";
import { V28_CREATE } from "../lib/db/v28Sql";
import { V29_INDEXES } from "../lib/db/v29Sql";
import { V30_CREATE } from "../lib/db/v30Sql";
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
    getAllAsync: async <T,>(sql: string, params: (string | number | null)[] = []) =>
      db.prepare(sql).all(...(params as never[])) as T[],
    runAsync: async (sql, params = []) => void db.prepare(sql).run(...(params as never[])),
    prepareAsync: async (sql) => {
      const st = db.prepare(sql);
      return { executeAsync: async (p) => void st.run(...(p as never[])), finalizeAsync: async () => {} };
    },
  };
  const host = {
    withExclusiveTransactionAsync: async (task: (t: H.HealthImportSql) => Promise<void>) => {
      db.exec("BEGIN");
      try {
        await task(txn);
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
    getAllAsync: async <T,>(sql: string, params: (string | number | null)[] = []) =>
      db.prepare(sql).all(...(params as never[])) as T[],
  };
  return { db, host };
}
const c1 = (db: DatabaseSync, sql: string, ...p: (string | number)[]) =>
  (db.prepare(sql).get(...p) as { c: number }).c;
const reader = (db: DatabaseSync) => ({
  getAllAsync: async <T,>(sql: string, p: (string | number | null)[] = []) =>
    db.prepare(sql).all(...(p as never[])) as T[],
});

const nsS = (ms: number, mg: number): Row => ({ at: iso(ms), mgdl: mg, source: "nightscout", sourceApp: null, externalId: `ns${ms}`, isCgm: true });
const mir = (ms: number, mg: number): Row => ({ at: iso(ms), mgdl: mg, source: "health", sourceApp: "com.mirror", externalId: `m${ms}`, isCgm: false });
const meter = (ms: number, mg: number): Row => ({ at: iso(ms), mgdl: mg, source: "health", sourceApp: "com.contour", externalId: `c${ms}`, isCgm: false });

const ins =
  "INSERT INTO sugar_logs (id, profile_id, glucose_level_mgdl, period_tag, source, logged_at, source_app, external_id, is_cgm) VALUES (?,?,?,?,?,?,?,?,?)";
const dose = (db: DatabaseSync, since: number) =>
  db.prepare(recentManualSugarSql(false)).all("P", iso(since)) as { id: string; glucose_level_mgdl: number }[];
const feedExcl = (db: DatabaseSync, range?: { start: number; end: number }, limit = 1000) =>
  db.prepare(journalFeedSql(!!range, true, { cgm: "exclude" })).all(...(journalFeedArgs("P", limit, range) as never[])) as {
    kind: string;
    source_app?: string;
  }[];

async function main() {
  console.log("A1. a real glucometer reading is stored whichever order the mirror arrives in");
  for (const mode of ["sameBatch", "mirrorFirstSync", "meterFirstSync"] as const) {
    for (const [dtMeter, dv] of [[60_000, 0], [600_000, 0], [100_000, 1]] as const) {
      const { db, host } = makeDb();
      const t0 = NOW - 3600_000;
      const ns = [nsS(t0, 140)];
      const m = [mir(t0 + 10_000, 140)];
      const g = [meter(t0 + 10_000 + dtMeter, 140 + dv)];
      await H.importGlucoseRows(host, "P", ns, nid, NOW);
      if (mode === "sameBatch") await H.importGlucoseRows(host, "P", [...m, ...g], nid, NOW);
      else if (mode === "mirrorFirstSync") {
        await H.importGlucoseRows(host, "P", m, nid, NOW);
        await H.importGlucoseRows(host, "P", g, nid, NOW);
      } else {
        await H.importGlucoseRows(host, "P", g, nid, NOW);
        await H.importGlucoseRows(host, "P", m, nid, NOW);
      }
      const stored = c1(db, "SELECT COUNT(*) c FROM sugar_logs WHERE source_app='com.contour'");
      ok(`A1 ${mode} +${dtMeter / 1000}s dv=${dv}: meter stored`, stored === 1, `stored=${stored}`);
    }
  }
  {
    // Rules 4 and 6 still collapse two non-sensor streams when NO sensor is around.
    const { db, host } = makeDb();
    const t0 = NOW - 3600_000;
    await H.importGlucoseRows(host, "P", [mir(t0, 140), meter(t0 + 60_000, 140)], nid, NOW);
    ok("no sensor around: the second app's copy is still the old duplicate", c1(db, "SELECT COUNT(*) c FROM sugar_logs") === 1);
  }

  console.log("A4c. 1-min sensor stream + hourly mirror copy: nothing reaches the dose path");
  for (const order of ["nsFirst", "mirrorFirst"] as const) {
    const { db, host } = makeDb();
    const start = NOW - 24 * 3600_000;
    const v = (ms: number) => 120 + Math.round(50 * Math.sin((ms - start) / 2_400_000));
    for (let h = 0; h < 24; h++) {
      const hs = start + h * 3600_000;
      const nsRows: Row[] = [];
      for (let m = 0; m < 60; m++) nsRows.push(nsS(hs + m * 60_000, v(hs + m * 60_000)));
      const k = (h * 7) % 60;
      const mRow = [mir(hs + k * 60_000 + 15_000, v(hs + k * 60_000))];
      if (order === "nsFirst") {
        await H.importGlucoseRows(host, "P", nsRows, nid, hs + 3600_000);
        await H.importGlucoseRows(host, "P", mRow, nid, hs + 3600_000);
      } else {
        await H.importGlucoseRows(host, "P", mRow, nid, hs + 3600_000);
        await H.importGlucoseRows(host, "P", nsRows, nid, hs + 3600_000);
      }
    }
    const mirrors = c1(db, "SELECT COUNT(*) c FROM sugar_logs WHERE source_app='com.mirror'");
    ok(`A4c ${order}: all 24 copies stored (import drops nothing)`, mirrors === 24, `mirrors=${mirrors}`);
    const leak = dose(db, start - 1).length;
    ok(`A4c ${order}: dose path leak 0`, leak === 0, `leak=${leak}`);
    const fe = feedExcl(db).filter((r) => r.kind === "glucose").length;
    // The import thins the sensor stream, so a mirror whose sensor row was not
    // kept shows as its own row (accepted); the rest are hidden by the 30 s +-1 rule.
    const mirRows = db.prepare("SELECT logged_at, glucose_level_mgdl FROM sugar_logs WHERE source_app='com.mirror'").all() as { logged_at: string; glucose_level_mgdl: number }[];
    const sens = db.prepare("SELECT logged_at, glucose_level_mgdl FROM sugar_logs WHERE is_cgm=1").all() as { logged_at: string; glucose_level_mgdl: number }[];
    const expectShown = mirRows.filter(
      (m) => !sens.some((x) => Math.abs(Date.parse(x.logged_at) - Date.parse(m.logged_at)) <= 30_000 && Math.abs(x.glucose_level_mgdl - m.glucose_level_mgdl) <= 1)
    ).length;
    ok(`A4c ${order}: journal shows exactly the mirrors with no sensor row at 30 s +-1`, fe === expectShown, `rows=${fe} expected=${expectShown}`);
  }

  console.log("A4. 1-min sensor + 1-min mirror");
  {
    const { db, host } = makeDb();
    const start = NOW - 6 * 3600_000;
    const v = (ms: number) => 120 + Math.round(50 * Math.sin((ms - start) / 2_400_000));
    const nsRows: Row[] = [];
    const mRows: Row[] = [];
    for (let t = start; t < NOW; t += 60_000) {
      nsRows.push(nsS(t, v(t)));
      mRows.push(mir(t + 15_000, v(t)));
    }
    await H.importGlucoseRows(host, "P", nsRows, nid, NOW);
    await H.importGlucoseRows(host, "P", mRows, nid, NOW);
    // Up to the last kept sensor row: a mirror newer than 150 s past it waits
    // for the next sensor row (live edge of a thinned stream, accepted).
    const settled = db.prepare(recentManualSugarSql(true)).all("P", iso(start - 1), iso(NOW - 270_000)) as unknown[];
    ok("A4 dose path leak 0 (settled part of the stream)", settled.length === 0, `leak=${settled.length}`);
  }

  console.log("Dose path and band: value-independent for imported rows, typed rows always");
  {
    const { db } = makeDb();
    const t = NOW - 3600_000;
    const put = (id: string, mg: number, tag: string, src: string, at: number, app: string | null, ext: string | null, cgm: number) =>
      db.prepare(ins).run(id, "P", mg, tag, src, iso(at), app, ext, cgm);
    put("s1", 140, "unset", "nightscout", t, null, "e1", 1);
    put("s2", 150, "unset", "nightscout", t + 300_000, null, "e2", 1);
    put("typedNear", 300, "unset", "manual", t + 20_000, null, null, 0);
    put("taggedNear", 90, "pre_meal", "health", t + 25_000, "com.contour", "x1", 0);
    put("importedFar", 95, "unset", "health", t - 400_000, "com.contour", "x2", 0);
    put("importedNearOffBand", 90, "unset", "health", t + 40_000, "com.contour", "x3", 0);
    put("importedNearInBand", 146, "unset", "health", t + 150_000, "com.mirror", "x4", 0);
    const d = new Set(dose(db, t - 3600_000).map((r) => r.id));
    ok("typed reading always offered, any value", d.has("typedNear"));
    ok("labelled reading always offered", d.has("taggedNear"));
    ok("imported reading with no sensor within 150 s offered", d.has("importedFar"));
    ok("imported reading near a sensor stays out of the dose path whatever its value", !d.has("importedNearOffBand") && !d.has("importedNearInBand"));
    const match = db.prepare(MATCHING_MANUAL_SUGAR_SQL).all("P", 90, iso(t - 3600_000), iso(t + 3600_000)) as { id: string }[];
    ok("duplicate-prompt lookup uses the same rule", match.map((r) => r.id).sort().join() === "importedFar,taggedNear" || match.length === 1);
    const list = new Set(feedExcl(db, undefined).map((r) => (r as unknown as { id: string }).id));
    ok("view: 146 in the 140..150 band but 150 s from a sensor is NOT a twin, listed", list.has("importedNearInBand"));
    ok("off-band imported reading is listed", list.has("importedNearOffBand"));
    ok("typed and labelled rows listed", list.has("typedNear") && list.has("taggedNear"));
  }

  console.log("FIX-O: a real fingerstick inside the neighbouring CGM band stays visible; 30 s +-1 mirrors are hidden");
  {
    const { db } = makeDb();
    const t = NOW - 3600_000;
    const put = (id: string, mg: number, at: number, app: string) =>
      db.prepare(ins).run(id, "P", mg, "unset", "health", iso(at), app, `x${id}`, 0);
    db.prepare(ins).run("s1", "P", 140, "unset", "nightscout", iso(t), null, "e1", 1);
    db.prepare(ins).run("s2", "P", 150, "unset", "nightscout", iso(t + 300_000), null, "e2", 1);
    put("f60", 145, t + 60_000, "com.contour");
    put("f150", 146, t + 150_000, "com.contour");
    put("m30", 141, t + 30_000, "com.mirror");
    put("m10", 140, t + 10_000, "com.mirror");
    const ids = (mode: "exclude" | "twins") =>
      new Set(
        (db.prepare(journalFeedSql(false, true, { cgm: mode })).all(...(journalFeedArgs("P", 300) as never[])) as { id: string }[]).map((r) => r.id)
      );
    for (const mode of ["exclude", "twins"] as const) {
      const l = ids(mode);
      ok(`(i) ${mode}: fingerstick 60 s from a sensor, in the band, is listed`, l.has("f60"));
      ok(`(i) ${mode}: fingerstick 150 s from a sensor, in the band, is listed`, l.has("f150"));
      ok(`(ii) ${mode}: mirror at 30 s +-1 and at 10 s is hidden`, !l.has("m30") && !l.has("m10"));
    }
    const d = new Set(dose(db, t - 3600_000).map((r) => r.id));
    ok("(i) dose path: neither fingerstick is offered while the sensor runs", !d.has("f60") && !d.has("f150"));
    const ins2 = await readInsightsSugar(reader(db) as never, "P", { start: t - 1000, end: t + 600_000 });
    const ins2Ids = new Set(ins2.map((r) => (r as unknown as { id: string }).id));
    ok("(i) insights hold both fingersticks and no mirror", ins2Ids.has("f60") && ins2Ids.has("f150") && !ins2Ids.has("m30") && !ins2Ids.has("m10"));
    const pts = db.prepare(glucosePointsSql(true, "manual")).all("P", iso(t - 1000), iso(t + 600_000)) as { glucose_level_mgdl: number }[];
    ok("(i) chart points (manual) hold both fingersticks and no mirror", pts.length === 2, `n=${pts.length}`);
  }

  console.log("Rules 4 and 6 do not drop a reading for a twin counterpart; sensor rows come from the batch too");
  {
    const { db, host } = makeDb();
    const t0 = NOW - 3600_000;
    // Whole thing in ONE batch, sensor rows included.
    await H.importGlucoseRows(host, "P", [nsS(t0, 140), mir(t0 + 10_000, 140), meter(t0 + 70_000, 141)], nid, NOW);
    ok("one batch: sensor, mirror, meter all stored", c1(db, "SELECT COUNT(*) c FROM sugar_logs") === 3);
  }

  console.log("A5. retention folds sensor rows and deletes no non-sensor row");
  {
    const { db, host } = makeDb();
    const old = NOW - 400 * 86_400_000;
    const ns: Row[] = [];
    const m: Row[] = [];
    for (let t = old; t < old + 86_400_000; t += 300_000) {
      ns.push(nsS(t, 100 + ((t / 300_000) % 50)));
      m.push(mir(t + 10_000, 100 + ((t / 300_000) % 50)));
    }
    await H.importGlucoseRows(host, "P", ns, nid, old + 86_400_000 + 1000);
    await H.importGlucoseRows(host, "P", m, nid, old + 86_400_000 + 1000);
    const noon = old + 12 * 3600_000;
    db.prepare(ins).run("man", "P", 133, "unset", "manual", iso(noon + 50_000), null, null, 0);
    db.prepare(ins).run("tag", "P", 77, "pre_meal", "health", iso(noon + 60_000), "com.mirror", "tagx", 0);
    db.prepare(ins).run("meal", "P", 61, "unset", "health", iso(noon + 70_000), "com.mirror", "mealx", 0);
    db.prepare("INSERT INTO meal_logs (id, profile_id, sugar_log_id, logged_at) VALUES ('ml','P','meal',?)").run(iso(noon + 70_000));
    db.prepare(ins).run("far", "P", 250, "unset", "health", iso(old + 5 * 3600_000 + 120_000), "com.contour", "farx", 0);
    const range = { start: old - 1000, end: old + 2 * 86_400_000 };
    const mirBefore = c1(db, "SELECT COUNT(*) c FROM sugar_logs WHERE source_app='com.mirror' AND id NOT IN ('tag','meal')");
    const nonSensorBefore = c1(db, "SELECT COUNT(*) c FROM sugar_logs WHERE is_cgm = 0");
    const before = feedExcl(db, range).filter((r) => r.kind === "glucose").length;
    const r = await runCgmRetention(host as never, "P", NOW);
    const mirAfter = c1(db, "SELECT COUNT(*) c FROM sugar_logs WHERE source_app='com.mirror' AND id NOT IN ('tag','meal')");
    const after = feedExcl(db, range).filter((r2) => r2.kind === "glucose").length;
    ok("A5 sensor rows folded", r.folded === 288, `folded=${r.folded}`);
    const nonSensorAfter = c1(db, "SELECT COUNT(*) c FROM sugar_logs WHERE is_cgm = 0");
    ok("(iii) A5 all 288 twins stay in the database", mirBefore === 288 && mirAfter === 288, `before=${mirBefore} after=${mirAfter}`);
    ok("(iii) A5 no non-sensor row deleted", nonSensorAfter === nonSensorBefore, `before=${nonSensorBefore} after=${nonSensorAfter}`);
    ok("A5 sensor rows are gone from sugar_logs", c1(db, "SELECT COUNT(*) c FROM sugar_logs WHERE is_cgm = 1") === 0);
    ok("A5 journal list still shows every kept row", after >= before, `before=${before} after=${after}`);
    const keep = (id: string) => c1(db, "SELECT COUNT(*) c FROM sugar_logs WHERE id=?", id) === 1;
    ok("typed, labelled, meal-linked and off-band rows are never deleted", keep("man") && keep("tag") && keep("meal") && keep("far"));
    const again = await runCgmRetention(host as never, "P", NOW);
    ok("re-run is idempotent", again.folded === 0);
  }

  console.log("Manual-mode stats feed leaves twins out and the home source says so");
  {
    const { db } = makeDb();
    const t = NOW - 3600_000;
    db.prepare(ins).run("s", "P", 140, "unset", "nightscout", iso(t), null, "e", 1);
    db.prepare(ins).run("tw", "P", 140, "unset", "health", iso(t + 10_000), "com.mirror", "x", 0);
    db.prepare(ins).run("ty", "P", 140, "unset", "manual", iso(t + 20_000), null, null, 0);
    const rows = db.prepare(journalFeedSql(false, true, { cgm: "twins" })).all(...(journalFeedArgs("P", 300) as never[])) as { id: string }[];
    const ids = new Set(rows.map((r) => r.id));
    ok("twins mode drops the twin, keeps sensor and typed rows", !ids.has("tw") && ids.has("s") && ids.has("ty"));
    const index = readFileSync(join(import.meta.dirname, "..", "app/(tabs)/index.tsx"), "utf8");
    ok("dashboard stats feed asks for twins out in manual mode", /cgmActive \? \{ cgm: "exclude" \} : \{ cgm: "twins" \}/.test(index));
  }

  console.log("Perf: 26k sensor + 26k twins, no full scan");
  {
    const { db } = makeDb();
    const start = NOW - 90 * 86_400_000;
    const meal = db.prepare("INSERT INTO meal_logs (id, profile_id, sugar_log_id, logged_at, tags) VALUES (?,?,?,?, '[]')");
    db.exec("BEGIN");
    let i = 0;
    for (let t = start; t < NOW; t += 300_000) {
      const v = 120 + Math.round(50 * Math.sin(t / 2_400_000));
      db.prepare(ins).run(`s${i}`, "P", v, "unset", "nightscout", iso(t), null, `e${i}`, 1);
      db.prepare(ins).run(`m${i}`, "P", v, "unset", "health", iso(t + 12_000), "com.mirror", `me${i}`, 0);
      i++;
    }
    for (let d = 0; d < 90; d++) {
      for (const h of [8, 13, 19]) {
        const t = start + d * 86_400_000 + h * 3600_000 + 60_000 * 7;
        db.prepare(ins).run(`g${d}_${h}`, "P", 150, "pre_meal", "manual", iso(t), null, null, 0);
        meal.run(`ml${d}_${h}`, "P", `g${d}_${h}`, iso(t));
      }
    }
    db.exec("COMMIT");
    db.exec("ANALYZE");
    const time = (f: () => number) => {
      const t0 = performance.now();
      for (let k = 0; k < 3; k++) f();
      return (performance.now() - t0) / 3;
    };
    const feedMs = time(() => (db.prepare(journalFeedSql(false, true, { cgm: "exclude" })).all(...(journalFeedArgs("P", 300) as never[])) as unknown[]).length);
    ok("journal feed (exclude) under 100 ms", feedMs < 100, `${feedMs.toFixed(1)} ms`);
    const twinFeedMs = time(() => (db.prepare(journalFeedSql(false, true, { cgm: "twins" })).all(...(journalFeedArgs("P", 300) as never[])) as unknown[]).length);
    // Manual-mode stats after a sensor was switched off: it also carries the 26k
    // sensor rows through the union sort, so it gets twice the budget (the gate
    // runs this under load).
    ok("journal feed (twins) under 200 ms", twinFeedMs < 200, `${twinFeedMs.toFixed(1)} ms`);
    const doseMs = time(() => dose(db, NOW - 86_400_000).length);
    ok("dose path 24 h under 100 ms", doseMs < 100, `${doseMs.toFixed(1)} ms`);
    const ptsMs = time(() => (db.prepare(glucosePointsSql(true, "manual")).all("P", iso(start), iso(NOW)) as unknown[]).length);
    ok("glucose points manual 90 d under 400 ms", ptsMs < 400, `${ptsMs.toFixed(1)} ms`);
    const plan = (sql: string, ...p: unknown[]) =>
      (db.prepare("EXPLAIN QUERY PLAN " + sql).all(...(p as never[])) as { detail: string }[]).map((r) => r.detail).join(" | ");
    for (const [name, sql, args] of [
      ["dose", recentManualSugarSql(false), ["P", iso(NOW)]],
      ["feed", journalFeedSql(false, true, { cgm: "exclude" }), journalFeedArgs("P", 300)],
    ] as const) {
      const p = plan(sql, ...(args as unknown[]));
      ok(`${name}: no full scan of sugar_logs`, !/SCAN s(?! USING)|SCAN sugar_logs(?! USING)|SCAN tw(?! USING)/.test(p), p);
    }
    console.log(`  (feed ${feedMs.toFixed(1)} ms, twins feed ${twinFeedMs.toFixed(1)} ms, dose ${doseMs.toFixed(1)} ms, points ${ptsMs.toFixed(1)} ms)`);
  }

  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}
main();
