import type { CgmMode } from "./cgm/state";
import { firstStepKindOf } from "./firstSync";

/**
 * What the dashboard's lead step shows and does, by mode. A manual profile keeps
 * the glucose step it always had (and it stays out of the compact setup row,
 * the first reading ends the first-run guide). A sensor profile leads with the
 * first sync: its tick is the remembered first-sync flag, its tap opens the
 * Health flow (cgm) or the data sources screen (nightscout). Pure, so
 * scripts/homeCgmLinks.test.ts runs it under plain Node.
 */
export type FirstStepAction = "quickAdd" | "health" | "dataSources";

export interface FirstStepPlan {
  labelKey: "dashboard.stepGlucose" | "dashboard.stepSync";
  action: FirstStepAction;
  /** undefined for a manual profile: the step has no completion state. */
  done: boolean | undefined;
  /** The compact "finish setup" row lists the step only on a sensor mode. */
  inSetupRow: boolean;
}

export function firstStepPlan(mode: CgmMode, syncDone: boolean): FirstStepPlan {
  if (firstStepKindOf(mode) === "log") {
    return {
      labelKey: "dashboard.stepGlucose",
      action: "quickAdd",
      done: undefined,
      inSetupRow: false,
    };
  }
  return {
    labelKey: "dashboard.stepSync",
    action: mode === "nightscout" ? "dataSources" : "health",
    done: syncDone,
    inSetupRow: true,
  };
}

/** How far back sensor days count toward the "days in a row" figure. */
export const STREAK_CGM_DAYS = 60;

export function cgmActivitySinceIso(nowMs: number): string {
  return new Date(nowMs - STREAK_CGM_DAYS * 86_400_000).toISOString();
}
