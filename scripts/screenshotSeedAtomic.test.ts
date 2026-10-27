/**
 * lib/db/screenshotSeedRows.ts: the store-screenshot seed's wipe-and-recreate
 * steps must converge on exactly one language's rows, whatever else is
 * writing to the database at the time.
 *
 * Section A is the reproducer of the K14 Android capture defect (today's carbs
 * 187 instead of 135): the pre-fix seedMeals sequence (one autocommit
 * statement at a time on the shared connection) runs while another code
 * path's transaction on that same connection rolls back. Sections B-F run the
 * real functions from lib/db/screenshotSeedRows.ts against node:sqlite, with
 * withExclusiveTransactionAsync mirrored the way expo-sqlite implements it
 * (a new connection, BEGIN, task, COMMIT or ROLLBACK, close).
 *
 * Run: npx tsx scripts/screenshotSeedAtomic.test.ts
 */
process.env.TZ = "UTC";

import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildCgmManualPoints, buildCgmSchedule, buildGlucoseSchedule } from "../lib/db/screenshotGlucose";
import { sourceBadgeKind } from "../lib/cgm/sourceLabel";
import { V29_COLUMNS, V29_INDEXES } from "../lib/db/v29Sql";
import {
  clearSeedCgm,
  replaceSeedCgm,
  replaceSeedMeals,
  replaceSeedStory,
  replaceSeedTemplates,
  runSeedTransaction,
  type SeedMealRow,
  type SeedSql,
  type SeedStory,
  type SeedTxnHost,
} from "../lib/db/screenshotSeedRows";

