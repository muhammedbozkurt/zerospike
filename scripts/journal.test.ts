/**
 * Journal feed query test.
 *
 * Builds the three log tables in a scratch database and runs the REAL statement
 * from lib/db/journalSql.ts (no hand-copied SQL), asserting the two properties
 * the feed used to get wrong:
 *
 *  1. LIMIT caps the MERGED feed. Each table used to be limited separately and
 *     merged in JS, so 300 rows of every kind were read to show 300.
 *  2. A date range filters in SQL. A range further back than the row cap used to
 *     come back short or empty in the report and the CSV export, with nothing
 *     telling the user their document was incomplete.
 *
 * Run: npx tsx scripts/journal.test.ts
 */
import { DatabaseSync } from "node:sqlite";

import { journalFeedArgs, journalFeedSql } from "../lib/db/journalSql";

let passed = 0;
let failed = 0;

function eq(label: string, got: unknown, want: unknown): void {
  if (got === want) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}  (got ${String(got)}, want ${String(want)})`);
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

interface FeedRow {
  kind: string;
  id: string;
  logged_at: string;
  site: string | null;
  name_en: string | null;
  custom_food_name: string | null;
  glucose_level_mgdl: number | null;
  source: string | null;
  note: string | null;
  med_name: string | null;
}

/** A database shaped like the app's (v16) log tables, with `days` days of data:
 *  one reading + one meal at 08:00 and one injection at 09:00 each day.
 *  med_logs exists but starts EMPTY, so section D owns every medication row and
 *  the counts the sections above assert stay exactly what they were. */
function makeFeedDb(days: number): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE med_logs (
      id TEXT PRIMARY KEY NOT NULL, profile_id TEXT NOT NULL, taken_at INTEGER NOT NULL,
      name TEXT, note TEXT, created_at INTEGER NOT NULL);
    CREATE TABLE foods (
      id TEXT PRIMARY KEY NOT NULL, name_tr TEXT, name_en TEXT, name_de TEXT,
      name_es TEXT, name_fr TEXT, category TEXT);
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
    INSERT INTO foods VALUES ('f1','Pilav','Rice','Reis','Arroz','Riz','grains');
  `);
  const sugar = db.prepare(
    `INSERT INTO sugar_logs VALUES (?, ?, ?, 'fasting', 'manual', ?, '[]', NULL);`
  );
  const meal = db.prepare(
    `INSERT INTO meal_logs VALUES (?, ?, NULL, ?, ?, 150, 40, 4, NULL, NULL, ?, '[]');`
  );
  const inj = db.prepare(
    `INSERT INTO injection_logs VALUES (?, ?, ?, NULL, 4, 'bolus', NULL, NULL, NULL, 'calculator', ?, '[]', NULL, NULL);`
  );
  // Day 1 is the OLDEST; a second profile's rows must never appear in the feed.
  for (let d = 1; d <= days; d++) {
    const day = `2026-07-${String(d).padStart(2, "0")}`;
    sugar.run(`s${d}`, "p1", 100 + d, `${day}T08:00:00.000Z`);
    meal.run(`m${d}`, "p1", "f1", null, `${day}T08:00:00.000Z`);
    // A dose the calculator wrote: no region (schema v11 nullable site).
    inj.run(`i${d}`, "p1", null, `${day}T09:00:00.000Z`);
  }
  sugar.run("other", "p2", 300, `2026-07-${String(days).padStart(2, "0")}T10:00:00.000Z`);
  return db;
}

function feed(
  db: DatabaseSync,
  limit: number,
  range?: { start: number; end: number },
  excludeCalculatorInjections = false
): FeedRow[] {
  return db
    .prepare(journalFeedSql(range != null, excludeCalculatorInjections))
    .all(...(journalFeedArgs("p1", limit, range) as never[])) as unknown as FeedRow[];
}

const day = (iso: string) => new Date(iso).getTime();

