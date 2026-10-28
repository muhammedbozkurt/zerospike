/**
 * The paywall's purchase and restore flow, with every side effect injected, so
 * the ordering that protects a payment is a tested property instead of a
 * convention in a screen:
 *
 * - a press is refused while an exit decision holds the lock, and while anything
 *   is in flight (the double-tap guard is the first statement);
 * - a purchase that starts makes any pending exit decision navigate nowhere;
 * - a cancelled store sheet is silent and only the downsell gate may leave;
 * - a successful purchase stays `done` (spinner, CTA locked) until the screen
 *   is gone, so the welcome transition cannot be double-fired;
 * - a failure toasts once and leaves the same plan selected for a retry;
 * - a payment the store holds for approval (Ask to Buy) is not a failure: one
 *   info message, no retry, and the later approval is settled by the app root.
 *
 * The screen (app/paywall.tsx) supplies the side effects; lib/paywallPurchase
 * supplies the state machine and the outcome plan.
 */
import {
  purchaseOutcomePlan,
  purchaseUiAcceptsPress,
  purchaseUiBusy,
  purchaseUiReduce,
  type PaywallPlan,
  type PurchaseOutcomeLike,
  type PurchaseUiEvent,
  type PurchaseUiState,
} from "./paywallPurchase";

export interface PurchaseFlowDeps<R extends PurchaseOutcomeLike> {
  /** An exit decision (close or cancel) holds the lock. */
  isExiting(): boolean;
  /** A purchase is starting: a pending exit decision must not navigate. */
  abandonPendingExit(): void;
  purchase(plan: PaywallPlan): Promise<R>;
  refreshPro(): Promise<void>;
  /** Analytics at the press. */
  onPress(plan: PaywallPlan): void;
  /** Analytics for the store's answer. */
  onResult(plan: PaywallPlan, res: R): void;
  /** Paid: entitlement bookkeeping, message, and the Pro welcome. */
  onSuccess(plan: PaywallPlan, res: R): Promise<void>;
  /** The store sheet was cancelled: runs the downsell gate; may navigate. */
  onCancelled(plan: PaywallPlan): Promise<void>;
  /** The store holds the payment for approval: one info message. */
  onPending(plan: PaywallPlan, res: R): void;
  /** A real failure: one short message. `res` is null for a thrown error. */
  onFailed(plan: PaywallPlan, res: R | null, err?: unknown): void;
  /** Something threw AFTER the purchase went through (settle, navigation). */
  onPostPurchaseError(err: unknown): void;
  onState(state: PurchaseUiState): void;
}

export function createPurchaseFlow<R extends PurchaseOutcomeLike>(deps: PurchaseFlowDeps<R>) {
  let state: PurchaseUiState = "idle";

  function dispatch(event: PurchaseUiEvent): PurchaseUiState {
    state = purchaseUiReduce(state, event);
    deps.onState(state);
    return state;
  }

  return {
    getState: () => state,
    /** In flight (or done): the button is disabled and a user close is ignored. */
    isBusy: () => purchaseUiBusy(state),
    planChanged: () => void dispatch("planChanged"),

    async buy(plan: PaywallPlan): Promise<"ignored" | "ran"> {
      // First statements, all synchronous: nothing below runs for a refused press.
      if (deps.isExiting() || !purchaseUiAcceptsPress(state)) return "ignored";
      dispatch("press");
      deps.abandonPendingExit();
      let last: PurchaseUiEvent = "settled";
      try {
        deps.onPress(plan);
        const res = await deps.purchase(plan);
        await deps.refreshPro();
        deps.onResult(plan, res);
        const outcome = purchaseOutcomePlan(res);
        if (outcome.openWelcome) {
          dispatch("success");
          await deps.onSuccess(plan, res);
        } else if (outcome.runDownsellGate) {
          // Held busy through the gate lookup, released after it.
          last = "cancelled";
          await deps.onCancelled(plan);
        } else if (outcome.awaitApproval) {
          last = "pending";
          deps.onPending(plan, res);
        } else {
          last = "failed";
          deps.onFailed(plan, res);
        }
      } catch (err) {
        if (state === "done" || last === "cancelled") {
          // The store already answered (paid, or cancelled): a throw from the
          // follow-up work is not a purchase failure and shows no error.
          deps.onPostPurchaseError(err);
        } else {
          last = "failed";
          deps.onFailed(plan, null, err);
        }
      } finally {
        // `done` stays until the screen is gone: the spinner holds and the CTA
        // stays locked through the welcome transition (unmount resets it).
        if (state !== "done") {
          dispatch(last);
          // A pending payment keeps its own state (the CTA waits); anything
          // else settles back to idle.
          if (last !== "settled" && last !== "pending") dispatch("settled");
        }
      }
      return "ran";
    },

    /** Restore shares the same guards; `run` carries the screen's own handling. */
    async restore(run: () => Promise<void>): Promise<"ignored" | "ran"> {
      if (deps.isExiting() || !purchaseUiAcceptsPress(state)) return "ignored";
      dispatch("restoreStart");
      try {
        await run();
      } finally {
        dispatch("settled");
      }
      return "ran";
    },
  };
}
