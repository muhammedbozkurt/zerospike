import type { Lang, MealLog, SugarLog } from "./db/types";
import { computeAgp, type Agp } from "./agp";
import {
  DEFAULT_TIR_BAND,
  rangeWindowDays,
  type DateRange,
  type TirBand,
} from "./insights";
import {
  BASELINE_LOOKBACK_MINUTES,
  MEAL_RESPONSE_HOURS,
  computeMealResponse,
} from "./mealResponse";
import { selectGlucoseBasis, timeOf, type MetricsWindow } from "./cgm/metrics";
import { inTargetBand } from "./glucose";

/**
 * Pro "Insights", wave 2: pure calculation layer (docs/plan-2.2.0.md D10).
 *
 * No DB access, no UI, no locale. Every function takes the rows it needs as
 * plain arrays and, whenever it needs a notion of "today", an explicit
 * `now` (epoch ms) instead of calling Date.now() itself, so every result here
 * is reproducible from its arguments alone. This is a deliberate tightening
 * of the convention in lib/insights.ts (whose windowDays-style helpers default
 * to reading Date.now() internally when no explicit range is given); nothing
 * in this file ever reads the clock.
 *
 * Same regulation posture as lib/insights.ts and lib/mealResponse.ts: every
 * figure reports what was logged. Nothing here is causal, an alarm, or advice.
 *
 * Units: every input/output stays in raw mg/dL, exactly like lib/insights.ts
 * and lib/agp.ts. Converting to the profile's display unit (lib/glucose.ts's
 * formatGlucose) is the UI wave's job, not this layer's.
 */

// ── Shared local helpers (kept private: lib/insights.ts's own equivalents,
// mean/stdev/dayKey/startOfDay, are not exported, so a small amount of
// parallel arithmetic here is unavoidable without reaching into app-facing
// modules). ──────────────────────────────────────────────────────────────

function mean(ns: number[]): number | null {
  return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : null;
}

/** Sample standard deviation (needs at least 2 points). */
function stdev(ns: number[]): number | null {
  if (ns.length < 2) return null;
  const m = ns.reduce((a, b) => a + b, 0) / ns.length;
  const variance = ns.reduce((a, b) => a + (b - m) * (b - m), 0) / (ns.length - 1);
  return Math.sqrt(variance);
}

function cvOf(vals: number[]): number | null {
  const m = mean(vals);
  const sd = stdev(vals);
  if (m == null || sd == null || m === 0) return null;
  return (sd / m) * 100;
}

