import type { Food, MealSlot, UserProfile } from "./db/types";
import { targetMidpoint, targetRangeFor } from "./glucose";
import { calcFiguresAllowed } from "./calcSetup";

/** Maps an hour (0-23) to the active meal slot per the product rules. */
export function mealSlotForHour(hour: number): MealSlot {
  if (hour >= 6 && hour < 11) return "breakfast";
  if (hour >= 11 && hour < 17) return "lunch";
  return "dinner"; // 17:00 - 06:00
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
 * Plausibility guardrails. These NEVER change the math or block logging - they
 * only flag an estimate so the UI can show a descriptive note (the dose stays
 * fully editable). The lower bound has to be well above 1, or the "carb ratio 1
 * instead of 10" typo this guard exists for slips through as a plausible value:
 * a real mealtime ratio below 3 g per unit is not a clinical setting, it is a
 * missing digit. Bounds stay generous so only clear errors trip them.
 */
export const PLAUSIBLE_CARB_RATIO = { min: 3, max: 50 } as const; // g per unit
/** Bounds for the daily carbohydrate range a profile can be given (grams). */
export const CARB_TARGET_BOUNDS = { min: 30, max: 600 } as const;

export function clampCarbTarget(value: number): number {
  return Math.round(
    Math.min(CARB_TARGET_BOUNDS.max, Math.max(CARB_TARGET_BOUNDS.min, value))
  );
}
export const PLAUSIBLE_ISF = { min: 5, max: 200 } as const; // mg/dL per unit
/** A single mealtime estimate at/above this many units is unusual → warn. */
export const HIGH_DOSE_WARNING_UNITS = 25;
/**
 * A single hand-entered dose above this is almost certainly a typo (a stray
 * digit). It is never REFUSED - refusing would block a legitimate outlier and
 * lose the record - but it takes a second explicit confirmation before it is
 * stored. Same non-blocking philosophy as the warnings above.
 */
export const IMPLAUSIBLE_DOSE_UNITS = 100;

/** How a hand-entered dose reads against the plausibility bands. */
export type DoseCheck = "ok" | "high" | "implausible";

/**
 * Classifies a typed dose so an entry screen can ask for confirmation before it
 * saves. Pure and display-only: nothing here changes what gets stored, it only
 * decides whether to ask "is that what you meant?" first.
 */
export function checkDose(units: number): DoseCheck {
  if (!Number.isFinite(units) || units <= 0) return "ok";
  if (units >= IMPLAUSIBLE_DOSE_UNITS) return "implausible";
  if (units >= HIGH_DOSE_WARNING_UNITS) return "high";
  return "ok";
}

export type InsulinWarning =
  | "high_dose"
  | "carb_ratio_out_of_range"
  | "isf_out_of_range";

/** Why the correction component was left out of an estimate, when it was. */
export type CorrectionSkipReason = "isf_invalid";

export interface InsulinEstimate {
  slot: MealSlot;
  carbRatio: number;
  /** active carbs in the chosen portion (g) */
  carbs: number;
  /** dose to cover the meal's carbs (units) */
  mealDose: number;
  /** optional correction for an above-target reading (units) */
  correctionDose: number;
  /** mealDose + correctionDose, rounded to the nearest 0.5 unit */
  totalDose: number;
  /** units the correction was reduced by active insulin (IOB), if any */
  iobReduction: number;
  /**
   * Set when a reading was given but the correction could not be computed, so
   * the UI can say WHY the estimate covers carbs only instead of silently
   * dropping the component. Descriptive, never an instruction.
   */
  correctionSkipped: CorrectionSkipReason | null;
  /** non-blocking plausibility flags for the UI (empty when the estimate looks sane) */
  warnings: InsulinWarning[];
}

export interface EstimateOptions {
  /** current glucose, for an optional ISF correction */
  currentGlucose?: number | null;
  /** target the correction aims for (defaults to the post-meal range midpoint) */
  targetGlucose?: number | null;
  /**
   * Active insulin (IOB) already working from recent bolus doses. When given,
   * it is subtracted from the CORRECTION component only (never the meal dose),
   * clamped at 0, so it can only LOWER the estimate, preventing stacking.
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
 * The correction target is the MIDDLE of the user's post-meal range, not its
 * ceiling. Aiming at the ceiling means every correction lands at the very top of
 * the band; the midpoint is the conventional, more honest choice, and the UI
 * states it in plain words ("the middle of your target range") so the number is
 * never a black box.
 *
 * Always presented to the user as a calculated, editable estimate.
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
    | "target_postmeal_min"
    | "target_postmeal_max"
  >,
  options: EstimateOptions = {}
): InsulinEstimate {
  const slot = options.slot ?? activeMealSlot(options.now ?? new Date());
  const rawRatio = carbRatioForSlot(profile, slot);
  const carbs = (food.carb_100g * portionGrams) / 100;
  // A ratio that cannot be divided by produces NO dose. It used to be floored at
  // 0.1, which turned a missing ratio into 500 U for 50 g; now the estimate is
  // zero and only says the ratio is unusable. The UI never gets here (the gate in
  // estimateInsulinConfirmed needs four usable numbers); this is the backstop.
  if (!Number.isFinite(rawRatio) || rawRatio <= 0) {
    return {
      slot,
      carbRatio: 0,
      carbs: Math.round(carbs * 10) / 10,
      mealDose: 0,
      correctionDose: 0,
      totalDose: 0,
      iobReduction: 0,
      correctionSkipped: null,
      warnings: ["carb_ratio_out_of_range"],
    };
  }
  const carbRatio = rawRatio;
  const mealDose = carbs / carbRatio;

  // A stored ISF of 0 (or a non-finite one) cannot produce a correction. It used
  // to disable the whole component in silence AND skip the range flag, so an
  // unusable setting looked identical to a healthy one; now it is reported.
  const rawIsf = profile.insulin_sensitivity_factor;
  const isfUsable = Number.isFinite(rawIsf) && rawIsf > 0;

  let correctionDose = 0;
  let correctionSkipped: CorrectionSkipReason | null = null;
  if (options.currentGlucose != null) {
    if (!isfUsable) {
      correctionSkipped = "isf_invalid";
    } else {
      const target =
        options.targetGlucose ??
        targetMidpoint(
          targetRangeFor("post_meal_2h", {
            target_postmeal_min: profile.target_postmeal_min,
            target_postmeal_max: profile.target_postmeal_max,
          })
        );
      const delta = options.currentGlucose - target;
      if (delta > 0) {
        correctionDose = delta / rawIsf;
      }
    }
  }

  // Subtract active insulin from the CORRECTION only (never the meal carbs),
  // clamped at 0. This can only reduce the estimate in the safe, anti-stacking
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
  if (!isfUsable || rawIsf < PLAUSIBLE_ISF.min || rawIsf > PLAUSIBLE_ISF.max) {
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
    correctionSkipped,
    warnings,
  };
}

/** Carbs in the chosen portion (g, one decimal). Needs no ratio, so it is the
 *  part of the calculator that works for everyone. */
export function carbsForPortion(
  food: Pick<Food, "carb_100g">,
  portionGrams: number
): number {
  return Math.round(((food.carb_100g * portionGrams) / 100) * 10) / 10;
}

/**
 * The only entry point that turns ratios into unit figures for the UI: null
 * unless the profile's owner confirmed their own ratios (ratios_confirmed 1).
 * With the gate closed no division by a ratio happens at all.
 */
export function estimateInsulinConfirmed(
  food: Pick<Food, "carb_100g">,
  portionGrams: number,
  profile: Parameters<typeof estimateInsulin>[2] & Pick<UserProfile, "ratios_confirmed">,
  options: EstimateOptions = {}
): InsulinEstimate | null {
  if (!calcFiguresAllowed(profile)) return null;
  return estimateInsulin(food, portionGrams, profile, options);
}
