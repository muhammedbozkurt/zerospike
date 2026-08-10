import { classifyGlucose, type TargetProfile } from "./glucose";

/**
 * Meal response: how a single meal's glucose moved over the following window.
 * Pure and storage-agnostic: the caller supplies the meal + every reading it
 * might draw from; this never touches the database.
 *
 * Regulation note (see docs/build-prompt-r10-release-plus.md §0): this reports
 * what was measured. It never judges the meal or the reading, and it never
 * emits a dose.
 */

/** How long after a meal starts its response is tracked. Single source so the
 *  calc layer and the chart axis can never drift apart. */
export const MEAL_RESPONSE_HOURS = 3;

/** How far back before the meal start a reading can still stand in for a
 *  baseline, when the meal has no directly linked glucose log. Exported so a
 *  caller can fetch exactly the readings a response can draw from instead of
 *  handing over the profile's whole history. */
export const BASELINE_LOOKBACK_MINUTES = 45;

/** The "+2h" read-out is the nearest reading to +120 min, accepted anywhere in
 *  this range so a slightly early/late measurement still counts. */
const TWO_HOUR_WINDOW = { min: 90, max: 150 } as const;

/** Fewer readings than this in the window and there is nothing to report. */
export const MIN_READINGS_FOR_RESPONSE = 2;

export interface MealResponseMealInput {
  id: string;
  logged_at: string;
  sugar_log_id: string | null;
}

export interface MealResponseReadingInput {
  id: string;
  logged_at: string;
  glucose_level_mgdl: number;
}

/** One plotted point: minutes since the meal started, and its value. */
export interface MealResponsePoint {
  atMinutes: number;
  glucose_level_mgdl: number;
  logged_at: string;
}

export interface MealResponseBandSplit {
  lowPct: number;
  inRangePct: number;
  highPct: number;
}

export interface MealResponse {
  /** Starting value, or null when nothing could stand in for one (the curve
   *  still renders; only the delta is withheld). */
  baseline: number | null;
  peak: number;
  /** peak - baseline, or null when there is no baseline. */
  delta: number | null;
  timeToPeakMin: number;
  /** Nearest reading to +2h within the window, or null if none falls in range. */
  twoHourValue: number | null;
  curve: MealResponsePoint[];
  /** Distribution of the window's own readings against the user's own range. */
  band: MealResponseBandSplit;
}

