import type { DiabetesType } from "./db/types";

export interface RangeValues {
  min: number;
  max: number;
}

interface DiabetesTargetDefaults {
  fasting: RangeValues;
  postmeal: RangeValues;
}

/**
 * Target-range defaults by diabetes type, in mg/dL (2.1.0 Wave 2a matrix).
 * Display-unit conversion goes through glucoseToDisplay at the call site;
 * this table never changes profiles.ts's own createProfile fallbacks.
 */
export const TARGET_DEFAULTS_MGDL: Record<DiabetesType, DiabetesTargetDefaults> = {
  type1: { fasting: { min: 80, max: 130 }, postmeal: { min: 80, max: 180 } },
  type2: { fasting: { min: 80, max: 130 }, postmeal: { min: 80, max: 180 } },
  gestational: { fasting: { min: 70, max: 95 }, postmeal: { min: 70, max: 120 } },
  prediabetes: { fasting: { min: 70, max: 100 }, postmeal: { min: 70, max: 140 } },
  none: { fasting: { min: 70, max: 100 }, postmeal: { min: 70, max: 140 } },
  unknown: { fasting: { min: 70, max: 100 }, postmeal: { min: 70, max: 140 } },
};

/** Daily carb-target defaults (grams). Only gestational differs from the
 *  app-wide 160-200 band. */
export const CARB_TARGET_DEFAULTS_G: Record<DiabetesType, RangeValues> = {
  type1: { min: 160, max: 200 },
  type2: { min: 160, max: 200 },
  gestational: { min: 175, max: 215 },
  prediabetes: { min: 160, max: 200 },
  none: { min: 160, max: 200 },
  unknown: { min: 160, max: 200 },
};

/**
 * Types that never ask the 4-way insulin question (prediabetes, no
 * diagnosis): they only ask a 2-way "do you use pills" question and their
 * insulin_mode stays "none". Every other type gets the full 4-way question.
 */
export function isNoInsulinDiabetesType(type: DiabetesType): boolean {
  return type === "none" || type === "prediabetes";
}
