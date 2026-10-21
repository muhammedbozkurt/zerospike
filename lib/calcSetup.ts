import type { InsulinMode } from "./db/types";
import { insulinModeShowsBolus } from "./insulinMode";

/**
 * The calculator's numbers (a carb ratio per meal and the correction factor),
 * decided in one place and kept pure so scripts/onboardingSteps.test.ts can run
 * it under plain Node.
 *
 * Nothing here supplies a number. The calculator shows a unit figure only for
 * a profile whose ratios_confirmed is 1 AND whose four numbers are all usable,
 * and that flag means exactly one thing: the user entered (or checked) their own
 * carb ratios and correction factor and ticked "I set these ratios with my
 * diabetes team". Stored numbers alone never qualify. The v27 migration cleared
 * the old flag for everyone, so no earlier meaning of it survives.
 */

/** Per-profile AsyncStorage flag base: set the moment the ratios sheet is first
 *  offered, so it opens by itself a single time and never nags afterwards. The
 *  user reaches it from the "Enter your ratios" / "Confirm your ratios" line.
 *  Listed in lib/profileScopedKeys.ts so deleting a profile sweeps it. */
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
 * What older builds wrote on their own, per field GROUP: the three meal ratios
 * (10/12/12 from the schema defaults, 10/10/10 from the old sheet's Save) and
 * the correction factor (40). Used ONLY to recognise a group as "the user never
 * entered this" (it then opens empty); never read as a ratio by a calculation.
 * Groups are judged separately, so a user's own 8/9/11 next to a stored 40 keeps
 * the ratios and blanks only the factor.
 */
const UNENTERED_CARB_TRIPLETS: readonly (readonly [number, number, number])[] = [
  [10, 12, 12],
  [10, 10, 10],
];
const UNENTERED_ISF_MGDL = 40;

export interface CalcSetupProfile {
  insulin_mode: InsulinMode;
  carb_ratio_breakfast: number;
  carb_ratio_lunch: number;
  carb_ratio_dinner: number;
  insulin_sensitivity_factor: number;
  ratios_confirmed: number;
}

type RatioProfile = Omit<CalcSetupProfile, "insulin_mode">;

export function usable(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

function allUsable(p: RatioProfile): boolean {
  return (
    usable(p.carb_ratio_breakfast) &&
    usable(p.carb_ratio_lunch) &&
    usable(p.carb_ratio_dinner) &&
    usable(p.insulin_sensitivity_factor)
  );
}

/**
 * The single gate for every unit figure ("Calculated total", the meal and
 * correction lines, any dose number derived from a ratio). True only for a
 * profile whose owner confirmed their own ratios AND whose four numbers can all
 * be divided by, so the arithmetic is never reached with a zero or a gap.
 */
export function calcFiguresAllowed(
  profile: RatioProfile | null | undefined
): boolean {
  return !!profile && profile.ratios_confirmed === 1 && allUsable(profile);
}

/** Which groups of an UNCONFIRMED profile hold only what older builds wrote. */
export function unenteredGroups(profile: RatioProfile | null | undefined): {
  carbs: boolean;
  isf: boolean;
} {
  if (!profile || profile.ratios_confirmed === 1) return { carbs: false, isf: false };
  const carbs = UNENTERED_CARB_TRIPLETS.some(
    ([b, l, d]) =>
      profile.carb_ratio_breakfast === b &&
      profile.carb_ratio_lunch === l &&
      profile.carb_ratio_dinner === d
  );
  return { carbs, isf: profile.insulin_sensitivity_factor === UNENTERED_ISF_MGDL };
}

export interface RatioFields {
  breakfast: number | null;
  lunch: number | null;
  dinner: number | null;
  /** mg/dL */
  isfMgdl: number | null;
}

export interface RatioSet {
  breakfast: number;
  lunch: number;
  dinner: number;
  /** mg/dL */
  isfMgdl: number;
}

/** What the entry fields open with: the stored value when it is the user's own
 *  and usable, otherwise empty (null). Never a suggested number. */
export function ratioFieldsInitial(profile: RatioProfile | null | undefined): RatioFields {
  if (!profile) return { breakfast: null, lunch: null, dinner: null, isfMgdl: null };
  const g = unenteredGroups(profile);
  const pick = (v: number, blank: boolean) => (!blank && usable(v) ? v : null);
  return {
    breakfast: pick(profile.carb_ratio_breakfast, g.carbs),
    lunch: pick(profile.carb_ratio_lunch, g.carbs),
    dinner: pick(profile.carb_ratio_dinner, g.carbs),
    isfMgdl: pick(profile.insulin_sensitivity_factor, g.isf),
  };
}

export function ratioFieldsComplete(f: RatioFields): f is RatioSet {
  return usable(f.breakfast) && usable(f.lunch) && usable(f.dinner) && usable(f.isfMgdl);
}

/** True when the sheet can open with all four of the user's own values filled
 *  in, so it only has to ask for the confirmation. */
export function calcSetupPrefilled(profile: RatioProfile | null | undefined): boolean {
  return ratioFieldsComplete(ratioFieldsInitial(profile));
}

/**
 * True when the profile uses mealtime insulin but has no confirmed ratios of
 * its own (or a confirmed one that cannot be divided by). A profile that takes
 * no mealtime insulin never sees the dose section, so it is never asked.
 */
export function calcSetupNeeded(profile: CalcSetupProfile | null | undefined): boolean {
  if (!profile) return false;
  if (!insulinModeShowsBolus(profile.insulin_mode)) return false;
  return !calcFiguresAllowed(profile);
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

export interface CalcSetupPatch {
  carb_ratio_breakfast: number;
  carb_ratio_lunch: number;
  carb_ratio_dinner: number;
  insulin_sensitivity_factor: number;
  ratios_confirmed: 0 | 1;
}

/**
 * What the sheet's "Save" writes: the four values exactly as the user saw them
 * (three meal ratios, then the correction factor). ratios_confirmed is 1 only
 * when the box was ticked; the numbers can be saved without it, but then no
 * figure appears. Null when any value cannot be used, so a bad entry never
 * reaches the profile.
 */
export function calcSetupPatch(input: {
  fields: RatioFields;
  confirmed: boolean;
}): CalcSetupPatch | null {
  const f = input.fields;
  if (!ratioFieldsComplete(f)) return null;
  return {
    carb_ratio_breakfast: f.breakfast,
    carb_ratio_lunch: f.lunch,
    carb_ratio_dinner: f.dinner,
    insulin_sensitivity_factor: f.isfMgdl,
    ratios_confirmed: input.confirmed ? 1 : 0,
  };
}

const EPS = 1e-6;

function sameSet(profile: RatioProfile, f: RatioSet): boolean {
  return (
    Math.abs(profile.carb_ratio_breakfast - f.breakfast) < EPS &&
    Math.abs(profile.carb_ratio_lunch - f.lunch) < EPS &&
    Math.abs(profile.carb_ratio_dinner - f.dinner) < EPS &&
    Math.abs(profile.insulin_sensitivity_factor - f.isfMgdl) < EPS
  );
}

/**
 * Profile and Targets saves the four numbers as one set, once all four are
 * filled. A set that differs from what is stored is a new set: the confirmation
 * is withdrawn (ratios_confirmed 0) and the user ticks the box again. Typing the
 * same numbers back changes nothing, so a confirmed profile stays confirmed.
 * Null when a value is missing or unusable, or when nothing differs.
 */
export function ratioSetPatch(
  profile: RatioProfile | null | undefined,
  draft: RatioFields
): (Omit<CalcSetupPatch, "ratios_confirmed"> & { ratios_confirmed: 0 }) | null {
  if (!profile || !ratioFieldsComplete(draft)) return null;
  if (sameSet(profile, draft)) return null;
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
  profile: RatioProfile | null | undefined,
  draft: RatioFields
): boolean {
  if (!profile || !ratioFieldsComplete(draft)) return false;
  return sameSet(profile, draft);
}

/** The box in Profile and Targets. Ticking confirms the stored set (null when
 *  any stored number cannot be divided by); unticking withdraws it. */
export function ratioConfirmPatch(
  profile: RatioProfile | null | undefined,
  checked: boolean
): { ratios_confirmed: 0 | 1 } | null {
  if (!profile) return null;
  if (!checked) return { ratios_confirmed: 0 };
  if (!allUsable(profile)) return null;
  return { ratios_confirmed: 1 };
}
