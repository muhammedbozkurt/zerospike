/**
 * A CGM reading is not a dose input. Every read that feeds the calculator's
 * glucose offer, its meal-to-reading link and the duplicate-entry prompt runs
 * the shared SQL against a scratch database holding a fresh sensor row next to
 * typed rows, and only the typed rows may come back.
 * Run: npx -y tsx scripts/cgmDoseIsolation.test.ts
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { COUNT_NON_CGM_HEALTH_SQL, MATCHING_MANUAL_SUGAR_SQL, recentManualSugarSql } from "../lib/db/cgmSql";
import { checkEntryGuards, guardQueryRange } from "../lib/entryGuard";
import { recentGlucoseSuggestion, RECENT_GLUCOSE_WINDOW_MINUTES } from "../lib/glucoseSuggestion";
import { estimateInsulin } from "../lib/insulin";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  FAIL ${name}`);
  }
}

const db = new DatabaseSync(":memory:");
db.exec(
  "CREATE TABLE sugar_logs(id TEXT, profile_id TEXT, logged_at TEXT, glucose_level_mgdl INT, source TEXT, is_cgm INT NOT NULL DEFAULT 0, source_app TEXT, period_tag TEXT NOT NULL DEFAULT 'unset')"
);
db.exec("CREATE TABLE meal_logs(id TEXT, sugar_log_id TEXT)");
const ins = db.prepare("INSERT INTO sugar_logs (id, profile_id, logged_at, glucose_level_mgdl, source, is_cgm) VALUES(?,?,?,?,?,?)");
const now = Date.now();
const iso = (minAgo: number) => new Date(now - minAgo * 60_000).toISOString();

console.log("A. the calculator offer ignores a fresh sensor reading");
ins.run("cgm1", "p1", iso(4), 220, "nightscout", 1);
const since = iso(RECENT_GLUCOSE_WINDOW_MINUTES);
const onlyCgm = db.prepare(recentManualSugarSql(false)).all("p1", since) as never[];
ok("no typed reading in the window: the query returns nothing", onlyCgm.length === 0);
ok("so there is no offer to tap", recentGlucoseSuggestion(onlyCgm, new Date(now)) === null);
ins.run("man1", "p1", iso(9), 140, "manual", 0);
const mixed = db.prepare(recentManualSugarSql(false)).all("p1", since) as { id: string }[];
ok("with a typed reading too, only that one comes back", mixed.length === 1 && mixed[0].id === "man1");
const offer = recentGlucoseSuggestion(mixed as never[], new Date(now));
ok("the offer is the typed value, not the sensor's 220", offer?.mgdl === 140);
const profile = {
  carb_ratio_breakfast: 10,
  carb_ratio_lunch: 10,
  carb_ratio_dinner: 10,
  insulin_sensitivity_factor: 50,
  target_postmeal_min: 80,
  target_postmeal_max: 180,
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const est = (g: number) => estimateInsulin({ carb_100g: 50 } as any, 100, profile as any, { currentGlucose: g, slot: "lunch" } as any);
ok("a correction from the sensor value would have added a dose (the old leak)", JSON.stringify(est(220)) !== JSON.stringify(est(140)));
ok("the dose input is the typed value", est(offer!.mgdl).correctionDose === est(140).correctionDose);

console.log("B. meal linking never grabs a sensor row");
ins.run("cgm2", "p2", iso(1), 150, "health", 1);
const m1 = db.prepare(MATCHING_MANUAL_SUGAR_SQL).get("p2", 150, iso(15), new Date(now + 15 * 60_000).toISOString());
ok("an identical sensor value within the window is not a match", m1 === undefined);
ins.run("man2", "p2", iso(2), 150, "manual", 0);
const m2 = db.prepare(MATCHING_MANUAL_SUGAR_SQL).get("p2", 150, iso(15), new Date(now + 15 * 60_000).toISOString()) as { id: string } | undefined;
ok("the typed twin is still found", m2?.id === "man2");

console.log("C. the duplicate prompt ignores the sensor stream");
ins.run("cgm3", "p3", iso(3), 130, "health", 1);
const range = guardQueryRange(now, null);
const rows = db.prepare(recentManualSugarSql(true)).all("p3", range.sinceIso, range.untilIso) as { id: string; logged_at: string; glucose_level_mgdl: number }[];
const guard = (recent: typeof rows) =>
  checkEntryGuards({
    now,
    entryAtIso: new Date(now).toISOString(),
    entryKind: "glucose",
    recent: { glucose: recent.map((g) => ({ id: g.id, logged_at: g.logged_at, valueText: String(g.glucose_level_mgdl) })) },
  } as never);
ok("a fingerstick next to a sensor row raises no 'recent reading' notice", guard(rows).length === 0);
ins.run("man3", "p3", iso(5), 130, "manual", 0);
const rows2 = db.prepare(recentManualSugarSql(true)).all("p3", range.sinceIso, range.untilIso) as typeof rows;
ok("a real typed duplicate still does", guard(rows2).length === 1);

console.log("D. the functions in logs.ts use the shared text");
const logs = readFileSync(join(import.meta.dirname, "..", "lib/db/logs.ts"), "utf8");
ok("listRecentSugarLogs runs recentManualSugarSql", /recentManualSugarSql\(Boolean\(untilIso\)\)/.test(logs));
ok("findMatchingSugarLog runs MATCHING_MANUAL_SUGAR_SQL", /getFirstAsync<SugarRow>\(MATCHING_MANUAL_SUGAR_SQL/.test(logs));

console.log("E. the health_import event counts logged readings, not the sensor stream");
ins.run("h-cgm", "p4", iso(1), 120, "health", 1);
ins.run("h-man", "p4", iso(2), 125, "health", 0);
ins.run("n-man", "p4", iso(3), 125, "manual", 0);
const cnt = db.prepare(COUNT_NON_CGM_HEALTH_SQL).get("p4") as { c: number };
ok("only imported non-sensor rows are counted", cnt.c === 1);
const dash = readFileSync(join(import.meta.dirname, "..", "app/(tabs)/index.tsx"), "utf8");
ok(
  "the event waits for a non-sensor row to be added",
  /countNonCgmHealthRows\(activeProfile\.id\)[\s\S]{0,400}manualAfter > manualBefore\)[\s\S]{0,120}logEvent\("log_added", \{ kind: "health_import" \}\)/.test(dash)
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