/** Index of the first element >= value in an ascending array. */
function lowerBound(sorted: number[], value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Index of the first element > value in an ascending array. */
function upperBound(sorted: number[], value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Which of these meals HAS a computable response, in one pass.
 *
 * Exactly the set of meals `computeMealResponse` would return a non-null value
 * for: that function's only rejection is "fewer than MIN_READINGS_FOR_RESPONSE
 * readings in the window", and nothing else can make it bail. The journal screens
 * only need that yes/no answer for a chevron, and asking it through the full
 * builder re-scanned and re-PARSED every reading's timestamp once per meal:
 * meals x readings Date constructions to decide which rows get an icon.
 *
 * Here each reading's timestamp is parsed ONCE and the window is found by binary
 * search, so the cost is a sort plus a lookup per meal.
 */
export function mealIdsWithResponse(
  meals: { id: string; logged_at: string }[],
  readings: { logged_at: string }[]
): Set<string> {
  const ids = new Set<string>();
  if (meals.length === 0 || readings.length === 0) return ids;
  const times: number[] = [];
  for (const r of readings) {
    const t = new Date(r.logged_at).getTime();
    // An unparseable timestamp fails every window comparison in
    // computeMealResponse too, so it belongs to no window here either.
    if (Number.isFinite(t)) times.push(t);
  }
  times.sort((a, b) => a - b);
  for (const meal of meals) {
    const start = new Date(meal.logged_at).getTime();
    if (!Number.isFinite(start)) continue;
    const end = start + MEAL_RESPONSE_HOURS * 3_600_000;
    const from = lowerBound(times, start);
    const to = upperBound(times, end);
    if (to - from >= MIN_READINGS_FOR_RESPONSE) ids.add(meal.id);
  }
  return ids;
}

/**
 * Builds a meal's response from every reading that MIGHT belong to it. Returns
 * null when the window (meal start .. +MEAL_RESPONSE_HOURS) has fewer than two
 * readings, too sparse for a curve to mean anything; the UI shows an honest
 * empty state instead of a two-point guess.
 */
export function computeMealResponse(
  meal: MealResponseMealInput,
  readings: MealResponseReadingInput[],
  profile: Partial<TargetProfile>
): MealResponse | null {
  const start = new Date(meal.logged_at).getTime();
  const end = start + MEAL_RESPONSE_HOURS * 3_600_000;

  const inWindow = readings
    .filter((r) => {
      const t = new Date(r.logged_at).getTime();
      return t >= start && t <= end;
    })
    .sort((a, b) => new Date(a.logged_at).getTime() - new Date(b.logged_at).getTime());

  if (inWindow.length < MIN_READINGS_FOR_RESPONSE) return null;

  // Baseline: the meal's own linked reading wins outright. Otherwise the
  // nearest reading in the 45 minutes before the meal, where "nearest" collapses to
  // "latest" once every candidate is already constrained to before the start.
  let baseline: number | null = null;
  if (meal.sugar_log_id) {
    const linked = readings.find((r) => r.id === meal.sugar_log_id);
    if (linked) baseline = linked.glucose_level_mgdl;
  }
  if (baseline == null) {
    const lookbackStart = start - BASELINE_LOOKBACK_MINUTES * 60_000;
    const before = readings
      .filter((r) => {
        const t = new Date(r.logged_at).getTime();
        return t >= lookbackStart && t <= start;
      })
      .sort((a, b) => new Date(b.logged_at).getTime() - new Date(a.logged_at).getTime());
    if (before[0]) baseline = before[0].glucose_level_mgdl;
  }

  const curve: MealResponsePoint[] = inWindow.map((r) => ({
    atMinutes: Math.round((new Date(r.logged_at).getTime() - start) / 60_000),
    glucose_level_mgdl: r.glucose_level_mgdl,
    logged_at: r.logged_at,
  }));

  const peakPoint = curve.reduce((max, p) =>
    p.glucose_level_mgdl > max.glucose_level_mgdl ? p : max
  );
  const peak = peakPoint.glucose_level_mgdl;
  const delta = baseline == null ? null : peak - baseline;
  const timeToPeakMin = peakPoint.atMinutes;

  const twoHourCandidates = curve.filter(
    (p) => p.atMinutes >= TWO_HOUR_WINDOW.min && p.atMinutes <= TWO_HOUR_WINDOW.max
  );
  const twoHourValue =
    twoHourCandidates.length === 0
      ? null
      : twoHourCandidates.reduce((closest, p) =>
          Math.abs(p.atMinutes - 120) < Math.abs(closest.atMinutes - 120) ? p : closest
        ).glucose_level_mgdl;

  // Band split: the user's OWN post-meal range (reuses classifyGlucose so this
  // never drifts from how every other surface reads the same value).
  let lowN = 0;
  let inN = 0;
  let highN = 0;
  for (const p of curve) {
    const status = classifyGlucose(p.glucose_level_mgdl, "post_meal_2h", profile);
    if (status === "low") lowN++;
    else if (status === "normal") inN++;
    else highN++; // elevated | high | veryHigh
  }
  const total = curve.length;
  const band: MealResponseBandSplit = {
    lowPct: Math.round((lowN / total) * 100),
    inRangePct: Math.round((inN / total) * 100),
    highPct: Math.round((highN / total) * 100),
  };

  return { baseline, peak, delta, timeToPeakMin, twoHourValue, curve, band };
}