function tirOf(vals: number[], band: TirBand): number | null {
  if (vals.length === 0) return null;
  return (vals.filter((v) => inTargetBand(v, band)).length / vals.length) * 100;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Local midnight of the calendar day `ms` falls in. */
function localMidnight(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Local calendar-day key (YYYY-MM-DD), never derived from toISOString(). */
function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** `ms` shifted by whole LOCAL calendar days via Date's own field math, so a
 *  DST transition inside the shift never makes a "7 days later" land 1 hour
 *  off local midnight the way raw `+7 * 86_400_000` can. */
function addDaysLocal(ms: number, days: number): number {
  const d = new Date(ms);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

// ── a) Weekly comparison ───────────────────────────────────────────────────

/** Which weekday a "week" starts on. */
export type WeekAnchor = "monday" | "sunday" | "saturday";

const ANCHOR_DOW: Record<WeekAnchor, number> = { sunday: 0, monday: 1, saturday: 6 };

/**
 * Language → week-start day, mirroring app/settings/notifications.tsx's
 * weekOrder(): ar starts Saturday, ja/en start Sunday, every other bundle
 * starts Monday. Re-derived here rather than imported: that file lives under
 * app/** and this module has to stay a pure data layer with zero app/router
 * dependency; the mapping is a 3-line rule, small enough that duplicating it
 * is cheaper than the coupling.
 */
export function weekAnchorForLang(lang: Lang): WeekAnchor {
  if (lang === "ar") return "saturday";
  if (lang === "ja" || lang === "en") return "sunday";
  return "monday";
}

/** Local midnight of the start of the calendar week `ms` falls in. */
function weekStartMs(ms: number, anchor: WeekAnchor): number {
  const midnight = localMidnight(ms);
  const dow = new Date(midnight).getDay();
  const diff = (dow - ANCHOR_DOW[anchor] + 7) % 7;
  return diff === 0 ? midnight : addDaysLocal(midnight, -diff);
}

export type TrendDirection = "up" | "down" | "flat";

export interface WeekMetric {
  current: number | null;
  previous: number | null;
  /** current - previous. */
  delta: number | null;
  /** null exactly when delta is null (either window has no basis for it). */
  direction: TrendDirection | null;
}

export interface WeeklyComparison {
  weekAnchor: WeekAnchor;
  /** Local midnight, ms. */
  currentWeekStart: number;
  previousWeekStart: number;
  currentReadingCount: number;
  previousReadingCount: number;
  tir: WeekMetric;
  avg: WeekMetric;
  cv: WeekMetric;
}

function metricOf(cur: number | null, prev: number | null): WeekMetric {
  const delta = cur != null && prev != null ? cur - prev : null;
  const direction: TrendDirection | null =
    delta == null ? null : delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  return { current: cur, previous: prev, delta, direction };
}

/**
 * This calendar week (week-start .. now, so a week in progress is compared as
 * far as it has got) vs. the immediately preceding FULL week. Unlike
 * lib/insights.ts's weeklyDigest (a rolling last-7-days vs. previous-7-days
 * window), this is calendar-week aligned per the app's own week-start rule:
 * that alignment is the point of this card, so a Wednesday view compares
 * "this week so far" against "all of last week", not two arbitrary 7-day
 * slices. TIR/avg/CV are all normalized (%, mean), so a partial week is still
 * a fair comparison; only a raw count would not be, and this never reports one.
 */
export function weeklyComparison(
  readings: SugarLog[],
  now: number,
  weekAnchor: WeekAnchor = "monday",
  band: TirBand = DEFAULT_TIR_BAND
): WeeklyComparison {
  const currentWeekStart = weekStartMs(now, weekAnchor);
  const previousWeekStart = addDaysLocal(currentWeekStart, -7);

  // Each week picks its own basis (lib/cgm/metrics.ts): a week the sensor
  // covered well is measured on the sensor alone, a thin one on every reading.
  const valuesInRange = (start: number, endInclusive: number) =>
    selectGlucoseBasis(readings, { start, end: endInclusive }).readings.map(
      (r) => r.glucose_level_mgdl
    );

  const current = valuesInRange(currentWeekStart, now);
  // Previous week is a full week: up to (not including) the current week's start.
  const previous = valuesInRange(previousWeekStart, currentWeekStart - 1);

  return {
    weekAnchor,
    currentWeekStart,
    previousWeekStart,
    currentReadingCount: current.length,
    previousReadingCount: previous.length,
    tir: metricOf(tirOf(current, band), tirOf(previous, band)),
    avg: metricOf(mean(current), mean(previous)),
    cv: metricOf(cvOf(current), cvOf(previous)),
  };
}

// ── b) Hour-band averages (heat strip) ─────────────────────────────────────

/** Hours per band. 3h → 8 bands/day. See hourBandAverages for why. */
export const HOUR_BAND_SIZE = 3;
export const HOUR_BAND_COUNT = 24 / HOUR_BAND_SIZE;

/** Absolute floor of pooled readings before a band counts as reliable. */
export const HOURBAND_MIN_N_FLOOR = 3;

/** Design note: the threshold scales with the window length (roughly one
 *  reading per two weeks of window, floored at HOURBAND_MIN_N_FLOOR) so a
 *  7-day window isn't held to the same bar as a 90-day one. */
function hourBandSparseThreshold(days: number): number {
  return Math.max(HOURBAND_MIN_N_FLOOR, Math.ceil(Math.max(0, days) / 14));
}

export interface HourBand {
  /** Local hour, inclusive. 0, 3, 6, … 21. */
  startHour: number;
  /** Local hour, exclusive. startHour + HOUR_BAND_SIZE (24 for the last band). */
  endHour: number;
  avg: number | null;
  n: number;
  /** Too few pooled readings for this band's average to be trusted. */
  sparse: boolean;
}

/**
 * Mean glucose per 3-hour band of the day, pooled across every reading
 * handed in (the caller is expected to have already limited `readings` to the
 * window it cares about: this function does no date filtering of its own;
 * `days` is used only to size the sparse-data threshold below).
 *
 * Design decision, 8 bands of 3h, not 24 of 1h: zerospike is a manual
 * logging diary, not a continuous CGM feed. A typical user logs a handful of
 * readings a day, clustered around meals and fasting, so splitting into 24
 * single-hour cells leaves most cells at 0-2 points even over a 30-day
 * window, too thin to color a heat strip meaningfully. Pooling into 3-hour
 * bands triples the readings per cell for the same data. The existing
 * 4-slice night/morning/afternoon/evening split (lib/insights.ts's
 * `hourly`/DayKind) is coarser still and was judged too blunt for a
 * dedicated heat-strip widget; lib/agp.ts keeps the full 24 hourly buckets
 * because that curve already carries its own AGP_MIN_READINGS gate and a
 * continuous line tolerates thin cells better than discrete heat-strip color
 * do.
 */
export function hourBandAverages(
  readings: SugarLog[],
  days: number,
  /** The span the readings were taken from, to tell whether a sensor covered it.
   *  Without one, the span the readings themselves cover is used (this module
   *  never reads the clock). */
  window?: MetricsWindow
): HourBand[] {
  let win = window;
  if (!win) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const r of readings) {
      const t = timeOf(r);
      if (t < lo) lo = t;
      if (t > hi) hi = t;
    }
    win = { start: lo, end: hi };
  }
  // Only the choice of readings looks at the window; a reading outside it that
  // the caller handed in still counts when the sensor is not the basis.
  const basis = selectGlucoseBasis(readings, win);
  const used = basis.kind === "cgm" ? basis.readings : readings;
  const buckets: number[][] = Array.from({ length: HOUR_BAND_COUNT }, () => []);
  for (const r of used) {
    const t = timeOf(r);
    if (!Number.isFinite(t)) continue;
    const hour = new Date(t).getHours();
    if (Number.isNaN(hour)) continue;
    const band = Math.min(HOUR_BAND_COUNT - 1, Math.floor(hour / HOUR_BAND_SIZE));
    buckets[band].push(r.glucose_level_mgdl);
  }
  const threshold = hourBandSparseThreshold(days);
  return buckets.map((vals, i) => ({
    startHour: i * HOUR_BAND_SIZE,
    endHour: (i + 1) * HOUR_BAND_SIZE,
    avg: mean(vals),
    n: vals.length,
    sparse: vals.length < threshold,
  }));
}

// ── c) AGP percentiles ──────────────────────────────────────────────────────

/**
 * Hour-of-day p5/p25/p50/p75/p95 bands for the last `days` days up to `now`.
 * This is a thin, deterministic wrapper around lib/agp.ts's `computeAgp`,
 * NOT a re-implementation, so the median this returns is byte-identical to
 * the one app/insights.tsx already renders as its AGP curve (`agp.bands.map(b
 * => b.p50)`) when given the same window: both ultimately run the same
 * function. `computeAgp` is only ever called here with an explicit `range`,
 * so its own internal `Date.now()` fallback is never exercised through this
 * layer.
 *
 * The window itself uses raw ms (`now - days * 86_400_000`), matching how
 * lib/insights.ts's other windowDays-style helpers (dailyAverages,
 * trendVsPrevious, computeAgp's own windowDays path) already measure "last N
 * days": unlike weeklyComparison/cvTrend below, calendar-day alignment is
 * not the point here.
 */
export function agpPercentiles(readings: SugarLog[], now: number, days: number): Agp {
  const range: DateRange = { start: now - days * 86_400_000, end: now };
  return computeAgp(readings, rangeWindowDays(range), range);
}

// ── d) Best day + streaks ───────────────────────────────────────────────────

/** A calendar day needs at least this many readings before its own TIR/avg is
 *  trusted enough to be a "best day" candidate or score toward the target-day
 *  streak (a day with 1-2 scattered readings doesn't describe a whole day). */
export const MIN_READINGS_PER_DAY = 3;

/** "Day in target" streak bar: the day's own TIR% clears the ADA Time-in-Range
 *  consensus figure (>70%) most patients are gauged against. A count, not a
 *  recommendation: this only reports which days cleared the line. */
export const DAY_IN_TARGET_TIR_PCT = 70;

export interface BestDay {
  /** Local YYYY-MM-DD. */
  day: string;
  tir: number;
  avg: number;
  n: number;
}

export interface StreakInfo {
  /** Ending today, or yesterday if today has nothing logged yet (a day not
   *  over yet is not a broken streak). */
  current: number;
  /** Longest run anywhere inside the window. */
  longest: number;
}

export interface BestDayAndStreaks {
  /** null when no day in the window reached MIN_READINGS_PER_DAY. */
  bestDay: BestDay | null;
  targetDayStreak: StreakInfo;
  /** "Kept a record" streak: any day with >= 1 reading, no quality bar. */
  loggingStreak: StreakInfo;
  /** Days in the window that reached MIN_READINGS_PER_DAY (informational). */
  qualifyingDays: number;
}

/** True/false per local day, oldest first, last element = today. */
function streaksFromFlags(flags: boolean[]): StreakInfo {
  let longest = 0;
  let run = 0;
  for (const f of flags) {
    run = f ? run + 1 : 0;
    if (run > longest) longest = run;
  }
  let current = 0;
  let i = flags.length - 1;
  if (i >= 0 && !flags[i]) i--; // today not logged yet forgives only today
  while (i >= 0 && flags[i]) {
    current++;
    i--;
  }
  return { current, longest };
}

/**
 * Best single day (by TIR%) and two streaks over the last `days` days
 * (default 30) up to `now`: a "day in target" streak (TIR% >= 70, on days with
 * enough readings to score) and a plain logging streak (any reading at all).
 * Both streaks report their current run AND their longest run in the window,
 * unlike lib/insights.ts's consecutiveLogDays which only ever reports the
 * current one.
 */
export function bestDayAndStreaks(
  readings: SugarLog[],
  band: TirBand = DEFAULT_TIR_BAND,
  now: number,
  days = 30
): BestDayAndStreaks {
  const winDays = Math.max(0, Math.floor(days));
  const windowStart = now - winDays * 86_400_000;

  const basis = selectGlucoseBasis(readings, { start: windowStart, end: now });
  const byDay = new Map<string, number[]>();
  for (const r of basis.readings) {
    const key = dayKey(timeOf(r));
    const arr = byDay.get(key);
    if (arr) arr.push(r.glucose_level_mgdl);
    else byDay.set(key, [r.glucose_level_mgdl]);
  }
  // The logging streak is "kept a record", so it reads every reading, not only
  // the ones the figures are computed from.
  const recordedDays = new Set<string>();
  for (const r of basis.all) recordedDays.add(dayKey(timeOf(r)));

  let bestDay: BestDay | null = null;
  for (const [key, vals] of byDay) {
    if (vals.length < MIN_READINGS_PER_DAY) continue;
    const tir = tirOf(vals, band) as number;
    const avg = mean(vals) as number;
    const better =
      !bestDay ||
      tir > bestDay.tir ||
      (tir === bestDay.tir && vals.length > bestDay.n) ||
      (tir === bestDay.tir && vals.length === bestDay.n && key > bestDay.day);
    if (better) bestDay = { day: key, tir, avg, n: vals.length };
  }

  // Walk the window day-by-day (oldest -> newest, local calendar days) to
  // score both streaks; addDaysLocal keeps a DST transition inside the
  // window from dropping or duplicating a day.
  const todayStart = localMidnight(now);
  const firstDay = addDaysLocal(todayStart, -Math.max(0, winDays - 1));
  const targetFlags: boolean[] = [];
  const loggingFlags: boolean[] = [];
  let qualifyingDays = 0;
  for (let cursor = firstDay; cursor <= todayStart; cursor = addDaysLocal(cursor, 1)) {
    const vals = byDay.get(dayKey(cursor)) ?? [];
    loggingFlags.push(recordedDays.has(dayKey(cursor)));
    const scored = vals.length >= MIN_READINGS_PER_DAY;
    if (scored) qualifyingDays++;
    targetFlags.push(scored && (tirOf(vals, band) ?? 0) >= DAY_IN_TARGET_TIR_PCT);
  }

  return {
    bestDay,
    targetDayStreak: streaksFromFlags(targetFlags),
    loggingStreak: streaksFromFlags(loggingFlags),
    qualifyingDays,
  };
}

// ── e) Meal response summary ────────────────────────────────────────────────

export interface MealResponseSummaryEntry {
  mealId: string;
  logged_at: string;
  baseline: number | null;
  peak: number;
  /** peak - baseline; null when the meal had no baseline. */
  delta: number | null;
  timeToPeakMin: number;
}

export interface MealResponseSummary {
  totalMeals: number;
  /** Meals with a computable curve (>= MIN_READINGS_FOR_RESPONSE readings in
   *  their window), see lib/mealResponse.ts. */
  evaluableMeals: number;
  /** Mean delta across meals that HAVE a baseline. null with no such meal. */
  avgDelta: number | null;
  /** How many meals fed avgDelta. */
  deltaSampleSize: number;
  /** Smallest delta = flattest response. */
  best: MealResponseSummaryEntry | null;
  /** Largest delta = biggest rise. */
  worst: MealResponseSummaryEntry | null;
}

/**
 * Aggregates lib/mealResponse.ts's per-meal `computeMealResponse`: this
 * never recomputes a curve itself, only summarizes across meals, so a
 * baseline/peak/delta rule change in that module can't silently drift out of
 * step with what this reports. `computeMealResponse` also classifies each
 * point's low/in/high band against a personal target profile; this summary
 * never surfaces that split, so an empty profile (`{}`) is passed through:
 * classifyGlucose's own built-in defaults keep that harmless, and the result
 * is discarded either way.
 */
export function mealResponseSummary(
  meals: MealLog[],
  readings: SugarLog[]
): MealResponseSummary {
  const entries: MealResponseSummaryEntry[] = [];
  let evaluable = 0;
  // A sensor stream makes `readings` tens of thousands of rows; handing every
  // meal all of them is meals x readings. Sorted once, each meal gets only the
  // readings its response is computed from (its window, the baseline lookback
  // and its own linked reading), which is exactly what computeMealResponse reads.
  const timed: { t: number; r: SugarLog }[] = [];
  const byId = new Map<string, SugarLog>();
  for (const r of readings) {
    const t = timeOf(r);
    if (Number.isFinite(t)) timed.push({ t, r });
    if (r.id) byId.set(r.id, r);
  }
  timed.sort((a, b) => a.t - b.t);
  const firstAtOrAfter = (t: number): number => {
    let lo = 0;
    let hi = timed.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (timed[mid].t < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  for (const meal of meals) {
    const start = Date.parse(meal.logged_at);
    if (!Number.isFinite(start)) continue;
    const from = firstAtOrAfter(start - BASELINE_LOOKBACK_MINUTES * 60_000);
    const to = firstAtOrAfter(start + MEAL_RESPONSE_HOURS * 3_600_000 + 1);
    const subset = timed.slice(from, to).map((x) => x.r);
    const linked = meal.sugar_log_id ? byId.get(meal.sugar_log_id) : undefined;
    if (linked && !subset.includes(linked)) subset.push(linked);
    const res = computeMealResponse(meal, subset, {});
    if (res == null) continue;
    evaluable++;
    entries.push({
      mealId: meal.id,
      logged_at: meal.logged_at,
      baseline: res.baseline,
      peak: res.peak,
      delta: res.delta,
      timeToPeakMin: res.timeToPeakMin,
    });
  }

  const withDelta = entries.filter((e) => e.delta != null);
  const avgDelta = withDelta.length
    ? withDelta.reduce((a, e) => a + (e.delta as number), 0) / withDelta.length
    : null;

  let best: MealResponseSummaryEntry | null = null;
  let worst: MealResponseSummaryEntry | null = null;
  for (const e of withDelta) {
    if (!best || (e.delta as number) < (best.delta as number)) best = e;
    if (!worst || (e.delta as number) > (worst.delta as number)) worst = e;
  }

  return {
    totalMeals: meals.length,
    evaluableMeals: evaluable,
    avgDelta,
    deltaSampleSize: withDelta.length,
    best,
    worst,
  };
}

// ── f) CV trend ──────────────────────────────────────────────────────────

/** Below this many non-null weeks, a direction would be reading noise as a
 *  trend (one point has none, two is barely one). */
export const CV_TREND_MIN_WEEKS = 3;

/** |slope| under this (CV percentage-points per week) reads as "flat" -
 *  smaller than a single week's rounding jitter would look like a trend. */
export const CV_TREND_FLAT_EPS = 0.5;

export interface CvWeekPoint {
  /** Local midnight of that week's start, ms. */
  weekStart: number;
  /** null when the week has fewer than 2 readings (stdev needs 2). */
  cv: number | null;
  n: number;
}

export interface CvTrend {
  weekAnchor: WeekAnchor;
  /** Oldest first, length === the requested `weeks` (one point per week even
   *  when a week has no data: cv null, n 0, so gaps stay visible). */
  weeks: CvWeekPoint[];
  /** null until at least CV_TREND_MIN_WEEKS weeks have a CV value. */
  direction: TrendDirection | null;
  /** Least-squares %CV change per week, over the non-null weeks only. */
  slopePerWeek: number | null;
}

/**
 * Weekly CV series for the last `weeks` calendar weeks (default 10, "8-12"
 * range from the plan) ending in the week containing `now`, calendar-aligned
 * per `weekAnchor` (same rule as weeklyComparison).
 *
 * The slope is fit over the INDEX of weeks that have data, not their
 * chronological week number: a gap week (nothing logged) is skipped rather
 * than treated as a real zero-width data point, so one quiet week doesn't
 * bend the fit around it.
 */
export function cvTrend(
  readings: SugarLog[],
  now: number,
  weekAnchor: WeekAnchor = "monday",
  weeks = 10
): CvTrend {
  const weekCount = Math.max(0, Math.floor(weeks));
  const currentWeekStart = weekStartMs(now, weekAnchor);

  const points: CvWeekPoint[] = [];
  for (let i = weekCount - 1; i >= 0; i--) {
    const start = addDaysLocal(currentWeekStart, -7 * i);
    const end = addDaysLocal(start, 7); // exclusive
    const vals = selectGlucoseBasis(readings, {
      start,
      end: Math.min(end - 1, now),
      until: end - 1,
    }).readings.map((r) => r.glucose_level_mgdl);
    points.push({ weekStart: start, cv: cvOf(vals), n: vals.length });
  }

  const withCv = points.filter((p): p is CvWeekPoint & { cv: number } => p.cv != null);
  let direction: TrendDirection | null = null;
  let slopePerWeek: number | null = null;
  if (withCv.length >= CV_TREND_MIN_WEEKS) {
    const xs = withCv.map((_, i) => i);
    const ys = withCv.map((p) => p.cv);
    const n = xs.length;
    const sumX = xs.reduce((a, b) => a + b, 0);
    const sumY = ys.reduce((a, b) => a + b, 0);
    const sumXY = xs.reduce((a, x, i) => a + x * ys[i], 0);
    const sumXX = xs.reduce((a, x) => a + x * x, 0);
    const denom = n * sumXX - sumX * sumX;
    slopePerWeek = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
    direction =
      Math.abs(slopePerWeek) < CV_TREND_FLAT_EPS ? "flat" : slopePerWeek > 0 ? "up" : "down";
  }

  return { weekAnchor, weeks: points, direction, slopePerWeek };
}
