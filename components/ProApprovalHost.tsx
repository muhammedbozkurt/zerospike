import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "expo-router";
import { useApp } from "../lib/store/AppContext";
import {
  ackWelcomeShown,
  subscribePurchaseApproval,
  takeApprovedPurchase,
  welcomeOwed,
} from "../lib/services/purchases";
import { onSurveyRelease, overlayOpen, surveyHeld } from "../lib/feedbackSurvey";
import { onSheetRelease, sheetClaimed } from "../lib/sheetClaim";
import { scheduleTrialDay1Nudge, scheduleTrialEndingReminder } from "../lib/services/notifications";
import { getHealthSyncEnabled } from "../lib/services/health";
import { useHealthAvailable } from "../lib/services/healthAvailability";
import { approvalSettle, welcomeMayOpen } from "../lib/pendingApproval";
import { shouldScheduleTrialNudge } from "../lib/trialTimeline";
import { PAYWALL_VERSION } from "../lib/analytics/eventSchema";
import { logCrash, logEvent } from "../lib/analytics";

/**
 * Settles a payment that was held for approval once it turns into Pro: the
 * purchase and trial events, the trial's ending reminder, and the Pro welcome,
 * each exactly once (purchases.takeApprovedPurchase hands the purchase over a
 * single time). It rides the entitlement path the app already has: the approval
 * is noticed by whichever store read sees Pro first (RevenueCat's push, a
 * foreground refresh, the next launch), so it also works when the app was closed
 * between the request and the approval.
 */
export function ProApprovalHost({ root }: { root: string | undefined }) {
  const router = useRouter();
  const { activeProfile } = useApp();
  const healthAvailable = useHealthAvailable();
  const [welcomeQueued, setWelcomeQueued] = useState(false);
  const [tick, setTick] = useState(0);
  const profileId = activeProfile?.id;
  const latest = useRef({ profileId, healthAvailable });
  latest.current = { profileId, healthAvailable };

  const settle = useCallback(async () => {
    try {
      const approved = await takeApprovedPurchase();
      if (!approved) return;
      const plan = approvalSettle(approved, Date.now());
      logEvent("purchase_completed", { ...plan.completed, paywall_version: PAYWALL_VERSION });
      if (plan.trial.logTrialStarted) logEvent("trial_started", { tier: approved.plan });
      if (plan.trial.scheduleReminderAt !== null) {
        const days = plan.trial.trialDays ?? 0;
        try {
          await scheduleTrialEndingReminder(plan.trial.scheduleReminderAt);
          const connected = await getHealthSyncEnabled(latest.current.profileId);
          if (
            shouldScheduleTrialNudge({
              trialDays: days,
              healthAvailable: latest.current.healthAvailable,
              healthConnected: connected,
            })
          ) {
            await scheduleTrialDay1Nudge();
          }
        } catch (err) {
          logCrash(err, { screen: "proApproval", op: "trialReminder" });
        }
      }
      setWelcomeQueued(true);
    } catch (err) {
      logCrash(err, { screen: "proApproval", op: "settle" });
    }
  }, []);

  useEffect(() => {
    void settle();
    return subscribePurchaseApproval(() => void settle());
  }, [settle]);

  // An approval settled in an earlier run whose welcome never opened is still owed.
  useEffect(() => {
    let alive = true;
    void welcomeOwed().then((owed) => {
      if (alive && owed) setWelcomeQueued(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const wake = () => setTick((t) => t + 1);
    const offSheet = onSheetRelease(wake);
    const offOverlay = onSurveyRelease(wake);
    return () => {
      offSheet();
      offOverlay();
    };
  }, []);

  useEffect(() => {
    if (!welcomeQueued) return;
    if (
      !welcomeMayOpen({
        root,
        overlayOpen: overlayOpen(),
        sheetClaimed: sheetClaimed(),
        surveyHeld: surveyHeld(),
      })
    ) {
      return;
    }
    setWelcomeQueued(false);
    router.push("/pro-welcome");
    void ackWelcomeShown();
  }, [welcomeQueued, root, router, tick]);

  return null;
}
