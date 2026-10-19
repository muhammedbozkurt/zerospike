import React, { useCallback, useEffect, useRef, useState } from "react";

import { useApp } from "../../lib/store/AppContext";
import { isScreenshotMode } from "../../lib/screenshotMode";
import { feedbackKv } from "../../lib/feedbackClient";
import {
  noteProState,
  onSurveyRelease,
  surveyHeld,
  surveyMayPresent,
  takePendingSurvey,
} from "../../lib/feedbackSurvey";
import { FeedbackSheet } from "./FeedbackSheet";

/**
 * Long enough for the store check that follows a cold start to settle (a cached
 * "Pro" that the store has already ended arrives as a late true to false), so
 * the survey is never shown on a stale answer.
 */
const SETTLE_MS = 2500;

/**
 * Mounted once under the root navigator. Notes the Pro state on every change
 * (arming the survey on a loss) and, once the screen is a tab screen and the
 * winback is out of the way, opens the one-time survey sheet. The asked flag is
 * written when the sheet opens, so it comes at most once per install.
 */
export function CancelSurveyHost({ root }: { root: string | undefined }) {
  const { ready, onboarded, isProUser } = useApp();
  const [visible, setVisible] = useState(false);
  const [tick, setTick] = useState(0);
  const latest = useRef({ ready, onboarded, isProUser, root });
  latest.current = { ready, onboarded, isProUser, root };

  useEffect(() => {
    if (!ready) return;
    void noteProState(feedbackKv, isProUser).then((armed) => {
      if (armed) setTick((n) => n + 1);
    });
  }, [ready, isProUser]);

  useEffect(() => onSurveyRelease(() => setTick((n) => n + 1)), []);

  useEffect(() => {
    if (!ready || !onboarded || isProUser || visible) return;
    const timer = setTimeout(() => {
      const s = latest.current;
      const gate = {
        ready: s.ready,
        onboarded: s.onboarded,
        isPro: s.isProUser,
        screenshotMode: isScreenshotMode(),
        root: s.root,
        winbackHold: surveyHeld(),
      };
      if (!surveyMayPresent(gate)) return;
      void takePendingSurvey(feedbackKv).then((due) => {
        if (due) setVisible(true);
      });
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [ready, onboarded, isProUser, root, tick, visible]);

  const close = useCallback(() => setVisible(false), []);

  return <FeedbackSheet visible={visible} mode="survey" onClose={close} />;
}
