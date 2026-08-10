import React from "react";
import { Linking, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { useApp } from "../../lib/store/AppContext";
import { insulinModeOf, insulinModeUsesInsulin } from "../../lib/insulinMode";
import { SectionLabel } from "../../components/ui";
import { Row, SettingsScaffold } from "../../components/settingsUi";
import { DisclaimerBanner } from "../../components/Disclaimer";
import { privacyUrl, termsUrl } from "../../lib/legal";
import { THEME } from "../../lib/theme/tokens";
import { useLayout } from "../../lib/useLayout";

/** Row's default right-side chevron implies in-app navigation; rows that hand
 *  off to the system browser get this instead, so the two don't look the same. */
const EXTERNAL_LINK_ICON = <Ionicons name="open-outline" size={16} color={THEME.muted} />;

/** Settings > About & Legal: guides, SOS/emergency, sources, legal, version. */
export default function AboutSettings() {
  const { t } = useTranslation();
  const router = useRouter();
  const { activeProfile } = useApp();
  const { contentColumn } = useLayout();
  const usesInsulin = insulinModeUsesInsulin(insulinModeOf(activeProfile));
  const version = Constants.expoConfig?.version ?? "1.0.0";

  return (
    <SettingsScaffold title={t("settings.aboutSection")}>
      <View style={contentColumn}>
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
        right={EXTERNAL_LINK_ICON}
      />
      <Row
        icon="reader-outline"
        label={t("settings.terms")}
        onPress={() => Linking.openURL(termsUrl())}
        right={EXTERNAL_LINK_ICON}
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
      </View>
    </SettingsScaffold>
  );
}
