/**
 * Pure state machine of the paywall's purchase button, and the label rule of its
 * CTA. No store call lives here: app/paywall.tsx runs the purchase and feeds
 * the outcome in, this only says what the button may do and show.
 *
 *   idle --press--> purchasing --success--> done --settled--> idle
 *                              --cancelled--> idle        (silent)
 *                              --failed-----> failed      (short message, retry)
 *   failed --press--> purchasing (same plan stays selected)
 *   idle|failed --restoreStart--> restoring --settled--> idle
 *
 * A press, or a restore, while anything is in flight changes nothing: that is
 * the double-tap guard, and "busy" is also what blocks a user close.
 */

export type PurchaseUiState = "idle" | "purchasing" | "restoring" | "failed" | "done";

export type PurchaseUiEvent =
  | "press"
  | "success"
  | "cancelled"
  | "failed"
  | "restoreStart"
  | "planChanged"
  | "settled";

export function purchaseUiReduce(state: PurchaseUiState, event: PurchaseUiEvent): PurchaseUiState {
  switch (event) {
    case "press":
      return state === "idle" || state === "failed" ? "purchasing" : state;
    case "restoreStart":
      return state === "idle" || state === "failed" ? "restoring" : state;
    case "success":
      return state === "purchasing" ? "done" : state;
    case "cancelled":
      return state === "purchasing" ? "idle" : state;
    case "failed":
      return state === "purchasing" ? "failed" : state;
    case "planChanged":
      return state === "failed" ? "idle" : state;
    case "settled":
      return state === "done" || state === "restoring" || state === "purchasing" ? "idle" : state;
  }
}

/** Anything in flight: the button is disabled and a user close is ignored. */
export function purchaseUiBusy(state: PurchaseUiState): boolean {
  return state === "purchasing" || state === "restoring" || state === "done";
}

/** Whether a press is accepted right now (the very first line of buy()). */
export function purchaseUiAcceptsPress(state: PurchaseUiState): boolean {
  return state === "idle" || state === "failed";
}

export type PurchaseOutcomeLike = { ok: boolean; cancelled?: boolean };

/** Which event a finished store call is. A cancel is never a failure. */
export function purchaseOutcomeEvent(res: PurchaseOutcomeLike): "success" | "cancelled" | "failed" {
  if (res.ok) return "success";
  return res.cancelled ? "cancelled" : "failed";
}

/** What the screen does with each outcome, as data the test can pin. */
export interface PurchaseOutcomePlan {
  /** A short message is shown (success / already-owned / store error). */
  toast: boolean;
  /** The existing downsell gate runs (a cancelled purchase is an exit). */
  runDownsellGate: boolean;
  /** The paywall closes and the Pro welcome opens. */
  openWelcome: boolean;
}

export function purchaseOutcomePlan(res: PurchaseOutcomeLike): PurchaseOutcomePlan {
  const event = purchaseOutcomeEvent(res);
  return {
    toast: event !== "cancelled",
    runDownsellGate: event === "cancelled",
    openWelcome: event === "success",
  };
}

export type PaywallPlan = "monthly" | "annual" | "lifetime";

/** Which template the pinned CTA uses. */
export type PaywallCtaKind = "retry" | "trial" | "annual" | "monthly" | "lifetime" | "generic";

/**
 * The CTA follows the SELECTED plan: a trial label only for the annual plan
 * with a store-reported trial, the price-carrying templates only when the store
 * gave that plan a price (a missing price never renders as an empty hole), and
 * "try again" after a failed purchase until the next press or plan change.
 */
export function paywallCtaKind(i: {
  plan: PaywallPlan;
  annualTrial: boolean;
  hasPrice: boolean;
  failed: boolean;
}): PaywallCtaKind {
  if (i.failed) return "retry";
  if (i.plan === "annual" && i.annualTrial) return "trial";
  if (!i.hasPrice) return "generic";
  return i.plan;
}

/** The trial timeline shows for the annual plan with a trial, and only then. */
export function showTrialTimeline(plan: PaywallPlan, annualTrial: boolean): boolean {
  return plan === "annual" && annualTrial;
}

/**
 * Whether a finished purchase opens the Pro welcome. A new purchase or trial
 * always does; a recovered (already owned) purchase keeps the earlier rule and
 * only opens it when a step is still open.
 */
export function shouldOpenWelcomeAfterPurchase(i: {
  recovered: boolean;
  stepsLeft: boolean;
}): boolean {
  return !i.recovered || i.stepsLeft;
}
