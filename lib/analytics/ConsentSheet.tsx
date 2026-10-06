import React, { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { useTranslation } from "react-i18next";

import { SheetShell } from "../../components/SheetShell";
import { GradientCTA } from "../../components/rich/GradientCTA";
import { isScreenshotMode } from "../screenshotMode";
import { useApp } from "../store/AppContext";
import { THEME } from "../theme/tokens";
import { logCrash } from "./index";
import { shouldShowConsentSheet, type ConsentState } from "./consent";
import {
  getAnalyticsConsent,
  hasAnalyticsConsentPrompt,
  markAnalyticsConsentPrompted,
  setAnalyticsConsent,
} from "./optOut";

/** A beat after the dashboard has settled, so the sheet never lands on its first frame. */
const SHOW_DELAY_MS = 900;

/**
 * The dashboard's one-time usage-data question, for an install that predates
 * the opt-in (onboarding asks everyone else). It appears only when onboarding
 * is finished, no answer is on record and the question was never put to the
 * user; never in screenshot mode, and only while the dashboard itself is the
 * screen in front (a route pushed over it, like the alarm tour, keeps it away).
 *
 * "Turn on" records consent. "Not now", the close button, the backdrop and the
 * Android back key all leave the answer unanswered: the user can still turn it
 * on in Settings > Data, and the sheet does not come back, because the question
 * is marked as asked. If recording consent fails the sheet closes WITHOUT that
 * mark, so the next launch asks again instead of pretending it was answered.
 */
export function AnalyticsConsentSheet(): React.ReactElement {
  const { t } = useTranslation();
  const { ready, onboarded } = useApp();
  const [state, setState] = useState<ConsentState | null>(null);
  const [prompted, setPrompted] = useState<boolean | null>(null);
  const [focused, setFocused] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // This session is done with the question, whatever the storage says next.
  const [resolved, setResolved] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, [])
  );

  useEffect(() => {
    if (!ready || !onboarded) return;
    let alive = true;
    void Promise.all([getAnalyticsConsent(), hasAnalyticsConsentPrompt()]).then(
      ([consent, asked]) => {
        if (!alive) return;
        setState(consent);
        setPrompted(asked);
      }
    );
    return () => {
      alive = false;
    };
  }, [ready, onboarded]);

  const due =
    !resolved &&
    shouldShowConsentSheet({
      ready,
      onboarded,
      state,
      prompted,
      screenshotMode: isScreenshotMode(),
    });

  useEffect(() => {
    if (!due || !focused || open) return;
    const timer = setTimeout(() => setOpen(true), SHOW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [due, focused, open]);

  const answer = useCallback(
    async (grant: boolean) => {
      if (busy) return;
      setBusy(true);
      let recorded = true;
      if (grant) {
        try {
          await setAnalyticsConsent("granted");
        } catch (err) {
          recorded = false;
          logCrash(err, { screen: "dashboard", op: "analyticsConsent" });
        }
      }
      if (recorded) {
        try {
          await markAnalyticsConsentPrompted();
        } catch (err) {
          logCrash(err, { screen: "dashboard", op: "analyticsConsentPrompted" });
        }
      }
      setResolved(true);
      setOpen(false);
      setBusy(false);
    },
    [busy]
  );

  return (
    <SheetShell
      visible={open}
      onClose={() => void answer(false)}
      title={t("settings.analytics.sheetTitle")}
      closeLabel={t("common.close")}
      footer={
        <View style={{ gap: 8 }}>
          <GradientCTA
            label={t("settings.analytics.sheetAccept")}
            loading={busy}
            onPress={() => void answer(true)}
          />
          <GradientCTA
            variant="sub"
            label={t("settings.analytics.sheetDecline")}
            disabled={busy}
            onPress={() => void answer(false)}
          />
        </View>
      }
    >
      <Text style={{ color: THEME.ink, fontSize: 14, lineHeight: 21, marginTop: 4, marginBottom: 8 }}>
        {t("onboarding.analyticsConsentBody")}
      </Text>
    </SheetShell>
  );
}
