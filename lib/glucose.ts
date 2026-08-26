import type { GlucoseUnit, PeriodTag, UserProfile } from "./db/types";
import { GLUCOSE_COLORS } from "./theme/tokens";
import { formatLocale } from "./format";

/* ── Units ─────────────────────────────────────────────────────────────────
 * Everything is stored in mg/dL. These helpers convert only at the display /
 * input boundary so the classification + insulin math never changes.
 *
 * MGDL_PER_MMOL is the single canonical factor for the whole app - display,
 * input, AND the health-store import (see lib/services/health.ts). Never use a
 * rounded `18`; one constant keeps every entry path agreeing to the mg/dL. */
export const MGDL_PER_MMOL = 18.0182;

export function glucoseUnitLabel(unit: GlucoseUnit): string {
  return unit === "mmol" ? "mmol/L" : "mg/dL";
}

/** mg/dL → the profile's unit as a display string (mmol shows 1 decimal), in the
 *  active locale's number format (mmol "5,5" in tr / de, "5.5" in en). */
export function formatGlucose(mgdl: number, unit: GlucoseUnit): string {
  const loc = formatLocale();
  try {
    return unit === "mmol"
      ? (mgdl / MGDL_PER_MMOL).toLocaleString(loc, {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        })
      : Math.round(mgdl).toLocaleString(loc);
  } catch {
    return unit === "mmol"
      ? (mgdl / MGDL_PER_MMOL).toFixed(1)
      : String(Math.round(mgdl));
  }
}

/** mg/dL → editable number in the profile's unit (mmol rounded to 1 decimal). */
export function glucoseToDisplay(mgdl: number, unit: GlucoseUnit): number {
  return unit === "mmol"
    ? Math.round((mgdl / MGDL_PER_MMOL) * 10) / 10
    : Math.round(mgdl);
}

/** A value entered in the profile's unit → canonical mg/dL for storage. */
export function glucoseFromDisplay(value: number, unit: GlucoseUnit): number {
  return unit === "mmol" ? Math.round(value * MGDL_PER_MMOL) : Math.round(value);
}

/**
 * mmol/L → mg/dL. Call ONLY on a value already known to be mmol/L (e.g. a
 * health record's explicit mmol field). Never infer the unit from magnitude:
 * a real severe-hypo mg/dL reading (e.g. 25) overlaps the mmol range and would
 * be silently 18×-inflated into a fake high. Returns an unrounded value; the
 * caller rounds at the storage boundary.
 */
export function mmolToMgdl(mmol: number): number {
  return mmol * MGDL_PER_MMOL;
}

/**
 * The neutral re-measure follow-up window (minutes) after a low reading. ONE
 * source: the dashboard schedules the reminder at this interval and the doctor
 * report pairs a low with the reading logged within it, so the two never drift.
 */
export const LOW_FOLLOWUP_MINUTES = 15;

export type GlucoseStatus = "low" | "normal" | "elevated" | "high" | "veryHigh";

/**
 * Fixed clinical ceiling, independent of the personal target range. A reading
 * at or above this sits in its own class no matter how lenient the user's own
 * range is, so a wide personal target can never render a 300 as a mild "high".
 * 250 mg/dL is the widely-published threshold for a markedly raised reading.
 */
export const VERY_HIGH_MGDL = 250;

/** Bounds the user's own range/threshold inputs to values that stay sane. */
export const HYPO_THRESHOLD_RANGE = { min: 54, max: 90 } as const;
export const TARGET_RANGE_BOUNDS = { min: 60, max: 300 } as const;

export function clampHypoThreshold(value: number): number {
  return Math.round(
    Math.min(HYPO_THRESHOLD_RANGE.max, Math.max(HYPO_THRESHOLD_RANGE.min, value))
  );
}

export function clampTarget(value: number): number {
  return Math.round(
    Math.min(TARGET_RANGE_BOUNDS.max, Math.max(TARGET_RANGE_BOUNDS.min, value))
  );
}

