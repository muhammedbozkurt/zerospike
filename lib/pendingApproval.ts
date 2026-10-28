/**
 * What the app does when a payment the store held for approval (Ask to Buy, a
 * pending Play payment) finally turns into Pro. Pure, so the decision is tested
 * on its own: purchases.ts hands over the approved purchase once
 * (takeApprovedPurchase), components/ProApprovalHost carries the result out.
 */
import { trialSettleAction, type TrialSettleAction, type TrialVerdict } from "./trialSettle";
import { isHomeRoute } from "./onboardingGate";
import { DEFAULT_TRIAL_DAYS } from "./trialTimeline";

export interface ApprovalSettle {
  /** Analytics: the purchase is complete now (it was not reported while pending). */
  completed: { tier: string; source: string };
  /** The trial's event and ending reminder, decided from the store's own expiry. */
  trial: TrialSettleAction;
}

export function approvalSettle(
  approved: { plan: string; trial: TrialVerdict },
  now: number
): ApprovalSettle {
  return {
    completed: { tier: approved.plan, source: "pending_approval" },
    trial: trialSettleAction({
      restored: false,
      trial: approved.trial,
      offerDays: DEFAULT_TRIAL_DAYS,
      now,
    }),
  };
}

/**
 * The welcome opens only on the app's home. On a paywall the sale closes first,
 * on SOS, the calculator, a scan or a tour it would land over something the
 * person is in the middle of, and during onboarding it waits for the dashboard.
 */
export function welcomeRouteReady(root: string | undefined): boolean {
  return isHomeRoute(root);
}
