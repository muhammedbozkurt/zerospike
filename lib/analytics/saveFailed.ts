import { logEvent } from "./index";

/**
 * Which entry failed to save and at which step, and nothing else: no value, no
 * message, no error text (G29). A save that loses a row is otherwise invisible,
 * because log_added only fires on success. The pair is a closed enum on the wire
 * (schema save_failed); consent is enforced by every sink like any other event.
 *
 * write: the row itself did not land. side: the row landed, a step after it did
 * not (reminder, template touch, remembered name, undo restore). schedule: the
 * row landed, the OS notification for it could not be scheduled.
 */
export type SaveFailedKind =
  | "glucose"
  | "meal"
  | "injection"
  | "med"
  | "reminder"
  | "profile"
  | "other";
export type SaveFailedStep = "write" | "side" | "schedule";

export function trackSaveFailed(kind: SaveFailedKind, step: SaveFailedStep): void {
  logEvent("save_failed", { kind, step });
}