function main() {
  console.log("zerospike journal feed query test");

  section("A. one ordered, limited feed");
  {
    const db = makeFeedDb(4);
    const all = feed(db, 100);
    eq("every entry of every kind is returned once", all.length, 12);
    eq("another profile's rows never leak in", all.some((r) => r.id === "other"), false);
    eq("newest first", all[0].logged_at, "2026-07-04T09:00:00.000Z");
    eq("the injection is the newest entry", all[0].kind, "injection");
    // A meal save writes its reading and the meal at the same instant; the
    // reading stayed ahead of the meal in the old JS merge, and still does.
    eq(
      "entries sharing a timestamp keep the reading ahead of the meal",
      `${all[1].kind}>${all[2].kind}`,
      "glucose>meal"
    );
    eq("the meal keeps its joined food name", all[2].name_en, "Rice");
    eq("a dose logged with no region stays null", all[0].site, null);
    eq("the injection's own source survives the union", all[0].source, "calculator");
    eq("the reading's value survives the union", all[1].glucose_level_mgdl, 104);

    // The core of the fix: the cap is on the merged feed, not per table.
    eq("LIMIT caps the merged feed", feed(db, 5).length, 5);
    eq("a limit of 5 starts at the newest entry", feed(db, 5)[0].id, "i4");
    db.close();
  }

  section("B. the date range is applied in SQL");
  {
    // 30 days of history (90 entries), far past the tight limits below.
    const db = makeFeedDb(30);
    const oneDay = {
      start: day("2026-07-02T00:00:00.000Z"),
      end: day("2026-07-02T23:59:59.999Z"),
    };
    const inDay = feed(db, 500, oneDay);
    eq("only the requested day comes back", inDay.length, 3);
    eq(
      "every returned entry is inside the range",
      inDay.every((r) => r.logged_at.startsWith("2026-07-02")),
      true
    );

    // The bug: the range used to be a JS filter over the newest N rows, so an OLD
    // range returned nothing at all once N was spent on recent entries.
    const oldDayTightLimit = feed(db, 3, oneDay);
    eq("an old range is complete even under a tight limit", oldDayTightLimit.length, 3);
    eq("and it is the requested day, not the newest one", oldDayTightLimit[0].logged_at.slice(0, 10), "2026-07-02");

    const empty = feed(db, 500, {
      start: day("2025-01-01T00:00:00.000Z"),
      end: day("2025-01-31T00:00:00.000Z"),
    });
    eq("a range with no entries returns none", empty.length, 0);
    db.close();
  }

  section("C. excludeCalculatorInjections (dashboard journal only)");
  {
    // 3 days of the usual fixture (a calculator-written bolus each day), plus
    // one HAND-entered injection - the flag must never touch that one.
    const db = makeFeedDb(3);
    db.exec(
      `INSERT INTO injection_logs VALUES
        ('manual1','p1','abdomen_left',1,3,'bolus',NULL,NULL,NULL,'manual','2026-07-03T09:30:00.000Z','[]',NULL,NULL);`
    );

    const withCalc = feed(db, 100);
    eq("default mode still carries the calculator bolus", withCalc.some((r) => r.id === "i3"), true);
    eq("default mode carries the manual injection too", withCalc.some((r) => r.id === "manual1"), true);

    const noCalc = feed(db, 100, undefined, true);
    eq("exclude mode drops the calculator bolus", noCalc.some((r) => r.id === "i3"), false);
    eq("exclude mode keeps the hand-entered injection", noCalc.some((r) => r.id === "manual1"), true);
    eq(
      "exclude mode leaves meal rows untouched",
      noCalc.filter((r) => r.kind === "meal").length,
      3
    );

    // The core of R11: the filter sits in the branch's WHERE, inside the UNION,
    // so it runs before the outer LIMIT. A limit tight enough to matter must
    // still fill up with visible rows - filtering AFTER a limit built from the
    // unfiltered feed would have handed back 3 rows here (the 4th slot spent on
    // the calculator row this mode is supposed to hide), not 4.
    const tight = feed(db, 4, undefined, true);
    eq("the filter is applied before LIMIT, not after", tight.length, 4);
    eq(
      "none of the limited rows are a calculator-sourced injection",
      tight.every((r) => r.source !== "calculator"),
      true
    );
    db.close();
  }

  section("D. the medication branch (schema v16)");
  {
    // med_logs stores epoch MILLISECONDS where every other log table stores ISO
    // text. SQLite orders by type before value, so an unconverted integer
    // timestamp sinks below every string one: the whole point of the branch's
    // strftime() is that a medication entry lands in the day it happened.
    const db = makeFeedDb(3);
    const med = db.prepare("INSERT INTO med_logs VALUES (?, ?, ?, ?, ?, ?);");
    med.run("d2", "p1", day("2026-07-02T08:30:00.000Z"), "Metformin", "kahvaltiyla", 1);
    med.run("d3", "p1", day("2026-07-03T21:00:00.000Z"), null, null, 1);
    // Another profile's entry, and a taken_at with milliseconds in it.
    med.run("dx", "p2", day("2026-07-03T21:30:00.000Z"), "Baskasi", null, 1);
    med.run("dms", "p1", day("2026-07-01T06:15:42.123Z"), "Erken", null, 1);

    const all = feed(db, 100);
    eq("medication entries join the feed", all.filter((r) => r.kind === "med").length, 3);
    eq("another profile's medication never leaks in", all.some((r) => r.id === "dx"), false);
    eq("the newest entry is now the evening medication", all[0].id, "d3");
    // Interleaving is the regression: without the conversion every med row would
    // sit in a block at one end of the feed instead of in its own day.
    const order = all.map((r) => r.id).join(",");
    eq(
      "medication sorts chronologically among the other kinds",
      order,
      "d3,i3,s3,m3,i2,d2,s2,m2,i1,s1,m1,dms"
    );
    const d2 = all.find((r) => r.id === "d2")!;
    eq("the stored epoch reads back as the same ISO instant", d2.logged_at, "2026-07-02T08:30:00.000Z");
    eq("milliseconds survive the conversion", all.find((r) => r.id === "dms")!.logged_at, "2026-07-01T06:15:42.123Z");
    eq("the name comes through", d2.med_name, "Metformin");
    eq("so does the note", d2.note, "kahvaltiyla");
    eq("an unnamed entry stays unnamed", all.find((r) => r.id === "d3")!.med_name, null);

    // The range bounds for this branch are epoch numbers, not ISO strings: bound
    // as text they would compare against an integer column and match nothing.
    const oneDay = {
      start: day("2026-07-02T00:00:00.000Z"),
      end: day("2026-07-02T23:59:59.999Z"),
    };
    const inDay = feed(db, 500, oneDay);
    eq("a ranged feed includes the day's medication", inDay.some((r) => r.id === "d2"), true);
    eq("and only that day's entries", inDay.length, 4);
    eq(
      "a range outside it excludes medication too",
      feed(db, 500, {
        start: day("2025-01-01T00:00:00.000Z"),
        end: day("2025-01-31T00:00:00.000Z"),
      }).length,
      0
    );
    db.close();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
