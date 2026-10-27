import type { CgmMode } from "./cgm/state";
import type { DiabetesType } from "./db/types";

/**
 * Which screens onboarding shows, decided in one place and kept pure so
 * scripts/onboardingSteps.test.ts can pin the length and order of every path
 * under plain Node (same reason lib/revealPlan.ts and lib/reminderPresets.ts
 * are pure). app/onboarding.tsx owns the rendering and the writes; this owns
 * only "which steps, in what order" and the two analytics payloads.
 *
 * The quiz used to be 13 screens for an insulin user (14 with pills): the
 * carb ratio, ISF and basal time had a screen each, and the widget preview and
 * the notification prompt were separate screens. Those numbers are now asked
 * where they are first needed (the calculator, lib/calcSetup.ts) or inside the
 * reminder step, and the OS permission is raised by the reminder step itself
 * once the user picks a plan.
 */

export const DIABETES_OPTIONS = [
  "type1",
  "type2",
  "gestational",
  "prediabetes",
  "none",
  "other",
] as const;
export type DiabetesOption = (typeof DIABETES_OPTIONS)[number];

/** Insulin and oral medication are two independent flags on the profile, so
 *  these four answers are just the four combinations of them. */
export const TREATMENT_OPTIONS = ["insulin", "pills", "both", "none"] as const;
export type TreatmentOption = (typeof TREATMENT_OPTIONS)[number];

/** How the person gets their readings: by hand (the default), from a sensor
 *  through the platform health store, or from Nightscout. */
export const MEASURE_OPTIONS = ["finger", "cgm", "nightscout"] as const;
export type MeasureOption = (typeof MEASURE_OPTIONS)[number];
export const DEFAULT_MEASURE: MeasureOption = "finger";

/** The answers this build and device can honour: cgm needs a health store,
 *  nightscout needs the connector (lib/cgm/sourceAvailability.ts). */
export function measureOptionsFor(avail: {
  hasHealth: boolean;
  nightscout: boolean;
}): MeasureOption[] {
  return MEASURE_OPTIONS.filter((o) =>
    o === "cgm" ? avail.hasHealth : o === "nightscout" ? avail.nightscout : true
  );
}

/** Nightscout is a Pro source (lib/cgm/pro.ts nightscoutAllowed). */
export function measureNeedsPro(m: MeasureOption): boolean {
  return m === "nightscout";
}

/** The mode to store for an answer; null for the finger prick, which is the
 *  profile's default and writes nothing. */
export function measureModeToWrite(m: MeasureOption): CgmMode | null {
  return m === "finger" ? null : m;
}

/** Sensor modes bring their own readings, so the measurement reminder plan is
 *  not offered. Meal and medication reminders are unaffected. */
export function skipsMeasurementReminders(m: MeasureOption): boolean {
  return m !== "finger";
}

/** Nightscout is connected after onboarding, in Settings > Data sources. */
export function nightscoutHandoff(m: MeasureOption): boolean {
  return m === "nightscout";
}

/** A refused Health permission puts the person back on the finger prick;
 *  `fellBack` tells the screen to say so. */
export function measureAfterPermission(
  picked: MeasureOption,
  granted: boolean
): { measure: MeasureOption; fellBack: boolean } {
  if (picked === "cgm" && !granted) return { measure: "finger", fellBack: true };
  return { measure: picked, fellBack: false };
}

export type OnboardingStepId =
  | "analytics"
  | "name"
  | "unit"
  | "diabetes"
  | "insulin"
  | "pillsOnly"
  | "measure"
  | "targets"
  | "insulinProducts"
  | "medReminder"
  | "reminderPlan";

export type OnboardingPhase = "welcome" | "quiz" | "reveal";
export type OnboardingPath = "insulin" | "pills" | "none";

/** The fixed head of the quiz; everything after it branches on the answers. */
export const BASE_STEPS: readonly OnboardingStepId[] = ["analytics", "name", "unit", "diabetes"];

/** Screens a user can walk past with no write and no answer. */
export const OPTIONAL_STEPS: readonly OnboardingStepId[] = ["insulinProducts", "medReminder"];

/** "other" (prefer not to say) and a skipped question both land on the DB's
 *  "unknown" type, the one non-answer this quiz can produce. */
export function diabetesTypeOf(opt: DiabetesOption | null): DiabetesType {
  return opt == null || opt === "other" ? "unknown" : opt;
}

export interface OnboardingAnswers {
  diabetes: DiabetesOption | null;
  treatment: TreatmentOption | null;
  /** The undiagnosed path's own question, kept apart from `treatment` so
   *  switching the diabetes answer never mixes the two. */
  pillsOnly: boolean | null;
}

export interface OnboardingFlags {
  /** "none" and "prediabetes" swap the four-way treatment question for a
   *  two-option pill question and force insulin off. */
  isTwoWayTreatment: boolean;
  /** Re-derived on every call instead of trusting the raw `treatment`: an
   *  answer picked before backing up and switching to a two-way diabetes type
   *  must not leak into the profile. */
  effectiveTreatment: TreatmentOption | null;
  hasInsulin: boolean;
  hasOralMeds: boolean;
  path: OnboardingPath;
}

export function onboardingFlags(a: OnboardingAnswers): OnboardingFlags {
  const isTwoWayTreatment = a.diabetes === "none" || a.diabetes === "prediabetes";
  const effectiveTreatment: TreatmentOption | null = isTwoWayTreatment ? "none" : a.treatment;
  const hasInsulin = effectiveTreatment === "insulin" || effectiveTreatment === "both";
  const hasOralMeds = isTwoWayTreatment
    ? a.pillsOnly === true
    : effectiveTreatment === "pills" || effectiveTreatment === "both";
  const path: OnboardingPath = hasInsulin ? "insulin" : hasOralMeds ? "pills" : "none";
  return { isTwoWayTreatment, effectiveTreatment, hasInsulin, hasOralMeds, path };
}

