import type { InsulinMode, UserProfile } from "./db/types";

/**
 * What the onboarding insulin answer actually changes in the UI.
 *
 * Before v8 the answer was written to AsyncStorage and never read, so a user who
 * said "I do not use insulin" still got the full insulin apparatus: an Injection
 * tab, a dose calculator, an IOB line. That is not a neutral default - showing
 * dosing machinery to someone who does not dose implies they should. These
 * predicates are the single place that decides what is shown.
 *
 * Nothing here gates a CALCULATION; it only gates presentation. A profile that
 * later switches modes immediately sees the matching surfaces, and no logged
 * data is ever hidden or deleted by a mode change.
 */

/** The safe default for a profile with no answer recorded (pre-v8 behaviour). */
export const DEFAULT_INSULIN_MODE: InsulinMode = "both";

export function insulinModeOf(
  profile: Pick<UserProfile, "insulin_mode"> | null | undefined
): InsulinMode {
  const mode = profile?.insulin_mode;
  return mode === "basal" || mode === "bolus" || mode === "both" || mode === "none"
    ? mode
    : DEFAULT_INSULIN_MODE;
}

/** Any insulin at all: drives the Injection tab and injection reminders. */
export function insulinModeUsesInsulin(mode: InsulinMode | undefined): boolean {
  return insulinModeOf({ insulin_mode: mode as InsulinMode }) !== "none";
}

/** Mealtime (bolus) insulin: drives the dose estimate, IOB and stacking copy. */
export function insulinModeShowsBolus(mode: InsulinMode | undefined): boolean {
  const m = insulinModeOf({ insulin_mode: mode as InsulinMode });
  return m === "bolus" || m === "both";
}

/** Long-acting insulin: drives the nightly basal reminder settings. */
export function insulinModeShowsBasal(mode: InsulinMode | undefined): boolean {
  const m = insulinModeOf({ insulin_mode: mode as InsulinMode });
  return m === "basal" || m === "both";
}
