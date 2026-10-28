import type {
  Injection,
  InjectionSite,
  LogTag,
  MealLog,
  SugarLog,
} from "./db/types";
import { INJECTION_SITES, LOG_TAGS } from "./db/types";
import { percentile } from "./agp";
import { VERY_HIGH_MGDL, inTargetBand } from "./glucose";
import { isUserEntered } from "./glucoseSource";
import {
  cgmGmiEligible,
  gmiFromMean,
  isCgmPoint,
  selectGlucoseBasis,
  timeOf,
  windowFitsGmi,
  type CgmSourceKind,
  type MetricsWindow,
} from "./cgm/metrics";

/**
 * Pro "Insights": a read-only, descriptive summary of the user's own logged
 * data over a recent window. Not medical advice and no interpretation: every
 * figure is computed from what the user entered. GMI is the standard Glucose
 * Management Indicator estimate (Bergenstal 2018).
 */

export type DayKind = "night" | "morning" | "afternoon" | "evening";

export interface SiteCount {
  site: InjectionSite;
  count: number;
}

export interface Insights {
  readings: number;
  meals: number;
  days: number;
  avgGlucose: number | null;
  /** The four shares are mutually exclusive and sum to 100. */
  inRangePct: number | null; // inside the profile's target band and under 250 mg/dL
  lowPct: number | null; // below the band's low end
  highPct: number | null; // above the band, under the fixed 250 ceiling
  veryHighPct: number | null; // at/above 250 mg/dL
  gmi: number | null; // GMI (%)
  /** What the glucose figures above are computed from: the sensor readings when
   *  they cover half the window or more, otherwise every reading. */
  basis: "cgm" | "manual";
  /** Share (0..100) of the window's five-minute slots holding a sensor reading,
   *  null when the window holds no sensor reading at all. */
  cgmCoverage: number | null;
  cgmReadings: number;
  /** Readings in the window that are not sensor readings. */
  manualReadings: number;
  cgmSources: CgmSourceKind[];
  avgFasting: number | null;
  avgPostMeal: number | null;
  avgDailyCarbs: number | null;

  // ── Added descriptive metrics ──
  /** Sample standard deviation of readings (in mg/dL). */
  glucoseSD: number | null;
  /** Coefficient of variation = SD / mean × 100 (%). */
  glucoseCV: number | null;
  /** Count of readings under 70 mg/dL (companion to lowPct). */
  hypoCount: number;
  /** Mean glucose per time-of-day slice (mg/dL), null if no readings there. */
  hourly: Record<DayKind, number | null>;

  // ── Injection metrics ──
  injectionCount: number;
  /** Total dosed units ÷ distinct days with a dosed injection. */
  avgDailyDose: number | null;
  basalUnits: number;
  bolusUnits: number;
  /** Basal share of (basal + bolus) units, %. Null if no dosed basal/bolus. */
  basalPct: number | null;
  mostUsedSite: InjectionSite | null;
  mostUsedSiteCount: number;
  /** Every injection site with its use count in the window (descriptive). The
   *  set grew from eight to twelve in schema v9 (abdomen quadrants). */
  siteDistribution: SiteCount[];
}

export const TIR_LOW = 70;
export const TIR_HIGH = 180;

/** The band time-in-range is measured against. */
export interface TirBand {
  low: number;
  high: number;
}

/** Used when no profile is available (population default). */
export const DEFAULT_TIR_BAND: TirBand = { low: TIR_LOW, high: TIR_HIGH };

/**
 * GMI is an indicator calculated from mean glucose, and it is only meaningful
 * over a real stretch of time. Five readings taken in one afternoon are too
 * thin a sample, so the figure is withheld until the sample both has enough
 * readings AND spans enough days; the UI then shows a "more data needed" note
 * instead.
 */
export const GMI_MIN_READINGS = 14;
export const GMI_MIN_SPAN_DAYS = 14;
/** Default (Pro) window; free tier is limited to the 7-day basic summary. */
export const INSIGHTS_WINDOW_DAYS = 30;
/** Selectable windows for the Insights screen: 7 (free) / 30 / 90 (Pro). */
export const INSIGHTS_WINDOWS = [7, 30, 90] as const;
/** The only window a free user sees fully. */
export const FREE_INSIGHTS_WINDOW = 7;

