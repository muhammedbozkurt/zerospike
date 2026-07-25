import React from "react";
import { Linking, View } from "react-native";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { useApp } from "../../lib/store/AppContext";
import { insulinModeOf, insulinModeUsesInsulin } from "../../lib/insulinMode";
import { SectionLabel } from "../../components/ui";
import { Row, SettingsScaffold } from "../../components/settingsUi";
import { DisclaimerBanner } from "../../components/Disclaimer";
import { privacyUrl, termsUrl } from "../../lib/legal";

/** Settings > About & Legal: guides, SOS/emergency, sources, legal, version. */
export default function AboutSettings() {
  const { t } = useTranslation();
  const router = useRouter();
  const { activeProfile } = useApp();
  const usesInsulin = insulinModeUsesInsulin(insulinModeOf(activeProfile));
  const version = Constants.expoConfig?.version ?? "1.0.0";

  return (
    <SettingsScaffold title={t("settings.aboutSection")}>
      {usesInsulin ? (
        <>
          <SectionLabel>{t("injection.title")}</SectionLabel>
          <Row
            icon="medkit-outline"
            label={t("injection.guideLink")}
            onPress={() => router.push("/injection-guide")}
          />
        </>
      ) : null}

      <SectionLabel>{t("sos.title")}</SectionLabel>
      <Row
        icon="people-outline"
        label={t("emergency.title")}
        onPress={() => router.push("/emergency-contacts")}
      />
      <Row icon="medical-outline" label={t("sos.openScreen")} onPress={() => router.push("/sos")} />

      <SectionLabel>{t("settings.legalSection")}</SectionLabel>
      <Row
        icon="shield-checkmark-outline"
        label={t("settings.privacy")}
        onPress={() => Linking.openURL(privacyUrl())}
      />
      <Row
        icon="reader-outline"
        label={t("settings.terms")}
        onPress={() => Linking.openURL(termsUrl())}
      />
      <Row icon="medkit-outline" label={t("sources.link")} onPress={() => router.push("/sources")} />

      <SectionLabel>{t("settings.aboutSection")}</SectionLabel>
      <Row
        icon="information-circle-outline"
        label={t("settings.version")}
        value={version}
        right={<View />}
      />

      <View className="my-3">
        <DisclaimerBanner full />
      </View>
    </SettingsScaffold>
  );
}
