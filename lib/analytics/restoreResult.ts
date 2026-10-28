import { logEvent } from "./index";

export type RestoreOutcome = "restored" | "none" | "error" | "slow";

export function restoreResultOf(outcome: RestoreOutcome): "success" | "empty" | "error" {
  // "slow" (the store has not answered yet) is reported as an error: the closed
  // result set has no value for it and the funnel only needs to know it did not finish.
  return outcome === "restored" ? "success" : outcome === "none" ? "empty" : "error";
}

/** The paywall and Settings > Restore purchases log the same event the same way. */
export function logRestoreResult(outcome: RestoreOutcome): void {
  logEvent("restore_result", { result: restoreResultOf(outcome) });
}
