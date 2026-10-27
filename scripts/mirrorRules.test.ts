/**
 * FIX-L (OPUS-9): the import never drops or converts a reading for being a
 * "mirror" (a non-sensor app copying a sensor value). The mirror is told apart
 * when rows are READ (cgmSql notSensorTwinSql: non-sensor, not typed, a sensor
 * row of another stream within 30 s and +-1 mg/dL). Real SQL on node:sqlite,
 * incremental importGlucoseRows sequences.
 *
 *  S1-S4  sensor first / Health first / mixed batch / random order race:
 *         no sensor reading lost, no mirror converted, no twin in the dose path
 *         or the journal list
 *  F1     a meal-linked (or labelled) stored row never becomes a sensor row
 *  F2     one coincidence does not make a glucometer app a sensor; knownCgm
 *         needs a count
 *  E1     a glucometer reading 60 s from a sensor value is in the DB; while a
 *         sensor runs it is out of the dose path and the journal list (FIX-N)
 *  L1     the accepted limit: a fingerstick inside 30 s and +-1 mg/dL stays in
 *         the database, only leaves the dose path and the journal list
 *  Q1     insights / report point reads leave twins out; the plans use idx_sugar_cgm
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
import { MATCHING_MANUAL_SUGAR_SQL, recentManualSugarSql } from "../lib/db/cgmSql";
import { journalFeedArgs, journalFeedSql } from "../lib/db/journalSql";
import { glucosePointsSql, readInsightsSugar } from "../lib/db/sugarRange";

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
    CREATE INDEX idx_sugar_profile ON sugar_logs (profile_id, logged_at DESC);
    CREATE TABLE meal_logs (id TEXT PRIMARY KEY, profile_id TEXT, sugar_log_id TEXT, logged_at TEXT, tags TEXT,
      food_id TEXT, custom_food_name TEXT, portion_g REAL, calculated_carbs_g REAL, insulin_dose_units REAL,
      photo_uri_local TEXT, personal_note TEXT);
    CREATE INDEX idx_meal_sugar_log ON meal_logs (sugar_log_id);
    CREATE TABLE foods (id TEXT PRIMARY KEY, name_tr TEXT, name_en TEXT, name_de TEXT, name_es TEXT, name_fr TEXT,
      name_it TEXT, name_pt TEXT, name_ar TEXT, name_ja TEXT, category TEXT);
    CREATE TABLE injection_logs (id TEXT PRIMARY KEY, profile_id TEXT, logged_at TEXT, tags TEXT, source TEXT,
      site TEXT, site_point TEXT, dose_units REAL, insulin_type TEXT, bolus_kind TEXT, note TEXT,
      insulin_product_id TEXT, insulin_product_other TEXT);
    CREATE TABLE med_logs (id TEXT PRIMARY KEY, profile_id TEXT, taken_at INTEGER, note TEXT, name TEXT);
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
const iso = (ms: number) => new Date(ms).toISOString();
const T = (min: number, sec = 0) => iso(NOW - 6 * 3600_000 + min * 60_000 + sec * 1000);
const count = (db: DatabaseSync, where = "1=1") =>
  (db.prepare(`SELECT COUNT(*) AS c FROM sugar_logs WHERE ${where}`).get() as { c: number }).c;
const dose = (db: DatabaseSync, since = T(-600)) =>
  (db.prepare(recentManualSugarSql(false)).all("P", since) as unknown[]).length;
const journalGlucose = (db: DatabaseSync, cgm: "include" | "exclude"): number =>
  (
    db.prepare(journalFeedSql(false, false, { cgm })).all(...(journalFeedArgs("P", 100_000) as never[])) as {
      kind: string;
    }[]
  ).filter((r) => r.kind === "glucose").length;

const meter = (min: number, sec: number, mg: number, ext: string, app = "com.ascensia.contour"): ImportedGlucoseRow => ({
  at: T(min, sec), mgdl: mg, source: "health", sourceApp: app, externalId: ext, isCgm: false,
});
const ns = (min: number, sec: number, mg: number, ext: string): ImportedGlucoseRow => ({
  at: T(min, sec), mgdl: mg, source: "nightscout", sourceApp: null, externalId: ext, isCgm: true,
});

const val = (ms: number) => 90 + Math.round(60 * Math.sin(ms / 3_600_000));
const nsAt = (ms: number): ImportedGlucoseRow => ({
  at: iso(ms), mgdl: val(ms), source: "nightscout", sourceApp: null, externalId: `ns${ms}`, isCgm: true,
});
const copyAt = (ms: number, secLate: number): ImportedGlucoseRow => ({
  at: iso(ms + secLate * 1000), mgdl: val(ms), source: "health", sourceApp: "com.mirror", externalId: `m${ms}`, isCgm: false,
});

/** Hourly syncs: 12 sensor readings plus one mirror copy per hour. `order(h)` says
 *  which side is imported first in that hour; `late(h)` is the copy's lateness
 *  in seconds. */
