/**
 * What the calculator writes when a saved meal is edited, and how its bolus
 * row's write is reported. Pure: the screen runs the plan against the database.
 */

export interface BolusRowSnapshot {
  id: string;
  dose_units: number | null;
  logged_at: string;
  insulin_type: string | null;
}

export type BolusStep =
  | { kind: "none" }
  | { kind: "create"; dose: number }
  | { kind: "update"; id: string; patch: { dose_units?: number; logged_at?: string; insulin_type?: "bolus" } }
  | { kind: "delete"; id: string };

export interface MealEditPlanInput {
  /** Insulin mode has a mealtime dose. False: dose and the bolus are not this screen's to change. */
  showsDose: boolean;
  dose: number;
  /** The dose the editor opened with (prefillDose). */
  prefilledDose: number;
  mealStored: { insulin_dose_units: number; logged_at: string };
  bolus: BolusRowSnapshot | null;
  loggedAtIso: string;
  /** The user moved the time picker off what it opened with. */
  loggedAtChanged: boolean;
}

export interface MealEditPlan {
  mealPatch: { insulin_dose_units?: number; logged_at?: string };
  bolus: BolusStep;
}

/** The bolus row is the truth for the dose: the Injection tab edits it without touching the meal row. */
export function prefillDose(mealDose: number, bolus: BolusRowSnapshot | null): number {
  return bolus && bolus.dose_units != null ? bolus.dose_units : mealDose;
}

export function mealEditPlan(input: MealEditPlanInput): MealEditPlan {
  const { showsDose, dose, prefilledDose, mealStored, bolus, loggedAtIso, loggedAtChanged } = input;
  const mealPatch: MealEditPlan["mealPatch"] = {};
  if (loggedAtChanged) mealPatch.logged_at = loggedAtIso;
  if (!showsDose) return { mealPatch, bolus: { kind: "none" } };

  if (dose !== mealStored.insulin_dose_units) mealPatch.insulin_dose_units = dose;

  if (dose > 0) {
    if (!bolus) return { mealPatch, bolus: { kind: "create", dose } };
    const patch: { dose_units?: number; logged_at?: string; insulin_type?: "bolus" } = {};
    if (dose !== prefilledDose) patch.dose_units = dose;
    if (loggedAtChanged) patch.logged_at = loggedAtIso;
    if (bolus.insulin_type !== "bolus") patch.insulin_type = "bolus";
    return { mealPatch, bolus: { kind: "update", id: bolus.id, patch } };
  }
  if (bolus && dose !== prefilledDose) return { mealPatch, bolus: { kind: "delete", id: bolus.id } };
  return { mealPatch, bolus: { kind: "none" } };
}

export type BolusWriteResult = { ok: true } | { ok: false; error: unknown };

export async function writeBolusRow(write: () => Promise<unknown>): Promise<BolusWriteResult> {
  try {
    await write();
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

export type SavedToastKey =
  | "bolusSaveFailed"
  | "autoInjection"
  | "autoInjectionNoSite"
  | "autoGlucose"
  | "savedRecord";

/** A dose that was wanted but whose row did not land is never reported as a plain save. */
export function savedToastKey(s: {
  doseWanted: boolean;
  wroteInjection: boolean;
  hasSite: boolean;
  createdReading: boolean;
}): SavedToastKey {
  if (s.doseWanted && !s.wroteInjection) return "bolusSaveFailed";
  if (s.wroteInjection) return s.hasSite ? "autoInjection" : "autoInjectionNoSite";
  return s.createdReading ? "autoGlucose" : "savedRecord";
}
