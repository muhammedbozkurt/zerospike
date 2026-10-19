import React, { useCallback, useEffect, useRef, useState } from "react";

import { useApp } from "../../lib/store/AppContext";
import { isScreenshotMode } from "../../lib/screenshotMode";
import { feedbackKv } from "../../lib/feedbackClient";
import {
  markSurveyAsked,
  noteProState,
  onSurveyRelease,
  overlayOpen,
  peekPendingSurvey,
  surveyHeld,
  surveyMayPresent,
} from "../../lib/feedbackSurvey";
import { FeedbackSheet } from "./FeedbackSheet";

/**
 * Long enough for the store check that follows a cold start to settle (a cached
 * "Pro" that the store has already ended arrives as a late true to false), so
 * the survey is never shown on a stale answer.
 */
const SETTLE_MS = 2500;
/** A Modal that has not reported onShow by now was refused by the OS; try again later. */
const SHOW_TIMEOUT_MS = 4000;
const MAX_ATTEMPTS = 5;

/**
 * Mounted once under the root navigator. Notes the Pro state on every change
 * (arming the survey on a loss) and, once the screen is a tab screen, the
 * winback is out of the way and no other Modal is up, opens the one-time survey
 * sheet. The asked flag is written when the sheet is really on screen (onShow),
 * so a refused or interrupted presentation does not use up the one ask.
 */
export function CancelSurveyHost({ root }: { root: string | undefined }) {
  const { ready, onboarded, isProUser } = useApp();
  const [visible, setVisible] = useState(false);
  const [tick, setTick] = useState(0);
  const latest = useRef({ ready, onboarded, isProUser, root });
  latest.current = { ready, onboarded, isProUser, root };
  const shown = useRef(false);
  const attempts = useRef(0);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!ready) return;
    void noteProState(feedbackKv, isProUser).then((armed) => {
      if (armed) setTick((n) => n + 1);
    });
  }, [ready, isProUser]);

  useEffect(() => onSurveyRelease(() => setTick((n) => n + 1)), []);

  useEffect(
    () => () => {
      if (showTimer.current) clearTimeout(showTimer.current);
    },
    []
  );

  useEffect(() => {
    if (!ready || !onboarded || isProUser || visible) return;
    const mayNow = () => {
      const s = latest.current;
      return surveyMayPresent({
        ready: s.ready,
        onboarded: s.onboarded,
        isPro: s.isProUser,
        screenshotMode: isScreenshotMode(),
        root: s.root,
        winbackHold: surveyHeld(),
        overlayOpen: overlayOpen(),
      });
    };
    const timer = setTimeout(() => {
      if (!mayNow() || attempts.current >= MAX_ATTEMPTS) return;
      void peekPendingSurvey(feedbackKv).then((due) => {
        // The storage read took a moment: the screen may have changed meanwhile.
        if (!due || !mayNow()) return;
        attempts.current += 1;
        shown.current = false;
        setVisible(true);
        showTimer.current = setTimeout(() => {
          if (shown.current) return;
          setVisible(false);
          setTick((n) => n + 1);
        }, SHOW_TIMEOUT_MS);
      });
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [ready, onboarded, isProUser, root, tick, visible]);

  const onShown = useCallback(() => {
    shown.current = true;
    if (showTimer.current) clearTimeout(showTimer.current);
    void markSurveyAsked(feedbackKv);
  }, []);

  const close = useCallback(() => setVisible(false), []);

  return <FeedbackSheet visible={visible} mode="survey" onClose={close} onShown={onShown} />;
}