async function incremental(hours: number, order: (h: number) => "ns" | "health" | "batch", late: (h: number) => number) {
  const { db, host } = makeDb();
  const base = NOW - (hours + 1) * 3600_000;
  const all: ImportedGlucoseRow[] = [];
  for (let h = 0; h < hours; h++) {
    const hs = base + h * 3600_000;
    const sensors: ImportedGlucoseRow[] = [];
    for (let m = 0; m < 60; m += 5) sensors.push(nsAt(hs + m * 60_000));
    const t0 = hs + 5 * ((h * 7) % 12) * 60_000;
    const copy = [copyAt(t0, late(h))];
    const now = hs + 3600_000;
    const o = order(h);
    if (o === "ns") {
      await importGlucoseRows(host, "P", sensors, nid, now);
      await importGlucoseRows(host, "P", copy, nid, now);
    } else if (o === "health") {
      await importGlucoseRows(host, "P", copy, nid, now);
      await importGlucoseRows(host, "P", sensors, nid, now);
    } else {
      await importGlucoseRows(host, "P", [...sensors, ...copy], nid, now);
    }
    all.push(...sensors, ...copy);
  }
  const again = await importGlucoseRows(host, "P", all, nid, NOW);
  return {
    again,
    nsLost: hours * 12 - count(db, "source='nightscout'"),
    copies: count(db, "source_app='com.mirror' AND is_cgm=0"),
    copiesAsSensor: count(db, "source_app='com.mirror' AND is_cgm=1"),
    leaked: dose(db, iso(base)),
    journalRows: journalGlucose(db, "exclude"),
  };
}

