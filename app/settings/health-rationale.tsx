import React from "react";
import { Linking, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { Row, SettingsScaffold } from "../../components/settingsUi";
import { privacyUrl } from "../../lib/legal";
import { THEME } from "../../lib/theme/tokens";
import { useLayout } from "../../lib/useLayout";

type IconName = keyof typeof Ionicons.glyphMap;

function RationaleItem({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  return (
    <View className="bg-glass border border-hair rounded-2xl px-4 py-3.5 mb-2">
      <View className="flex-row items-center">
        <Ionicons name={icon} size={19} color={THEME.accent} />
        <Text accessibilityRole="header" className="flex-1 ml-3 font-medium text-ink">
          {title}
        </Text>
      </View>
      <Text className="text-mut text-xs mt-2 leading-5">{body}</Text>
    </View>
  );
}

/**
 * Opened by Health Connect's permission rationale intents (deep link
 * zerospike://settings/health-rationale, see plugins/withHealthRationaleRouting.js):
 * why the permissions are requested, what stays on the device, and where to
 * change them. Also reachable by hand from the same route.
 */
export default function HealthRationale() {
  const { t } = useTranslation();
  const router = useRouter();
  const { columnPad } = useLayout();

  return (
    <SettingsScaffold title={t("healthRationale.title")}>
      <View style={columnPad()}>
        <Text className="text-mut text-sm leading-5 mb-3">{t("healthRationale.intro")}</Text>

        <RationaleItem
          icon="download-outline"
          title={t("healthRationale.readTitle")}
          body={t("healthRationale.readBody")}
        />
        <RationaleItem
          icon="cloud-upload-outline"
          title={t("healthRationale.writeTitle")}
          body={t("healthRationale.writeBody")}
        />
        <RationaleItem
          icon="sync-outline"
          title={t("healthRationale.backgroundTitle")}
          body={t("healthRationale.backgroundBody")}
        />
        <RationaleItem
          icon="phone-portrait-outline"
          title={t("healthRationale.deviceTitle")}
          body={t("healthRationale.deviceBody")}
        />
        <RationaleItem
          icon="remove-circle-outline"
          title={t("healthRationale.insulinTitle")}
          body={t("healthRationale.insulinBody")}
        />
        <RationaleItem
          icon="options-outline"
          title={t("healthRationale.removeTitle")}
          body={t("healthRationale.removeBody")}
        />

        <View className="mt-2">
          <Row
            icon="shield-checkmark-outline"
            label={t("healthRationale.privacyLink")}
            onPress={() => {
              Linking.openURL(privacyUrl()).catch(() => {});
            }}
            right={<Ionicons name="open-outline" size={16} color={THEME.textMuted} />}
          />
          <Row
            icon="heart-outline"
            label={t("healthRationale.openSettings")}
            onPress={() => router.push("/settings/data")}
          />
        </View>
      </View>
    </SettingsScaffold>
  );
}
