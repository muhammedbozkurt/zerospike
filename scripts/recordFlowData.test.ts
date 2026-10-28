/**
 * G253-FIX-C1: data fixes from the record-flow audit, against the REAL
 * lib/db/{logs,injections,foods,undo}.ts, journalSql and the v28 triggers on
 * node:sqlite (expo-sqlite faked by a thin adapter).
 *   C-1  a calculator bolus the user turned into basal leaves its meal: meal
 *        delete keeps it, the journal feed shows it, undo does not duplicate it
 *   C-2  deleting a custom food keeps the name of meals logged with it, and
 *        undo puts food, favorites, portions and the meal links back
 *   C-4  a meal time correction moves a linked reading only when it is that
 *        meal's own (rule: shouldMoveLinkedReading)
 *   C-17 undoing the delete of an imported Health reading retires its tombstone
 * Run: npx tsx scripts/recordFlowData.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import Module from "node:module";
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { V28_CREATE } from "../lib/db/v28Sql";
import { journalFeedSql } from "../lib/db/journalSql";
import { shouldMoveLinkedReading } from "../lib/mealEditPatch";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ": " + detail : ""}`);
  }
}

const d = new DatabaseSync(":memory:");
d.exec("PRAGMA foreign_keys = ON;");
// Columns and foreign keys as in lib/db/index.ts (meal_logs, sugar_logs,
// injection_logs, favorites) and lib/db/v23Sql.ts (food_portions).
d.exec(`
  CREATE TABLE user_profiles (id TEXT PRIMARY KEY);
  CREATE TABLE foods (
    id TEXT PRIMARY KEY NOT NULL, name_tr TEXT NOT NULL, name_en TEXT NOT NULL DEFAULT '',
    name_de TEXT, name_es TEXT, name_fr TEXT, name_it TEXT, name_pt TEXT, name_ar TEXT, name_ja TEXT, category TEXT,
    carb_100g REAL NOT NULL DEFAULT 0, is_custom INTEGER NOT NULL DEFAULT 0, source TEXT,
    created_at TEXT NOT NULL DEFAULT '2026-10-01T00:00:00Z');
  CREATE TABLE sugar_logs (
    id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL, glucose_level_mgdl INTEGER NOT NULL,
    period_tag TEXT NOT NULL DEFAULT 'manual', source TEXT NOT NULL DEFAULT 'manual',
    logged_at TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', healthkit_uuid TEXT,
    source_app TEXT, external_id TEXT, is_cgm INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (profile_id) REFERENCES user_profiles (id) ON DELETE CASCADE);
  CREATE TABLE meal_logs (
    id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL, sugar_log_id TEXT, food_id TEXT,
    custom_food_name TEXT, portion_g REAL NOT NULL DEFAULT 0, calculated_carbs_g REAL NOT NULL DEFAULT 0,
    insulin_dose_units REAL NOT NULL DEFAULT 0, photo_uri_local TEXT, personal_note TEXT,
    logged_at TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', meal_template_id TEXT, health_uuid TEXT,
    FOREIGN KEY (profile_id) REFERENCES user_profiles (id) ON DELETE CASCADE,
    FOREIGN KEY (sugar_log_id) REFERENCES sugar_logs (id) ON DELETE SET NULL,
    FOREIGN KEY (food_id) REFERENCES foods (id) ON DELETE SET NULL);
  CREATE TABLE injection_logs (
    id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL, site TEXT, site_point INTEGER,
    dose_units REAL, insulin_type TEXT CHECK (insulin_type IN ('basal','bolus')), meal_log_id TEXT,
    note TEXT, source TEXT NOT NULL DEFAULT 'manual', logged_at TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '[]', bolus_kind TEXT, insulin_product_id TEXT,
    insulin_product_other TEXT, health_uuid TEXT,
    FOREIGN KEY (profile_id) REFERENCES user_profiles (id) ON DELETE CASCADE,
    FOREIGN KEY (meal_log_id) REFERENCES meal_logs (id) ON DELETE SET NULL);
  CREATE TABLE med_logs (id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL, name TEXT, note TEXT, taken_at INTEGER);
  CREATE TABLE favorites (
    id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL, food_id TEXT NOT NULL,
    UNIQUE (profile_id, food_id),
    FOREIGN KEY (profile_id) REFERENCES user_profiles (id) ON DELETE CASCADE,
    FOREIGN KEY (food_id) REFERENCES foods (id) ON DELETE CASCADE);
  CREATE TABLE food_portions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, food_id TEXT NOT NULL, label_key TEXT NOT NULL,
    grams REAL NOT NULL, sort INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (food_id) REFERENCES foods (id) ON DELETE CASCADE);
  INSERT INTO user_profiles VALUES ('P');
`);
for (const stmt of V28_CREATE) d.exec(stmt);

const bind = (p?: unknown[]) => (p ?? []) as any[];
const db = {
  execAsync: async (sql: string) => void d.exec(sql),
  runAsync: async (sql: string, p?: unknown[]) => ({ changes: Number(d.prepare(sql).run(...bind(p)).changes) }),
  getFirstAsync: async (sql: string, p?: unknown[]) => (d.prepare(sql).get(...bind(p)) as any) ?? null,
  getAllAsync: async (sql: string, p?: unknown[]) => d.prepare(sql).all(...bind(p)) as any[],
  isInTransactionSync: () => d.isTransaction,
  withTransactionAsync: async (fn: () => Promise<void>) => {
    d.exec("BEGIN");
    try {
      await fn();
      d.exec("COMMIT");
    } catch (e) {
      if (d.isTransaction) d.exec("ROLLBACK");
      throw e;
    }
  },
};
const M = Module as unknown as { _load: (...a: unknown[]) => unknown };
const realLoad = M._load;
M._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "./index" || request.endsWith("/db/index")) return { getDb: async () => db };
  // foods.ts reaches the RN layer through services/openFoodFacts; the delete SQL under test needs none of it.
  if (/^(react-native|expo-(?!crypto$))/.test(request)) return new Proxy({}, { get: (_t, k) => (k === "__esModule" ? false : () => ({})) });
  if (request === "expo-crypto") return { getRandomBytes: (n: number) => randomBytes(n) };
  return realLoad.call(this, request, ...rest);
};

const one = (sql: string, ...p: any[]) => d.prepare(sql).get(...p) as any;
const count = (sql: string, ...p: any[]) => one(sql, ...p).c as number;

async function main() {
  const logs = await import("../lib/db/logs");
  const inj = await import("../lib/db/injections");
  const foods = await import("../lib/db/foods");
  const undo = await import("../lib/db/undo");
  const at = "2026-10-27T19:00:00.000Z";

  // ---- C-1: bolus turned into basal is no longer the meal's ----
  console.log("C-1 calculator bolus turned into basal");
  const feed = () =>
    d
      .prepare(journalFeedSql(false, true))
      .all("P", "P", "P", "P", 100)
      .map((r: any) => `${r.kind}:${r.id}`);
  const meal = await logs.addMealLog({ profile_id: "P", portion_g: 100, calculated_carbs_g: 50, insulin_dose_units: 5, logged_at: at });
  const bolus = await inj.logInjection({ profile_id: "P", dose_units: 5, insulin_type: "bolus", meal_log_id: meal.id, source: "calculator", logged_at: at });
  ok("calculator bolus hidden from the feed while it is the meal's dose", !feed().includes(`injection:${bolus.id}`));
  // InjectionEditSheet.save: type -> basal, meal dose -> 0
  await inj.updateInjection(bolus.id, { dose_units: 20, insulin_type: "basal", bolus_kind: null });
  await logs.updateMealLog(meal.id, { insulin_dose_units: 0 });
  const turned = one("SELECT source, meal_log_id FROM injection_logs WHERE id = ?", bolus.id);
  ok("turned row drops meal link and calculator source", turned.meal_log_id === null && turned.source === "manual", JSON.stringify(turned));
  ok("turned basal row is visible in the feed", feed().includes(`injection:${bolus.id}`));
  const snap = await undo.captureDeletion("meal", meal.id);
  ok("meal snapshot does not carry the basal row", (snap.injections ?? []).length === 0);
  await logs.deleteMealLog(meal.id);
  ok("basal row survives the meal delete", count("SELECT COUNT(*) c FROM injection_logs WHERE id = ?", bolus.id) === 1);
  await undo.restoreDeletion(snap);
  ok("undo restores the meal", count("SELECT COUNT(*) c FROM meal_logs WHERE id = ?", meal.id) === 1);
  ok("undo leaves exactly one basal row", count("SELECT COUNT(*) c FROM injection_logs WHERE insulin_type = 'basal'") === 1);
  ok("undo adds no bolus row", count("SELECT COUNT(*) c FROM injection_logs WHERE insulin_type = 'bolus'") === 0);

  // A row converted before this fix (still source 'calculator', still linked).
  const meal2 = await logs.addMealLog({ profile_id: "P", portion_g: 100, calculated_carbs_g: 50, insulin_dose_units: 0, logged_at: at });
  const legacy = await inj.logInjection({ profile_id: "P", dose_units: 20, insulin_type: "basal", meal_log_id: meal2.id, source: "calculator", logged_at: at });
  ok("legacy converted row is visible in the feed", feed().includes(`injection:${legacy.id}`));
  const legacySnap = await undo.captureDeletion("meal", meal2.id);
  ok("legacy snapshot does not carry the basal row", (legacySnap.injections ?? []).length === 0);
  await logs.deleteMealLog(meal2.id);
  ok("legacy basal row survives the meal delete", count("SELECT COUNT(*) c FROM injection_logs WHERE id = ?", legacy.id) === 1);

  // Control: a real calculator bolus still goes with its meal and returns on undo.
  const meal3 = await logs.addMealLog({ profile_id: "P", portion_g: 100, calculated_carbs_g: 50, insulin_dose_units: 4, logged_at: at });
  const b3 = await inj.logInjection({ profile_id: "P", dose_units: 4, insulin_type: "bolus", meal_log_id: meal3.id, source: "calculator", logged_at: at });
  const snap3 = await undo.captureDeletion("meal", meal3.id);
  await logs.deleteMealLog(meal3.id);
  ok("control: calculator bolus is deleted with its meal", count("SELECT COUNT(*) c FROM injection_logs WHERE id = ?", b3.id) === 0);
  await undo.restoreDeletion(snap3);
  ok("control: undo returns meal and bolus", count("SELECT COUNT(*) c FROM injection_logs WHERE id = ?", b3.id) === 1 && count("SELECT COUNT(*) c FROM meal_logs WHERE id = ?", meal3.id) === 1);

  // ---- C-2: custom food delete keeps meal names, undo restores every link ----
  console.log("C-2 custom food delete");
  d.exec(`
    INSERT INTO foods (id, name_tr, name_en, carb_100g, is_custom, source) VALUES ('f1','Annemin keki','Mom cake',48,1,NULL);
    INSERT INTO foods (id, name_tr, name_en, carb_100g, is_custom, source) VALUES ('cat','Elma','Apple',14,0,NULL);
    INSERT INTO favorites VALUES ('fav1','P','f1');
    INSERT INTO food_portions (food_id, label_key, grams, sort) VALUES ('f1','slice',80,0),('f1','piece',120,1);
    INSERT INTO meal_logs (id, profile_id, food_id, custom_food_name, portion_g, calculated_carbs_g, logged_at) VALUES
      ('ma','P','f1',NULL,120,57.6,'2026-10-27T12:00:00Z'),
      ('mb','P','f1','Kek, ev yapimi',100,48,'2026-10-26T12:00:00Z'),
      ('mc','P','f1',NULL,100,48,'2026-10-25T12:00:00Z'),
      ('md','P','cat',NULL,100,14,'2026-10-25T13:00:00Z');
  `);
  const foodSnap = await undo.captureFoodDeletion("f1", "Annemin keki");
  await foods.deleteFood("f1", "Annemin keki");
  ok("food row is gone", count("SELECT COUNT(*) c FROM foods WHERE id = 'f1'") === 0);
  ok("nameless meal keeps the food name", one("SELECT custom_food_name n FROM meal_logs WHERE id = 'ma'").n === "Annemin keki");
  ok("meal with its own name keeps it", one("SELECT custom_food_name n FROM meal_logs WHERE id = 'mb'").n === "Kek, ev yapimi");
  ok("catalog food meal is untouched", one("SELECT food_id f, custom_food_name n FROM meal_logs WHERE id = 'md'").f === "cat" && one("SELECT custom_food_name n FROM meal_logs WHERE id = 'md'").n === null);
  await foods.deleteFood("cat", "Elma");
  ok("catalog food is never deleted and its meals are never renamed", count("SELECT COUNT(*) c FROM foods WHERE id = 'cat'") === 1 && one("SELECT custom_food_name n FROM meal_logs WHERE id = 'md'").n === null);
  // user renames one meal during the undo window: that edit wins
  d.exec("UPDATE meal_logs SET custom_food_name = 'Baska ad' WHERE id = 'mc'");
  await undo.restoreDeletion(foodSnap);
  ok("undo restores the food", count("SELECT COUNT(*) c FROM foods WHERE id = 'f1'") === 1);
  ok("undo restores the favorite", count("SELECT COUNT(*) c FROM favorites WHERE food_id = 'f1'") === 1);
  ok("undo restores both portions", count("SELECT COUNT(*) c FROM food_portions WHERE food_id = 'f1'") === 2);
  const ma = one("SELECT food_id f, custom_food_name n FROM meal_logs WHERE id = 'ma'");
  ok("undo relinks the nameless meal and clears the stamped name", ma.f === "f1" && ma.n === null, JSON.stringify(ma));
  const mb = one("SELECT food_id f, custom_food_name n FROM meal_logs WHERE id = 'mb'");
  ok("undo relinks the named meal and keeps its name", mb.f === "f1" && mb.n === "Kek, ev yapimi", JSON.stringify(mb));
  const mc = one("SELECT food_id f, custom_food_name n FROM meal_logs WHERE id = 'mc'");
  ok("a meal renamed in the meantime is left alone", mc.f === null && mc.n === "Baska ad", JSON.stringify(mc));

  // ---- C-4: which linked readings a meal time correction may move ----
  console.log("C-4 linked reading and meal time");
  const mv = (o: Partial<Parameters<typeof shouldMoveLinkedReading>[0]>) =>
    shouldMoveLinkedReading({
      loggedAtChanged: true,
      readingLoggedAt: "2026-10-27T18:00:00.000Z",
      mealStoredLoggedAt: "2026-10-27T18:00:00.000Z",
      otherMealsOnReading: 0,
      ...o,
    });
  ok("reading created with the meal follows the corrected time", mv({}) === true);
  ok("time not changed: reading stays", mv({ loggedAtChanged: false }) === false);
  ok("reading shared with another meal never moves", mv({ otherMealsOnReading: 1 }) === false);
  ok("pre-existing reading (other instant) does not move", mv({ readingLoggedAt: "2026-10-27T17:58:00.000Z" }) === false);
  ok("unparseable time does not move", mv({ readingLoggedAt: "x" }) === false);
  const ra = await logs.addSugarLog({ profile_id: "P", glucose_level_mgdl: 140, period_tag: "pre_meal", logged_at: "2026-10-27T18:00:00.000Z" });
  const m1 = await logs.addMealLog({ profile_id: "P", sugar_log_id: ra.id, portion_g: 50, calculated_carbs_g: 10, insulin_dose_units: 0, logged_at: "2026-10-27T18:02:00.000Z" });
  const m2 = await logs.addMealLog({ profile_id: "P", sugar_log_id: ra.id, portion_g: 50, calculated_carbs_g: 10, insulin_dose_units: 0, logged_at: "2026-10-27T18:10:00.000Z" });
  ok("two meals on one reading are counted", (await logs.countOtherMealsOnSugarLog(ra.id, m1.id)) === 1 && (await logs.countOtherMealsOnSugarLog(ra.id, m2.id)) === 1);
  d.exec(`DELETE FROM meal_logs WHERE id = '${m2.id}'`);
  ok("a sole meal counts none", (await logs.countOtherMealsOnSugarLog(ra.id, m1.id)) === 0);

  // ---- C-17: undo of an imported reading's delete retires its tombstone ----
  console.log("C-17 health tombstone");
  const tomb = () => count("SELECT COUNT(*) c FROM health_import_tombstones WHERE profile_id = 'P' AND logged_at = '2026-10-27T08:00:00.000Z' AND glucose_level_mgdl = 110");
  d.exec("INSERT INTO sugar_logs (id, profile_id, glucose_level_mgdl, source, logged_at, healthkit_uuid) VALUES ('h1','P',110,'health','2026-10-27T08:00:00.000Z','uuid-1')");
  const hSnap = await undo.captureDeletion("glucose", "h1");
  await logs.deleteSugarLog("h1");
  ok("the delete leaves a tombstone", tomb() === 1);
  await undo.restoreDeletion(hSnap);
  ok("the reading is back", count("SELECT COUNT(*) c FROM sugar_logs WHERE id = 'h1'") === 1);
  ok("undo retires the tombstone", tomb() === 0, `tombstones=${tomb()}`);
  // an older tombstone of the same sample is not collateral damage
  d.exec("INSERT INTO health_import_tombstones VALUES ('P','2026-10-27T08:00:00.000Z',110)");
  const hSnap2 = await undo.captureDeletion("glucose", "h1");
  await logs.deleteSugarLog("h1");
  ok("second delete adds one more tombstone", tomb() === 2);
  await undo.restoreDeletion(hSnap2);
  ok("undo removes exactly the tombstone its delete wrote", tomb() === 1);
  // a manual reading never had one
  d.exec("INSERT INTO sugar_logs (id, profile_id, glucose_level_mgdl, source, logged_at) VALUES ('mn','P',99,'manual','2026-10-27T09:00:00.000Z')");
  const mSnap = await undo.captureDeletion("glucose", "mn");
  await logs.deleteSugarLog("mn");
  await undo.restoreDeletion(mSnap);
  ok("manual reading round trip touches no tombstone", count("SELECT COUNT(*) c FROM health_import_tombstones") === 1);

  console.log(`\nrecordFlowData: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => {
  console.log(e);
  process.exit(1);
});
