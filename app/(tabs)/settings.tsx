import React, { useEffect, useState } from "react";
import { Image, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import Constants from "expo-constants";

import { AppBackgroundFill } from "../../components/rich";
import { useApp } from "../../lib/store/AppContext";
import { useProCta } from "../../lib/proCta";
import {
  getNotificationPermission,
  type NotificationPermission,
} from "../../lib/services/notifications";
import { Row, useSettingsGap } from "../../components/settingsUi";
import { ProfileSwitcher } from "../../components/ProfileSwitcher";
import { THEME } from "../../lib/theme/tokens";

/**
 * Settings HUB (R7.3). The former single 1050-line scroll is split into five
 * pushed sub-pages (app/settings/*), reached from these icon-plate rows. Two
 * summaries stay inline here - the notification-permission state and the Pro
 * state - so the two most-checked facts are visible without a tap.
 */
export default function SettingsHub() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { activeProfile, isProUser } = useApp();
  const proCta = useProCta(!isProUser);
  // Tablet (wider than 700dp): hub title and rows share one centred 640 column
  // instead of full-width rows with a lone chevron at the far edge. Gap is 0 on
  // phones and narrow tablets.
  const gap = useSettingsGap();
  const columnPad = (base: number) => ({
    paddingLeft: base + gap,
    paddingRight: base + gap,
  });
  const [permission, setPermission] = useState<NotificationPermission | null>(null);

  useEffect(() => {
    (async () => setPermission(await getNotificationPermission()))();
  }, []);

  const go = (path: Href) => () => router.push(path);
  const version = Constants.expoConfig?.version ?? "1.0.0";

  return (
    <View className="flex-1" style={{ paddingTop: insets.top }}>
      <AppBackgroundFill />
      <View className="flex-row items-center justify-between pt-2 pb-3" style={columnPad(16)}>
        <Text className="text-ink text-2xl font-bold">{t("settings.title")}</Text>
        <ProfileSwitcher />
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingTop: 16,
          paddingBottom: insets.bottom + 32,
          flexGrow: 1,
          ...columnPad(16),
        }}
        showsVerticalScrollIndicator={false}
      >
        <Row icon="person-outline" label={t("settings.hubProfile")} onPress={go("/settings/profile")} />
        {activeProfile?.oral_meds_enabled === 1 ? (
          <Row
            icon="medical-outline"
            label={t("settings.hubMedications")}
            onPress={go("/settings/medications")}
          />
        ) : null}
        <Row
          icon="notifications-outline"
          label={t("settings.notificationsSection")}
          value={permission ? t(`settings.notifPerm_${permission}`) : undefined}
          onPress={go("/settings/notifications")}
        />
        {/* Its own entry, UNCONDITIONALLY. The only other way in is a row on the
            notifications screen that is itself hidden while the master switch
            is off - so a user who turned notifications off had no route left to
            the reminders they had already set up, not even to look at them. */}
        <Row
          icon="alarm-outline"
          label={t("settings.remindersTitle")}
          onPress={go("/settings/reminders")}
        />
        <Row icon="server-outline" label={t("settings.hubData")} onPress={go("/settings/data")} />
        <Row
          icon="phone-portrait-outline"
          label={t("settings.appSection")}
          // Free users see the shared Pro lock label here (trial or upgrade).
          value={isProUser ? t("settings.proActive") : t(proCta.key, proCta.params)}
          onPress={go("/settings/app")}
        />
        <Row icon="information-circle-outline" label={t("settings.hubAbout")} onPress={go("/settings/about")} />

        {/* App logo + version, anchored to the bottom of the hub */}
        <View style={{ flex: 1, minHeight: 32 }} />
        <View style={{ alignItems: "center", paddingTop: 16 }}>
          <Image
            source={require("../../assets/brand/icon-1024.png")}
            style={{ width: 60, height: 60, borderRadius: 15 }}
          />
          <Text style={{ color: THEME.text, fontWeight: "700", fontSize: 15, marginTop: 10 }}>
            zerospike
          </Text>
          <Text style={{ color: THEME.textMuted, fontSize: 12, marginTop: 3 }}>
            {t("settings.version")} {version}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
