import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { SheetShell } from "./SheetShell";
import { Button } from "./ui";
import { DirIcon } from "./DirIcon";
import { useFeedback } from "./Feedback";
import { withAlpha } from "./rich/GlassCard";
import { HIDDEN_FROM_A11Y } from "../lib/a11y";
import { THEME } from "../lib/theme/tokens";
import { logEvent } from "../lib/analytics";
import { useApp } from "../lib/store/AppContext";
import { isScreenshotMode } from "../lib/screenshotMode";
import { onSurveyRelease, overlayOpen, surveyHeld } from "../lib/feedbackSurvey";
import { evaluateThanksNow } from "../lib/services/thanks";
import { getHealthConnectStatus, getHealthSyncEnabled, hasHealthProvider } from "../lib/services/health";
import { maybeRequestReview } from "../lib/services/review";
import { thanksMayPresent } from "../lib/thanks/gate";
import type { ThanksOutcome } from "../lib/thanks/detect";

/** Lets the sheet finish settling before the native review dialog goes up. */
const REVIEW_DELAY_MS = 900;
/** The sheet slides out before a route is pushed, so the two never overlap. */
const NAVIGATE_DELAY_MS = 450;

type CardId = "report" | "health" | "spike";

function NextCard({
  icon,
  title,
  body,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${body}`}
      className="flex-row items-center bg-glass border border-hair rounded-2xl px-3 py-3 mb-2 active:opacity-80"
    >
      <View
        {...HIDDEN_FROM_A11Y}
        className="rounded-xl items-center justify-center"
        style={{ width: 36, height: 36, backgroundColor: withAlpha(THEME.accent, 0.14) }}
      >
        <Ionicons name={icon} size={18} color={THEME.accent} />
      </View>
      <View className="flex-1 mx-3">
        <Text style={{ color: THEME.text, fontSize: 15, fontWeight: "600" }}>{title}</Text>
        <Text style={{ color: THEME.textMuted, fontSize: 13, lineHeight: 18, marginTop: 2 }}>{body}</Text>
      </View>
      <DirIcon name="chevron-forward" size={18} color={THEME.textMuted} />
    </Pressable>
  );
}

export function ThanksSheet({
  visible,
  showHealth,
  onClose,
  onShown,
  onCard,
}: {
  visible: boolean;
  showHealth: boolean;
  onClose: () => void;
  onShown: () => void;
  onCard: (id: CardId) => void;
}) {
  const { t } = useTranslation();
  const health = t(Platform.OS === "ios" ? "settings.healthSection" : "settings.healthSectionAndroid");
  return (
    <SheetShell
      scrollHintId="thanks"
      visible={visible}
      onClose={onClose}
      onShown={onShown}
      title={t("thanks.title")}
      closeLabel={t("common.close")}
      footer={<Button label={t("common.continue")} onPress={onClose} />}
      testID="thanks-sheet"
    >
      <View style={{ paddingTop: 4, paddingBottom: 8 }}>
        <Text style={{ color: THEME.text, fontSize: 15, lineHeight: 22 }}>{t("thanks.body")}</Text>
        <Text
          accessibilityRole="header"
          style={{ color: THEME.textMuted, fontSize: 12, fontWeight: "700", marginTop: 16, marginBottom: 8 }}
        >
          {t("thanks.nextLabel")}
        </Text>
        <NextCard
          icon="document-text-outline"
          title={t("thanks.reportTitle")}
          body={t("thanks.reportBody")}
          onPress={() => onCard("report")}
        />
        {showHealth ? (
          <NextCard
            icon="heart-outline"
            title={t("thanks.healthTitle", { health })}
            body={t("thanks.healthBody", { health })}
            onPress={() => onCard("health")}
          />
        ) : null}
        <NextCard
          icon="chatbubble-ellipses-outline"
          title={t("thanks.spikeTitle")}
          body={t("thanks.spikeBody")}
          onPress={() => onCard("spike")}
        />
      </View>
    </SheetShell>
  );
}

/** The Health card only makes sense where Health can be connected and is not connected yet. */
async function healthCardWanted(profileId: string | null): Promise<boolean> {
  try {
    if (!hasHealthProvider()) return false;
    if (Platform.OS === "android" && (await getHealthConnectStatus()) === "unavailable") return false;
    return !(await getHealthSyncEnabled(profileId));
  } catch {
    return false;
  }
}

/**
 * Mounted once under the root navigator. On launch and on each foreground it
 * takes ONE look at the entitlement (lib/services/thanks), but only while a
 * moment could really be shown (tab screen, no Modal up, nothing else
 * deciding), so an evaluation is never spent behind the paywall. The outcome is
 * already persisted when it arrives, so a result that has to wait for a clear
 * screen is held in memory and, if the app dies first, simply not shown.
 */
export function ThanksHost({ root }: { root: string | undefined }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { ready, onboarded, activeProfile } = useApp();
  const { toast } = useFeedback();
  const [visible, setVisible] = useState(false);
  const [showHealth, setShowHealth] = useState(false);
  const [pending, setPending] = useState<ThanksOutcome>("none");
  const [tick, setTick] = useState(0);

  const foreground = useRef(0);
  const evaluatedIn = useRef(-1);
  const alive = useRef(true);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const profileId = activeProfile?.id ?? null;
  const latest = useRef({ ready, onboarded, root, visible, profileId });
  latest.current = { ready, onboarded, root, visible, profileId };

  const later = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timers.current.delete(id);
      if (alive.current) fn();
    }, ms);
    timers.current.add(id);
  }, []);

  useEffect(() => {
    alive.current = true;
    const pendingTimers = timers.current;
    return () => {
      alive.current = false;
      pendingTimers.forEach(clearTimeout);
      pendingTimers.clear();
    };
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      foreground.current += 1;
      setTick((n) => n + 1);
    });
    const off = onSurveyRelease(() => setTick((n) => n + 1));
    return () => {
      sub.remove();
      off();
    };
  }, []);

  const clear = useCallback(() => {
    const s = latest.current;
    return thanksMayPresent({
      ready: s.ready,
      onboarded: s.onboarded,
      screenshotMode: isScreenshotMode(),
      root: s.root,
      overlayOpen: overlayOpen(),
      winbackHold: surveyHeld(),
      sheetVisible: s.visible,
    });
  }, []);

  useEffect(() => {
    if (pending !== "none" || evaluatedIn.current === foreground.current || !clear()) return;
    evaluatedIn.current = foreground.current;
    void evaluateThanksNow().then(async (outcome) => {
      if (outcome === "none" || !alive.current) return;
      if (outcome === "converted") setShowHealth(await healthCardWanted(latest.current.profileId));
      if (alive.current) setPending(outcome);
    });
  }, [pending, ready, onboarded, root, visible, tick, clear]);

  useEffect(() => {
    if (pending === "none" || !clear()) return;
    setPending("none");
    if (pending === "converted") {
      logEvent("trial_converted_seen");
      setVisible(true);
    } else {
      logEvent("renewal_seen");
      toast(t("thanks.renewalToast"), "success");
    }
  }, [pending, ready, onboarded, root, visible, tick, clear, toast, t]);

  const close = useCallback(() => setVisible(false), []);

  const onShown = useCallback(() => {
    later(() => void maybeRequestReview("trial_converted"), REVIEW_DELAY_MS);
  }, [later]);

  const onCard = useCallback(
    (id: CardId) => {
      setVisible(false);
      later(() => {
        if (id === "report") router.push("/settings/data");
        else if (id === "spike") router.push("/spike");
        else router.navigate({ pathname: "/(tabs)", params: { health: "connect" } });
      }, NAVIGATE_DELAY_MS);
    },
    [later, router]
  );

  return <ThanksSheet visible={visible} showHealth={showHealth} onClose={close} onShown={onShown} onCard={onCard} />;
}
