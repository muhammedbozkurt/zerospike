import type { GlucoseUnit, PeriodTag, UserProfile } from "./db/types";

/* ── Units ─────────────────────────────────────────────────────────────────
 * Everything is stored in mg/dL. These helpers convert only at the display /
 * input boundary so the classification + insulin math never changes.
 *
 * MGDL_PER_MMOL is the single canonical factor for the whole app — display,
 * input, AND the health-store import (see lib/services/health.ts). Never use a
 * rounded `18`; one constant keeps every entry path agreeing to the mg/dL. */
export const MGDL_PER_MMOL = 18.0182;

export function glucoseUnitLabel(unit: GlucoseUnit): string {
  return unit === "mmol" ? "mmol/L" : "mg/dL";
}

/** mg/dL → the profile's unit as a display string (mmol shows 1 decimal). */
export function formatGlucose(mgdl: number, unit: GlucoseUnit): string {
  return unit === "mmol"
    ? (mgdl / MGDL_PER_MMOL).toFixed(1)
    : String(Math.round(mgdl));
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

export type GlucoseStatus = "low" | "normal" | "elevated" | "high";

/** Diagnostic palette (matches tailwind.config). `low` is a cold blue, kept
 *  deliberately far from the rose `high` so a hypo is never read as a high. */
export const STATUS_COLOR: Record<GlucoseStatus, string> = {
  low: "#3b82f6", // blue — hypoglycemia (treat with fast carbs, NOT insulin)
  normal: "#10b981", // emerald
  elevated: "#f59e0b", // amber
  high: "#f43f5e", // rose
};

export const STATUS_BORDER: Record<GlucoseStatus, string> = {
  low: "border-l-low",
  normal: "border-l-normal",
  elevated: "border-l-elevated",
  high: "border-l-high",
};

export const STATUS_TEXT: Record<GlucoseStatus, string> = {
  low: "text-low",
  normal: "text-normal",
  elevated: "text-elevated",
  high: "text-high",
};

/** Fasting/pre-meal/bedtime compare to the fasting target; post-meal to its own. */
function maxFor(
  tag: PeriodTag,
  profile: Pick<UserProfile, "target_fasting_max" | "target_postmeal_max">
): number {
  switch (tag) {
    case "post_meal_2h":
      return profile.target_postmeal_max;
    case "fasting":
    case "pre_meal":
    case "bedtime":
      return profile.target_fasting_max;
    case "manual":
    default:
      // Neutral manual reading: use the more lenient post-meal threshold.
      return profile.target_postmeal_max;
  }
}

/**
 * Classifies a reading against the user's personal targets.
 * - low:      hypoglycemia (< 70 mg/dL, ADA level-1) — its own state so it is
 *             never shown like a high; a hypo is treated with carbs, not insulin
 * - normal:   at/under target (and not hypo)
 * - elevated: up to ~25% above target
 * - high:     beyond that
 *
 * Display-only: this never feeds estimateInsulin (which uses raw mg/dL).
 */
export function classifyGlucose(
  value: number,
  tag: PeriodTag,
  profile: Pick<UserProfile, "target_fasting_max" | "target_postmeal_max">
): GlucoseStatus {
  if (value < 70) return "low";
  const max = maxFor(tag, profile);
  if (value <= max) return "normal";
  if (value <= max * 1.25) return "elevated";
  return "high";
}