/** Diagnostic palette - the single glucose color language (lib/theme/tokens.ts,
 *  mirrored in tailwind.config). low=red, normal=green, elevated=amber,
 *  high=orange. Color is never the sole cue: a value + period label always
 *  accompany it, so a reading stays legible in greyscale and for color-vision
 *  differences. */
export const STATUS_COLOR: Record<GlucoseStatus, string> = GLUCOSE_COLORS;

export const STATUS_BORDER: Record<GlucoseStatus, string> = {
  low: "border-l-low",
  normal: "border-l-normal",
  elevated: "border-l-elevated",
  high: "border-l-high",
  veryHigh: "border-l-veryHigh",
};

export const STATUS_TEXT: Record<GlucoseStatus, string> = {
  low: "text-low",
  normal: "text-normal",
  elevated: "text-elevated",
  high: "text-high",
  veryHigh: "text-veryHigh",
};

/** The subset of a profile the classification and range helpers need. */
export type TargetProfile = Pick<
  UserProfile,
  | "target_fasting_min"
  | "target_fasting_max"
  | "target_postmeal_min"
  | "target_postmeal_max"
  | "hypo_threshold_mgdl"
>;

export interface TargetRange {
  min: number;
  max: number;
}

/** The user's own low threshold, defaulted and clamped to a sane band. */
export function hypoThreshold(profile: Partial<TargetProfile>): number {
  return clampHypoThreshold(profile.hypo_threshold_mgdl ?? 70);
}

/**
 * The target RANGE for a reading's period. Fasting/pre-meal/bedtime use the
 * fasting range; post-meal uses its own; an untagged reading - "manual" (never
 * tagged in the entry sheet) or "unset" (a Health import, schema v22, see
 * lib/periodTag.ts) - uses the more lenient post-meal range (unchanged from
 * the pre-range behaviour).
 */
export function targetRangeFor(
  tag: PeriodTag,
  profile: Partial<TargetProfile>
): TargetRange {
  const postMeal = tag === "post_meal_2h" || tag === "manual" || tag === "unset";
  const min = postMeal
    ? (profile.target_postmeal_min ?? 80)
    : (profile.target_fasting_min ?? 80);
  const max = postMeal
    ? (profile.target_postmeal_max ?? 140)
    : (profile.target_fasting_max ?? 100);
  // Defensive: a stored min above its max would invert the band.
  return min <= max ? { min, max } : { min: max, max: min };
}

/** Middle of a target range - what a correction aims for (never the ceiling). */
export function targetMidpoint(range: TargetRange): number {
  return Math.round((range.min + range.max) / 2);
}

/**
 * Classifies a reading against the user's personal target RANGE.
 * - low:      below the user's own hypo threshold (default 70, ADA level-1) -
 *             its own state so it is never shown like a high; a low is handled
 *             with carbs, not insulin
 * - normal:   inside the target range (min..max)
 * - elevated: above the range, up to ~25% over its ceiling
 * - high:     further above the ceiling
 * - veryHigh: at/above the fixed clinical 250 mg/dL, whatever the personal range
 *
 * A reading between the hypo threshold and the range's low end is NOT a low; it
 * counts as normal, because the low end of a target band is a preference, not a
 * clinical event.
 *
 * Display-only: this never feeds estimateInsulin (which uses raw mg/dL).
 */
export function classifyGlucose(
  value: number,
  tag: PeriodTag,
  profile: Partial<TargetProfile>
): GlucoseStatus {
  if (value < hypoThreshold(profile)) return "low";
  if (value >= VERY_HIGH_MGDL) return "veryHigh";
  const { min, max } = targetRangeFor(tag, profile);
  if (value >= min && value <= max) return "normal";
  if (value < min) return "normal"; // above hypo but under the band's low end
  if (value <= max * 1.25) return "elevated";
  return "high";
}
