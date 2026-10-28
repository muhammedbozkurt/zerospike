/**
 * G253-FIX-A, figures (A-8 and the 250 rule on every surface): the "this week"
 * tiles read a 7 day range, not the newest 300 rows; no surface counts a reading
 * of 250 or more as "in target"; the CSV separator follows the device; the French
 * colon and the Arabic day count are right.
 *
 * Real SQL against node:sqlite, real helpers. Run: npx tsx scripts/g253FixAStats.test.ts
 */
process.env.TZ = "Europe/Berlin";

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { journalFeedArgs, journalFeedSql } from "../lib/db/journalSql";
import {
  CGM_MANUAL_RANGE_STATS_SQL,
  CGM_RANGE_STATS_SQL,
  cgmDaySummariesSql,
  daySummariesArgs,
  rangeStatsArgs,
  toDaySummaries,
  toRangeStats,
} from "../lib/db/cgmCurveSql";
import { V29_COLUMNS, V29_INDEXES } from "../lib/db/v29Sql";
import { csvDelimiterFor } from "../lib/exportLimits";
import { coverageLine } from "../lib/cgm/basisText";
import { setActiveLang } from "../lib/lang";
import { inTargetBand, VERY_HIGH_MGDL } from "../lib/glucose";

let passed = 0;
let failed = 0;
function eq(name: string, got: unknown, want: unknown): void {
  if (JSON.stringify(got) === JSON.stringify(want)) passed++;
  else {
    failed++;
    console.log(`  FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}
function ok(name: string, cond: boolean): void {
  eq(name, cond, true);
}
const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE med_logs (id TEXT PRIMARY KEY, profile_id TEXT, taken_at INTEGER, name TEXT, note TEXT, created_at INTEGER);
    CREATE TABLE foods (id TEXT PRIMARY KEY, name_tr TEXT, name_en TEXT, name_de TEXT, name_es TEXT, name_fr TEXT, name_it TEXT, name_pt TEXT, name_ar TEXT, name_ja TEXT, category TEXT);
    CREATE TABLE sugar_logs (id TEXT PRIMARY KEY, profile_id TEXT, glucose_level_mgdl INTEGER, period_tag TEXT, source TEXT, logged_at TEXT, tags TEXT, healthkit_uuid TEXT);
    CREATE TABLE meal_logs (id TEXT PRIMARY KEY, profile_id TEXT, sugar_log_id TEXT, food_id TEXT, custom_food_name TEXT, portion_g REAL, calculated_carbs_g REAL, insulin_dose_units REAL, photo_uri_local TEXT, personal_note TEXT, logged_at TEXT, tags TEXT);
    CREATE TABLE injection_logs (id TEXT PRIMARY KEY, profile_id TEXT, site TEXT, site_point INTEGER, dose_units REAL, insulin_type TEXT, bolus_kind TEXT, meal_log_id TEXT, note TEXT, source TEXT, logged_at TEXT, tags TEXT, insulin_product_id TEXT, insulin_product_other TEXT);
  `);
  for (const col of V29_COLUMNS) db.exec(`ALTER TABLE sugar_logs ADD COLUMN ${col.name} ${col.type};`);
  for (const stmt of V29_INDEXES) db.exec(stmt);
  return db;
}

console.log("A-8. the week tiles come from a 7 day range");
{
  const db = makeDb();
  const now = Date.parse("2026-10-28T12:00:00.000Z");
  const ins = db.prepare(
    `INSERT INTO sugar_logs (id, profile_id, glucose_level_mgdl, period_tag, source, logged_at, tags, source_app, external_id, is_cgm) VALUES (?, 'p1', ?, ?, ?, ?, '[]', ?, ?, ?)`
  );
  let n = 0;
  for (let t = now - 7 * 86_400_000; t <= now; t += 5 * 60_000) {
    ins.run(`c${n}`, 120 + (n % 40), "unset", "health", new Date(t).toISOString(), "com.dexcom.G7", `x${n}`, 1);
    n++;
  }
  for (let d = 0; d < 7; d++) {
    for (const back of [1, 5, 9]) {
      const t = now - d * 86_400_000 - back * 3_600_000;
      ins.run(`m${d}-${back}`, 140, "fasting", "manual", new Date(t).toISOString(), null, null, 0);
    }
  }
  const window300 = db
    .prepare(journalFeedSql(false, false, { cgm: "twins" }))
    .all(...(journalFeedArgs("p1", 300) as never[])) as { logged_at: string; source: string }[];
  const hours = Math.round((now - Date.parse(window300[window300.length - 1].logged_at)) / 3_600_000);
  ok("the old newest-300 window was about a day", hours < 48);

  const range = { start: now - 7 * 86_400_000, end: now };
  const week = db
    .prepare(journalFeedSql(true, false, { cgm: "exclude" }))
    .all(...(journalFeedArgs("p1", 3000, range) as never[])) as { kind: string; source: string }[];
  eq("the range read holds all 21 hand-entered readings", week.filter((r) => r.kind === "glucose").length, 21);
  ok("and no sensor row", week.every((r) => r.source === "manual"));

  const idx = read("app/(tabs)/index.tsx");
  ok("the dashboard reads the week as a range", /getJournal\(activeProfile\.id, lang, WEEK_FEED_LIMIT, \{ start: weekEnd - WEEK_MS, end: weekEnd \}/.test(idx));
  ok("the week loop walks that read, not the 300 window", /for \(const e of weekEntries\)/.test(idx));
  ok("no week test left in the newest-N loop", !/inWeek/.test(idx));
}

console.log("250 rule on every surface");
{
  const db = makeDb();
  const now = Date.UTC(2026, 9, 21, 12, 0, 0);
  const ins = db.prepare(
    "INSERT INTO sugar_logs (id, profile_id, glucose_level_mgdl, source, logged_at, is_cgm) VALUES (?, 'p1', ?, ?, ?, ?)"
  );
  const at = (m: number) => new Date(now - m * 60_000).toISOString();
  // band 70..300: 100 and 249 are in target; 250 and 280 are not.
  [100, 249, 250, 280].forEach((v, i) => ins.run(`c${i}`, v, "health", at(i + 1), 1));
  [110, 250, 300].forEach((v, i) => ins.run(`m${i}`, v, "manual", at(i + 10), 0));
  const band = { low: 70, high: 300 };

  const sensor = toRangeStats(
    db.prepare(CGM_RANGE_STATS_SQL).get(...rangeStatsArgs("p1", band, now - 86_400_000, now + 60_000)) as never
  );
  eq("sensor range stats: 250 is out", sensor.inRange, 2);
  const manual = toRangeStats(
    db.prepare(CGM_MANUAL_RANGE_STATS_SQL).get(...rangeStatsArgs("p1", band, now - 86_400_000, now + 60_000)) as never
  );
  eq("hand-entered range stats: 250 and 300 are out", manual.inRange, 1);
  const days = toDaySummaries(
    db.prepare(cgmDaySummariesSql(2)).all(...daySummariesArgs("p1", band, now, 2)) as never
  );
  eq("per-day sensor summary: 250 is out", days.reduce((s, d) => s + d.inRange, 0), 2);

  eq("inTargetBand agrees at 249/250", [inTargetBand(249, band), inTargetBand(VERY_HIGH_MGDL, band)], [true, false]);
  ok("the SQL uses the shared constant, not a copy", read("lib/db/cgmCurveSql.ts").includes("${VERY_HIGH_MGDL}"));

  const spike = read("lib/ai/spikeContext.ts");
  ok("Spike's sensor aggregate leaves 250 out", /glucose_level_mgdl <= \? AND glucose_level_mgdl < \$\{VERY_HIGH_MGDL\}/.test(spike));
  ok("the day sheet uses inTargetBand", read("components/CgmDaySheet.tsx").includes("inTargetBand(r.mgdl, band)"));
  const insights = read("app/insights.tsx");
  ok("the heat strip colours with inTargetBand", insights.includes("if (inTargetBand(avg, band)) return GLUCOSE_RICH.target;"));
  const dash = read("app/(tabs)/index.tsx");
  ok("the week tile uses inTargetBand", dash.includes("inTargetBand(e.glucose_level_mgdl, weekBand)"));
}

console.log("CSV separator follows the device");
{
  eq("device comma decimal -> ;", csvDelimiterFor(",", false), ";");
  eq("device dot decimal -> , even for a comma-decimal app language", csvDelimiterFor(".", true), ",");
  eq("unknown device mark falls back to the app language (comma)", csvDelimiterFor(null, true), ";");
  eq("unknown device mark falls back to the app language (dot)", csvDelimiterFor(undefined, false), ",");
  const exp = read("lib/services/export.ts");
  ok("export reads the device decimal mark", exp.includes("csvDelimiterFor(getLocales()[0]?.decimalSeparator, decimalComma)"));
}

console.log("French colon, Arabic day count");
void (async () => {
  const t = (key: string) => key;
  setActiveLang("fr");
  ok("fr: a no-break space before the colon", coverageLine(t, 1, 80).startsWith("cgmInsights.coverage : "));
  setActiveLang("en");
  ok("en: no space before the colon", coverageLine(t, 1, 80).startsWith("cgmInsights.coverage: "));
  const ar = read("lib/i18n/locales/ar.ts");
  const need = /gmiNeedCoverage: "([^"]+)"/.exec(ar)?.[1] ?? "";
  ok("ar gmiNeedCoverage base form has no accusative day word that breaks at 100+", need.includes("{{days}} يوم.") && !need.includes("يومًا"));
  // The real resolver, with the app's settings (i18next v3 plural suffixes).
  const i18next = require("i18next") as typeof import("i18next");
  const arMod = require("../lib/i18n/locales/ar") as { default: { cgmInsights: Record<string, string> } };
  await i18next.init({ lng: "ar", compatibilityJSON: "v3", resources: { ar: { translation: { cgmInsights: arMod.default.cgmInsights } } } });
  const need2 = (n: number) => i18next.t("cgmInsights.gmiNeedCoverage", { days: n, count: n, pct: "70%" });
  ok("ar 14 days: accusative singular", need2(14).includes("14 يومًا"));
  ok("ar 30 and 90 days: the same", need2(30).includes("30 يومًا") && need2(90).includes("90 يومًا"));
  ok("ar 7 days: plural noun", need2(7).includes("7 أيام"));
  ok("ar 100 days: genitive singular, no accusative", need2(100).includes("100 يوم.") && !need2(100).includes("يومًا"));
  ok("ar 365 days: accusative (65 is in 11-99)", need2(365).includes("365 يومًا"));
  const cov = (n: number) => i18next.t("cgmInsights.coverageLine", { days: n, count: n, pct: "92%" });
  ok("ar coverage line follows the same forms", cov(14).includes("14 يومًا") && cov(7).includes("7 أيام") && cov(100).includes("100 يوم:"));
  console.log(failed ? `${failed} failed, ${passed} passed` : `${passed} passed`);
  if (failed) process.exit(1);
})();
