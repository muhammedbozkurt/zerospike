import React, { useEffect, useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { AppBackground, GlassCard, GradientCTA, IconTile } from "../components/rich";
import { withAlpha } from "../components/rich/GlassCard";
import { ScreenHeader } from "../components/ScreenHeader";
import { Button } from "../components/ui";
import { markAlarmTourSeen } from "../lib/services/alarmTour";
import {
  getAlarmAuthorizationStatus,
  requestAlarmAuthorization,
} from "../modules/zerospike-alarmkit";
import { GLUCOSE_RICH, HIT_TARGET, MODAL_TOP_PAD, THEME } from "../lib/theme/tokens";
import { useLayout } from "../lib/useLayout";

/**
 * The one-time alarm tour (2.3.0's D), for a user UPGRADING into the release
 * where the reminders they already had started ringing as real alarms. Three
 * short steps: what changed, the permission it needs, and where any single
 * reminder can be put back on notifications.
 *
 * Who sees it is decided entirely in app/_layout.tsx (AlarmKit present, tour
 * not seen yet, at least one reminder row for it to be about); a fresh install
 * never does, because completeOnboarding marks the tour seen. This screen only
 * renders, asks, and records that it is done with.
 */
interface TourStep {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  /** Second, quieter line. Only step 1 has one. */
  note?: string;
  cta: string;
}

function AlarmTourScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { columnPad } = useLayout();

  // Written out as real t() calls (not key strings looked up later) so
  // scripts/i18n-check.js can see every key this screen uses.
  const steps: TourStep[] = [
    {
      icon: "alarm-outline",
      title: t("alarmTour.step1Title"),
      body: t("alarmTour.step1Body"),
      // A system alarm stops on its own if nobody stops it, exactly like the
      // Clock app's; AlarmKit gives no way to change that and no callback when
      // it happens. Saying so here is the only honest place: the reminder that
      // rang and went unanswered leaves no trace behind, and a user who does
      // not know that reads the silence as the alarm having failed.
      note: t("alarmTour.step1Note"),
      cta: t("alarmTour.next"),
    },
    {
      icon: "lock-open-outline",
      title: t("alarmTour.step2Title"),
      body: t("alarmTour.step2Body"),
      cta: t("alarmTour.step2Cta"),
    },
    {
      icon: "options-outline",
      title: t("alarmTour.step3Title"),
      body: t("alarmTour.step3Body"),
      cta: t("alarmTour.step3Cta"),
    },
  ];

  const [stepIdx, setStepIdx] = useState(0);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);

  // app/_layout.tsx already marks the tour seen BEFORE pushing it (the winback
  // pattern), so this is only a backstop for any other way in - and it costs
  // one write on mount rather than one per render.
  useEffect(() => {
    void markAlarmTourSeen();
  }, []);

  const step = steps[stepIdx];

  async function askPermission() {
    setBusy(true);
    try {
      let status = getAlarmAuthorizationStatus();
      if (status !== "authorized") status = await requestAlarmAuthorization();
      if (status === "authorized") {
        setDenied(false);
        setStepIdx(2);
      } else {
        // Not a dead end: the last step is what actually matters (every
        // reminder keeps arriving, and the badge can ask again later), so the
        // system-settings pointer appears and the tour stays walkable.
        setDenied(true);
      }
    } finally {
      setBusy(false);
    }
  }

  function onCta() {
    if (stepIdx === 0) return setStepIdx(1);
    if (stepIdx === 1) return void askPermission();
    // Dismiss the modal first, but only when there is something under it: this
    // route is pushed from the launch flow, and a back() with nothing behind it
    // is a no-op that would leave the tour sitting over the destination.
    if (router.canGoBack()) router.back();
    router.push("/settings/reminders");
  }

  return (
    <AppBackground>
      <View className="flex-1" style={{ paddingTop: Math.max(insets.top, MODAL_TOP_PAD) }}>
        <ScreenHeader
          title={step.title}
          onBack={() => router.back()}
          backIcon="close"
          accessibilityLabel={t("common.close")}
        />
        <View
          className="flex-1"
          style={{ paddingTop: 16, paddingBottom: insets.bottom + 24, ...columnPad(16) }}
        >
          <GlassCard>
            <View className="flex-row items-center mb-3" style={{ gap: 10 }}>
              <IconTile icon={step.icon} size={36} radius={12} hero />
              <Text style={{ color: THEME.text, fontSize: 16, fontWeight: "800", flex: 1 }}>
                {step.title}
              </Text>
            </View>
            <Text style={{ color: THEME.text, fontSize: 14, lineHeight: 21, opacity: 0.9 }}>
              {step.body}
            </Text>
            {step.note ? (
              <Text
                style={{ color: THEME.textMuted, fontSize: 12, lineHeight: 18, marginTop: 8 }}
              >
                {step.note}
              </Text>
            ) : null}
            {stepIdx === 1 && denied ? (
              <Pressable
                onPress={() => Linking.openSettings()}
                accessibilityRole="button"
                className="mt-3"
              >
                <View
                  className="rounded-xl px-3 py-2.5"
                  style={{
                    borderWidth: 1,
                    borderColor: withAlpha(GLUCOSE_RICH.high, 0.3),
                    backgroundColor: withAlpha(GLUCOSE_RICH.high, 0.1),
                  }}
                >
                  <Text style={{ color: THEME.text, fontSize: 12, lineHeight: 18 }}>
                    {t("reminders.alarmPermissionDenied")}{" "}
                    <Text style={{ color: THEME.accent, fontWeight: "700" }}>
                      {t("settings.openSystemSettings")}
                    </Text>
                  </Text>
                </View>
              </Pressable>
            ) : null}
          </GlassCard>

          <View style={{ marginTop: "auto" }}>
            {/* Three dots, so a two-tap flow reads as a short tour rather than
                an offer that keeps coming back. */}
            <View className="flex-row justify-center mb-4" style={{ gap: 6 }}>
              {steps.map((s, i) => (
                <View
                  key={s.title}
                  style={{
                    width: i === stepIdx ? 18 : 6,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: i === stepIdx ? THEME.accentFill : THEME.border,
                  }}
                />
              ))}
            </View>
            <GradientCTA label={step.cta} disabled={busy} onPress={onCta} />
            <Button variant="tertiary" onPress={() => router.back()} label={t("alarmTour.skip")} />
          </View>
        </View>
      </View>
    </AppBackground>
  );
}

export default function AlarmTourRoute() {
  return (
    <SafeAreaProvider>
      <AlarmTourScreen />
    </SafeAreaProvider>
  );
}