async function main(): Promise<void> {
  console.log("1. S1-S3: incremental sequences (24 hours, one copy an hour)");
  for (const [name, order] of [
    ["sensor first, Health after", () => "ns" as const],
    ["Health first, sensor after", () => "health" as const],
    ["same batch", () => "batch" as const],
  ] as const) {
    const r = await incremental(24, order, (h) => 5 + (h % 25));
    eq(`${name}: 24 of 24 hours of sensor readings kept`, r.nsLost, 0);
    eq(`${name}: every copy stored as it came`, r.copies, 24);
    eq(`${name}: no copy became a sensor row`, r.copiesAsSensor, 0);
    eq(`${name}: no copy in the dose path`, r.leaked, 0);
    eq(`${name}: no copy in the journal list`, r.journalRows, 0);
    eq(`${name}: a full re-read adds nothing`, r.again, 0);
  }

  console.log("2. S4: a 7 day random order race (P(Health first) 0.2 and 0.5), copy 0-30 s late");
  for (const p of [0.2, 0.5]) {
    let s = 42;
    const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    const r = await incremental(168, () => (rnd() < p ? "health" : "ns"), () => Math.floor(rnd() * 30));
    eq(`P=${p}: no sensor reading lost`, r.nsLost, 0);
    eq(`P=${p}: no copy converted`, r.copiesAsSensor, 0);
    eq(`P=${p}: no copy in the dose path`, r.leaked, 0);
    eq(`P=${p}: no copy in the journal list`, r.journalRows, 0);
    eq(`P=${p}: every copy still stored`, r.copies, 168);
  }

  console.log("3. a first big sync of 30 days, then the next day's readings in either order");
  {
    const { db, host } = makeDb();
    const start = NOW - 30 * 86_400_000;
    const rows: ImportedGlucoseRow[] = [];
    for (let t = start; t < NOW - 3600_000; t += 300_000) rows.push(nsAt(t));
    for (let t = start + 1_200_000; t < NOW - 3600_000; t += 3 * 3600_000) rows.push(copyAt(t, 17));
    await importGlucoseRows(host, "P", rows, nid, NOW);
    eq("no sensor reading of the 30 days lost", count(db, "source='nightscout'"), rows.filter((r) => r.isCgm).length);
    eq(
      "every copy stored, none as a sensor row",
      count(db, "source_app='com.mirror' AND is_cgm=0"),
      rows.filter((r) => !r.isCgm).length
    );
    eq("no copy in the dose path", dose(db, iso(start - 1000)), 0);
    eq("no copy in the journal list", journalGlucose(db, "exclude"), 0);
    const later = [nsAt(NOW - 1800_000), copyAt(NOW - 1800_000, 12)];
    await importGlucoseRows(host, "P", [later[1]], nid, NOW);
    await importGlucoseRows(host, "P", [later[0]], nid, NOW);
    eq("a sensor reading arriving after its copy is stored", count(db, `external_id='${later[0].externalId}'`), 1);
    eq("still no copy in the dose path", dose(db, iso(start - 1000)), 0);
  }

  console.log("4. F1: a meal-linked stored row never becomes a sensor row");
  {
    const { db, host } = makeDb();
    await importGlucoseRows(host, "P", [meter(10, 0, 72, "hk-m1")], nid, NOW);
    const id = (db.prepare("SELECT id FROM sugar_logs WHERE external_id='hk-m1'").get() as { id: string }).id;
    db.prepare("INSERT INTO meal_logs (id, profile_id, sugar_log_id) VALUES ('meal1','P',?)").run(id);
    await importGlucoseRows(host, "P", [ns(10, 3, 73, "ns-1")], nid, NOW);
    const row = db.prepare("SELECT is_cgm FROM sugar_logs WHERE id=?").get(id) as { is_cgm: number };
    eq("F1: the linked row stays a hand-read row", row.is_cgm, 0);
    eq("F1: the sensor value is stored beside it", count(db, "external_id='ns-1' AND is_cgm=1"), 1);
    eq(
      "F1: re-import changes nothing",
      await importGlucoseRows(host, "P", [meter(10, 0, 72, "hk-m1"), ns(10, 3, 73, "ns-1")], nid, NOW),
      0
    );
  }

  console.log("5. F2: one coincidence does not make a glucometer app a sensor");
  {
    const { db, host } = makeDb();
    await importGlucoseRows(host, "P", [meter(10, 0, 72, "hk-m1")], nid, NOW);
    await importGlucoseRows(host, "P", [ns(10, 3, 72, "ns-1")], nid, NOW);
    eq("F2: a 3 s exact copy is not converted either", count(db, "external_id='hk-m1' AND is_cgm=0"), 1);
    await importGlucoseRows(host, "P", [meter(240, 0, 180, "hk-m2")], nid, NOW);
    eq("F2: the next reading of that app is stored as a hand reading", count(db, "external_id='hk-m2' AND is_cgm=0"), 1);
    ok("F2: and sits in the dose path", dose(db) >= 1);

    const sql = (Sql as Record<string, unknown>).knownCgmSql as undefined | ((clause: string) => string);
    const minRows = (Sql as Record<string, unknown>).KNOWN_CGM_MIN_ROWS as number | undefined;
    ok("F2: knownCgmSql / KNOWN_CGM_MIN_ROWS are exported", typeof sql === "function" && minRows === 12);
    if (typeof sql === "function" && typeof minRows === "number") {
      const q = sql("source_app = ?");
      const since = new Date(NOW - 30 * 86_400_000).toISOString();
      const known = (d: DatabaseSync) =>
        (d.prepare(q).get("P", "health", "com.ascensia.contour", since) as { c: number }).c >= minRows;
      eq("F2: the coincidence leaves no sensor row of that app: knownCgm false", known(db), false);
      const ins = db.prepare(
        "INSERT INTO sugar_logs (id, profile_id, glucose_level_mgdl, source, logged_at, source_app, external_id, is_cgm) VALUES (?, 'P', 100, 'health', ?, 'com.ascensia.contour', ?, 1)"
      );
      for (let i = 0; i < 11; i++) ins.run(`k${i}`, T(100 + i * 5), `kx${i}`);
      eq("F2: 11 sensor rows: knownCgm false", known(db), false);
      ins.run("k11", T(200), "kx11");
      eq("F2: 12 sensor rows: knownCgm true", known(db), true);
    }
  }

  console.log("6. E1: a glucometer reading 60 s from a sensor value");
  {
    const { db, host } = makeDb();
    await importGlucoseRows(host, "P", [ns(10, 0, 120, "ns1")], nid, NOW);
    eq("E1: stored", await importGlucoseRows(host, "P", [meter(11, 0, 120, "m1")], nid, NOW), 1);
    eq("E1: a hand reading", count(db, "external_id='m1' AND is_cgm=0"), 1);
    // FIX-N (OPUS-10): a Health reading within 150 s of a sensor value (+-1) is
    // read as the sensor value mirrored; it stays in the database but leaves the
    // dose path (the user can type it) and the journal list.
    eq("E1: out of the dose path while the sensor runs", dose(db), 0);
    eq(
      "E1: out of the calculator's own matching query",
      (db.prepare(MATCHING_MANUAL_SUGAR_SQL).all("P", 120, T(0), T(30)) as unknown[]).length,
      0
    );
    eq("E1: out of the journal list (counted in the sensor summary)", journalGlucose(db, "exclude"), 0);
    eq("E1: the full journal still has both rows", journalGlucose(db, "include"), 2);
    const both = makeDb();
    await importGlucoseRows(both.host, "P", [ns(10, 0, 120, "ns1"), meter(11, 0, 120, "m1")], nid, NOW);
    eq("E1: same in one batch", dose(both.db), 0);
    eq("E1: both stored in one batch", count(both.db, "1=1"), 2);
  }

  console.log("7. L1: the accepted limit, a fingerstick inside 30 s and +-1 mg/dL of a sensor value");
  {
    const { db, host } = makeDb();
    await importGlucoseRows(host, "P", [ns(10, 0, 120, "ns1"), meter(10, 20, 121, "m1")], nid, NOW);
    eq("L1: kept in the database", count(db, "external_id='m1'"), 1);
    eq("L1: still a hand reading (Health keeps it too)", count(db, "external_id='m1' AND is_cgm=0"), 1);
    eq("L1: out of the dose path", dose(db), 0);
    eq(
      "L1: out of the matching query",
      (db.prepare(MATCHING_MANUAL_SUGAR_SQL).all("P", 121, T(0), T(30)) as unknown[]).length,
      0
    );
    eq("L1: out of the journal list (counted in the sensor summary)", journalGlucose(db, "exclude"), 0);
    eq("L1: the full journal (reports) still has both rows", journalGlucose(db, "include"), 2);
  }

  console.log("8. what is never a twin");
  {
    const { db, host } = makeDb();
    db.prepare("INSERT INTO sugar_logs (id, profile_id, glucose_level_mgdl, source, logged_at) VALUES ('typed','P',120,'manual',?)").run(
      T(10, 5)
    );
    await importGlucoseRows(host, "P", [ns(10, 0, 120, "ns1")], nid, NOW);
    eq("a typed row beside a sensor value stays in the dose path", dose(db), 1);
    eq("and in the journal list", journalGlucose(db, "exclude"), 1);

    const same = makeDb();
    await importGlucoseRows(same.host, "P", [{ ...ns(10, 0, 120, "a"), source: "health", sourceApp: "com.app" }], nid, NOW);
    await importGlucoseRows(same.host, "P", [meter(10, 10, 120, "b", "com.app")], nid, NOW);
    eq("a plain row of the SAME stream as the sensor row is not a twin", dose(same.db), 1);

    const diffValue = makeDb();
    await importGlucoseRows(diffValue.host, "P", [ns(10, 0, 120, "a"), meter(10, 10, 123, "b")], nid, NOW);
    eq("3 mg/dL apart is out of the dose path (value-independent proximity)", dose(diffValue.db), 0);
    eq("3 mg/dL apart is not a twin: it stays in the journal list", journalGlucose(diffValue.db, "exclude"), 1);
  }

  console.log("9. Q1: insights and report reads leave twins out; plans use idx_sugar_cgm");
  {
    const { db, host } = makeDb();
    await importGlucoseRows(host, "P", [ns(10, 0, 120, "ns1"), meter(10, 10, 120, "mirror"), meter(30, 0, 150, "real")], nid, NOW);
    const reader = {
      getAllAsync: async <T,>(sql: string, p: (string | number | null)[]) => db.prepare(sql).all(...(p as never[])) as T[],
    };
    const range = { start: NOW - 24 * 3600_000, end: NOW + 3600_000 };
    const pts = await readInsightsSugar(reader, "P", range);
    eq("insights: sensor row plus the real fingerstick, not the mirror", pts.length, 2);
    ok("insights: the mirror is absent", !pts.some((p) => p.logged_at === T(10, 10)));
    const bounds = [iso(range.start), iso(range.end)];
    eq("points all: 2", (db.prepare(glucosePointsSql(true, "all")).all("P", ...bounds) as unknown[]).length, 2);
    eq("points manual: 1", (db.prepare(glucosePointsSql(true, "manual")).all("P", ...bounds) as unknown[]).length, 1);
    eq("points cgm: 1", (db.prepare(glucosePointsSql(true, "cgm")).all("P", ...bounds) as unknown[]).length, 1);

    const planOf = (sql: string, p: (string | number)[]) =>
      (db.prepare("EXPLAIN QUERY PLAN " + sql).all(...(p as never[])) as { detail: string }[]).map((r) => r.detail).join(" | ");
    for (const [name, plan] of [
      ["recentManualSugarSql", planOf(recentManualSugarSql(false), ["P", T(-60)])],
      ["MATCHING_MANUAL_SUGAR_SQL", planOf(MATCHING_MANUAL_SUGAR_SQL, ["P", 120, T(0), T(30)])],
      ["journal exclude", planOf(journalFeedSql(false, false, { cgm: "exclude" }), ["P", "P", "P", "P", 100])],
      ["points all", planOf(glucosePointsSql(true, "all"), ["P", bounds[0], bounds[1]])],
    ] as const) {
      ok(`${name}: the twin lookup uses idx_sugar_cgm`, /tw USING INDEX idx_sugar_cgm/.test(plan), plan);
      ok(`${name}: no full table scan of sugar_logs`, !/SCAN (s|sugar_logs|tw)\b/.test(plan), plan);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