/**
 * An explicit date range (epoch ms), for the custom "from-to" window. The whole
 * insights/report/export stack can take EITHER a windowDays shortcut OR a range;
 * this is the one place the two meet. `rangeFromWindow` is the single conversion
 * from the [7,30,90] shortcuts, so a shortcut and a hand-picked range flow
 * through identical code.
 */
export interface DateRange {
  start: number;
  end: number;
}

export function rangeFromWindow(windowDays: number, now = Date.now()): DateRange {
  return { start: now - windowDays * 86_400_000, end: now };
}

/** Whole days a range spans (inclusive), for the shortcut-shaped helpers. */
export function rangeWindowDays(range: DateRange): number {
  return Math.max(1, Math.ceil((range.end - range.start) / 86_400_000));
}

/**
 * Whether a reading set is a defensible basis for GMI: enough readings, spread
 * over enough calendar time. Both conditions matter - many readings crammed into
 * two days describe two days, not a quarter.
 */
export function hasGmiBasis(readings: { logged_at: string; t?: number }[]): boolean {
  if (readings.length < GMI_MIN_READINGS) return false;
  let n = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const x of readings) {
    const t = timeOf(x);
    if (Number.isNaN(t)) continue;
    n++;
    if (t < min) min = t;
    if (t > max) max = t;
  }
  return n >= GMI_MIN_READINGS && max - min >= GMI_MIN_SPAN_DAYS * 86_400_000;
}

/**
 * Which hint explains a withheld GMI. A window shorter than the 14 days either
 * rule needs can never carry one, whatever the data, so that comes first: the
 * user's way out is a longer window, not more readings. Past that, any sensor
 * reading in the window means the sensor rule (70 % coverage of the window) is
 * the one that decides, even when the basis fell back to the fingersticks:
 * "needs 14 readings" would be false for someone who already has 120.
 */
export function gmiWithheldReason(
  i: Pick<Insights, "basis" | "cgmReadings">,
  windowDays: number
): "window" | "coverage" | "readings" {
  if (!windowFitsGmi(windowDays)) return "window";
  return i.basis === "cgm" || i.cgmReadings > 0 ? "coverage" : "readings";
}

function mean(ns: number[]): number | null {
  return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : null;
}

/** Sample standard deviation (needs at least 2 points). */
function stdev(ns: number[]): number | null {
  if (ns.length < 2) return null;
  const m = ns.reduce((a, b) => a + b, 0) / ns.length;
  const variance =
    ns.reduce((a, b) => a + (b - m) * (b - m), 0) / (ns.length - 1);
  return Math.sqrt(variance);
}

/** Maps an hour (0-23) to a time-of-day slice. Boundaries: night 0-6,
 *  morning 6-12, afternoon 12-18, evening 18-24. */