/**
 * The quiz, in order. reminderPlan sits last on every path: setting it up
 * raises the OS permission prompts, and that must come after the user has seen
 * what the reminders are. The disclaimer is no longer a step: it lives on the
 * reveal screen, so the quiz is one screen shorter and the reveal index in
 * onboarding_step moves down by one with it (the step names are free strings).
 */
export function buildOnboardingSteps(
  flags: Pick<OnboardingFlags, "isTwoWayTreatment" | "hasInsulin" | "hasOralMeds"> & {
    measure?: MeasureOption;
  }
): OnboardingStepId[] {
  const steps: OnboardingStepId[] = [
    ...BASE_STEPS,
    flags.isTwoWayTreatment ? "pillsOnly" : "insulin",
    "measure",
    "targets",
  ];
  if (flags.hasInsulin) steps.push("insulinProducts");
  if (flags.hasOralMeds) steps.push("medReminder");
  // The step also carries the night insulin reminder, so a sensor mode drops it
  // only for someone with no insulin.
  if (!skipsMeasurementReminders(flags.measure ?? DEFAULT_MEASURE) || flags.hasInsulin) {
    steps.push("reminderPlan");
  }
  return steps;
}

/** Screens that cannot be walked past without an answer or an accept. */
export function requiredScreenCount(steps: readonly OnboardingStepId[]): number {
  return steps.filter((s) => !OPTIONAL_STEPS.includes(s)).length;
}

// A type alias, not an interface: logEvent takes a Record<string, ...>, and only
// an alias gets the implicit index signature that makes this assignable to it.
export type OnboardingStepEvent = {
  step: string;
  index: number;
};

/**
 * The treatment question is "insulin" for most diabetes answers and "pillsOnly"
 * for none and prediabetes. Which of the two a device saw says what it
 * answered one screen earlier, so both report under one name.
 */
const REPORTED_NAME: Partial<Record<OnboardingStepId, string>> = {
  insulin: "treatment",
  pillsOnly: "treatment",
};

/**
 * onboarding_step payload, built so that no path can be told from another:
 * which treatment someone uses is health information, and a usage metric has
 * no business holding it. `index` counts only the screens every path shows
 * (OPTIONAL_STEPS are left out), 1-based, with welcome = 0 and reveal = that
 * count + 1, so it grows monotonically along the funnel and is the same number
 * on every path. An optional screen exists on some paths only, so it reports
 * as the screen before it and adds no event of its own.
 */
export function onboardingStepEvent(
  phase: OnboardingPhase,
  step: OnboardingStepId,
  steps: readonly OnboardingStepId[]
): OnboardingStepEvent {
  if (phase === "welcome") return { step: "welcome", index: 0 };
  // A skipped plan step still takes its place in the numbering, so the reveal
  // is the same number whether or not a sensor mode dropped that screen.
  if (phase === "reveal") {
    const skippedPlan = steps.includes("reminderPlan") ? 0 : 1;
    return { step: "reveal", index: requiredScreenCount(steps) + skippedPlan + 1 };
  }
  let at = steps.indexOf(step);
  if (at === -1) return { step, index: 0 };
  while (at > 0 && OPTIONAL_STEPS.includes(steps[at])) at--;
  const shown = steps[at];
  return {
    step: REPORTED_NAME[shown] ?? shown,
    index: requiredScreenCount(steps.slice(0, at + 1)),
  };
}

export type OnboardingDoneEvent = Record<string, never>;

/**
 * onboarding_done payload: empty. It once carried the path (insulin, pills or
 * neither) and then the screen count, which is the same thing (7, 8 or 9
 * screens, depending on the two optional ones). The steps are not read; the
 * parameter stays so the call in app/onboarding.tsx keeps compiling.
 */
export function onboardingDoneEvent(
  _steps?: readonly OnboardingStepId[]
): OnboardingDoneEvent {
  return {};
}

export interface PlanSetupInput {
  /** Glucose lines still on the preview (the user can remove any of them). */
  glucoseRows: number;
  hasInsulin: boolean;
  /** The user picked the basal reminder row in the plan step. */
  basalSelected: boolean;
  /** A basal row was already written by an earlier "Set up this plan" tap. */
  basalInstalled: boolean;
}

export interface PlanSetupDecision {
  /** Whether the primary "Set up this plan" action has anything to write. */
  canSetUp: boolean;
  /** The basal reminder as it will stand after the action. */
  wantBasal: boolean;
  /** What to do to the basal row: a plan the user pruned after an earlier tap
   *  must turn the row they no longer want off, not leave it armed. */
  basal: "enable" | "disable" | "keep";
}

export function planSetupDecision(i: PlanSetupInput): PlanSetupDecision {
  const wantBasal = i.hasInsulin && i.basalSelected;
  return {
    canSetUp: i.glucoseRows > 0 || wantBasal,
    wantBasal,
    basal: wantBasal ? "enable" : i.basalInstalled ? "disable" : "keep",
  };
}

/**
 * Whether the basal reminder stands once onboarding finishes. All three must
 * hold: an insulin path, a row the user still has picked, and a row that
 * "Set up this plan" really wrote. A row picked and then walked past with
 * "Not now" was never written and never asked for a permission, so it does not
 * come into being at the last screen; a row written and then un-picked is
 * switched off.
 */
export function basalReminderOnAtFinish(i: {
  hasInsulin: boolean;
  basalSelected: boolean;
  basalInstalled: boolean;
}): boolean {
  return i.hasInsulin && i.basalSelected && i.basalInstalled;
}
