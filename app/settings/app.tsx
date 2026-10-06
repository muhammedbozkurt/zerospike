import React, { useCallback, useState } from "react";
import { Linking, Platform, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { useApp } from "../../lib/store/AppContext";
import type { Lang } from "../../lib/db/types";
import { applyNotificationPrefs } from "../../lib/services/notifications";
import {
  getPlan,
  getTrialStatus,
  presentCodeRedemption,
  restore,
  type PlanId,
  type TrialStatus,
} from "../../lib/services/purchases";
import { hasSpikeConsent, withdrawSpikeConsent } from "../../lib/services/spikeConsent";
import { getProWelcomeState } from "../../lib/services/proWelcome";
import { getHealthSyncEnabled } from "../../lib/services/health";
import { useHealthAvailable } from "../../lib/services/healthAvailability";
import { incompleteCount, withHealthMirror } from "../../lib/proWelcome";
import { StoreStatusNotice } from "../../components/StoreStatusNotice";
import { SectionLabel } from "../../components/ui";
import { LanguagePicker } from "../../components/LanguagePicker";
import { Row, SettingsScaffold } from "../../components/settingsUi";
import { useFeedback } from "../../components/Feedback";
import { THEME } from "../../lib/theme/tokens";
import { isConfigured as spikeConfigured } from "../../lib/ai/spikeClient";
import { useLayout } from "../../lib/useLayout";

/** Settings > App: language, Spike, Pro / subscription, widget guide. */
export default function AppSettings() {
  const { t } = useTranslation();
  const router = useRouter();
  const { toast, confirm } = useFeedback();
  const { lang, setLanguage, isProUser, refreshPro, activeProfile } = useApp();
  const { columnPad } = useLayout();
  const healthAvailable = useHealthAvailable();
  const profileId = activeProfile?.id;
  const [restoring, setRestoring] = useState(false);
  // Open Pro welcome steps; null until read. The welcome row follows these for
  // any Pro user, trial or not: the steps do not expire with the trial.
  const [stepsLeft, setStepsLeft] = useState<number | null>(null);
  const [spikeConsent, setSpikeConsent] = useState(false);
  // Which plan unlocked Pro, so the "Pro active" row can open store subscription
  // management for a monthly/annual subscriber but not for a lifetime purchase
  // (there is no subscription to manage there). Starts null (unknown): until it
  // resolves the row stays clickable, same as an indeterminate plan - it must
  // never default to LOOKING locked while the read is still in flight.
  const [proPlan, setProPlan] = useState<PlanId | null>(null);
  // Null means "no answer yet / store unreachable", which is NOT the same as
  // "no trial": the line is only drawn on a positive answer.
  const [trial, setTrial] = useState<TrialStatus | null>(null);

  // Re-read on every focus, not just on mount: this screen stays mounted
  // under the stack while the user grants or withdraws consent on /spike, so
  // a plain mount-only read would leave the row stale on the way back.
  useFocusEffect(
    useCallback(() => {
      if (!spikeConfigured) return;
      void hasSpikeConsent().then(setSpikeConsent);
    }, [])
  );

  useFocusEffect(
    useCallback(() => {
      if (!isProUser) return;
      void getPlan().then(setProPlan);
      void getTrialStatus().then(setTrial);
      void (async () => {
        const state = withHealthMirror(
          await getProWelcomeState(),
          await getHealthSyncEnabled(profileId)
        );
        setStepsLeft(incompleteCount(state, healthAvailable));
      })();
    }, [isProUser, profileId, healthAvailable])
  );

  async function onWithdrawSpikeConsent() {
    const ok = await confirm({
      title: t("spike.withdraw"),
      message: t("spike.withdrawConfirm"),
      confirmLabel: t("common.confirm"),
      destructive: true,
      icon: "close-circle-outline",
    });
    if (!ok) return;
    await withdrawSpikeConsent();
    setSpikeConsent(false);
    toast(t("common.done"), "success");
  }

  async function onChangeLang(next: Lang) {
    await setLanguage(next);
    // Reschedule so reminder text matches the new language.
    await applyNotificationPrefs();
  }

  // Opens the store's native subscription management page. Lifetime is a
  // one-time purchase with nothing to manage there, so that row stays inert.
  function onManageSubscription() {
    const url =
      Platform.OS === "android"
        ? "https://play.google.com/store/account/subscriptions?package=com.greeneyeapp.zerospike"
        : "https://apps.apple.com/account/subscriptions";
    Linking.openURL(url);
  }

  async function onRedeemCode() {
    if (Platform.OS === "android") {
      Linking.openURL("https://play.google.com/redeem");
      return;
    }
    await presentCodeRedemption();
    await refreshPro();
  }

  async function onRestore() {
    if (restoring) return;
    setRestoring(true);
    try {
      const result = await restore();
      await refreshPro();
      if (result === "restored") toast(t("paywall.restored"), "success");
      else if (result === "none") toast(t("paywall.nothingToRestore"), "info");
      else toast(t("paywall.restoreFailed"), "error");
    } finally {
      setRestoring(false);
    }
  }

  const onTrial = trial?.active === true;
  const trialLine = !onTrial
    ? undefined
    : trial.daysLeft != null
      ? t("settings.trialDaysLeft", { count: trial.daysLeft })
      : t("settings.trialActive");
  // A running trial always converts into a subscription, so the way to stop it
  // has to be reachable even while getPlan has not resolved which plan it is.
  const canManage = onTrial || proPlan !== "lifetime";

  return (
    <SettingsScaffold title={t("settings.appSection")}>
      <View style={columnPad()}>
      <SectionLabel>{t("settings.language")}</SectionLabel>
      <LanguagePicker value={lang} onChange={onChangeLang} />

      {spikeConfigured ? (
        <>
          <SectionLabel>{t("spike.title")}</SectionLabel>
          <Row icon="sparkles-outline" label={t("spike.settingsRow")} onPress={() => router.push("/spike")} />
          {spikeConsent ? (
            <Row
              icon="close-circle-outline"
              label={t("spike.withdraw")}
              onPress={onWithdrawSpikeConsent}
              danger
            />
          ) : null}
        </>
      ) : null}

      <SectionLabel>{t("settings.proSection")}</SectionLabel>
      <StoreStatusNotice onRestore={onRestore} busy={restoring} />
      {isProUser ? (
        <Row
          icon="checkmark-circle"
          label={t("settings.proActive")}
          sub={trialLine}
          value={canManage ? t("settings.manageSubscription") : undefined}
          onPress={canManage ? onManageSubscription : undefined}
          right={<Ionicons name="sparkles" size={18} color={THEME.accent} />}
        />
      ) : (
        <Row
          icon="sparkles-outline"
          label={t("settings.goPro")}
          onPress={() => router.push({ pathname: "/paywall", params: { reason: "settings" } })}
        />
      )}
      {isProUser && stepsLeft != null && stepsLeft > 0 ? (
        <Row
          icon="sparkles-outline"
          label={t("trial.welcomeRow")}
          sub={t("trial.stepsLeft", { count: stepsLeft })}
          onPress={() => router.push("/pro-welcome")}
        />
      ) : null}
      {!isProUser ? (
        <Row icon="pricetag-outline" label={t("settings.redeemCode")} onPress={onRedeemCode} />
      ) : null}
      <Row
        icon="refresh-outline"
        label={t("settings.restorePurchases")}
        onPress={onRestore}
        right={restoring ? <Ionicons name="hourglass-outline" size={18} color={THEME.muted} /> : undefined}
      />

      <Row
        icon="apps-outline"
        label={t("widgetGuide.title")}
        onPress={() => router.push("/widget-guide")}
      />
      </View>
    </SettingsScaffold>
  );
}
