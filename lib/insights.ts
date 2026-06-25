import type {
  Injection,
  InjectionSite,
  LogTag,
  MealLog,
  SugarLog,
} from "./db/types";
import { INJECTION_SITES, LOG_TAGS } from "./db/types";

/**
 * Pro "Insights" — a read-only, descriptive summary of the user's own logged
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
  inRangePct: number | null; // 70–180 mg/dL
  lowPct: number | null; // < 70
  highPct: number | null; // > 180
  gmi: number | null; // estimated A1C (%)
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
  /** All eight sites with their use count in the window (descriptive). */
  siteDistribution: SiteCount[];
}

export const TIR_LOW = 70;
export const TIR_HIGH = 180;
export const INSIGHTS_WINDOW_DAYS = 14;
/** Selectable windows for the Insights screen. */
export const INSIGHTS_WINDOWS = [7, 14, 30] as const;

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

/** Maps an hour (0–23) to a time-of-day slice. Boundaries: night 0–6,
 *  morning 6–12, afternoon 12–18, evening 18–24. */
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
  windowDays = INSIGHTS_WINDOW_DAYS
): Insights {
  const since = Date.now() - windowDays * 86_400_000;
  const within = (iso: string) => {
    const t = new Date(iso).getTime();
    return !Number.isNaN(t) && t >= since;
  };

  const s = sugar.filter((x) => within(x.logged_at));
  const m = meals.filter((x) => within(x.logged_at));
  const inj = injections.filter((x) => within(x.logged_at));

  const levels = s.map((x) => x.glucose_level_mgdl);
  const readings = levels.length;

  const inRange = levels.filter((v) => v >= TIR_LOW && v <= TIR_HIGH).length;
  const low = levels.filter((v) => v < TIR_LOW).length;
  const high = levels.filter((v) => v > TIR_HIGH).length;

  const avgGlucose = mean(levels);
  const sd = stdev(levels);

  const avgFasting = mean(
    s
      .filter(
        (x) =>
          x.period_tag === "fasting" ||
          x.period_tag === "pre_meal" ||
          x.period_tag === "bedtime"
      )
      .map((x) => x.glucose_level_mgdl)
  );
  const avgPostMeal = mean(
    s.filter((x) => x.period_tag === "post_meal_2h").map((x) => x.glucose_level_mgdl)
  );

  // Mean glucose per time-of-day slice.
  const slices: Record<DayKind, number[]> = {
    night: [],
    morning: [],
    afternoon: [],
    evening: [],
  };
  for (const x of s) {
    const h = new Date(x.logged_at).getHours();
    if (!Number.isNaN(h)) slices[hourSlice(h)].push(x.glucose_level_mgdl);
  }
  const hourly: Record<DayKind, number | null> = {
    night: mean(slices.night),
    morning: mean(slices.morning),
    afternoon: mean(slices.afternoon),
    evening: mean(slices.evening),
  };

  // Distinct calendar days with any log.
  const dayKeys = new Set<string>();
  [...s, ...m].forEach((x) => dayKeys.add(x.logged_at.slice(0, 10)));
  const days = dayKeys.size;

  const totalCarbs = m.reduce((a, x) => a + (x.calculated_carbs_g || 0), 0);

  // ── Injection metrics ──
  const dosed = inj.filter((x) => x.dose_units != null && x.dose_units > 0);
  const totalDose = dosed.reduce((a, x) => a + (x.dose_units || 0), 0);
  const doseDays = new Set(dosed.map((x) => x.logged_at.slice(0, 10))).size;

  const basalUnits = dosed
    .filter((x) => x.insulin_type === "basal")
    .reduce((a, x) => a + (x.dose_units || 0), 0);
  const bolusUnits = dosed
    .filter((x) => x.insulin_type === "bolus")
    .reduce((a, x) => a + (x.dose_units || 0), 0);
  const bbTotal = basalUnits + bolusUnits;

  const siteCounts = new Map<InjectionSite, number>();
  for (const x of inj) siteCounts.set(x.site, (siteCounts.get(x.site) ?? 0) + 1);
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
    // GMI needs a meaningful sample; require at least 5 readings.
    gmi: avgGlucose != null && readings >= 5 ? 3.31 + 0.02392 * avgGlucose : null,
    avgFasting,
    avgPostMeal,
    avgDailyCarbs: days > 0 && m.length ? totalCarbs / days : null,

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

/* ── Actionable patterns ──────────────────────────────────────────────────
 * Purely DESCRIPTIVE observations about the user's own readings — never causal
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
 *  - dawn:            morning readings (06:00–12:00) average notably higher
 *  - high_variability: coefficient of variation ≥ 36 %
 * Returns at most a few, strongest-first. Empty when there isn't enough data.
 */
export function derivePatterns(
  sugar: SugarLog[],
  windowDays = INSIGHTS_WINDOW_DAYS
): InsightPattern[] {
  const since = Date.now() - windowDays * 86_400_000;
  const within = (iso: string) => {
    const t = new Date(iso).getTime();
    return !Number.isNaN(t) && t >= since;
  };
  const readings = sugar.filter((x) => within(x.logged_at));
  const levels = readings.map((x) => x.glucose_level_mgdl);
  const baseline = mean(levels);
  if (baseline == null || levels.length < PATTERN_MIN_READINGS) return [];

  const out: InsightPattern[] = [];

  // Tag correlations — only tags with enough tagged readings and a clear lift.
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

  // Dawn phenomenon — morning slice (06:00–12:00) clearly above the mean.
  const morning = readings
    .filter((x) => {
      const h = new Date(x.logged_at).getHours();
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
