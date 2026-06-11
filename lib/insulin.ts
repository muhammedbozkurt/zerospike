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
}

export interface EstimateOptions {
  /** current glucose, for an optional ISF correction */
  currentGlucose?: number | null;
  /** target the correction aims for (defaults to postmeal target) */
  targetGlucose?: number | null;
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
  const carbRatio = Math.max(carbRatioForSlot(profile, slot), 0.1);
  const carbs = (food.carb_100g * portionGrams) / 100;
  const mealDose = carbs / carbRatio;

  let correctionDose = 0;
  if (
    options.currentGlucose != null &&
    profile.insulin_sensitivity_factor > 0
  ) {
    const target = options.targetGlucose ?? profile.target_postmeal_max;
    const delta = options.currentGlucose - target;
    if (delta > 0) {
      correctionDose = delta / profile.insulin_sensitivity_factor;
    }
  }

  const total = Math.max(0, mealDose + correctionDose);
  return {
    slot,
    carbRatio,
    carbs: Math.round(carbs * 10) / 10,
    mealDose: Math.round(mealDose * 100) / 100,
    correctionDose: Math.round(correctionDose * 100) / 100,
    totalDose: Math.round(total * 2) / 2,
  };
}
