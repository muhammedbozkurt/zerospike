/**
 * lib/insightsPro.ts correctness harness. No jest, same standalone style as
 * scripts/mealResponse.test.ts.
 *
 * Run: npx tsx scripts/insightsPro.test.ts
 *
 * Every date-sensitive scenario anchors on a fixed local Wednesday (2026-06-10,
 * mid-June — nowhere near a DST transition in either hemisphere) built via the
 * local Date constructor rather than an ISO/UTC string, so the fixtures agree
 * with the module's own local-calendar arithmetic (weekStartMs, addDaysLocal,
 * dayKey) regardless of which timezone actually runs this file. Where a
 * fixture depends on knowing the exact weekday zerospike's own week-start rule
 * lands on, the test derives it from the function's own boundary contract
 * (e.g. "a Monday-anchored week always starts on a local Monday") instead of
 * hand-computing a date, so it stays correct however the runner's clock/TZ is
 * set.
 */
declare const console: { log: (...a: unknown[]) => void };
declare const process: { exit: (code: number) => void };

import {
  weekAnchorForLang,
  weeklyComparison,
  hourBandAverages,
  HOUR_BAND_COUNT,
  agpPercentiles,
  bestDayAndStreaks,
  MIN_READINGS_PER_DAY,
  mealResponseSummary,
  cvTrend,
  type WeekAnchor,
} from "../lib/insightsPro";
import { computeAgp } from "../lib/agp";
import { rangeWindowDays, DEFAULT_TIR_BAND, type DateRange } from "../lib/insights";
import type { Lang, MealLog, SugarLog } from "../lib/db/types";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ": " + detail : ""}`);
  }
}
function eq<T>(name: string, actual: T, expected: T): void {
  ok(name, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}
/** Float comparison within `eps` — avg/CV/slope carry fractional remainders. */
function close(name: string, actual: number | null, expected: number, eps = 0.01): void {
  ok(
    actual != null && Math.abs(actual - expected) < eps,
    `got ${actual}, want ~${expected}`
  );
}
function section(title: string): void {
  console.log(`\n${title}`);
}

// ── Fixtures ─────────────────────────────────────────────────────────────

function mkReading(id: string, iso: string, mgdl: number): SugarLog {
  return {
    id,
    profile_id: "p1",
    glucose_level_mgdl: mgdl,
    period_tag: "manual",
    source: "manual",
    logged_at: iso,
    tags: [],
    healthkit_uuid: null,
  };
}
function mkMeal(id: string, iso: string, sugarLogId: string | null = null): MealLog {
  return {
    id,
    profile_id: "p1",
    sugar_log_id: sugarLogId,
    food_id: null,
    custom_food_name: null,
    portion_g: 0,
    calculated_carbs_g: 0,
    insulin_dose_units: 0,
    photo_uri_local: null,
    personal_note: null,
    logged_at: iso,
    tags: [],
    meal_template_id: null,
  };
}

/** Wed 2026-06-10, local. Mid-June: clear of every hemisphere's DST window. */
const NOW = new Date(2026, 5, 10, 12, 0, 0).getTime();
/** Local midnight of NOW's own day. */
const TODAY0 = new Date(2026, 5, 10, 0, 0, 0).getTime();
/** `offsetDays` from NOW's calendar day, at local `hour:minute`. Date's own
 *  field math normalizes month/day overflow, so this is safe across the
 *  small offsets used below. */
function dOffset(offsetDays: number, hour = 9, minute = 0): number {
  return new Date(2026, 5, 10 + offsetDays, hour, minute, 0).getTime();
}
function keyOffset(offsetDays: number): string {
  const d = new Date(2026, 5, 10 + offsetDays);
  const p2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

console.log("zerospike insightsPro test");

// ── A. weekAnchorForLang ─────────────────────────────────────────────────
section("A. weekAnchorForLang (mirrors app/settings/notifications.tsx weekOrder)");
{
  const cases: [Lang, WeekAnchor][] = [
    ["ar", "saturday"],
    ["ja", "sunday"],
    ["en", "sunday"],
    ["tr", "monday"],
    ["de", "monday"],
    ["fr", "monday"],
    ["es", "monday"],
    ["it", "monday"],
    ["pt", "monday"],
  ];
  for (const [lang, anchor] of cases) {
    eq(`${lang} -> ${anchor}`, weekAnchorForLang(lang), anchor);
  }
}

// ── B. weeklyComparison ──────────────────────────────────────────────────
section("B. weeklyComparison");
{
  // B1: the returned week boundaries always land on the anchor's weekday,
  // whatever weekday NOW itself happens to be.
  const probeMon = weeklyComparison([], NOW, "monday");
  eq("monday anchor: currentWeekStart is a Monday", new Date(probeMon.currentWeekStart).getDay(), 1);
  eq("monday anchor: previousWeekStart is also a Monday", new Date(probeMon.previousWeekStart).getDay(), 1);
  ok("currentWeekStart <= now", probeMon.currentWeekStart <= NOW);
  ok(
    "now falls before currentWeekStart + 7 local days",
    NOW < new Date(new Date(probeMon.currentWeekStart).setDate(new Date(probeMon.currentWeekStart).getDate() + 7)).getTime()
  );
  const expectedPrev = new Date(probeMon.currentWeekStart);
  expectedPrev.setDate(expectedPrev.getDate() - 7);
  eq("previousWeekStart is exactly 7 local days before currentWeekStart", probeMon.previousWeekStart, expectedPrev.getTime());

  const probeSun = weeklyComparison([], NOW, "sunday");
  eq("sunday anchor: currentWeekStart is a Sunday", new Date(probeSun.currentWeekStart).getDay(), 0);
  const probeSat = weeklyComparison([], NOW, "saturday");
  eq("saturday anchor: currentWeekStart is a Saturday", new Date(probeSat.currentWeekStart).getDay(), 6);

  const probeDefault = weeklyComparison([], NOW);
  eq("default anchor is monday", new Date(probeDefault.currentWeekStart).getDay(), 1);

  // B2: no data at all -> every field null/zero, never throws.
  eq("empty: currentReadingCount", probeMon.currentReadingCount, 0);
  eq("empty: previousReadingCount", probeMon.previousReadingCount, 0);
  eq("empty: tir.current null", probeMon.tir.current, null);
  eq("empty: tir.delta null", probeMon.tir.delta, null);
  eq("empty: tir.direction null", probeMon.tir.direction, null);
  eq("empty: avg.current null", probeMon.avg.current, null);
  eq("empty: cv.current null", probeMon.cv.current, null);

  const cw = probeMon.currentWeekStart;
  const pw = probeMon.previousWeekStart;

  // B3: a single current-week reading -> avg exists, cv needs 2 points so
  // stays null, and with no previous-week data the delta stays null too.
  const single = [mkReading("s1", new Date(cw + 3_600_000).toISOString(), 140)];
  const r3 = weeklyComparison(single, NOW, "monday");
  eq("single reading: avg.current = value", r3.avg.current, 140);
  eq("single reading: avg.delta null (no previous)", r3.avg.delta, null);
  eq("single reading: cv.current null (needs 2 points)", r3.cv.current, null);
  eq("single reading: tir.current is 100 (140 in 70-180)", r3.tir.current, 100);

  // B4: both weeks populated with round numbers, hand-computed expectations.
  const readings = [
    mkReading("c1", new Date(cw + 1 * 3_600_000).toISOString(), 100),
    mkReading("c2", new Date(cw + 2 * 3_600_000).toISOString(), 100),
    mkReading("c3", new Date(cw + 3 * 3_600_000).toISOString(), 160),
    mkReading("p1", new Date(pw + 1 * 3_600_000).toISOString(), 200),
    mkReading("p2", new Date(pw + 2 * 3_600_000).toISOString(), 220),
  ];
  const r4 = weeklyComparison(readings, NOW, "monday");
  eq("B4: currentReadingCount", r4.currentReadingCount, 3);
  eq("B4: previousReadingCount", r4.previousReadingCount, 2);
  close("B4: avg.current = 120", r4.avg.current, 120);
  close("B4: avg.previous = 210", r4.avg.previous, 210);
  close("B4: avg.delta = -90", r4.avg.delta as number, -90);
  eq("B4: avg.direction down", r4.avg.direction, "down");
  eq("B4: tir.current = 100 (all 3 within 70-180)", r4.tir.current, 100);
  eq("B4: tir.previous = 0 (both above 180)", r4.tir.previous, 0);
  eq("B4: tir.direction up", r4.tir.direction, "up");
  close("B4: cv.current ~ 28.87", r4.cv.current, 28.867, 0.01);
  close("B4: cv.previous ~ 6.73", r4.cv.previous, 6.735, 0.01);
  eq("B4: cv.direction up", r4.cv.direction, "up");

  // B5/B6: boundary readings around the week seam.
  const boundary = [
    mkReading("edge-prev", new Date(cw - 1).toISOString(), 100), // last ms of previous week
    mkReading("edge-cur", new Date(cw).toISOString(), 100), // first ms of current week
    mkReading("future", new Date(NOW + 60_000).toISOString(), 999), // after `now`, excluded
  ];
  const r5 = weeklyComparison(boundary, NOW, "monday");
  eq("boundary: cw-1 counts as previous week", r5.previousReadingCount, 1);
  eq("boundary: cw counts as current week", r5.currentReadingCount, 1);

  // B7: a reading after `now` never counts (an upsert of "future" data is
  // never trusted for what is, by definition, already in the past).
  const strictlyBefore = weeklyComparison(
    [mkReading("f", new Date(NOW + 1).toISOString(), 100)],
    NOW,
    "monday"
  );
  eq("reading 1ms after now is excluded from current", strictlyBefore.currentReadingCount, 0);
}

// ── C. hourBandAverages ──────────────────────────────────────────────────
section("C. hourBandAverages (8 bands of 3h)");
{
  eq("HOUR_BAND_COUNT is 8", HOUR_BAND_COUNT, 8);

  const empty = hourBandAverages([], 30);
  eq("empty: 8 bands returned", empty.length, 8);
  eq("empty: band0 spans 0-3", `${empty[0].startHour}-${empty[0].endHour}`, "0-3");
  eq("empty: band7 spans 21-24", `${empty[7].startHour}-${empty[7].endHour}`, "21-24");
  ok("empty: every band avg null", empty.every((b) => b.avg === null));
  ok("empty: every band sparse (threshold floor is 3)", empty.every((b) => b.sparse));

  // Band0 (hours 0-2) gets exactly the sparse-floor of 3 readings -> not sparse;
  // band1 (hours 3-5) gets exactly 1 -> sparse.
  const local = (h: number, m = 0) => new Date(2026, 5, 10, h, m, 0).toISOString();
  const mixed = [
    mkReading("a", local(0), 100),
    mkReading("b", local(1), 110),
    mkReading("c", local(2), 120),
    mkReading("d", local(5), 130),
  ];
  const bands30 = hourBandAverages(mixed, 30);
  eq("band0 n=3", bands30[0].n, 3);
  close("band0 avg=110", bands30[0].avg, 110);
  eq("band0 not sparse at exactly the floor", bands30[0].sparse, false);
  eq("band1 n=1", bands30[1].n, 1);
  eq("band1 sparse with 1 reading", bands30[1].sparse, true);

  // Threshold scales with the window: the same 5-reading band is fine at
  // days=30 (threshold 3) but sparse at days=90 (threshold ceil(90/14)=7).
  const fiveInOneBand = Array.from({ length: 5 }, (_, i) => mkReading(`x${i}`, local(0, i), 100 + i));
  const at30 = hourBandAverages(fiveInOneBand, 30);
  const at90 = hourBandAverages(fiveInOneBand, 90);
  eq("5 readings not sparse over a 30-day window", at30[0].sparse, false);
  eq("5 readings sparse over a 90-day window (threshold 7)", at90[0].sparse, true);

  // Hour-to-band boundary: hour 3 belongs to band1, not band0; hour 23 -> band7.
  const boundary = [mkReading("h3", local(3), 100), mkReading("h23", local(23), 200)];
  const bb = hourBandAverages(boundary, 30);
  eq("hour 3 falls in band1 (3-6)", bb[1].n, 1);
  eq("hour 3 does not leak into band0", bb[0].n, 0);
  eq("hour 23 falls in band7 (21-24)", bb[7].n, 1);

  // Unparseable timestamp: skipped, never thrown.
  const withBad = [...mixed, { ...mixed[0], id: "bad", logged_at: "not-a-date" }];
  const bandsBad = hourBandAverages(withBad, 30);
  eq("unparseable reading does not inflate any band", bandsBad[0].n, 3);
}

// ── D. agpPercentiles ─────────────────────────────────────────────────────
section("D. agpPercentiles (thin wrapper over lib/agp.ts computeAgp)");
{
  const empty = agpPercentiles([], NOW, 14);
  eq("empty: no bands", empty.bands.length, 0);
  eq("empty: totalReadings 0", empty.totalReadings, 0);

  const start = NOW - 14 * 86_400_000;
  const readings = [
    mkReading("in-start", new Date(start).toISOString(), 100), // inclusive lower edge
    mkReading("in-now", new Date(NOW).toISOString(), 110), // inclusive upper edge
    mkReading("out-before", new Date(start - 1).toISOString(), 999), // excluded
    mkReading("out-after", new Date(NOW + 1).toISOString(), 999), // excluded
  ];
  const agp = agpPercentiles(readings, NOW, 14);
  eq("window edges included, outside excluded", agp.totalReadings, 2);

  // Delegation, not duplication: calling computeAgp directly with the
  // equivalent range must produce the identical result agpPercentiles does.
  const range: DateRange = { start, end: NOW };
  const direct = computeAgp(readings, rangeWindowDays(range), range);
  eq("bands length matches direct computeAgp call", agp.bands.length, direct.bands.length);
  eq("totalReadings matches direct computeAgp call", agp.totalReadings, direct.totalReadings);
  ok(
    "band contents match direct computeAgp call byte-for-byte",
    JSON.stringify(agp.bands) === JSON.stringify(direct.bands)
  );

  // A known 5-point band: p50 must be the middle value, matching lib/agp.ts's
  // own percentile() (the same one app/insights.tsx's AGP curve reads).
  const sameHour = [100, 110, 120, 130, 140].map((v, i) =>
    mkReading(`p${i}`, new Date(start + 3_600_000 + i * 1000).toISOString(), v)
  );
  const agpP = agpPercentiles(sameHour, NOW, 14);
  const band = agpP.bands.find((b) => b.n === 5);
  ok("5-point band found", band != null);
  eq("median of [100,110,120,130,140] is 120", band?.p50, 120);
}

// ── E. bestDayAndStreaks ──────────────────────────────────────────────────
section("E. bestDayAndStreaks");
{
  const empty = bestDayAndStreaks([], DEFAULT_TIR_BAND, NOW, 30);
  eq("empty: bestDay null", empty.bestDay, null);
  eq("empty: targetDayStreak current 0", empty.targetDayStreak.current, 0);
  eq("empty: targetDayStreak longest 0", empty.targetDayStreak.longest, 0);
  eq("empty: loggingStreak current 0", empty.loggingStreak.current, 0);
  eq("empty: qualifyingDays 0", empty.qualifyingDays, 0);

  // days=0 must not throw and degrades to "just today".
  const zeroDays = bestDayAndStreaks([], DEFAULT_TIR_BAND, NOW, 0);
  eq("days=0: no crash, empty streaks", zeroDays.loggingStreak.current, 0);

  eq("MIN_READINGS_PER_DAY is 3", MIN_READINGS_PER_DAY, 3);

  const inRange = (v: number) => v; // helper for readability only
  const readings: SugarLog[] = [
    // offset -1: 4 readings, all in range -> qualifies target + logging
    mkReading("d1a", new Date(dOffset(-1, 7)).toISOString(), inRange(100)),
    mkReading("d1b", new Date(dOffset(-1, 9)).toISOString(), inRange(100)),
    mkReading("d1c", new Date(dOffset(-1, 13)).toISOString(), inRange(100)),
    mkReading("d1d", new Date(dOffset(-1, 19)).toISOString(), inRange(100)),
    // offset -2: 4 readings, all in range -> qualifies
    mkReading("d2a", new Date(dOffset(-2, 7)).toISOString(), 110),
    mkReading("d2b", new Date(dOffset(-2, 9)).toISOString(), 110),
    mkReading("d2c", new Date(dOffset(-2, 13)).toISOString(), 110),
    mkReading("d2d", new Date(dOffset(-2, 19)).toISOString(), 110),
    // offset -3: only 2 readings -> logged, but not enough to be "scored"
    mkReading("d3a", new Date(dOffset(-3, 8)).toISOString(), 100),
    mkReading("d3b", new Date(dOffset(-3, 20)).toISOString(), 105),
    // offset -4: 5 readings, all in range -> the actual best day (ties d1/d2
    // on TIR=100 but wins on reading count)
    mkReading("d4a", new Date(dOffset(-4, 6)).toISOString(), 120),
    mkReading("d4b", new Date(dOffset(-4, 9)).toISOString(), 120),
    mkReading("d4c", new Date(dOffset(-4, 12)).toISOString(), 120),
    mkReading("d4d", new Date(dOffset(-4, 15)).toISOString(), 120),
    mkReading("d4e", new Date(dOffset(-4, 20)).toISOString(), 120),
    // offset -5: nothing logged -> breaks both streaks
    // offset -6: 6 readings but only half in range (TIR 50) -> more readings
    // than d4, but a worse day; must NOT be picked as best.
    mkReading("d6a", new Date(dOffset(-6, 6)).toISOString(), 100),
    mkReading("d6b", new Date(dOffset(-6, 8)).toISOString(), 100),
    mkReading("d6c", new Date(dOffset(-6, 10)).toISOString(), 100),
    mkReading("d6d", new Date(dOffset(-6, 14)).toISOString(), 300),
    mkReading("d6e", new Date(dOffset(-6, 18)).toISOString(), 300),
    mkReading("d6f", new Date(dOffset(-6, 22)).toISOString(), 300),
    // offset -8: a single isolated logged day (gap on both sides)
    mkReading("d8a", new Date(dOffset(-8, 12)).toISOString(), 90),
  ];

  const res = bestDayAndStreaks(readings, DEFAULT_TIR_BAND, NOW, 10);

  eq("best day is offset -4 (ties on TIR, wins on reading count)", res.bestDay?.day, keyOffset(-4));
  eq("best day tir is 100", res.bestDay?.tir, 100);
  eq("best day n is 5", res.bestDay?.n, 5);

  eq("target streak current is 2 (offset -1, -2; -3 not scored)", res.targetDayStreak.current, 2);
  eq("target streak longest is 2", res.targetDayStreak.longest, 2);

  eq("logging streak current is 4 (offset -1..-4, broken by -5 gap)", res.loggingStreak.current, 4);
  eq("logging streak longest is 4", res.loggingStreak.longest, 4);

  eq("qualifyingDays counts -1,-2,-4,-6", res.qualifyingDays, 4);

  // Tie-break sanity in isolation: two equally-scored days, more readings wins.
  const tieReadings = [
    mkReading("t1a", new Date(dOffset(-1, 8)).toISOString(), 100),
    mkReading("t1b", new Date(dOffset(-1, 20)).toISOString(), 100),
    mkReading("t1c", new Date(dOffset(-1, 21)).toISOString(), 100),
    mkReading("t2a", new Date(dOffset(-2, 8)).toISOString(), 100),
    mkReading("t2b", new Date(dOffset(-2, 9)).toISOString(), 100),
    mkReading("t2c", new Date(dOffset(-2, 20)).toISOString(), 100),
    mkReading("t2d", new Date(dOffset(-2, 21)).toISOString(), 100),
  ];
  const tieRes = bestDayAndStreaks(tieReadings, DEFAULT_TIR_BAND, NOW, 10);
  eq("tie on TIR=100: the 4-reading day wins over the 3-reading day", tieRes.bestDay?.day, keyOffset(-2));
}

// ── F. mealResponseSummary (reuses lib/mealResponse.ts, no duplicated math) ─
section("F. mealResponseSummary");
{
  const START = "2026-06-01T08:00:00.000Z";
  const startMs = new Date(START).getTime();
  const at = (min: number) => new Date(startMs + min * 60_000).toISOString();

  const meals: MealLog[] = [
    mkMeal("m1", at(0), "b1"), // baseline 100, peak 160 -> delta 60
    mkMeal("m2", at(500), "b2"), // baseline 100, peak 120 -> delta 20 (best)
    mkMeal("m3", at(1000), null), // no baseline available -> delta null
    mkMeal("m4", at(1500), "b4"), // baseline 150, peak 300 -> delta 150 (worst)
    mkMeal("m5", at(2000), null), // only 1 reading in window -> not evaluable
  ];
  const readings: SugarLog[] = [
    mkReading("b1", at(-5), 100),
    mkReading("r1a", at(30), 130),
    mkReading("r1b", at(60), 160),

    mkReading("b2", at(480), 100),
    mkReading("r2a", at(530), 110),
    mkReading("r2b", at(560), 120),

    mkReading("r3a", at(1010), 140),
    mkReading("r3b", at(1040), 150),

    mkReading("b4", at(1480), 150),
    mkReading("r4a", at(1540), 250),
    mkReading("r4b", at(1560), 300),

    mkReading("r5a", at(2010), 140),
  ];

  const summary = mealResponseSummary(meals, readings);
  eq("totalMeals is 5", summary.totalMeals, 5);
  eq("evaluableMeals is 4 (m5 has only 1 reading)", summary.evaluableMeals, 4);
  eq("deltaSampleSize is 3 (m3 has no baseline)", summary.deltaSampleSize, 3);
  close("avgDelta ~ 76.667", summary.avgDelta, 76.667, 0.01);
  eq("best meal is m2 (smallest delta)", summary.best?.mealId, "m2");
  eq("best delta is 20", summary.best?.delta, 20);
  eq("worst meal is m4 (largest delta)", summary.worst?.mealId, "m4");
  eq("worst delta is 150", summary.worst?.delta, 150);

  const noMeals = mealResponseSummary([], readings);
  eq("no meals: totalMeals 0", noMeals.totalMeals, 0);
  eq("no meals: avgDelta null", noMeals.avgDelta, null);
  eq("no meals: best null", noMeals.best, null);

  const noReadings = mealResponseSummary(meals, []);
  eq("no readings: evaluableMeals 0", noReadings.evaluableMeals, 0);
  eq("no readings: avgDelta null", noReadings.avgDelta, null);
}

// ── G. cvTrend ────────────────────────────────────────────────────────────
section("G. cvTrend");
{
  const probe = cvTrend([], NOW, "monday", 6);
  eq("probe: 6 weeks returned", probe.weeks.length, 6);
  ok("probe: every weekStart is a Monday", probe.weeks.every((w) => new Date(w.weekStart).getDay() === 1));
  ok(
    "probe: weeks are 7 local days apart, oldest first",
    probe.weeks.every((w, i) => {
      if (i === 0) return true;
      const prev = new Date(probe.weeks[i - 1].weekStart);
      prev.setDate(prev.getDate() + 7);
      return prev.getTime() === w.weekStart;
    })
  );
  eq("probe: empty data -> direction null", probe.direction, null);
  eq("probe: empty data -> slopePerWeek null", probe.slopePerWeek, null);
  ok("probe: every week cv null with no data", probe.weeks.every((w) => w.cv === null && w.n === 0));

  // weeks=0: no crash, nothing to report.
  const zero = cvTrend([], NOW, "monday", 0);
  eq("weeks=0: empty array", zero.weeks.length, 0);
  eq("weeks=0: direction null", zero.direction, null);

  // Populate the 4 most recent of 6 weeks with a clear, monotonic CV rise.
  const w = probe.weeks.map((p) => p.weekStart);
  const at = (weekIdx: number, hour: number) => new Date(w[weekIdx] + hour * 3_600_000).toISOString();
  const readings: SugarLog[] = [
    mkReading("w2a", at(2, 1), 100),
    mkReading("w2b", at(2, 2), 100), // cv 0

    mkReading("w3a", at(3, 1), 100),
    mkReading("w3b", at(3, 2), 120), // mean110, cv ~12.86

    mkReading("w4a", at(4, 1), 100),
    mkReading("w4b", at(4, 2), 140), // mean120, cv ~23.57

    mkReading("w5a", at(5, 1), 100),
    mkReading("w5b", at(5, 2), 160), // mean130, cv ~32.64 (current week)
  ];
  const trend = cvTrend(readings, NOW, "monday", 6);
  eq("week0 (no data) cv null", trend.weeks[0].cv, null);
  eq("week1 (no data) cv null", trend.weeks[1].cv, null);
  close("week2 cv ~ 0", trend.weeks[2].cv, 0, 0.01);
  eq("week2 n is 2", trend.weeks[2].n, 2);
  close("week3 cv ~ 12.86", trend.weeks[3].cv, 12.856, 0.05);
  close("week4 cv ~ 23.57", trend.weeks[4].cv, 23.570, 0.05);
  close("week5 cv ~ 32.64", trend.weeks[5].cv, 32.635, 0.05);
  eq("direction is up (clear monotonic rise)", trend.direction, "up");
  ok("slopePerWeek is positive", (trend.slopePerWeek ?? 0) > 0);

  // Flat: every populated week has the identical CV.
  const flatReadings: SugarLog[] = [3, 4, 5].flatMap((idx) => [
    mkReading(`f${idx}a`, at(idx, 1), 100),
    mkReading(`f${idx}b`, at(idx, 2), 120),
  ]);
  const flatTrend = cvTrend(flatReadings, NOW, "monday", 6);
  eq("flat: direction is flat (identical CV every week)", flatTrend.direction, "flat");
  close("flat: slopePerWeek ~ 0", flatTrend.slopePerWeek, 0, 0.001);

  // Fewer than CV_TREND_MIN_WEEKS populated weeks -> no direction claimed.
  const twoWeeksOnly: SugarLog[] = [
    mkReading("o1", at(4, 1), 100),
    mkReading("o2", at(4, 2), 140),
    mkReading("o3", at(5, 1), 100),
    mkReading("o4", at(5, 2), 160),
  ];
  const sparseTrend = cvTrend(twoWeeksOnly, NOW, "monday", 6);
  eq("2 populated weeks: direction stays null", sparseTrend.direction, null);
  eq("2 populated weeks: slopePerWeek stays null", sparseTrend.slopePerWeek, null);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
