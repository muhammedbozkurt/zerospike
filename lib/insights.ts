import type { MealLog, SugarLog } from "./db/types";

/**
 * Pro "Insights" — a read-only summary of the user's own logged data over a
 * recent window. Not medical advice: every figure is computed from what the
 * user entered. GMI is the standard Glucose Management Indicator estimate.
 */

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
}

export const TIR_LOW = 70;
export const TIR_HIGH = 180;
export const INSIGHTS_WINDOW_DAYS = 14;

function mean(ns: number[]): number | null {
  return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : null;
}

export function computeInsights(
  sugar: SugarLog[],
  meals: MealLog[],
  windowDays = INSIGHTS_WINDOW_DAYS
): Insights {
  const since = Date.now() - windowDays * 86_400_000;
  const within = (iso: string) => {
    const t = new Date(iso).getTime();
    return !Number.isNaN(t) && t >= since;
  };

  const s = sugar.filter((x) => within(x.logged_at));
  const m = meals.filter((x) => within(x.logged_at));

  const levels = s.map((x) => x.glucose_level_mgdl);
  const readings = levels.length;

  const inRange = levels.filter((v) => v >= TIR_LOW && v <= TIR_HIGH).length;
  const low = levels.filter((v) => v < TIR_LOW).length;
  const high = levels.filter((v) => v > TIR_HIGH).length;

  const avgGlucose = mean(levels);

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

  // Distinct calendar days with any log.
  const dayKeys = new Set<string>();
  [...s, ...m].forEach((x) => dayKeys.add(x.logged_at.slice(0, 10)));
  const days = dayKeys.size;

  const totalCarbs = m.reduce((a, x) => a + (x.calculated_carbs_g || 0), 0);

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
  };
}
