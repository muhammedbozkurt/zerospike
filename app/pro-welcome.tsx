import React, { useCallback, useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { AppBackground, GlassCard, GradientCTA, IconTile } from "../components/rich";
import { withAlpha } from "../components/rich/GlassCard";
import { ScreenHeader } from "../components/ScreenHeader";
import { FeedbackHost } from "../components/Feedback";
import { GLUCOSE_RICH, HIT_TARGET, THEME } from "../lib/theme/tokens";
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
  shouldReturnToWelcome,
  visibleSteps,
  withHealthMirror,
  type ProWelcomeState,
  type ProWelcomeStep,
} from "../lib/proWelcome";

function DoneChip({ label }: { label: string }) {
  return (
    <View
      className="flex-row items-center rounded-full px-2 py-0.5"
      style={{ gap: 4, backgroundColor: withAlpha(GLUCOSE_RICH.target, 0.16) }}
    >
      <Ionicons name="checkmark-circle" size={13} color={GLUCOSE_RICH.target} />
      <Text style={{ color: GLUCOSE_RICH.target, fontSize: 11, fontWeight: "800" }}>
        {label}
      </Text>
    </View>
  );
}

/**
 * One checklist step. Every string wraps (no single-line clip, no font
 * shrinking), so the longest translation just makes the card taller.
 */
function StepCard({
  icon,
  title,
  body,
  cta,
  done,
  skipped,
  primary,
  doneLabel,
  skippedLabel,
  skipLabel,
  onCta,
  onSkip,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  cta: string;
  done: boolean;
  skipped: boolean;
  primary: boolean;
  doneLabel: string;
  skippedLabel: string;
  skipLabel: string;
  onCta: () => void;
  onSkip: () => void;
}) {
  return (
    <GlassCard style={{ marginBottom: 12 }}>
      <View className="flex-row items-center" style={{ gap: 10 }}>
        <IconTile
          icon={done ? "checkmark" : icon}
          size={36}
          radius={12}
          hero={!done}
          tint={done ? GLUCOSE_RICH.target : THEME.accent}
        />
        <Text
          style={{ color: THEME.ink, fontSize: 15, fontWeight: "800", flex: 1, lineHeight: 20 }}
          accessibilityRole="header"
        >
          {title}
        </Text>
        {done ? <DoneChip label={doneLabel} /> : null}
      </View>
      <Text style={{ color: THEME.muted, fontSize: 13, lineHeight: 19, marginTop: 8 }}>
        {body}
      </Text>
      {!done ? (
        <View style={{ marginTop: 12 }}>
          {skipped ? (
            <Text style={{ color: THEME.muted, fontSize: 11, marginBottom: 6 }}>
              {skippedLabel}
            </Text>
          ) : null}
          <GradientCTA label={cta} variant={primary ? "primary" : "sub"} onPress={onCta} />
          {!skipped ? (
            <Pressable
              onPress={onSkip}
              accessibilityRole="button"
              accessibilityLabel={skipLabel}
              className="items-center justify-center"
              style={{ minHeight: HIT_TARGET }}
            >
              <Text style={{ color: THEME.muted, fontSize: 13 }}>{skipLabel}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </GlassCard>
  );
}

function ProWelcomeScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { columnPad } = useLayout();
  const { activeProfile, isProUser } = useApp();
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
    if (allowed) logEvent("pro_welcome_view");
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
    else router.replace("/(tabs)");
  }

  async function skip(step: ProWelcomeStep) {
    await markProWelcomeStep(step, "skipped");
    await load();
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

  async function openInsights() {
    await markProWelcomeStep("insights", "done");
    router.push("/insights");
  }

  async function openReminders() {
    await markProWelcomeStep("reminders", "done");
    router.push("/settings/reminders");
  }

  const steps = visibleSteps(healthAvailable);
  const firstOpen = steps.find((s) => state[s] !== "done");
  const copy: Record<
    ProWelcomeStep,
    { icon: keyof typeof Ionicons.glyphMap; title: string; body: string; cta: string; onCta: () => void }
  > = {
    health: {
      icon: "heart-outline",
      title: t("proWelcome.healthTitle"),
      body: t("proWelcome.healthBody", { health: healthName, days: importDays }),
      cta: t("proWelcome.healthCta"),
      onCta: connectHealth,
    },
    insights: {
      icon: "analytics-outline",
      title: t("proWelcome.insightsTitle"),
      body: t("proWelcome.insightsBody"),
      cta: t("proWelcome.insightsCta"),
      onCta: () => void openInsights(),
    },
    reminders: {
      icon: "alarm-outline",
      title: t("proWelcome.remindersTitle"),
      body: t("proWelcome.remindersBody"),
      cta: t("proWelcome.remindersCta"),
      onCta: () => void openReminders(),
    },
  };
  const allDone = steps.length > 0 && firstOpen === undefined;

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
          title={t("proWelcome.title")}
          onBack={close}
          backIcon="close"
          accessibilityLabel={t("common.close")}
        />
        <ScrollView
          contentContainerStyle={[
            { paddingTop: 8, paddingBottom: 24 },
            columnPad(16),
          ]}
          showsVerticalScrollIndicator={false}
        >
          <GlassCard glow style={{ marginBottom: 14, paddingVertical: 16 }}>
            <View className="flex-row items-center" style={{ gap: 10 }}>
              <IconTile icon="sparkles" size={40} radius={13} hero />
              <View style={{ flex: 1 }}>
                {trial?.active === true ? (
                  <Text
                    style={{ color: THEME.accent, fontSize: 12, fontWeight: "800", lineHeight: 17 }}
                  >
                    {trial.daysLeft != null
                      ? t("settings.trialDaysLeft", { count: trial.daysLeft })
                      : t("settings.trialActive")}
                  </Text>
                ) : null}
                <Text
                  style={{
                    color: THEME.ink,
                    fontSize: 13,
                    lineHeight: 19,
                    marginTop: trial?.active === true ? 2 : 0,
                  }}
                >
                  {t("proWelcome.subtitle")}
                </Text>
              </View>
            </View>
          </GlassCard>

          {steps.map((step) => {
            const c = copy[step];
            return (
              <StepCard
                key={step}
                icon={c.icon}
                title={c.title}
                body={c.body}
                cta={c.cta}
                done={state[step] === "done"}
                skipped={state[step] === "skipped"}
                primary={step === firstOpen}
                doneLabel={t("proWelcome.stepDone")}
                skippedLabel={t("proWelcome.stepSkipped")}
                skipLabel={t("proWelcome.notNow")}
                onCta={c.onCta}
                onSkip={() => void skip(step)}
              />
            );
          })}

          {allDone ? (
            <Text
              style={{
                color: THEME.muted,
                fontSize: 13,
                lineHeight: 19,
                textAlign: "center",
                marginTop: 4,
              }}
            >
              {t("proWelcome.allDone")}
            </Text>
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
          <GradientCTA label={t("common.continue")} onPress={close} />
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
