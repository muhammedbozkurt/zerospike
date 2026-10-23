import React, { useEffect, useState } from "react";
import { Linking, Platform, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { useApp } from "../../lib/store/AppContext";
import { insulinModeOf, insulinModeUsesInsulin } from "../../lib/insulinMode";
import { SectionLabel } from "../../components/ui";
import { Row, SettingsScaffold } from "../../components/settingsUi";
import { DisclaimerBanner } from "../../components/Disclaimer";
import { FeedbackSheet } from "../../components/feedback/FeedbackSheet";
import { FatalReportSheet } from "../../components/FatalReportSheet";
import { loadLastFatalReport } from "../../lib/fatalCapture";
import { fatalReportDate, type FatalReport } from "../../lib/fatalReport";
import { privacyUrl, termsUrl } from "../../lib/legal";
import { THEME } from "../../lib/theme/tokens";
import { writeReviewUrl } from "../../lib/services/review";

/** Row's default right-side chevron implies in-app navigation; rows that hand
 *  off to the system browser get this instead, so the two don't look the same. */
const externalLinkIcon = () => <Ionicons name="open-outline" size={16} color={THEME.textMuted} />;

/** Settings > About & Legal: guides, SOS/emergency, sources, legal, version. */
export default function AboutSettings() {
  const rateUrl = writeReviewUrl(Platform.OS);
  const { t } = useTranslation();
  const router = useRouter();
  const { activeProfile } = useApp();
  const usesInsulin = insulinModeUsesInsulin(insulinModeOf(activeProfile));
  const version = Constants.expoConfig?.version ?? "1.0.0";
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [fatalOpen, setFatalOpen] = useState(false);
  const [fatalReport, setFatalReport] = useState<FatalReport | null>(null);

  useEffect(() => {
    let alive = true;
    loadLastFatalReport()
      .then((r) => alive && setFatalReport(r))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

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

      <SectionLabel>{t("settings.appSection")}</SectionLabel>
      <Row
        icon="chatbubble-ellipses-outline"
        label={t("feedback.aboutRow")}
        onPress={() => setFeedbackOpen(true)}
      />
      {rateUrl ? (
        <Row
          icon="star-outline"
          label={t("settings.rateApp")}
          onPress={() => {
            Linking.openURL(rateUrl).catch(() => {});
          }}
          right={externalLinkIcon()}
        />
      ) : null}

      <SectionLabel>{t("settings.legalSection")}</SectionLabel>
      <Row
        icon="shield-checkmark-outline"
        label={t("settings.privacy")}
        onPress={() => Linking.openURL(privacyUrl())}
        right={externalLinkIcon()}
      />
      <Row
        icon="reader-outline"
        label={t("settings.terms")}
        onPress={() => Linking.openURL(termsUrl())}
        right={externalLinkIcon()}
      />
      <Row icon="medkit-outline" label={t("sources.link")} onPress={() => router.push("/sources")} />

      <SectionLabel>{t("settings.aboutSection")}</SectionLabel>
      <Row
        icon="information-circle-outline"
        label={t("settings.version")}
        value={version}
        right={<View />}
      />

      <Row
        icon="bug-outline"
        label={t("fatalReport.row")}
        value={fatalReport ? fatalReportDate(fatalReport.at) || fatalReport.platform : t("fatalReport.none")}
        onPress={() => setFatalOpen(true)}
      />

      <View className="my-3">
        <DisclaimerBanner full />
      </View>
      <FatalReportSheet
        visible={fatalOpen}
        report={fatalReport}
        onClose={() => setFatalOpen(false)}
        onCleared={() => setFatalReport(null)}
      />
      <FeedbackSheet
        visible={feedbackOpen}
        mode="general"
        onClose={() => setFeedbackOpen(false)}
      />
    </SettingsScaffold>
  );
}
