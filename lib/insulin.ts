import type { Food, MealSlot, UserProfile } from "./db/types";

/** Maps an hour (0–23) to the active meal slot per the product rules. */
export function mealSlotForHour(hour: number): MealSlot {
  if (hour >= 6 && hour < 11) return "breakfast";
  if (hour >= 11 && hour < 17) return "lunch";
  return "dinner"; // 17:00 – 06:00
}

export function activeMealSlot(date = new Date()): MealSlot {
  return mealSlotForHour(date.getHours());
}

export function carbRatioForSlot(
  profile: Pick<
    UserProfile,
    "carb_ratio_breakfast" | "carb_ratio_lunch" | "carb_ratio_dinner"
  >,
  slot: MealSlot
): number {
  switch (slot) {
    case "breakfast":
      return profile.carb_ratio_breakfast;
    case "lunch":
      return profile.carb_ratio_lunch;
    case "dinner":
      return profile.carb_ratio_dinner;
  }
}

/**
 * Plausibility guardrails. These NEVER change the math or block logging — they
 * only flag an estimate so the UI can warn the user to double-check (the dose
 * stays fully editable). Catching a "carb ratio 1 instead of 10" typo before it
 * becomes a 10× over-estimate is exactly the input-validation safety net that
 * most dosing apps lack. Bounds are generous so only clear errors trip them.
 */
export const PLAUSIBLE_CARB_RATIO = { min: 1, max: 50 } as const; // g per unit
export const PLAUSIBLE_ISF = { min: 5, max: 200 } as const; // mg/dL per unit
/** A single mealtime estimate at/above this many units is unusual → warn. */
export const HIGH_DOSE_WARNING_UNITS = 25;

export type InsulinWarning =
  | "high_dose"
  | "carb_ratio_out_of_range"
  | "isf_out_of_range";

export interface InsulinEstimate {
  slot: MealSlot;
  carbRatio: number;
  /** active carbs in the chosen portion (g) */
  carbs: number;
  /** dose to cover the meal's carbs (units) */
  mealDose: number;
  /** optional correction for an above-target reading (units) */
  correctionDose: number;
  /** mealDose + correctionDose, rounded to nearest 0.5 (pen resolution) */
  totalDose: number;
  /** units the correction was reduced by active insulin (IOB), if any */
  iobReduction: number;
  /** non-blocking plausibility flags for the UI (empty when the estimate looks sane) */
  warnings: InsulinWarning[];
}

export interface EstimateOptions {
  /** current glucose, for an optional ISF correction */
  currentGlucose?: number | null;
  /** target the correction aims for (defaults to postmeal target) */
  targetGlucose?: number | null;
  /**
   * Active insulin (IOB) already working from recent bolus doses. When given,
   * it is subtracted from the CORRECTION component only (never the meal dose),
   * clamped at 0 — so it can only LOWER the estimate, preventing stacking.
   */
  currentIOB?: number | null;
  /** override the auto-detected slot */
  slot?: MealSlot;
  now?: Date;
}

/**
 * Live carb & insulin estimator.
 *
 *   carbs       = carb_100g × portion / 100
 *   mealDose    = carbs / activeCarbRatio
 *   correction  = max(0, currentGlucose − target) / ISF   (only if provided)
 *
 * Always presented to the user as an "Estimated Dose Recommendation".
 */
export function estimateInsulin(
  food: Pick<Food, "carb_100g">,
  portionGrams: number,
  profile: Pick<
    UserProfile,
    | "carb_ratio_breakfast"
    | "carb_ratio_lunch"
    | "carb_ratio_dinner"
    | "insulin_sensitivity_factor"
    | "target_postmeal_max"
  >,
  options: EstimateOptions = {}
): InsulinEstimate {
  const slot = options.slot ?? activeMealSlot(options.now ?? new Date());
  const rawRatio = carbRatioForSlot(profile, slot);
  // Defensive floor against a non-positive stored ratio (would divide by ~0);
  // an out-of-range ratio is surfaced via warnings below, not silently trusted.
  const carbRatio = Math.max(rawRatio, 0.1);
  const carbs = (food.carb_100g * portionGrams) / 100;
  const mealDose = carbs / carbRatio;

  let correctionDose = 0;
  let isfApplied: number | null = null;
  if (
    options.currentGlucose != null &&
    profile.insulin_sensitivity_factor > 0
  ) {
    isfApplied = profile.insulin_sensitivity_factor;
    const target = options.targetGlucose ?? profile.target_postmeal_max;
    const delta = options.currentGlucose - target;
    if (delta > 0) {
      correctionDose = delta / profile.insulin_sensitivity_factor;
    }
  }

  // Subtract active insulin from the CORRECTION only (never the meal carbs),
  // clamped at 0. This can only reduce the estimate — the safe, anti-stacking
  // direction. The dose stays editable.
  let iobReduction = 0;
  if (options.currentIOB != null && options.currentIOB > 0 && correctionDose > 0) {
    iobReduction = Math.min(correctionDose, options.currentIOB);
    correctionDose = correctionDose - iobReduction;
  }

  const total = Math.max(0, mealDose + correctionDose);
  const totalDose = Math.round(total * 2) / 2;

  const warnings: InsulinWarning[] = [];
  if (
    rawRatio < PLAUSIBLE_CARB_RATIO.min ||
    rawRatio > PLAUSIBLE_CARB_RATIO.max
  ) {
    warnings.push("carb_ratio_out_of_range");
  }
  if (
    isfApplied != null &&
    (isfApplied < PLAUSIBLE_ISF.min || isfApplied > PLAUSIBLE_ISF.max)
  ) {
    warnings.push("isf_out_of_range");
  }
  if (totalDose >= HIGH_DOSE_WARNING_UNITS) {
    warnings.push("high_dose");
  }

  return {
    slot,
    carbRatio,
    carbs: Math.round(carbs * 10) / 10,
    mealDose: Math.round(mealDose * 100) / 100,
    correctionDose: Math.round(correctionDose * 100) / 100,
    totalDose,
    iobReduction: Math.round(iobReduction * 100) / 100,
    warnings,
  };
}
