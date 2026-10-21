import type { InsulinMode } from "./db/types";
import { insulinModeShowsBolus } from "./insulinMode";

/**
 * The calculator's two numbers (carb ratio, correction factor), decided in one
 * place and kept pure so scripts/onboardingSteps.test.ts can run it under plain
 * Node.
 *
 * Nothing here supplies a number. The calculator shows a unit figure only for
 * a profile whose ratios_confirmed is 1, and that flag means exactly one thing:
 * the user typed their own carb ratio and correction factor AND ticked "I set
 * these ratios with my diabetes team". Stored numbers alone never qualify, so a
 * value the app once wrote by itself cannot turn into a figure.
 */

/** Per-profile AsyncStorage flag base: set once the ratios sheet has been
 *  offered, so it opens by itself a single time and never nags afterwards. The
 *  user reaches it from the "Enter your ratios" line from then on. Listed in
 *  lib/profileScopedKeys.ts so deleting a profile sweeps it. */
export const RATIOS_CONFIRM_PROMPTED_KEY = "zerospike.ratiosConfirmPrompted";

/** The pre-2.4 key (the old sheet's "put away" flag). Kept only so a deleted
 *  profile still sweeps it; nothing reads it any more. */
export const LEGACY_CALC_SETUP_DISMISSED_KEY = "zerospike.calcSetupDismissed";

export const CARB_RATIO_BOUNDS = { min: 1, max: 50 } as const;
/** ISF bounds in the profile's display unit. */
export const ISF_BOUNDS = {
  mgdl: { min: 5, max: 500 },
  mmol: { min: 0.5, max: 30 },
} as const;

/**
 * What older builds wrote into a profile nobody had filled in. Used ONLY to
 * recognise those rows as "the user never entered anything" (the fields then
 * open empty); it is never read as a ratio by any calculation path.
 */
const LEGACY_UNENTERED = { breakfast: 10, lunch: 12, dinner: 12, isfMgdl: 40 } as const;

export interface CalcSetupProfile {
  insulin_mode: InsulinMode;
  carb_ratio_breakfast: number;
  carb_ratio_lunch: number;
  carb_ratio_dinner: number;
  insulin_sensitivity_factor: number;
  ratios_confirmed: number;
}

