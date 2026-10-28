import type { PurchaseOutcome } from "./purchases";

export interface PurchaseToast {
  /** i18n key for the message. */
  key: string;
  kind: "success" | "info" | "error";
}

/**
 * Maps a purchase outcome to the toast the user should see, shared by the
 * paywall, downsell and winback so the feedback is identical everywhere and no
 * path is ever silent:
 * - success: normal activation, or an already-owned recovery ("already yours").
 * - store error: an honest generic message (never a silent stay).
 * - cancel: null, the caller decides (route to downsell, or just dismiss).
 * - pending (Ask to Buy, a pending Play payment): an info message, never an
 *   error; Pro opens by itself once the payment is approved.
 */
export function purchaseToastFor(outcome: PurchaseOutcome): PurchaseToast | null {
  if (outcome.ok) {
    return outcome.recovered
      ? { key: "paywall.alreadyOwned", kind: "success" }
      : { key: "paywall.activated", kind: "success" };
  }
  if (outcome.cancelled) return null;
  if (outcome.error === "pending") return { key: "purchasePending.toast", kind: "info" };
  return { key: "paywall.purchaseError", kind: "error" };
}
