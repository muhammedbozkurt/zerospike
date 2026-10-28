import React, { useCallback, useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { useTranslation } from "react-i18next";

import { AppBackground, GlassCard, GradientCTA, IconTile } from "../components/rich";
import { Button, Txt } from "../components/ui";
import { DirIcon } from "../components/DirIcon";
import { ProCelebration } from "../components/ProCelebration";
import { ScreenHeader } from "../components/ScreenHeader";
import { FeedbackHost } from "../components/Feedback";
import { SPACE, THEME } from "../lib/theme/tokens";
import { FadeSlideIn } from "../lib/theme/motion";
import { getHapticsEnabled, hapticSuccess } from "../lib/haptics";
import { useLayout } from "../lib/useLayout";
import { logCrash, logEvent } from "../lib/analytics";
import { useApp } from "../lib/store/AppContext";
import { getTrialStatus, isProCached, type TrialStatus } from "../lib/services/purchases";
import {
  getProWelcomeState,
  markProWelcomeStep,
  waitForProWelcomeStep,
} from "../lib/services/proWelcome";
import { getHealthSyncEnabled } from "../lib/services/health";
import { useHealthAvailable } from "../lib/services/healthAvailability";
import { cancelTrialDay1Nudge } from "../lib/services/notifications";
import {
  HEALTH_RETURN_WINDOW_MS,
  healthImportDays,
  leaveThen,
  shouldReturnToWelcome,
  showConnectData,
  showReminderStep,
  welcomeExitTarget,
  welcomeFeatures,
  welcomeLinksOpen,
  withHealthMirror,
  type ProWelcomeState,
  type WelcomeFeatureId,
} from "../lib/proWelcome";

const FEATURE_ICON: Record<WelcomeFeatureId, keyof typeof Ionicons.glyphMap> = {
  insights: "analytics-outline",
  pdf: "document-text-outline",
  cgm: "pulse-outline",
  health: "sync-outline",
  spike: "sparkles-outline",
};

function FeatureRow({
  icon,
  title,
  body,
  onPress,
  hint,
  last,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  onPress?: () => void;
  hint?: string;
  last: boolean;
}) {
  const content = (
    <View
      className="flex-row items-center"
      style={{
        gap: SPACE.md,
        paddingVertical: SPACE.md,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: THEME.border,
      }}
    >
      <IconTile icon={icon} size={42} radius={14} hero />
      <View style={{ flex: 1 }}>
        <Txt kind="body" style={{ fontWeight: "700" }}>
          {title}
        </Txt>
        <Txt kind="caption" tone="muted" style={{ marginTop: 2 }}>
          {body}
        </Txt>
      </View>
      {onPress ? <DirIcon name="chevron-forward" size={18} color={THEME.textMuted} /> : null}
    </View>
  );
  if (!onPress) {
    return (
      <View accessible accessibilityLabel={`${title}. ${body}`}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${body}`}
      accessibilityHint={hint}
    >
      {content}
    </Pressable>
  );
}

/** One open follow-up: icon, short copy and a quiet outlined button. */
function NextStep({
  icon,
  title,
  body,
  cta,
  onCta,
  last,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  cta: string;
  onCta: () => void;
  last: boolean;
}) {
  return (
    <View
      style={{
        paddingVertical: SPACE.md,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: THEME.border,
      }}
    >
      <View className="flex-row items-center" style={{ gap: SPACE.md }}>
        <IconTile icon={icon} size={36} radius={12} tint={THEME.accent} />
        <Txt kind="body" style={{ flex: 1, fontWeight: "700" }}>
          {title}
        </Txt>
      </View>
      <Txt kind="caption" tone="muted" style={{ marginTop: SPACE.sm }}>
        {body}
      </Txt>
      <View style={{ marginTop: SPACE.md }}>
        <Button variant="outlined" size="sm" label={cta} onPress={onCta} />
      </View>
    </View>
  );
}

function ProWelcomeScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { columnPad } = useLayout();
  const { activeProfile, isProUser, onboarded } = useApp();
  const healthAvailable = useHealthAvailable();
  const profileId = activeProfile?.id ?? null;
  const [state, setState] = useState<ProWelcomeState>({});
  const [trial, setTrial] = useState<TrialStatus | null>(null);
  // The welcome belongs to Pro. The app's flag decides; when it says no, the
  // entitlement cached at the last store answer gets the last word, because the
  // flag can lag a purchase that just went through (the paywall lands here the
  // moment the store confirms). Only a no from both sends the visitor to the paywall.
  const [gate, setGate] = useState<"checking" | "pro" | "free">(isProUser ? "pro" : "checking");

  const healthName = t(
    Platform.OS === "ios" ? "settings.healthSection" : "settings.healthSectionAndroid"
  );
  const importDays = healthImportDays(Platform.OS === "ios" ? "ios" : "android");

  useEffect(() => {
    if (isProUser) {
      setGate("pro");
      return;
    }
    let alive = true;
    void isProCached().then((cached) => {
      if (!alive) return;
      if (cached) {
        setGate("pro");
        return;
      }
      setGate("free");
      router.replace("/paywall");
    });
    return () => {
      alive = false;
    };
  }, [isProUser, router]);

  const allowed = gate === "pro";

  useEffect(() => {
    if (!allowed) return;
    logEvent("pro_welcome_view");
    // Once per opening. The haptics module reads its on/off setting async, so
    // wait for it instead of firing into a cold cache.
    void getHapticsEnabled().then(() => hapticSuccess());
  }, [allowed]);

  // Re-read on every focus: the Health connect and the Insights screens are
  // visited from here and the answer is on the way back.
  const load = useCallback(async () => {
    try {
      const [stored, syncOn, trialStatus] = await Promise.all([
        getProWelcomeState(),
        getHealthSyncEnabled(profileId),
        getTrialStatus(),
      ]);
      setState(withHealthMirror(stored, syncOn));
      setTrial(trialStatus);
      // The day-1 nudge only exists to get Health connected.
      if (syncOn) void cancelTrialDay1Nudge();
    } catch (err) {
      logCrash(err, { screen: "proWelcome", op: "load" });
    }
  }, [profileId]);

  useFocusEffect(
    useCallback(() => {
      if (allowed) void load();
    }, [allowed, load])
  );

  function close() {
    if (router.canGoBack()) router.back();
    else router.replace(welcomeExitTarget(onboarded));
  }

  function connectHealth() {
    // The dashboard owns the one Health connect flow (permission, import,
    // backfill offer) and marks this step done once it succeeds. This screen
    // goes back to it with dismissTo: navigate pushed a SECOND dashboard on top
    // of the welcome and left the welcome buried underneath, one back press away.
    // The welcome then closes, so it asks to be told when the connect lands and
    // reopens itself if a step is still open (the listener outlives this screen).
    const connected = waitForProWelcomeStep("health", HEALTH_RETURN_WINDOW_MS);
    router.dismissTo({ pathname: "/(tabs)", params: { health: "connect" } });
    void (async () => {
      try {
        if (!(await connected)) return;
        if (shouldReturnToWelcome(await getProWelcomeState(), healthAvailable)) {
          router.push("/pro-welcome");
        }
      } catch (err) {
        logCrash(err, { screen: "proWelcome", op: "returnAfterConnect" });
      }
    })();
  }

  // Every button that leads elsewhere closes this modal first (leaveThen).
  function goTo(href: Href) {
    leaveThen(
      { canGoBack: () => router.canGoBack(), back: () => router.back(), push: (h) => router.push(h) },
      href
    );
  }

  async function openInsights() {
    await markProWelcomeStep("insights", "done");
    goTo("/insights");
  }

  async function openReminders() {
    await markProWelcomeStep("reminders", "done");
    goTo("/settings/reminders");
  }

  const features = welcomeFeatures(healthAvailable);
  const featureCopy: Record<WelcomeFeatureId, { title: string; body: string }> = {
    insights: { title: t("proWelcome.insightsTitle"), body: t("proWelcome.insightsBody") },
    pdf: { title: t("proWelcome.pdfTitle"), body: t("proWelcome.pdfBody") },
    cgm: { title: t("proWelcome.cgmTitle"), body: t("proWelcome.cgmBody") },
    health: {
      title: t("proWelcome.syncTitle", { health: healthName }),
      body: t("proWelcome.syncBody", { health: healthName }),
    },
    spike: { title: t("proWelcome.spikeTitle"), body: t("proWelcome.spikeBody") },
  };
  const linksOpen = welcomeLinksOpen(onboarded);
  const connectOpen = linksOpen && showConnectData(state, healthAvailable);
  const reminderOpen = linksOpen && showReminderStep(state);

  // Nothing of the checklist shows while the Pro check runs or once it has
  // sent the visitor to the paywall.
  if (!allowed) {
    return (
      <AppBackground>
        <View className="flex-1" />
      </AppBackground>
    );
  }

  return (
    <AppBackground>
      <View className="flex-1" style={{ paddingTop: insets.top }}>
        <ScreenHeader
          title={t("paywall.title")}
          onBack={close}
          backIcon="close"
          accessibilityLabel={t("common.close")}
        />
        <ScrollView
          contentContainerStyle={[{ paddingBottom: 24 }, columnPad(16)]}
          showsVerticalScrollIndicator={false}
        >
          <ProCelebration />

          <View style={{ marginTop: -SPACE.xl, alignItems: "center" }}>
            <FadeSlideIn delay={500}>
              <Txt
                kind="title"
                accessibilityRole="header"
                style={{ textAlign: "center", fontWeight: "800" }}
              >
                {t("proWelcome.title")}
              </Txt>
            </FadeSlideIn>
            <FadeSlideIn delay={600}>
              <Txt kind="body" tone="muted" style={{ textAlign: "center", marginTop: SPACE.sm }}>
                {t("proWelcome.subtitle")}
              </Txt>
              {trial?.active === true ? (
                <Txt
                  kind="caption"
                  tone="accent"
                  style={{ textAlign: "center", fontWeight: "800", marginTop: SPACE.sm }}
                >
                  {trial.daysLeft != null
                    ? t("settings.trialDaysLeft", { count: trial.daysLeft })
                    : t("settings.trialActive")}
                </Txt>
              ) : null}
            </FadeSlideIn>
          </View>

          <FadeSlideIn delay={760} style={{ marginTop: SPACE.xl }}>
            <Txt kind="caption" tone="muted" accessibilityRole="header" style={{ marginBottom: SPACE.sm, fontWeight: "700" }}>
              {t("proWelcome.unlockedHeading")}
            </Txt>
            <GlassCard glow style={{ paddingVertical: 0, paddingHorizontal: SPACE.lg }}>
              {features.map((id, i) => {
                const c = featureCopy[id];
                return (
                  <FeatureRow
                    key={id}
                    icon={FEATURE_ICON[id]}
                    title={c.title}
                    body={c.body}
                    last={i === features.length - 1}
                    onPress={id === "insights" && linksOpen ? () => void openInsights() : undefined}
                    hint={id === "insights" && linksOpen ? t("proWelcome.insightsCta") : undefined}
                  />
                );
              })}
            </GlassCard>
          </FadeSlideIn>

          {connectOpen || reminderOpen ? (
            <FadeSlideIn delay={900} style={{ marginTop: SPACE.xl }}>
              <Txt kind="caption" tone="muted" accessibilityRole="header" style={{ marginBottom: SPACE.sm, fontWeight: "700" }}>
                {t("proWelcome.nextHeading")}
              </Txt>
              <GlassCard style={{ paddingVertical: 0, paddingHorizontal: SPACE.lg }}>
                {connectOpen ? (
                  <NextStep
                    icon="heart-outline"
                    title={t("proWelcome.healthTitle")}
                    body={t("proWelcome.healthBody", { health: healthName, days: importDays })}
                    cta={t("proWelcome.connectCta")}
                    onCta={connectHealth}
                    last={!reminderOpen}
                  />
                ) : null}
                {reminderOpen ? (
                  <NextStep
                    icon="alarm-outline"
                    title={t("proWelcome.remindersTitle")}
                    body={t("proWelcome.remindersBody")}
                    cta={t("proWelcome.remindersCta")}
                    onCta={() => void openReminders()}
                    last
                  />
                ) : null}
              </GlassCard>
            </FadeSlideIn>
          ) : null}
        </ScrollView>

        <View
          style={[
            {
              borderTopWidth: 1,
              borderTopColor: THEME.border,
              backgroundColor: THEME.bg.g1,
              paddingTop: 12,
              paddingBottom: insets.bottom + 12,
            },
            columnPad(16),
          ]}
        >
          <GradientCTA label={t("proWelcome.start")} size="lg" onPress={close} />
        </View>
      </View>
      <FeedbackHost />
    </AppBackground>
  );
}

export default function ProWelcomeRoute() {
  return (
    <SafeAreaProvider>
      <ProWelcomeScreen />
    </SafeAreaProvider>
  );
}
