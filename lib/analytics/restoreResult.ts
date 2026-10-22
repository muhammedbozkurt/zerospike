import { logEvent } from "./index";

export type RestoreOutcome = "restored" | "none" | "error";

export function restoreResultOf(outcome: RestoreOutcome): "success" | "empty" | "error" {
  return outcome === "restored" ? "success" : outcome === "none" ? "empty" : "error";
}

/** The paywall and Settings > Restore purchases log the same event the same way. */
export function logRestoreResult(outcome: RestoreOutcome): void {
  logEvent("restore_result", { result: restoreResultOf(outcome) });
}
