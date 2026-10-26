/**
 * G16: the Food tab's "Today" list must not be filtered out of the newest 120
 * mixed journal rows. Runs the real lib/db/meals.ts query against node:sqlite:
 *
 *   npx tsx scripts/foodTodayFeed.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (c: number) => void };
import Module from "node:module";
import { DatabaseSync } from "node:sqlite";

import { journalFeedArgs, journalFeedSql } from "../lib/db/journalSql";

const raw = new DatabaseSync(":memory:");
const db = {
  async getAllAsync<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return raw.prepare(sql).all(...(params as never[])) as T[];
  },
};

const M = Module as unknown as {
  _load: (request: string, parent?: { filename?: string }, ...rest: unknown[]) => unknown;
};
const realLoad = M._load;
M._load = function (request: string, parent?: { filename?: string }, ...rest: unknown[]) {
  if (request === "./index" && (parent?.filename ?? "").endsWith("/lib/db/meals.ts")) {
    return { getDb: async () => db };
  }
  return realLoad.call(this, request, parent, ...rest);
};

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  x ${name}${detail ? ": " + detail : ""}`);
  }
}

raw.exec(`
  CREATE TABLE foods (
    id TEXT PRIMARY KEY NOT NULL, name_tr TEXT, name_en TEXT, name_de TEXT,
    name_es TEXT, name_fr TEXT, name_it TEXT, name_pt TEXT, name_ar TEXT, name_ja TEXT, category TEXT);
  CREATE TABLE sugar_logs (
    id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL, glucose_level_mgdl INTEGER,
    period_tag TEXT, source TEXT, logged_at TEXT NOT NULL, tags TEXT, healthkit_uuid TEXT);
  CREATE TABLE meal_logs (
    id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL, sugar_log_id TEXT, food_id TEXT,
    custom_food_name TEXT, portion_g REAL, calculated_carbs_g REAL, insulin_dose_units REAL,
    photo_uri_local TEXT, personal_note TEXT, logged_at TEXT NOT NULL, tags TEXT);
  CREATE TABLE injection_logs (
    id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL, site TEXT, site_point INTEGER,
    dose_units REAL, insulin_type TEXT, bolus_kind TEXT, meal_log_id TEXT, note TEXT,
    source TEXT, logged_at TEXT NOT NULL, tags TEXT,
    insulin_product_id TEXT, insulin_product_other TEXT);
  CREATE TABLE med_logs (
    id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL, taken_at INTEGER NOT NULL,
    name TEXT, note TEXT, created_at INTEGER NOT NULL);
  INSERT INTO foods VALUES ('f1','Pilav','Rice','Reis','Arroz','Riz',NULL,NULL,NULL,NULL,'grains');
`);

const now = new Date(2026, 5, 15, 14, 0, 0);
const at = (h: number, m = 0, dayOffset = 0) => new Date(2026, 5, 15 + dayOffset, h, m, 0).toISOString();

// A CGM-heavy history: 400 readings spread over yesterday, 150 more today after the morning meal.
const insG = raw.prepare("INSERT INTO sugar_logs VALUES (?,?,?,?,?,?,NULL,NULL)");
for (let i = 0; i < 400; i++) insG.run(`gy${i}`, "p1", 110, "manual", "health", at(12, i % 60, -1));
for (let i = 0; i < 150; i++) insG.run(`gt${i}`, "p1", 120, "manual", "health", at(11, i % 60));
insG.run("g-pre", "p1", 100, "manual", "manual", at(7, 30));
insG.run("g-post1", "p1", 160, "manual", "manual", at(9, 0));
insG.run("g-post2", "p1", 140, "manual", "manual", at(10, 30));
const insM = raw.prepare("INSERT INTO meal_logs VALUES (?,?,?,?,?,?,?,?,NULL,NULL,?,NULL)");
insM.run("m-morning", "p1", null, null, "Breakfast", 200, 45, 0, at(7, 45));
insM.run("m-food", "p1", null, "f1", null, 150, 40, 0, at(8, 0));
insM.run("m-yesterday", "p1", null, null, "Old", 100, 20, 0, at(21, 0, -1));
insM.run("m-other", "p2", null, null, "Other profile", 100, 20, 0, at(8, 0));

async function main() {
  // The old path: newest 120 mixed rows, meal + today filtered in JS.
  const feed = raw
    .prepare(journalFeedSql(false))
    .all(...(journalFeedArgs("p1", 120) as never[])) as { kind: string; id: string }[];
  ok("old path drops the morning meals (the defect)", !feed.some((r) => r.id === "m-morning"));

  const { getTodayFoodFeed } = await import("../lib/db/meals");
  const res = await getTodayFoodFeed("p1", "en", now);
  const ids = res.meals.map((m) => m.id);
  ok("morning meal is kept", ids.includes("m-morning"), ids.join(","));
  ok("food meal is kept", ids.includes("m-food"));
  ok("yesterday meal excluded", !ids.includes("m-yesterday"));
  ok("other profile excluded", !ids.includes("m-other"));
  ok("meals newest first", ids[0] === "m-food" && ids[1] === "m-morning", ids.join(","));
  ok("joined food name resolved", res.meals.find((m) => m.id === "m-food")?.display_name === "Rice");
  ok("custom name kept", res.meals.find((m) => m.id === "m-morning")?.display_name === "Breakfast");
  ok("carbs mapped", res.meals.find((m) => m.id === "m-morning")?.calculated_carbs_g === 45);
  ok("readings are glucose entries", res.readings.length > 0 && res.readings.every((r) => r.kind === "glucose"));
  ok("response readings present", res.readings.some((r) => r.id === "g-post1") && res.readings.some((r) => r.id === "g-post2"));
  ok("baseline reading before the meal present", res.readings.some((r) => r.id === "g-pre"));
  ok("yesterday noon readings excluded", !res.readings.some((r) => r.id.startsWith("gy")));
  console.log(`foodTodayFeed: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}
void main();
