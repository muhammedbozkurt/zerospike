import React, { useState } from "react";
import { Linking, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { useApp } from "../../lib/store/AppContext";
import type { Lang } from "../../lib/db/types";
import { applyNotificationPrefs } from "../../lib/services/notifications";
import { presentCodeRedemption, restore } from "../../lib/services/purchases";
import { SectionLabel } from "../../components/ui";
import { LanguagePicker } from "../../components/LanguagePicker";
import { Row, SettingsScaffold } from "../../components/settingsUi";
import { useFeedback } from "../../components/Feedback";
import { THEME } from "../../lib/theme/tokens";
import { isConfigured as spikeConfigured } from "../../lib/ai/spikeClient";

/** Settings > App: language, Spike, Pro / subscription, widget guide. */
export default function AppSettings() {
  const { t } = useTranslation();
  const router = useRouter();
  const { toast } = useFeedback();
  const { lang, setLanguage, isProUser, refreshPro } = useApp();
  const [restoring, setRestoring] = useState(false);

  async function onChangeLang(next: Lang) {
    await setLanguage(next);
    // Reschedule so reminder text matches the new language.
    await applyNotificationPrefs();
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

  return (
    <SettingsScaffold title={t("settings.appSection")}>
      <SectionLabel>{t("settings.language")}</SectionLabel>
      <LanguagePicker value={lang} onChange={onChangeLang} />

      {spikeConfigured ? (
        <>
          <SectionLabel>{t("spike.title")}</SectionLabel>
          <Row icon="sparkles-outline" label={t("spike.settingsRow")} onPress={() => router.push("/spike")} />
        </>
      ) : null}

      <SectionLabel>{t("settings.proSection")}</SectionLabel>
      {isProUser ? (
        <Row
          icon="checkmark-circle"
          label={t("settings.proActive")}
          right={<Ionicons name="sparkles" size={18} color={THEME.accent} />}
        />
      ) : (
        <Row icon="sparkles-outline" label={t("settings.goPro")} onPress={() => router.push("/paywall")} />
      )}
      {!isProUser ? (
        <Row icon="pricetag-outline" label={t("settings.redeemCode")} onPress={onRedeemCode} />
      ) : null}
      <Row
        icon="refresh-outline"
        label={t("settings.restorePurchases")}
        onPress={onRestore}
        right={restoring ? <Ionicons name="hourglass-outline" size={18} color={THEME.muted} /> : undefined}
      />

      <SectionLabel>{t("widgetGuide.title")}</SectionLabel>
      <Row
        icon="apps-outline"
        label={t("widgetGuide.title")}
        onPress={() => router.push("/widget-guide")}
      />
    </SettingsScaffold>
  );
}