function hourSlice(hour: number): DayKind {
  if (hour < 6) return "night";
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

export function computeInsights(
  sugar: SugarLog[],
  meals: MealLog[],
  injections: Injection[],
  windowDays = INSIGHTS_WINDOW_DAYS,
  band: TirBand = DEFAULT_TIR_BAND,
  /** Optional explicit range. When given, the window is [start, end] (two-sided,
   *  so a range ending in the past is honoured); otherwise it is the last
   *  `windowDays` up to now - byte-identical to the pre-R7.2 behaviour. */
  range?: DateRange
): Insights {
  const now = Date.now();
  const win: MetricsWindow = range
    ? { start: range.start, end: range.end }
    : { start: now - windowDays * 86_400_000, end: now, until: Infinity };
  const within = range
    ? (iso: string) => {
        const t = new Date(iso).getTime();
        return !Number.isNaN(t) && t >= range.start && t <= range.end;
      }
    : (iso: string) => {
        const t = new Date(iso).getTime();
        return !Number.isNaN(t) && t >= now - windowDays * 86_400_000;
      };

  const basis = selectGlucoseBasis(sugar, win);
  const s = basis.all;
  const m = meals.filter((x) => within(x.logged_at));
  const inj = injections.filter((x) => within(x.logged_at));

  const basisRows = basis.readings;
  const levels = basisRows.map((x) => x.glucose_level_mgdl);
  const readings = levels.length;

  const inRange = levels.filter((v) => inTargetBand(v, band)).length;
  const low = levels.filter((v) => v < band.low).length;
  const veryHigh = levels.filter((v) => v >= VERY_HIGH_MGDL).length;
  const high = levels.filter((v) => v > band.high && v < VERY_HIGH_MGDL).length;

  const avgGlucose = mean(levels);
  const sd = stdev(levels);

  // Period averages use ONLY readings the user tagged themselves. Health-store
  // imports carry a guessed period (there is no period on a HealthKit sample),
  // so folding them in would quietly poison the fasting/post-meal figures with
  // an assumption rather than an observation.
  const userTagged = s.filter((x) => isUserEntered(x.source));
  const avgFasting = mean(
    userTagged
      .filter(
        (x) =>
          x.period_tag === "fasting" ||
          x.period_tag === "pre_meal" ||
          x.period_tag === "bedtime"
      )
      .map((x) => x.glucose_level_mgdl)
  );
  const avgPostMeal = mean(
    userTagged
      .filter((x) => x.period_tag === "post_meal_2h")
      .map((x) => x.glucose_level_mgdl)
  );

  // Mean glucose per time-of-day slice.
  const slices: Record<DayKind, number[]> = {
    night: [],
    morning: [],
    afternoon: [],
    evening: [],
  };
  for (const x of basisRows) {
    const h = new Date(timeOf(x)).getHours();
    if (!Number.isNaN(h)) slices[hourSlice(h)].push(x.glucose_level_mgdl);
  }
  const hourly: Record<DayKind, number | null> = {
    night: mean(slices.night),
    morning: mean(slices.morning),
    afternoon: mean(slices.afternoon),
    evening: mean(slices.evening),
  };

  // Distinct calendar days with any log. LOCAL days: logged_at is stored as UTC,
  // so slicing its date part counted "yesterday" for every late-evening entry
  // east of Greenwich (and every early-morning one west of it), which then also
  // skewed avgDailyCarbs and avgDailyDose. Every other day-bucketing surface in
  // the app (dailyAverages, the journal sections, the report timeline) is local.
  // A sensor stream puts a reading on every day, so the carbs-per-day average
  // counts the days that hold a hand-entered reading or a meal, as before.
  const dayKeys = new Set<string>();
  const handDayKeys = new Set<string>();
  const dayOfMs = (ms: number) => (Number.isNaN(ms) ? "" : dayKey(new Date(ms)));
  for (const x of s) {
    const key = dayOfMs(timeOf(x));
    dayKeys.add(key);
    if (!isCgmPoint(x)) handDayKeys.add(key);
  }
  for (const x of m) {
    const key = localDayKey(x.logged_at);
    dayKeys.add(key);
    handDayKeys.add(key);
  }
  // A rolling 7 x 24 h window starts mid-day, so it touches 8 calendar days; the
  // count never exceeds the window's own length.
  const spanDays = Math.max(1, Math.ceil((win.end - win.start) / 86_400_000));
  const days = Math.min(dayKeys.size, spanDays);
  const carbDays = handDayKeys.size;

  const totalCarbs = m.reduce((a, x) => a + (x.calculated_carbs_g || 0), 0);

  // ── Injection metrics ──
  const dosed = inj.filter((x) => x.dose_units != null && x.dose_units > 0);
  const totalDose = dosed.reduce((a, x) => a + (x.dose_units || 0), 0);
  const doseDays = new Set(dosed.map((x) => localDayKey(x.logged_at))).size;

  const basalUnits = dosed
    .filter((x) => x.insulin_type === "basal")
    .reduce((a, x) => a + (x.dose_units || 0), 0);
  const bolusUnits = dosed
    .filter((x) => x.insulin_type === "bolus")
    .reduce((a, x) => a + (x.dose_units || 0), 0);
  const bbTotal = basalUnits + bolusUnits;

  // Region distribution counts only injections that HAVE a region: a dose logged
  // without one (the calculator's mealtime bolus) describes no place, so it can
  // neither fill a bar nor become the "most used" region.
  const siteCounts = new Map<InjectionSite, number>();
  for (const x of inj) {
    if (x.site == null) continue;
    siteCounts.set(x.site, (siteCounts.get(x.site) ?? 0) + 1);
  }
  const siteDistribution: SiteCount[] = INJECTION_SITES.map((site) => ({
    site,
    count: siteCounts.get(site) ?? 0,
  }));
  let mostUsedSite: InjectionSite | null = null;
  let mostUsedSiteCount = 0;
  for (const sc of siteDistribution) {
    if (sc.count > mostUsedSiteCount) {
      mostUsedSiteCount = sc.count;
      mostUsedSite = sc.site;
    }
  }

  return {
    readings,
    meals: m.length,
    days,
    avgGlucose,
    inRangePct: readings ? (inRange / readings) * 100 : null,
    lowPct: readings ? (low / readings) * 100 : null,
    highPct: readings ? (high / readings) * 100 : null,
    veryHighPct: readings ? (veryHigh / readings) * 100 : null,
    gmi:
      avgGlucose == null
        ? null
        : basis.cgmCount > 0
          ? cgmGmiEligible(basis, win)
            ? gmiFromMean(avgGlucose)
            : null
          : hasGmiBasis(basisRows)
            ? gmiFromMean(avgGlucose)
            : null,
    basis: basis.kind === "cgm" ? "cgm" : "manual",
    cgmCoverage: basis.cgmCount > 0 ? basis.coverage * 100 : null,
    cgmReadings: basis.cgmCount,
    manualReadings: basis.otherCount,
    cgmSources: basis.sources,
    avgFasting,
    avgPostMeal,
    avgDailyCarbs: carbDays > 0 && m.length ? totalCarbs / carbDays : null,

    glucoseSD: sd,
    glucoseCV: sd != null && avgGlucose ? (sd / avgGlucose) * 100 : null,
    hypoCount: low,
    hourly,

    injectionCount: inj.length,
    avgDailyDose: doseDays > 0 ? totalDose / doseDays : null,
    basalUnits,
    bolusUnits,
    basalPct: bbTotal > 0 ? (basalUnits / bbTotal) * 100 : null,
    mostUsedSite,
    mostUsedSiteCount,
    siteDistribution,
  };
}

/**
 * Compares the current window's mean glucose and TIR to the previous window of
 * equal length, so the UI can show a descriptive trend arrow. Null deltas when
 * either window lacks readings.
 */
export function trendVsPrevious(
  sugar: SugarLog[],
  windowDays: number,
  band: TirBand = DEFAULT_TIR_BAND,
  range?: DateRange
): { avgDelta: number | null; tirDelta: number | null } {
  // Each window picks its own basis: a window the sensor barely covers is
  // measured on all its readings, one it covers well on the sensor alone.
  const bucket = (lo: number, hi: number) =>
    selectGlucoseBasis(sugar, { start: lo, end: hi - 1 }).readings.map(
      (x) => x.glucose_level_mgdl
    );
  let cur: number[];
  let prev: number[];
  if (range) {
    // The previous window is the equal-length span immediately before it.
    const span = range.end - range.start;
    cur = bucket(range.start, range.end + 1);
    prev = bucket(range.start - span, range.start);
  } else {
    const now = Date.now();
    const span = windowDays * 86_400_000;
    cur = bucket(now - span, now + 1);
    prev = bucket(now - 2 * span, now - span);
  }
  const avgOf = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
  const tirOf = (a: number[]) =>
    a.length
      ? (a.filter((v) => inTargetBand(v, band)).length / a.length) * 100
      : null;
  const curAvg = avgOf(cur);
  const prevAvg = avgOf(prev);
  const curTir = tirOf(cur);
  const prevTir = tirOf(prev);
  return {
    avgDelta: curAvg != null && prevAvg != null ? curAvg - prevAvg : null,
    tirDelta: curTir != null && prevTir != null ? curTir - prevTir : null,
  };
}

export interface DailyAverage {
  /** Local calendar day, YYYY-MM-DD. */
  day: string;
  /** Whole days since the first day of the window, so gaps stay visible. */
  offset: number;
  avg: number;
  n: number;
}

/** Local midnight of the day an instant falls in. */
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Local calendar day key. Never derived from toISOString(), which is UTC and
 *  would name the previous day for a local midnight east of Greenwich. */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** The local day a stored timestamp falls in. Empty string for an unparsable
 *  value, so it collapses into one bucket instead of inventing days. */
function localDayKey(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : dayKey(d);
}

/**
 * Mean glucose per calendar day across the window, oldest first. Days with no
 * reading are omitted rather than plotted as zero, and `offset` keeps the
 * remaining points on a real time axis so gaps stay visible.
 *
 * Buckets are calendar days, not fixed 24-hour blocks, so a clock change inside
 * the window never shifts a reading into the neighbouring day.
 */
export function dailyAverages(
  sugar: SugarLog[],
  windowDays: number,
  range?: DateRange
): DailyAverage[] {
  // For a custom range the axis starts on the range's first day and spans its
  // own length; otherwise it is the last `windowDays` ending today (unchanged).
  const daysCount = range ? rangeWindowDays(range) : windowDays;
  const firstDate = range ? startOfDay(new Date(range.start)) : startOfDay(new Date());
  if (!range) firstDate.setDate(firstDate.getDate() - (windowDays - 1));
  const first = firstDate.getTime();

  const readings = selectGlucoseBasis(sugar, {
    start: first,
    end: first + daysCount * 86_400_000,
    until: Infinity,
  }).readings;
  const buckets = new Map<number, number[]>();
  for (const x of readings) {
    const d = new Date(timeOf(x));
    if (Number.isNaN(d.getTime())) continue;
    // Round, because a day spanning a clock change is 23 or 25 hours long.
    const offset = Math.round((startOfDay(d).getTime() - first) / 86_400_000);
    if (offset < 0 || offset > daysCount - 1) continue;
    const bucket = buckets.get(offset);
    if (bucket) bucket.push(x.glucose_level_mgdl);
    else buckets.set(offset, [x.glucose_level_mgdl]);
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([offset, values]) => {
      const d = new Date(firstDate);
      d.setDate(d.getDate() + offset);
      return {
        day: dayKey(d),
        offset,
        avg: values.reduce((a, b) => a + b, 0) / values.length,
        n: values.length,
      };
    });
}

export interface WindowPercentiles {
  p05: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
  n: number;
}

/** Overall glucose percentiles across the window (the AGP band numeric summary). */
export function windowPercentiles(
  sugar: SugarLog[],
  windowDays: number,
  range?: DateRange
): WindowPercentiles | null {
  const now = Date.now();
  const win: MetricsWindow = range
    ? { start: range.start, end: range.end }
    : { start: now - windowDays * 86_400_000, end: now, until: Infinity };
  const vals = selectGlucoseBasis(sugar, win)
    .readings.map((x) => x.glucose_level_mgdl)
    .sort((a, b) => a - b);
  if (vals.length < 5) return null;
  return {
    p05: Math.round(percentile(vals, 5)),
    p25: Math.round(percentile(vals, 25)),
    p50: Math.round(percentile(vals, 50)),
    p75: Math.round(percentile(vals, 75)),
    p95: Math.round(percentile(vals, 95)),
    n: vals.length,
  };
}

/**
 * Rule-based weekly digest: 2-3 neutral, descriptive sentences comparing this
 * week to last (never causal, never advice). The UI renders each from its key.
 * Empty when there isn't enough data for any sentence to be meaningful.
 */
export type WeeklySentence =
  | { kind: "tir"; tir: number; delta: number }
  | { kind: "avg"; avgDelta: number } // mg/dL vs last week
  | { kind: "morning_evening"; diff: number; higher: "morning" | "evening" };

export function weeklyDigest(
  sugar: SugarLog[],
  band: TirBand = DEFAULT_TIR_BAND
): WeeklySentence[] {
  const week = computeInsights(sugar, [], [], 7, band);
  const trend = trendVsPrevious(sugar, 7, band);
  const out: WeeklySentence[] = [];
  if (
    week.inRangePct != null &&
    trend.tirDelta != null &&
    Math.abs(trend.tirDelta) >= 1
  ) {
    out.push({
      kind: "tir",
      tir: Math.round(week.inRangePct),
      delta: Math.round(trend.tirDelta),
    });
  }
  const mo = week.hourly.morning;
  const ev = week.hourly.evening;
  if (mo != null && ev != null && Math.abs(mo - ev) >= 10) {
    out.push({
      kind: "morning_evening",
      diff: Math.round(Math.abs(mo - ev)),
      higher: mo > ev ? "morning" : "evening",
    });
  }
  if (trend.avgDelta != null && Math.abs(trend.avgDelta) >= 5) {
    out.push({ kind: "avg", avgDelta: Math.round(trend.avgDelta) });
  }
  return out.slice(0, 3);
}

/**
 * Consecutive local days ending today or yesterday that have at least one log.
 * `cgmDates` are timestamps of sensor readings: a day the sensor fed the journal
 * counts like a day with a hand-entered log (nobody is asked to log on top of a
 * sensor). Framed as encouragement ("X days in a row"), not a streak to protect: it
 * survives a single missed day boundary and never blames a gap.
 */
export function consecutiveLogDays(logDates: string[], cgmDates: string[] = []): number {
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  const key = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const days = new Set(
    (cgmDates.length > 0 ? [...logDates, ...cgmDates] : logDates)
      .map((iso) => {
        const d = new Date(iso);
        return Number.isNaN(d.getTime()) ? "" : key(d);
      })
      .filter(Boolean)
  );
  if (days.size === 0) return 0;
  const cursor = new Date(Date.now());
  cursor.setHours(0, 0, 0, 0);
  if (!days.has(key(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!days.has(key(cursor))) return 0;
  }
  let count = 0;
  while (days.has(key(cursor))) {
    count++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}

/* ── Actionable patterns ──────────────────────────────────────────────────
 * Purely DESCRIPTIVE observations about the user's own readings, never causal
 * claims, never advice. Each requires a minimum sample so a single outlier
 * can't manufacture a "pattern". The UI renders each from its typed key. */

/** A reading bucket needs at least this many points to be reported. */
export const PATTERN_MIN_READINGS = 4;
/** A bucket's mean must beat the overall mean by this (mg/dL) to be flagged. */
export const PATTERN_DIFF_MGDL = 15;
/** Glucose CV at/above this (%) is the standard "high variability" marker. */
export const PATTERN_CV_HIGH = 36;

export type InsightPattern =
  | { kind: "tag_higher"; tag: LogTag; avg: number; baseline: number; n: number }
  | { kind: "dawn"; morningAvg: number; baseline: number; n: number }
  | { kind: "high_variability"; cv: number };

/**
 * Derives descriptive patterns from a profile's recent readings:
 *  - tag_higher:      readings carrying a context tag (sport/stress/…) average
 *                     notably higher than the overall mean
 *  - dawn:            morning readings (06:00-12:00) average notably higher
 *  - high_variability: coefficient of variation ≥ 36 %
 * Returns at most a few, strongest-first. Empty when there isn't enough data.
 */
export function derivePatterns(
  sugar: SugarLog[],
  windowDays = INSIGHTS_WINDOW_DAYS,
  range?: DateRange
): InsightPattern[] {
  const now = Date.now();
  const win: MetricsWindow = range
    ? { start: range.start, end: range.end }
    : { start: now - windowDays * 86_400_000, end: now, until: Infinity };
  const readings = selectGlucoseBasis(sugar, win).readings;
  const levels = readings.map((x) => x.glucose_level_mgdl);
  const baseline = mean(levels);
  if (baseline == null || levels.length < PATTERN_MIN_READINGS) return [];

  const out: InsightPattern[] = [];

  // Tag correlations: only tags with enough tagged readings and a clear lift.
  const tagFindings: { tag: LogTag; avg: number; n: number }[] = [];
  for (const tag of LOG_TAGS) {
    if (tag === "other") continue; // catch-all tag → not a meaningful correlation
    const vals = readings
      .filter((x) => x.tags.includes(tag))
      .map((x) => x.glucose_level_mgdl);
    const avg = mean(vals);
    if (avg != null && vals.length >= PATTERN_MIN_READINGS && avg - baseline >= PATTERN_DIFF_MGDL) {
      tagFindings.push({ tag, avg: Math.round(avg), n: vals.length });
    }
  }
  tagFindings
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 2)
    .forEach((f) =>
      out.push({ kind: "tag_higher", tag: f.tag, avg: f.avg, baseline: Math.round(baseline), n: f.n })
    );

  // Dawn phenomenon: morning slice (06:00-12:00) clearly above the mean.
  const morning = readings
    .filter((x) => {
      const h = new Date(timeOf(x)).getHours();
      return h >= 6 && h < 12;
    })
    .map((x) => x.glucose_level_mgdl);
  const morningAvg = mean(morning);
  if (morningAvg != null && morning.length >= PATTERN_MIN_READINGS && morningAvg - baseline >= PATTERN_DIFF_MGDL) {
    out.push({ kind: "dawn", morningAvg: Math.round(morningAvg), baseline: Math.round(baseline), n: morning.length });
  }

  // High variability (CV ≥ 36 %).
  const sd = stdev(levels);
  if (sd != null && baseline > 0) {
    const cv = (sd / baseline) * 100;
    if (cv >= PATTERN_CV_HIGH) out.push({ kind: "high_variability", cv: Math.round(cv) });
  }

  return out;
}
