import type { GlucoseUnit, InsulinMode } from "./db/types";
import { glucoseToDisplay } from "./glucose";
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

export const CARB_RATIO_BOUNDS = { min: 1, max: 100 } as const;
/** ISF bounds in the profile's display unit. */
export const ISF_BOUNDS = {
  mgdl: { min: 1, max: 500 },
  mmol: { min: 0.1, max: 27.7 },
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
  if (!profile || profile.ratios_confirmed === 1 || profile.ratios_confirmed === RATIOS_ENTERED) {
    return { carbs: false, isf: false };
  }
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

/** What ratios_confirmed holds. 1 is the only value that opens the unit figure
 *  (calcFiguresAllowed). 2 marks numbers the user typed and saved but has not
 *  confirmed yet, so a set that happens to equal an older build's defaults
 *  (10/10/10 and 40) is still recognised as theirs. 0 is "never entered". */
export const RATIOS_ENTERED = 2 as const;

export interface RatioDraftPatch {
  carb_ratio_breakfast: number;
  carb_ratio_lunch: number;
  carb_ratio_dinner: number;
  insulin_sensitivity_factor: number;
  ratios_confirmed: 0 | 2;
}

function storedNumber(v: number | null): number {
  return usable(v) ? v : 0;
}

/** The flag an unconfirmed profile carries: "entered" when any of the four
 *  numbers is the user's own, otherwise "never entered". */
export function unconfirmedFlag(p: {
  carb_ratio_breakfast: number;
  carb_ratio_lunch: number;
  carb_ratio_dinner: number;
  insulin_sensitivity_factor: number;
}): 0 | 2 {
  return usable(p.carb_ratio_breakfast) ||
    usable(p.carb_ratio_lunch) ||
    usable(p.carb_ratio_dinner) ||
    usable(p.insulin_sensitivity_factor)
    ? RATIOS_ENTERED
    : 0;
}

const EPS = 1e-6;

/**
 * Two correction factors are the same when the field would show the same
 * number. A mmol/L screen shows one decimal, so 41 and 42 mg/dL both read 2.3
 * and typing "2.3" back must not look like a change (it would withdraw the
 * confirmation over rounding alone). mg/dL compares whole numbers.
 */
export function sameIsf(a: number, b: number, unit: GlucoseUnit): boolean {
  return glucoseToDisplay(a, unit) === glucoseToDisplay(b, unit);
}

function sameSet(profile: RatioProfile, f: RatioSet, unit: GlucoseUnit): boolean {
  return (
    Math.abs(profile.carb_ratio_breakfast - f.breakfast) < EPS &&
    Math.abs(profile.carb_ratio_lunch - f.lunch) < EPS &&
    Math.abs(profile.carb_ratio_dinner - f.dinner) < EPS &&
    sameIsf(profile.insulin_sensitivity_factor, f.isfMgdl, unit)
  );
}

function sameNumbers(profile: RatioProfile, next: RatioDraftPatch, unit: GlucoseUnit): boolean {
  return (
    Math.abs(profile.carb_ratio_breakfast - next.carb_ratio_breakfast) < EPS &&
    Math.abs(profile.carb_ratio_lunch - next.carb_ratio_lunch) < EPS &&
    Math.abs(profile.carb_ratio_dinner - next.carb_ratio_dinner) < EPS &&
    (next.insulin_sensitivity_factor === profile.insulin_sensitivity_factor ||
      (usable(next.insulin_sensitivity_factor) &&
        usable(profile.insulin_sensitivity_factor) &&
        sameIsf(profile.insulin_sensitivity_factor, next.insulin_sensitivity_factor, unit)))
  );
}

/**
 * What a draft of the four numbers writes to the profile, shared by the
 * calculator's sheet and Profile and Targets so both read and write the same
 * record. Every value the user filled is kept, even when the others are still
 * empty (an empty one is stored as 0, "not entered"), so three typed ratios are
 * still there when the user moves on. A changed set always leaves the
 * confirmation behind (ratios_confirmed is never 1 in a patch): the user ticks
 * the box again for the numbers on screen. Null when nothing differs.
 */
export function ratioDraftPatch(
  profile: RatioProfile | null | undefined,
  draft: RatioFields,
  unit: GlucoseUnit = "mgdl"
): RatioDraftPatch | null {
  if (!profile) return null;
  const next: RatioDraftPatch = {
    carb_ratio_breakfast: storedNumber(draft.breakfast),
    carb_ratio_lunch: storedNumber(draft.lunch),
    carb_ratio_dinner: storedNumber(draft.dinner),
    insulin_sensitivity_factor: storedNumber(draft.isfMgdl),
    ratios_confirmed: 0,
  };
  next.ratios_confirmed = unconfirmedFlag(next);
  if (sameNumbers(profile, next, unit)) {
    // The numbers are already stored. A set nobody had marked yet, typed back by
    // the user, is theirs from now on; a confirmed set stays confirmed.
    if (profile.ratios_confirmed === 0 && next.ratios_confirmed === RATIOS_ENTERED) {
      return {
        carb_ratio_breakfast: profile.carb_ratio_breakfast,
        carb_ratio_lunch: profile.carb_ratio_lunch,
        carb_ratio_dinner: profile.carb_ratio_dinner,
        insulin_sensitivity_factor: profile.insulin_sensitivity_factor,
        ratios_confirmed: RATIOS_ENTERED,
      };
    }
    return null;
  }
  return next;
}

/** True when the stored set is the draft (so ticking the box confirms exactly
 *  what is on screen). */
export function ratioSetMatchesStored(
  profile: RatioProfile | null | undefined,
  draft: RatioFields,
  unit: GlucoseUnit = "mgdl"
): boolean {
  if (!profile || !ratioFieldsComplete(draft)) return false;
  return sameSet(profile, draft, unit);
}

/** True when the draft differs from the stored set in any field. */
export function ratioDraftDiffers(
  profile: RatioProfile | null | undefined,
  draft: RatioFields,
  unit: GlucoseUnit = "mgdl"
): boolean {
  if (!profile) return false;
  const next = {
    carb_ratio_breakfast: storedNumber(draft.breakfast),
    carb_ratio_lunch: storedNumber(draft.lunch),
    carb_ratio_dinner: storedNumber(draft.dinner),
    insulin_sensitivity_factor: storedNumber(draft.isfMgdl),
    ratios_confirmed: 0 as const,
  };
  return !sameNumbers(profile, next, unit);
}

/**
 * Ticking the box with a draft on screen: the four numbers AND the flag in one
 * patch, so the confirmation can never be stored without the numbers it vouches
 * for (a failed number write used to leave the flag landing on the OLD set).
 * Null while any value cannot be divided by.
 */
export function ratioConfirmDraftPatch(draft: RatioFields): {
  carb_ratio_breakfast: number;
  carb_ratio_lunch: number;
  carb_ratio_dinner: number;
  insulin_sensitivity_factor: number;
  ratios_confirmed: 1;
} | null {
  if (!ratioFieldsComplete(draft)) return null;
  return {
    carb_ratio_breakfast: draft.breakfast,
    carb_ratio_lunch: draft.lunch,
    carb_ratio_dinner: draft.dinner,
    insulin_sensitivity_factor: draft.isfMgdl,
    ratios_confirmed: 1,
  };
}

/** The box. Ticking confirms the stored set (null when any stored number cannot
 *  be divided by); unticking withdraws the confirmation but keeps the numbers
 *  marked as the user's own. */
export function ratioConfirmPatch(
  profile: RatioProfile | null | undefined,
  checked: boolean
): { ratios_confirmed: 0 | 1 | 2 } | null {
  if (!profile) return null;
  if (!checked) return { ratios_confirmed: unconfirmedFlag(profile) };
  if (!allUsable(profile)) return null;
  return { ratios_confirmed: 1 };
}

/** True when two drafts hold the same four values. */
export function sameRatioDraft(a: RatioFields, b: RatioFields): boolean {
  return (
    a.breakfast === b.breakfast &&
    a.lunch === b.lunch &&
    a.dinner === b.dinner &&
    a.isfMgdl === b.isfMgdl
  );
}

/**
 * After the box was ticked: may the sheet show the tick and close? Only when the
 * write reached the profile AND the numbers on screen are still the ones that
 * were sent. A field edited while the write ran leaves the profile unconfirmed
 * (the edit withdraws the confirmation), so the sheet stays open, unticked.
 */
export function confirmStillCurrent(
  ok: boolean | undefined,
  sent: RatioFields,
  now: RatioFields
): boolean {
  return !!ok && sameRatioDraft(sent, now);
}
