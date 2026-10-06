import type { InsulinMode } from "./db/types";
import { insulinModeShowsBolus } from "./insulinMode";

/**
 * First-use setup of the calculator's two numbers, decided in one place and
 * kept pure so scripts/onboardingSteps.test.ts can run it under plain Node.
 *
 * The carb ratio and the correction factor (ISF) used to be two onboarding
 * screens. They are asked the first time the calculator is opened instead, in
 * one sheet (app/calculator.tsx), because that is the moment a number can be
 * used and the moment the user knows which one they mean. The same predicate
 * also catches an older profile that never gave them, so there is one path for
 * both, not a migration.
 */

/** What an unsure user starts from. Taking it leaves ratios_confirmed at 0, so
 *  the calculator keeps saying out loud that it runs on defaults. */
export const DEFAULT_CARB_RATIO = 10;
export const DEFAULT_ISF_MGDL = 40;

/** Per-profile AsyncStorage flag base: set once the sheet has been shown and
 *  put away, so closing it is final until the user reopens it themselves.
 *  Listed in lib/profileScopedKeys.ts so deleting a profile sweeps it. */
export const CALC_SETUP_DISMISSED_KEY = "zerospike.calcSetupDismissed";

export interface CalcSetupProfile {
  insulin_mode: InsulinMode;
  carb_ratio_breakfast: number;
  carb_ratio_lunch: number;
  carb_ratio_dinner: number;
  insulin_sensitivity_factor: number;
  ratios_confirmed: number;
}

function usable(n: number): boolean {
  return Number.isFinite(n) && n > 0;
}

/**
 * True when the profile uses mealtime insulin but the calculator has no number
 * of the user's own to work from: nothing confirmed yet, or a stored ratio or
 * ISF that cannot be divided by. A profile that takes no mealtime insulin never
 * sees the calculator's dose section, so it is never asked.
 *
 * ratios_confirmed is 1 for everyone who upgraded from before v8 (see the v8
 * migration), so an established install is not asked anything new.
 */
export function calcSetupNeeded(profile: CalcSetupProfile | null | undefined): boolean {
  if (!profile) return false;
  if (!insulinModeShowsBolus(profile.insulin_mode)) return false;
  if (profile.ratios_confirmed !== 1) return true;
  return !(
    usable(profile.carb_ratio_breakfast) &&
    usable(profile.carb_ratio_lunch) &&
    usable(profile.carb_ratio_dinner) &&
    usable(profile.insulin_sensitivity_factor)
  );
}

/** The sheet opens by itself only on a new record and only until it has been
 *  put away once. Editing a past meal is not the moment to ask. */
export function shouldAutoOpenCalcSetup(input: {
  needed: boolean;
  isEdit: boolean;
  dismissed: boolean;
}): boolean {
  return input.needed && !input.isEdit && !input.dismissed;
}

/** What the sheet starts from: the stored value when it is usable, else the
 *  default, so a profile with a zero ratio never opens on zero. */
export function calcSetupInitial(profile: CalcSetupProfile | null | undefined): {
  carbRatio: number;
  isfMgdl: number;
} {
  const cr = profile?.carb_ratio_breakfast;
  const isf = profile?.insulin_sensitivity_factor;
  return {
    carbRatio: cr != null && usable(cr) ? cr : DEFAULT_CARB_RATIO,
    isfMgdl: isf != null && usable(isf) ? isf : DEFAULT_ISF_MGDL,
  };
}

export interface CalcSetupPatch {
  carb_ratio_breakfast: number;
  carb_ratio_lunch: number;
  carb_ratio_dinner: number;
  insulin_sensitivity_factor: number;
  ratios_confirmed: 1;
}

/**
 * What "Save" writes. One ratio for all three meals (what onboarding wrote;
 * per-meal ratios stay in Settings), and ratios_confirmed 1: saving a number in
 * a sheet whose only job is that number is the user telling us it is theirs,
 * the same rule Settings applies when a ratio is saved there. Null when either
 * value cannot be used, so a bad entry never reaches the profile.
 */
export function calcSetupPatch(input: {
  carbRatio: number;
  isfMgdl: number;
}): CalcSetupPatch | null {
  if (!usable(input.carbRatio) || !usable(input.isfMgdl)) return null;
  return {
    carb_ratio_breakfast: input.carbRatio,
    carb_ratio_lunch: input.carbRatio,
    carb_ratio_dinner: input.carbRatio,
    insulin_sensitivity_factor: input.isfMgdl,
    ratios_confirmed: 1,
  };
}