function usable(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

/**
 * The single gate for every unit figure ("Calculated total", the meal and
 * correction lines, any dose number derived from a ratio). True only for a
 * profile whose owner confirmed their own ratios.
 */
export function calcFiguresAllowed(
  profile: Pick<CalcSetupProfile, "ratios_confirmed"> | null | undefined
): boolean {
  return !!profile && profile.ratios_confirmed === 1;
}

/** An unconfirmed profile whose four numbers are exactly what older builds
 *  filled in on their own: nothing the user entered. */
export function isLegacyUnentered(
  profile: Omit<CalcSetupProfile, "insulin_mode"> | null | undefined
): boolean {
  if (!profile || profile.ratios_confirmed === 1) return false;
  return (
    profile.carb_ratio_breakfast === LEGACY_UNENTERED.breakfast &&
    profile.carb_ratio_lunch === LEGACY_UNENTERED.lunch &&
    profile.carb_ratio_dinner === LEGACY_UNENTERED.dinner &&
    profile.insulin_sensitivity_factor === LEGACY_UNENTERED.isfMgdl
  );
}

export interface RatioFields {
  breakfast: number | null;
  lunch: number | null;
  dinner: number | null;
  /** mg/dL */
  isfMgdl: number | null;
}

/** What the entry fields open with: the stored value when it is the user's own
 *  and usable, otherwise empty (null). Never a suggested number. */
export function ratioFieldsInitial(
  profile: Omit<CalcSetupProfile, "insulin_mode"> | null | undefined
): RatioFields {
  if (!profile || isLegacyUnentered(profile)) {
    return { breakfast: null, lunch: null, dinner: null, isfMgdl: null };
  }
  const pick = (v: number) => (usable(v) ? v : null);
  return {
    breakfast: pick(profile.carb_ratio_breakfast),
    lunch: pick(profile.carb_ratio_lunch),
    dinner: pick(profile.carb_ratio_dinner),
    isfMgdl: pick(profile.insulin_sensitivity_factor),
  };
}

/**
 * True when the profile uses mealtime insulin but has no confirmed ratios of
 * the user's own (or a confirmed one that cannot be divided by). A profile that
 * takes no mealtime insulin never sees the dose section, so it is never asked.
 */
export function calcSetupNeeded(profile: CalcSetupProfile | null | undefined): boolean {
  if (!profile) return false;
  if (!insulinModeShowsBolus(profile.insulin_mode)) return false;
  if (!calcFiguresAllowed(profile)) return true;
  return !(
    usable(profile.carb_ratio_breakfast) &&
    usable(profile.carb_ratio_lunch) &&
    usable(profile.carb_ratio_dinner) &&
    usable(profile.insulin_sensitivity_factor)
  );
}

/** The sheet opens by itself only on a new record and only until it has been
 *  offered once. Editing a past meal is not the moment to ask. */
export function shouldAutoOpenCalcSetup(input: {
  needed: boolean;
  isEdit: boolean;
  prompted: boolean;
}): boolean {
  return input.needed && !input.isEdit && !input.prompted;
}

/** What the sheet starts from: the user's own stored numbers, else empty. */
export function calcSetupInitial(profile: CalcSetupProfile | null | undefined): {
  carbRatio: number | null;
  isfMgdl: number | null;
} {
  const f = ratioFieldsInitial(profile);
  return { carbRatio: f.breakfast, isfMgdl: f.isfMgdl };
}

export interface CalcSetupPatch {
  carb_ratio_breakfast: number;
  carb_ratio_lunch: number;
  carb_ratio_dinner: number;
  insulin_sensitivity_factor: number;
  ratios_confirmed: 0 | 1;
}

/**
 * What "Save" writes. One ratio for all three meals (per-meal ratios stay in
 * Profile and Targets). ratios_confirmed is 1 only when the box was ticked:
 * the numbers can be saved without it, but then no figure appears. Null when
 * either value cannot be used, so a bad entry never reaches the profile.
 */
export function calcSetupPatch(input: {
  carbRatio: number;
  isfMgdl: number;
  confirmed: boolean;
}): CalcSetupPatch | null {
  if (!usable(input.carbRatio) || !usable(input.isfMgdl)) return null;
  return {
    carb_ratio_breakfast: input.carbRatio,
    carb_ratio_lunch: input.carbRatio,
    carb_ratio_dinner: input.carbRatio,
    insulin_sensitivity_factor: input.isfMgdl,
    ratios_confirmed: input.confirmed ? 1 : 0,
  };
}

const EPS = 1e-6;

/**
 * Profile and Targets saves the four numbers as one set, once all four are
 * filled. A set that differs from what is stored is a new set: the confirmation
 * is withdrawn (ratios_confirmed 0) and the user ticks the box again. Typing the
 * same numbers back changes nothing, so a confirmed profile stays confirmed.
 * Null when a value is missing or unusable, or when nothing differs.
 */
export function ratioSetPatch(
  profile: Omit<CalcSetupProfile, "insulin_mode"> | null | undefined,
  draft: RatioFields
): Omit<CalcSetupPatch, "ratios_confirmed"> & { ratios_confirmed: 0 } | null {
  if (!profile) return null;
  if (
    !usable(draft.breakfast) ||
    !usable(draft.lunch) ||
    !usable(draft.dinner) ||
    !usable(draft.isfMgdl)
  ) {
    return null;
  }
  const same =
    Math.abs(profile.carb_ratio_breakfast - draft.breakfast) < EPS &&
    Math.abs(profile.carb_ratio_lunch - draft.lunch) < EPS &&
    Math.abs(profile.carb_ratio_dinner - draft.dinner) < EPS &&
    Math.abs(profile.insulin_sensitivity_factor - draft.isfMgdl) < EPS;
  if (same) return null;
  return {
    carb_ratio_breakfast: draft.breakfast,
    carb_ratio_lunch: draft.lunch,
    carb_ratio_dinner: draft.dinner,
    insulin_sensitivity_factor: draft.isfMgdl,
    ratios_confirmed: 0,
  };
}

/** True when the stored set is the draft (so ticking the box confirms exactly
 *  what is on screen). */
export function ratioSetMatchesStored(
  profile: Omit<CalcSetupProfile, "insulin_mode"> | null | undefined,
  draft: RatioFields
): boolean {
  if (!profile) return false;
  if (
    !usable(draft.breakfast) ||
    !usable(draft.lunch) ||
    !usable(draft.dinner) ||
    !usable(draft.isfMgdl)
  ) {
    return false;
  }
  return (
    Math.abs(profile.carb_ratio_breakfast - draft.breakfast) < EPS &&
    Math.abs(profile.carb_ratio_lunch - draft.lunch) < EPS &&
    Math.abs(profile.carb_ratio_dinner - draft.dinner) < EPS &&
    Math.abs(profile.insulin_sensitivity_factor - draft.isfMgdl) < EPS
  );
}

/** The box in Profile and Targets. Ticking confirms the stored set (null when
 *  any stored number cannot be divided by); unticking withdraws it. */
export function ratioConfirmPatch(
  profile: Omit<CalcSetupProfile, "insulin_mode"> | null | undefined,
  checked: boolean
): { ratios_confirmed: 0 | 1 } | null {
  if (!profile) return null;
  if (!checked) return { ratios_confirmed: 0 };
  if (
    !usable(profile.carb_ratio_breakfast) ||
    !usable(profile.carb_ratio_lunch) ||
    !usable(profile.carb_ratio_dinner) ||
    !usable(profile.insulin_sensitivity_factor)
  ) {
    return null;
  }
  return { ratios_confirmed: 1 };
}
