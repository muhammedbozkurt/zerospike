import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Pressable, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { IconTile } from "./rich";
import { DirIcon } from "./DirIcon";
import { THEME } from "../lib/theme/tokens";
import { logCrash } from "../lib/analytics";
import { useApp } from "../lib/store/AppContext";
import { getTrialStatus, type TrialStatus } from "../lib/services/purchases";
import { getProWelcomeState } from "../lib/services/proWelcome";
import { getHealthSyncEnabled } from "../lib/services/health";
import { useHealthAvailable } from "../lib/services/healthAvailability";
import { incompleteCount, withHealthMirror } from "../lib/proWelcome";

/**
 * Dashboard card for a running free trial: the days left and how many Pro
 * welcome steps are still open, one tap from the welcome screen. It decides for
 * itself whether to exist: the store says there is a trial (getTrialStatus keeps
 * the last known one when the store is unreachable), so it disappears the moment
 * the trial ends or converts into a paid subscription. Re-checked on every focus
 * and foreground, because both the countdown and the steps change away from here.
 */
export function TrialCard() {
  const { t } = useTranslation();
  const router = useRouter();
  const { isProUser, activeProfile } = useApp();
  const healthAvailable = useHealthAvailable();
  const profileId = activeProfile?.id ?? null;
  const [trial, setTrial] = useState<TrialStatus | null>(null);
  const [stepsLeft, setStepsLeft] = useState<number | null>(null);
  // Only the newest refresh may write state: focus and foreground can overlap.
  const latestRun = useRef(0);

  const refresh = useCallback(async () => {
    const run = ++latestRun.current;
    if (!isProUser) {
      setTrial(null);
      return;
    }
    try {
      const status = await getTrialStatus();
      if (run !== latestRun.current) return;
      setTrial(status);
      if (status?.active !== true) return;
      const state = withHealthMirror(
        await getProWelcomeState(),
        await getHealthSyncEnabled(profileId)
      );
      if (run !== latestRun.current) return;
      setStepsLeft(incompleteCount(state, healthAvailable));
    } catch (err) {
      logCrash(err, { screen: "dashboard", op: "trialCard" });
    }
  }, [isProUser, profileId, healthAvailable]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  if (trial?.active !== true) return null;

  const title =
    trial.daysLeft != null
      ? t("settings.trialDaysLeft", { count: trial.daysLeft })
      : t("settings.trialActive");
  const sub =
    stepsLeft == null
      ? undefined
      : stepsLeft > 0
        ? t("trial.stepsLeft", { count: stepsLeft })
        : t("trial.allSet");

  return (
    <Pressable
      onPress={() => router.push("/pro-welcome")}
      accessibilityRole="button"
      accessibilityLabel={sub ? `${title}. ${sub}` : title}
      className="flex-row items-center rounded-2xl border border-hair bg-glass px-3.5 py-3 mb-3 active:opacity-80"
    >
      <IconTile icon="sparkles" size={34} radius={11} hero />
      <View style={{ flex: 1, marginHorizontal: 12 }}>
        <Text style={{ color: THEME.ink, fontSize: 14, fontWeight: "800", lineHeight: 19 }}>
          {title}
        </Text>
        {sub ? (
          <Text style={{ color: THEME.muted, fontSize: 12, lineHeight: 17, marginTop: 2 }}>
            {sub}
          </Text>
        ) : null}
      </View>
      <DirIcon name="chevron-forward" size={18} color={THEME.muted} />
    </Pressable>
  );
}