let passed = 0;
let failed = 0;
function eq<T>(name: string, actual: T, expected: T): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed++;
  else {
    failed++;
    console.log(`  ✗ ${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  }
}

const P = "00000000-0000-4000-8000-000000000001";
const dir = mkdtempSync(join(tmpdir(), "seed-atomic-"));
let fileNo = 0;

function freshDb(): { file: string; shared: DatabaseSync } {
  const file = join(dir, `t${fileNo++}.db`);
  const shared = new DatabaseSync(file);
  shared.exec("PRAGMA journal_mode = WAL;");
  shared.exec(`
    CREATE TABLE app_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
    CREATE TABLE meal_logs (
      id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL, sugar_log_id TEXT,
      food_id TEXT, custom_food_name TEXT, portion_g REAL NOT NULL DEFAULT 0,
      calculated_carbs_g REAL NOT NULL DEFAULT 0, insulin_dose_units REAL NOT NULL DEFAULT 0,
      photo_uri_local TEXT, personal_note TEXT, logged_at TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]', meal_template_id TEXT, health_uuid TEXT);
    CREATE TABLE sugar_logs (
      id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL,
      glucose_level_mgdl INTEGER NOT NULL,
      period_tag TEXT NOT NULL DEFAULT 'manual'
        CHECK (period_tag IN ('fasting','pre_meal','post_meal_2h','bedtime','manual','unset')),
      source TEXT NOT NULL DEFAULT 'manual', logged_at TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]', healthkit_uuid TEXT);
    CREATE TABLE injection_logs (
      id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL, site TEXT,
      site_point INTEGER CHECK (site_point IS NULL OR site_point BETWEEN 1 AND 4),
      dose_units REAL, insulin_type TEXT CHECK (insulin_type IN ('basal','bolus')),
      meal_log_id TEXT, note TEXT, source TEXT NOT NULL DEFAULT 'manual',
      logged_at TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', bolus_kind TEXT,
      insulin_product_id TEXT, insulin_product_other TEXT, health_uuid TEXT);
    CREATE TABLE med_logs (
      id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL, taken_at INTEGER NOT NULL,
      name TEXT, note TEXT, created_at INTEGER NOT NULL);
    CREATE TABLE meal_templates (
      id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL, name TEXT NOT NULL,
      slot TEXT CHECK (slot IS NULL OR slot IN ('breakfast','lunch','dinner')),
      sort_order INTEGER NOT NULL DEFAULT 0, use_count INTEGER NOT NULL DEFAULT 0,
      last_used_at TEXT, created_at TEXT NOT NULL);
    CREATE TABLE meal_template_items (
      id TEXT PRIMARY KEY NOT NULL, template_id TEXT NOT NULL, food_id TEXT,
      name_snapshot TEXT NOT NULL, carb_100g_snapshot REAL NOT NULL DEFAULT 0,
      portion_g REAL NOT NULL DEFAULT 0, carbs_g_fixed REAL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      CHECK (food_id IS NOT NULL OR TRIM(name_snapshot) <> ''));
  `);
  return { file, shared };
}

// Every statement yields first, like an expo-sqlite native call does, so
// concurrent passes really interleave.
function sqlOf(db: DatabaseSync): SeedSql {
  return {
    async runAsync(source, params) {
      await new Promise<void>((r) => setImmediate(r));
      return db.prepare(source).run(...params);
    },
  };
}

function exclusiveHost(file: string, counter: { attempts: number }): SeedTxnHost {
  return {
    async withExclusiveTransactionAsync(task) {
      counter.attempts++;
      const conn = new DatabaseSync(file);
      try {
        conn.exec("BEGIN");
        try {
          await task(sqlOf(conn));
          conn.exec("COMMIT");
        } catch (e) {
          conn.exec("ROLLBACK");
          throw e;
        }
      } finally {
        conn.close();
      }
    },
  };
}

const CARBS = [38, 45, 52];
function mealRows(names: string[]): SeedMealRow[] {
  return names.map((name, i) => ({
    name,
    carbs: CARBS[i],
    portionG: 200,
    dose: Math.round((CARBS[i] / 10) * 2) / 2,
    loggedAt: `2026-10-19T${["05", "10", "16"][i]}:15:00.000Z`,
  }));
}
const DE = mealRows(["🥣 Haferbrei", "🥗 Linsensuppe", "🍲 Hähnchen & Gemüse"]);
const IT = mealRows(["🥣 Porridge d'avena", "🥗 Zuppa di lenticchie", "🍲 Pollo con verdure"]);

function meals(db: DatabaseSync): { n: number; carbs: number; names: string[] } {
  const rows = db
    .prepare("SELECT custom_food_name AS name, calculated_carbs_g AS carbs FROM meal_logs WHERE profile_id = ? ORDER BY logged_at, name")
    .all(P) as { name: string; carbs: number }[];
  return { n: rows.length, carbs: rows.reduce((s, r) => s + r.carbs, 0), names: rows.map((r) => r.name) };
}

/** The pre-fix seedMeals, statement for statement: listMealLogs (newest first),
 *  deleteMealLog per row, addMealLog per row, each its own autocommit
 *  statement on the app's shared connection. `after` runs between statements. */
async function legacySeedMeals(
  shared: DatabaseSync,
  rows: SeedMealRow[],
  after: (statementNo: number) => void
): Promise<void> {
  let no = 0;
  const ids = (shared
    .prepare("SELECT id FROM meal_logs WHERE profile_id = ? ORDER BY logged_at DESC")
    .all(P) as { id: string }[]).map((r) => r.id);
  for (const id of ids) {
    await new Promise<void>((r) => setImmediate(r));
    shared.prepare("DELETE FROM meal_logs WHERE id = ?").run(id);
    after(++no);
  }
  for (const r of rows) {
    await new Promise<void>((res) => setImmediate(res));
    shared
      .prepare(
        "INSERT INTO meal_logs (id, profile_id, custom_food_name, portion_g, calculated_carbs_g, insulin_dose_units, logged_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(`legacy-${Math.random()}`, P, r.name, r.portionG, r.carbs, r.dose, r.loggedAt);
    after(++no);
  }
}

/** Another code path's withTransactionAsync on the shared connection (BEGIN,
 *  its own write, then a failure: expo-sqlite rolls back the connection). */
function openForeignTransaction(shared: DatabaseSync): void {
  shared.exec("BEGIN");
  shared.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('foreign', '1')").run();
}

async function main(): Promise<void> {
  // A. Reproducer: pre-fix sequence, foreign rollback right after the first delete.
  {
    const { shared } = freshDb();
    await legacySeedMeals(shared, DE, () => {});
    eq("A0 de seeded", meals(shared).carbs, 135);
    openForeignTransaction(shared);
    await legacySeedMeals(shared, IT, (no) => {
      if (no === 1) shared.exec("ROLLBACK");
    });
    const m = meals(shared);
    eq("A1 pre-fix: one previous-language meal survives (187 = 135 + 52)", [m.n, m.carbs], [4, 187]);
    eq("A2 pre-fix: the survivor is the de dinner", m.names.includes("🍲 Hähnchen & Gemüse"), true);
  }

  // B. Fixed step under the same foreign transaction: waits for it, then lands whole.
  {
    const { file, shared } = freshDb();
    const counter = { attempts: 0 };
    const host = exclusiveHost(file, counter);
    await runSeedTransaction(host, (t) => replaceSeedMeals(t, P, DE), 20, 5);
    openForeignTransaction(shared);
    setTimeout(() => shared.exec("ROLLBACK"), 30);
    await runSeedTransaction(host, (t) => replaceSeedMeals(t, P, IT), 50, 5);
    const m = meals(shared);
    eq("B1 fixed: exactly the three it meals", [m.n, m.carbs], [3, 135]);
    eq("B2 fixed: no de row left", m.names, IT.map((r) => r.name));
    eq("B3 fixed: it waited for the foreign transaction (retried)", counter.attempts > 2, true);
  }

  // C. Converges from a broken state, and re-runs never add rows.
  {
    const { file, shared } = freshDb();
    await legacySeedMeals(shared, DE, () => {});
    openForeignTransaction(shared);
    await legacySeedMeals(shared, IT, (no) => {
      if (no === 1) shared.exec("ROLLBACK");
    });
    eq("C0 broken state reproduced", meals(shared).carbs, 187);
    const counter = { attempts: 0 };
    const host = exclusiveHost(file, counter);
    for (let i = 0; i < 3; i++) await runSeedTransaction(host, (t) => replaceSeedMeals(t, P, IT), 20, 5);
    eq("C1 healed and idempotent", [meals(shared).n, meals(shared).carbs], [3, 135]);
  }

  // D. Two passes at once (another runtime, another module instance): serialized, one language.
  {
    const { file, shared } = freshDb();
    const counter = { attempts: 0 };
    const host = exclusiveHost(file, counter);
    await Promise.all([
      runSeedTransaction(host, (t) => replaceSeedMeals(t, P, DE), 50, 2),
      runSeedTransaction(host, (t) => replaceSeedMeals(t, P, IT), 50, 2),
    ]);
    const m = meals(shared);
    eq("D1 concurrent passes: three rows, 135", [m.n, m.carbs], [3, 135]);
    const oneLang =
      JSON.stringify(m.names) === JSON.stringify(DE.map((r) => r.name)) ||
      JSON.stringify(m.names) === JSON.stringify(IT.map((r) => r.name));
    eq("D2 concurrent passes: no mixed languages", oneLang, true);
  }

  // E. Templates and the first-pass story: same convergence, concurrent or repeated.
  {
    const { file, shared } = freshDb();
    const counter = { attempts: 0 };
    const host = exclusiveHost(file, counter);
    const tpl = (lang: string) =>
      [0, 1, 2].map((i) => ({
        name: `${lang}-template-${i}`,
        slot: (["breakfast", "lunch", "dinner"] as const)[i],
        itemName: `${lang}-item-${i}`,
        carbs: CARBS[i],
        portionG: 200,
      }));
    await Promise.all([
      runSeedTransaction(host, (t) => replaceSeedTemplates(t, P, tpl("de"), 0), 50, 2),
      runSeedTransaction(host, (t) => replaceSeedTemplates(t, P, tpl("it"), 0), 50, 2),
    ]);
    const tCount = (shared.prepare("SELECT COUNT(*) AS n FROM meal_templates WHERE profile_id = ?").get(P) as { n: number }).n;
    const iCount = (shared.prepare("SELECT COUNT(*) AS n FROM meal_template_items").get() as { n: number }).n;
    const langs = (shared.prepare("SELECT DISTINCT substr(name, 1, 2) AS l FROM meal_templates").all() as { l: string }[]).length;
    eq("E1 templates: 3 templates, 3 items, one language", [tCount, iCount, langs], [3, 3, 1]);

    const story: SeedStory = {
      glucose: buildGlucoseSchedule(new Date("2026-10-19T17:30:00Z")),
      injections: [
        { site: "abdomen_left", site_point: 1, dose_units: 24, insulin_type: "basal", logged_at: "2026-10-19T19:30:00.000Z" },
        { site: "thigh_left", site_point: 4, dose_units: 6.5, insulin_type: "bolus", logged_at: "2026-10-18T09:00:00.000Z" },
      ],
      meds: [{ takenAt: Date.parse("2026-10-19T17:10:00Z"), name: "Metformin" }],
    };
    await Promise.all([
      runSeedTransaction(host, (t) => replaceSeedStory(t, P, story, 0), 50, 2),
      runSeedTransaction(host, (t) => replaceSeedStory(t, P, story, 0), 50, 2),
    ]);
    await runSeedTransaction(host, (t) => replaceSeedStory(t, P, story, 0), 50, 2);
    const n = (table: string) =>
      (shared.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE profile_id = ?`).get(P) as { n: number }).n;
    eq("E2 story: readings/injections/meds never doubled", [n("sugar_logs"), n("injection_logs"), n("med_logs")], [story.glucose.length, 2, 1]);
    eq("E3 story: 185 readings in the 30-day schedule", story.glucose.length, 185);
  }

  // F. Only a busy database is retried; anything else fails the pass at once.
  {
    const { file } = freshDb();
    const counter = { attempts: 0 };
    const host = exclusiveHost(file, counter);
    let threw = false;
    try {
      await runSeedTransaction(
        host,
        (t) =>
          replaceSeedStory(t, P, {
            glucose: [{ glucose_level_mgdl: 100, period_tag: "nope" as "manual", logged_at: "2026-10-19T08:00:00.000Z" }],
            injections: [],
            meds: [],
          }, 0),
        20,
        2
      );
    } catch {
      threw = true;
    }
    eq("F1 constraint error is not retried", [threw, counter.attempts], [true, 1]);
  }

  // H. screenshot seed: 12 saatlik 5 dakikalık CGM eğrisi + kaynak rozeti
  {
    const { file, shared } = freshDb();
    for (const c of V29_COLUMNS) shared.exec(`ALTER TABLE sugar_logs ADD COLUMN ${c.name} ${c.type};`);
    for (const s of V29_INDEXES) shared.exec(s);
    shared
      .prepare("INSERT INTO sugar_logs (id, profile_id, glucose_level_mgdl, period_tag, source, logged_at) VALUES ('story-1', ?, 100, 'manual', 'manual', '2026-10-21T01:00:00.000Z')")
      .run(P);
    const host = exclusiveHost(file, { attempts: 0 });
    const now = Date.UTC(2026, 9, 21, 3, 17, 41);

    const sensor = buildCgmSchedule(now);
    const manual = buildCgmManualPoints(sensor);
    await runSeedTransaction(host, (t) => replaceSeedCgm(t, P, { sensor, manual }), 20, 5);

    const cgmRows = shared
      .prepare("SELECT id, glucose_level_mgdl AS g, source, source_app, external_id, is_cgm, period_tag, logged_at FROM sugar_logs WHERE profile_id = ? AND is_cgm = 1 ORDER BY logged_at")
      .all(P) as { id: string; g: number; source: string; source_app: string; external_id: string; is_cgm: number; period_tag: string; logged_at: string }[];
    eq("H1 144 sensor rows", cgmRows.length, 144);
    eq("H2 5 minutes apart", new Set(cgmRows.slice(1).map((r, i) => Date.parse(r.logged_at) - Date.parse(cgmRows[i].logged_at))).size === 1 && Date.parse(cgmRows[1].logged_at) - Date.parse(cgmRows[0].logged_at) === 5 * 60_000, true);
    eq("H3 spans 12 hours", Date.parse(cgmRows[143].logged_at) - Date.parse(cgmRows[0].logged_at), 143 * 5 * 60_000);
    const newest = Date.parse(cgmRows[143].logged_at);
    eq("H4 the newest reading is within 5 minutes of now", newest <= now && now - newest < 5 * 60_000, true);
    eq("H5 generic health rows", cgmRows.every((r) => r.source === "health" && r.is_cgm === 1 && r.period_tag === "unset"), true);
    eq("H6 external ids are unique", new Set(cgmRows.map((r) => r.external_id)).size, 144);
    eq("H7 the badge for these rows is the generic CGM one", sourceBadgeKind(cgmRows[0].source, cgmRows[0].is_cgm), "cgm");

    const values = cgmRows.map((r) => r.g);
    const inBand = values.filter((v) => v >= 80 && v <= 160).length;
    eq("H8 values are mostly inside the target band", inBand / values.length >= 0.85, true);
    eq("H9 realistic bounds", Math.min(...values) >= 70 && Math.max(...values) <= 190, true);
    eq("H10 there is a meal rise", Math.max(...values) - Math.min(...values) >= 50 && Math.max(...values) > 160, true);

    const again = buildCgmSchedule(now);
    eq("H12 deterministic for the same clock", JSON.stringify(again), JSON.stringify(sensor));
    const otherClock = buildCgmSchedule(Date.UTC(2026, 9, 21, 15, 2, 9));
    eq("H13 the shape does not depend on the clock", otherClock.map((p) => p.mgdl), sensor.map((p) => p.mgdl));
    eq("H14 but the times follow it", otherClock[143].atMs - sensor[143].atMs, Date.UTC(2026, 9, 21, 15, 0, 0) - Date.UTC(2026, 9, 21, 3, 15, 0));

    const handEntered = shared
      .prepare("SELECT glucose_level_mgdl AS g, source, is_cgm, source_app FROM sugar_logs WHERE profile_id = ? AND id LIKE 'screenshot-cgmmanual-%'")
      .all(P) as { g: number; source: string; is_cgm: number; source_app: string | null }[];
    eq("H15 three hand-entered readings sit beside the curve", [handEntered.length, handEntered.every((r) => r.source === "manual" && r.is_cgm === 0 && r.source_app == null)], [3, true]);

    await runSeedTransaction(host, (t) => replaceSeedCgm(t, P, { sensor: buildCgmSchedule(now + 5 * 60_000), manual }), 20, 5);
    const total = (shared.prepare("SELECT COUNT(*) AS c FROM sugar_logs WHERE profile_id = ?").get(P) as { c: number }).c;
    eq("H16 a second pass converges instead of duplicating (144 + 3 + the story row)", total, 148);

    await runSeedTransaction(host, (t) => clearSeedCgm(t, P), 20, 5);
    const left = shared.prepare("SELECT id FROM sugar_logs WHERE profile_id = ?").all(P) as { id: string }[];
    eq("H17 clearing removes only the demo rows", left.map((r) => r.id), ["story-1"]);

    const sources = JSON.stringify([...cgmRows.map((r) => [r.source, r.source_app, r.external_id]), handEntered]);
    eq("H18 no device or app brand anywhere in the rows", /dexcom|libre|abbott|medtronic|xdrip|eversense|juggluco|freestyle|omnipod/i.test(sources), false);
  }

  // G. The seed itself goes through these steps, not the one-row helpers.
  {
    const seedSrc = readFileSync(join(__dirname, "..", "lib/db/screenshotSeed.ts"), "utf8");
    for (const step of ["replaceSeedMeals", "replaceSeedTemplates", "replaceSeedStory"]) {
      eq(`G1 ${step} runs inside runSeedTransaction`, new RegExp(`runSeedTransaction\\([\\s\\S]{0,120}${step}\\(`).test(seedSrc), true);
    }
    eq(
      "G2 no row-by-row wipe/insert helpers left in the seed",
      /\b(deleteMealLog|addMealLog|createTemplate|deleteTemplate|addSugarLog|deleteSugarLog|logInjection|deleteInjection|logMed|deleteMed)\b/.test(seedSrc),
      false
    );
  }

  rmSync(dir, { recursive: true, force: true });
  console.log(`screenshotSeedAtomic: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
