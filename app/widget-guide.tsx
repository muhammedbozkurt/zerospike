import React from "react";
import { Platform, ScrollView, Text, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { AppBackground, GlassCard, IconTile } from "../components/rich";
import { withAlpha } from "../components/rich/GlassCard";
import { ScreenHeader } from "../components/ScreenHeader";
import { GLUCOSE_RICH, MODAL_TOP_PAD, THEME } from "../lib/theme/tokens";
import { isLiveActivityAvailable } from "../modules/zerospike-live-activity";
import { useLayout } from "../lib/useLayout";

/**
 * "Widgets & Lock Screen": the one place that tells the user these native
 * surfaces exist and how to place them. Discoverability was zero before; a
 * reminder that a home/lock-screen widget and a Live Activity are available is
 * worth more than the surfaces themselves if nobody knows to add them.
 */
function Section({
  icon,
  title,
  children,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <GlassCard style={{ marginBottom: 12 }}>
      <View className="flex-row items-center mb-2" style={{ gap: 10 }}>
        <IconTile icon={icon} size={32} radius={10} hero />
        <Text style={{ color: THEME.text, fontSize: 15, fontWeight: "800", flex: 1 }}>
          {title}
        </Text>
      </View>
      {children}
    </GlassCard>
  );
}

function Steps({ text }: { text: string }) {
  // The step strings are newline-separated in i18n; render each as its own line.
  return (
    <View style={{ gap: 6 }}>
      {text.split("\n").map((line, i) => (
        <View key={i} className="flex-row" style={{ gap: 8 }}>
          <Text style={{ color: THEME.accent, fontSize: 13, fontWeight: "800" }}>
            {i + 1}.
          </Text>
          <Text style={{ color: THEME.text, fontSize: 13, lineHeight: 19, flex: 1 }}>
            {line}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** One row of the Android six-widget list: icon, the widget's own on-screen
 *  label (reused, not new copy), a plain description of what it shows/does,
 *  and a rough size hint so the picker's identical "zerospike" entries (see
 *  the D1 note above the call site) become tellable apart before adding one. */
function WidgetRow({
  icon,
  title,
  desc,
  size,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  desc: string;
  size: string;
}) {
  return (
    <View className="flex-row" style={{ gap: 10 }}>
      <View
        style={{
          width: 30,
          height: 30,
          borderRadius: 9,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: withAlpha(THEME.accent, 0.14),
        }}
      >
        <Ionicons name={icon} size={15} color={THEME.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: THEME.text, fontSize: 13, fontWeight: "700" }}>{title}</Text>
        <Text style={{ color: THEME.textMuted, fontSize: 12, lineHeight: 17, marginTop: 2 }}>
          {desc}
        </Text>
        <Text style={{ color: THEME.textMuted, fontSize: 11, marginTop: 2 }}>{size}</Text>
      </View>
    </View>
  );
}

function WidgetGuideScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { columnPad } = useLayout();
  const ios = Platform.OS === "ios";
  const liveOn = isLiveActivityAvailable();

  return (
    <AppBackground>
      <View className="flex-1" style={{ paddingTop: Math.max(insets.top, MODAL_TOP_PAD) }}>
        <ScreenHeader
          // Android never renders the lock-screen/Live Activity sections below
          // (both iOS-only), so its title drops "ve Kilit Ekranı" instead of
          // promising sections the page doesn't show there.
          title={ios ? t("widgetGuide.title") : t("widgetGuide.titleAndroid")}
          onBack={() => router.back()}
          backIcon="close"
          accessibilityLabel={t("common.close")}
        />
        <ScrollView
          contentContainerStyle={{
            paddingTop: 16,
            paddingBottom: insets.bottom + 32,
            ...columnPad(16),
          }}
          showsVerticalScrollIndicator={false}
        >
          <Section
            icon="grid-outline"
            title={ios ? t("widgetGuide.homeTitle") : t("widgetGuide.homeTitleAndroid")}
          >
            <Steps
              text={ios ? t("widgetGuide.homeStepsIos") : t("widgetGuide.homeStepsAndroid")}
            />
            {/* D1: the Android widget picker shows only the plain "zerospike"
                label per entry (no configurationDisplayName the way iOS's
                gallery has), so all six widgets are otherwise indistinguishable
                in that list. Each row below reuses the widget's own already-
                nine-language on-screen label instead of new copy, next to a
                plain description and a rough size hint. */}
            {!ios ? (
              <View style={{ marginTop: 10, gap: 12 }}>
                <Text style={{ color: THEME.textMuted, fontSize: 12, lineHeight: 18 }}>
                  {t("widgetGuide.androidListIntro")}
                </Text>
                <WidgetRow
                  icon="analytics-outline"
                  title={t("widget.avgGlucose")}
                  desc={t("widgetGuide.androidGlanceDesc")}
                  size={t("widgetGuide.androidGlanceSize")}
                />
                <WidgetRow
                  icon="time-outline"
                  title={t("widget.lastReading")}
                  desc={t("widgetGuide.androidReadingDesc")}
                  size={t("widgetGuide.androidReadingSize")}
                />
                <WidgetRow
                  icon="apps-outline"
                  title={t("widget.quickAdd")}
                  desc={t("widgetGuide.androidQuickAddDesc")}
                  size={t("widgetGuide.androidQuickAddSize")}
                />
                <WidgetRow
                  icon="water-outline"
                  title={t("widget.addGlucose")}
                  desc={t("widgetGuide.androidLogGlucoseDesc")}
                  size={t("widgetGuide.androidLogGlucoseSize")}
                />
                <WidgetRow
                  icon="restaurant-outline"
                  title={t("widget.addMeal")}
                  desc={t("widgetGuide.androidLogMealDesc")}
                  size={t("widgetGuide.androidLogMealSize")}
                />
                <WidgetRow
                  icon="timer-outline"
                  title={t("widget.timerTitle")}
                  desc={t("widgetGuide.androidTimerDesc")}
                  size={t("widgetGuide.androidTimerSize")}
                />
              </View>
            ) : null}
          </Section>

          {ios ? (
            <Section icon="lock-closed-outline" title={t("widgetGuide.lockTitle")}>
              <Steps text={t("widgetGuide.lockStepsIos")} />
              {/* What the three lock-screen shapes actually show, so the user
                  can pick one instead of adding whichever the gallery offers
                  first. */}
              <Text
                style={{ color: THEME.textMuted, fontSize: 12, lineHeight: 18, marginTop: 8 }}
              >
                {t("widgetGuide.lockShapes")}
              </Text>
            </Section>
          ) : null}

          {!ios ? (
            // Android's counterpart to the iOS Live Activity section below:
            // there is no Lock Screen surface here (no Android lock-screen
            // widgets exist), but the post-meal Timer widget above has its own
            // honest twin - a persistent notification, since a home-screen
            // widget only redraws every so often (see buildTimerWidget /
            // PostMealNotification.kt).
            <Section icon="timer-outline" title={t("widgetGuide.postMealTitleAndroid")}>
              <Text style={{ color: THEME.text, fontSize: 13, lineHeight: 19 }}>
                {t("widgetGuide.postMealBodyAndroid")}
              </Text>
            </Section>
          ) : null}

          {ios ? (
            <Section icon="timer-outline" title={t("widgetGuide.liveTitle")}>
              <Text style={{ color: THEME.text, fontSize: 13, lineHeight: 19 }}>
                {t("widgetGuide.liveBody")}
              </Text>
              {/* Honest status: only true when the OS supports Live Activities AND
                  the user has left them enabled. Never an error, just the state. */}
              <View
                className="flex-row items-center mt-3 rounded-xl px-3 py-2.5"
                style={{
                  borderWidth: 1,
                  borderColor: withAlpha(
                    liveOn ? GLUCOSE_RICH.target : GLUCOSE_RICH.high,
                    0.3
                  ),
                  backgroundColor: withAlpha(
                    liveOn ? GLUCOSE_RICH.target : GLUCOSE_RICH.high,
                    0.1
                  ),
                }}
              >
                <Ionicons
                  name={liveOn ? "checkmark-circle" : "alert-circle-outline"}
                  size={16}
                  color={liveOn ? GLUCOSE_RICH.target : GLUCOSE_RICH.high}
                />
                <Text style={{ color: THEME.text, fontSize: 12, marginLeft: 8, flex: 1 }}>
                  {liveOn ? t("widgetGuide.liveOn") : t("widgetGuide.liveOff")}
                </Text>
              </View>
            </Section>
          ) : null}
        </ScrollView>
      </View>
    </AppBackground>
  );
}

export default function WidgetGuideRoute() {
  return (
    <SafeAreaProvider>
      <WidgetGuideScreen />
    </SafeAreaProvider>
  );
}
