import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  AppBackground,
  GlassCard,
  GradientCTA,
  IconTile,
} from "../components/rich";
import { withAlpha } from "../components/rich/GlassCard";
import { GLUCOSE_RICH, MODAL_TOP_PAD, TABULAR, THEME, glow } from "../lib/theme/tokens";
import { money, pct } from "../lib/format";
import { useTranslation } from "react-i18next";

import { useApp } from "../lib/store/AppContext";
import {
  purchasePro,
  restore,
  loadOfferings,
  getDownsellOffer,
  type OfferingsResult,
  PlanId,
} from "../lib/services/purchases";
import {
  canShowDownsell,
  getDownsellState,
  recordDownsellShown,
  type DownsellTrigger,
} from "../lib/services/downsell";
import { purchaseToastFor } from "../lib/services/purchaseFlow";
import {
  cancelTrialReminder,
  scheduleTrialEndingReminder,
} from "../lib/services/notifications";
import { FREE_CUSTOM_FOOD_LIMIT } from "../lib/guardrails";
import { privacyUrl, termsUrl } from "../lib/legal";
import { logEvent } from "../lib/analytics";
import { FeedbackHost, useFeedback } from "../components/Feedback";
import { LanguageChip } from "../components/onboarding/LanguageChip";
import { hapticSelect, hapticSuccess } from "../lib/haptics";
import { insulinModeUsesInsulin } from "../lib/insulinMode";

/** Used only if the annual plan's own offering data has no trial length. */
const FALLBACK_TRIAL_DAYS = 7;

/**
 * A plan row in the mockup's 08 composition: the plan name and its terms on the
 * left, and the BILLED AMOUNT as the dominant figure on the right. The selected
 * plan is lit with an accent border, an accent wash and a glow; selection is
 * also carried by the radio, so it never rests on colour alone.
 */
function PlanCard({
  selected,
  onSelect,
  name,
  desc,
  foot,
  price,
  period,
  badge,
  save,
}: {
  selected: boolean;
  onSelect: () => void;
  name: string;
  desc: string;
  foot?: string;
  price: string | null;
  period: string;
  badge?: string;
  save?: string;
}) {
  return (
    <Pressable
      onPress={onSelect}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className="rounded-2xl p-4 flex-row items-center mb-3"
      style={[
        {
          borderWidth: 1,
          borderColor: selected ? THEME.accent : THEME.border,
          backgroundColor: selected ? withAlpha(THEME.accent, 0.12) : THEME.glass,
        },
        selected ? glow(THEME.accent, 24, 0.45) : undefined,
      ]}
    >
      <View
        className="w-5 h-5 rounded-full items-center justify-center mr-3"
        style={{ borderWidth: 2, borderColor: selected ? THEME.accent : THEME.border }}
      >
        {selected ? (
          <View
            style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: THEME.accent }}
          />
        ) : null}
      </View>

      <View className="flex-1">
        <View className="flex-row items-center flex-wrap" style={{ gap: 6 }}>
          <Text style={{ color: THEME.ink, fontWeight: "800", fontSize: 15 }}>{name}</Text>
          {badge ? (
            <View className="rounded-full bg-brand px-2 py-0.5">
              <Text className="text-black text-[10px] font-bold">{badge}</Text>
            </View>
          ) : null}
          {save ? (
            <View
              className="rounded-full px-2 py-0.5"
              style={{ backgroundColor: withAlpha(GLUCOSE_RICH.target, 0.16) }}
            >
              <Text style={{ color: GLUCOSE_RICH.target, fontSize: 10, fontWeight: "800" }}>
                {save}
              </Text>
            </View>
          ) : null}
        </View>
        <Text style={{ color: THEME.muted, fontSize: 11, marginTop: 2 }} numberOfLines={2}>
          {desc}
        </Text>
        {foot ? (
          <Text style={{ color: THEME.muted, fontSize: 11, marginTop: 1 }}>{foot}</Text>
        ) : null}
      </View>

      {/* The billed amount, dominant. A plan whose store price is missing shows a
          placeholder bar instead of an empty slot in the loudest spot on the row. */}
      <View className="items-end ml-2">
        {price ? (
          <Text style={[TABULAR, { color: THEME.ink, fontSize: 20, fontWeight: "800" }]}>
            {price}
          </Text>
        ) : (
          <View
            style={{
              width: 56,
              height: 20,
              borderRadius: 6,
              backgroundColor: THEME.track,
            }}
          />
        )}
        <Text style={{ color: THEME.muted, fontSize: 11 }}>{period}</Text>
      </View>
    </Pressable>
  );
}

function PaywallScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { reason, context: ctxParam } = useLocalSearchParams<{
    reason?: string;
    context?: string;
  }>();
  const context: DownsellTrigger =
    ctxParam === "onboarding" ? "onboarding" : "inapp";
  const { refreshPro, completeOnboarding, activeProfile, isProUser } = useApp();
  const { toast } = useFeedback();
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<PlanId>("annual");
  const [offer, setOffer] = useState<OfferingsResult | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  // Real localized store prices + trial state. In release, a failed fetch
  // yields status 'unavailable' (never a hardcoded fallback) → retry state.
  useEffect(() => {
    let alive = true;
    setOffer(null);
    loadOfferings()
      .then((r) => alive && setOffer(r))
      .catch(() => alive && setOffer({ status: "unavailable", isDevFallback: false, plans: {} }));
    return () => {
      alive = false;
    };
  }, [reloadToken]);

  const plans = offer?.plans ?? {};
  const annualTrial = plans.annual?.hasFreeTrial ?? false;
  // Store-reported trial length (RC intro offer), so an A/B on the trial
  // length never needs a code change; falls back to the shipped default.
  const trialDays = plans.annual?.freeTrialDays || FALLBACK_TRIAL_DAYS;

  useEffect(() => {
    if (!offer) return;
    logEvent("paywall_view", {
      source: reason ?? "direct",
      trial_eligible: annualTrial,
    });
  }, [offer, reason, annualTrial]);

  // null, not "": a missing store price must never render as an empty gap where
  // the billed amount belongs.
  const priceStr = (p: PlanId) => plans[p]?.priceString ?? null;

  // Derived, currency-correct: annual per-month and savings vs 12 months.
  const monthly = plans.monthly;
  const annual = plans.annual;
  const savePct =
    monthly && annual && monthly.price > 0
      ? Math.round((1 - annual.price / (monthly.price * 12)) * 100)
      : 0;
  const annualPerMonth =
    annual && annual.price > 0
      ? money(annual.price / 12, annual.currencyCode)
      : null;

  function selectPlan(p: PlanId) {
    hapticSelect();
    logEvent("paywall_tier_selected", { tier: p });
    setPlan(p);
  }

  // Leaves the paywall. During onboarding it completes onboarding first so the
  // app does not bounce back to the quiz.
  async function exit() {
    if (context === "onboarding") {
      await completeOnboarding();
      router.replace("/(tabs)");
    } else if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)");
    }
  }

  // Downsell trigger, shared by an explicit dismiss and a cancelled purchase:
  // first time always, then a single 7-day re-armed retry, capped at 2 lifetime
  // shows. An active Pro/trial user is never shown a discount on their own
  // subscription, and a lifetime show is only spent once a REAL discount is
  // confirmed to exist - never on an empty offering. Falls back to exit
  // otherwise.
  async function triggerDownsell() {
    if (isProUser) {
      await exit();
      return;
    }
    const state = await getDownsellState();
    if (!canShowDownsell(state, Date.now())) {
      await exit();
      return;
    }
    const offer = await getDownsellOffer();
    if (!offer.hasRealDiscount) {
      await exit();
      return;
    }
    await recordDownsellShown(context, Date.now());
    router.replace({ pathname: "/downsell", params: { trigger: context } });
  }

  async function dismiss() {
    logEvent("paywall_dismiss", { source: reason ?? "direct" });
    await triggerDownsell();
  }

  const limit =
    reason === "health"
      ? { title: t("paywall.limitTitleHealth"), body: t("paywall.limitBodyHealth") }
      : reason === "foods"
        ? {
            title: t("paywall.limitTitleFoods"),
            body: t("paywall.limitBodyFoods", { limit: FREE_CUSTOM_FOOD_LIMIT }),
          }
        : reason === "profiles"
          ? { title: t("paywall.limitTitleProfiles"), body: t("paywall.limitBodyProfiles") }
          : reason === "rotation"
            ? { title: t("paywall.limitTitleRotation"), body: t("paywall.limitBodyRotation") }
            : reason === "mealResponse"
              ? { title: t("paywall.limitTitleMealResponse"), body: t("paywall.limitBodyMealResponse") }
              : null;

  async function buy() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await purchasePro(plan);
      await refreshPro();
      const feedback = purchaseToastFor(res);
      if (res.ok) {
        logEvent("purchase_completed", { tier: plan });
        if (plan === "annual" && annualTrial) {
          // A fresh trial starts: schedule its own ending reminder. Scheduling
          // uses the same fixed identifier as cancelTrialReminder, so it already
          // replaces any stale one on its own - calling cancel here too would
          // race the two un-awaited calls and risk cancelling the one just armed.
          logEvent("trial_started", { tier: "annual" });
          scheduleTrialEndingReminder(trialDays).catch(() => {});
        } else {
          // No trial in this purchase (lifetime, monthly, or a non-trial annual):
          // any trial-ending reminder left over from an earlier trial must not
          // survive a completed purchase.
          cancelTrialReminder().catch(() => {});
        }
        hapticSuccess();
        // Success, or an already-owned recovery ("this is already yours").
        if (feedback) toast(t(feedback.key), feedback.kind);
        await exit();
      } else if (res.cancelled) {
        // A cancelled purchase is a downsell trigger too (same lifetime cap).
        await triggerDownsell();
      } else if (feedback) {
        // Real store error: an honest message instead of a silent stay.
        toast(t(feedback.key), feedback.kind);
      }
    } finally {
      setBusy(false);
    }
  }

  async function onRestore() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await restore();
      await refreshPro();
      if (result === "restored") {
        // A restored entitlement is already paid (lifetime or subscription): any
        // trial-ending reminder from an earlier trial no longer applies.
        cancelTrialReminder().catch(() => {});
        hapticSuccess();
        toast(t("paywall.restored"), "success");
        await exit();
      } else if (result === "none") {
        toast(t("paywall.nothingToRestore"), "info");
      } else {
        toast(t("paywall.restoreFailed"), "error");
      }
    } finally {
      setBusy(false);
    }
  }

  const ctaPeriod =
    plan === "monthly"
      ? t("paywall.perMonth")
      : plan === "annual"
        ? t("paywall.perYear")
        : ` ${t("paywall.perOnce")}`;
  const ctaTrial = plan === "annual" && annualTrial;
  // scheduleTrialEndingReminder skips scheduling entirely once trialDays leaves
  // no room before its 2-day lead (trialDays <= 2), so the "we'll remind you"
  // note must not promise a reminder that is never actually armed.
  const trialReminderArmed = trialDays > 2;
  const selectedPrice = priceStr(plan);
  const ctaLabel = ctaTrial
    ? t("paywall.ctaTrial", { days: trialDays })
    : selectedPrice
      ? `${t("paywall.cta")} · ${selectedPrice}${ctaPeriod}`
      : t("paywall.cta");

  const loading = offer === null;
  const unavailable = offer?.status === "unavailable";

  return (
    <AppBackground>
      <View
        className="flex-1"
        style={{ paddingTop: Math.max(insets.top, MODAL_TOP_PAD) }}
      >
        {/* Header (mockup 08: free exit left, title centred, close right) */}
        <View className="flex-row items-center justify-between px-4 py-2">
          <Pressable onPress={dismiss} hitSlop={10} className="px-1 py-1" style={{ flexShrink: 1 }}>
            <Text
              style={{ color: THEME.muted, fontWeight: "600", fontSize: 13, flexShrink: 1 }}
              numberOfLines={1}
            >
              {t("paywall.notNow")}
            </Text>
          </Pressable>
          <Text
            style={{
              color: THEME.ink,
              fontSize: 16,
              fontWeight: "800",
              flexShrink: 1,
              minWidth: 0,
              marginHorizontal: 8,
            }}
            numberOfLines={1}
          >
            {t("paywall.title")}
          </Text>
          <View className="flex-row items-center" style={{ flexShrink: 0 }}>
            {context === "onboarding" ? (
              <View className="mr-2">
                <LanguageChip />
              </View>
            ) : null}
            <Pressable
              onPress={dismiss}
              hitSlop={10}
              accessibilityLabel={t("common.close")}
            >
              <IconTile icon="close" size={30} radius={10} tint={THEME.muted} />
            </Pressable>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 24 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Hero: one compact glow card, the value stated in a single line */}
          <GlassCard glow style={{ alignItems: "center", paddingVertical: 16, marginBottom: 14 }}>
            <Text style={{ fontSize: 30 }}>📄</Text>
            <Text
              style={{
                color: THEME.muted,
                fontSize: 12,
                lineHeight: 18,
                textAlign: "center",
                marginTop: 6,
              }}
            >
              {t("paywall.subtitle")}
            </Text>
          </GlassCard>

          {limit ? (
            <View
              className="rounded-2xl p-4 mb-4"
              style={{
                borderWidth: 1,
                borderColor: withAlpha(GLUCOSE_RICH.high, 0.3),
                backgroundColor: withAlpha(GLUCOSE_RICH.high, 0.1),
              }}
            >
              <Text style={{ color: GLUCOSE_RICH.high, fontWeight: "800", marginBottom: 2 }}>
                {limit.title}
              </Text>
              <Text style={{ color: THEME.ink, fontSize: 13, lineHeight: 19, opacity: 0.85 }}>
                {limit.body}
              </Text>
            </View>
          ) : null}

          {/* Benefits: a single, focused list (at most 4 rows). Health sync is
              iOS-only (Health Connect removed for Play policy), so on Android it
              drops off and an injection benefit fills the slot. The injection
              benefit itself only applies to a profile that actually doses, so an
              insulin-free / undiagnosed user never sees it. */}
          <GlassCard style={{ paddingVertical: 16, marginBottom: 16 }}>
            {[
              ...(Platform.OS === "ios" ? [t("paywall.featureHealthSync")] : []),
              t("paywall.featureInsights"),
              t("paywall.featureFamily"),
              t("paywall.featurePdf"),
              ...(insulinModeUsesInsulin(activeProfile?.insulin_mode)
                ? [t("paywall.featureInjection")]
                : []),
            ]
              .slice(0, 4)
              .map((text, i, arr) => (
                <View
                  key={i}
                  className={`flex-row items-center ${i < arr.length - 1 ? "mb-3" : ""}`}
                >
                  <Ionicons name="checkmark-circle" size={17} color={THEME.accent} />
                  <Text style={{ color: THEME.ink, flex: 1, marginLeft: 10, fontSize: 13 }}>
                    {text}
                  </Text>
                </View>
              ))}
          </GlassCard>

          {loading ? (
            // Same waiting composition as downsell / winback: a spinner carries
            // the wait so the plan slot never reads as a broken empty band.
            <GlassCard style={{ alignItems: "center", paddingVertical: 28 }}>
              <ActivityIndicator color={THEME.accent} />
              <Text style={{ color: THEME.muted, marginTop: 10 }}>
                {t("common.loading")}
              </Text>
            </GlassCard>
          ) : unavailable ? (
            // Release-only: prices could not be loaded. Never show fake prices;
            // offer a retry instead.
            <GlassCard style={{ alignItems: "center", paddingVertical: 20 }}>
              <IconTile icon="cloud-offline-outline" size={44} radius={14} tint={THEME.muted} />
              <Text
                style={{ color: THEME.muted, textAlign: "center", marginTop: 12, marginBottom: 14 }}
              >
                {t("paywall.pricesUnavailable")}
              </Text>
              <GradientCTA
                label={t("paywall.retry")}
                onPress={() => setReloadToken((n) => n + 1)}
                style={{ alignSelf: "stretch" }}
              />
            </GlassCard>
          ) : (
            <>
              {/* Plans */}
              <PlanCard
                selected={plan === "monthly"}
                onSelect={() => selectPlan("monthly")}
                name={t("paywall.planMonthly")}
                desc={t("paywall.monthlyDesc")}
                price={priceStr("monthly")}
                period={t("paywall.perMonth")}
              />
              <PlanCard
                selected={plan === "annual"}
                onSelect={() => selectPlan("annual")}
                name={t("paywall.planAnnual")}
                desc={
                  annualTrial
                    ? t("paywall.annualTrialDesc", { days: trialDays })
                    : t("paywall.annualDesc")
                }
                foot={
                  annualPerMonth
                    ? t("paywall.perMonthApprox", { price: annualPerMonth })
                    : undefined
                }
                price={priceStr("annual")}
                period={t("paywall.perYear")}
                badge={t("paywall.mostPopular")}
                save={savePct > 0 ? t("paywall.savePercent", { percent: pct(savePct) }) : undefined}
              />
              <PlanCard
                selected={plan === "lifetime"}
                onSelect={() => selectPlan("lifetime")}
                name={t("paywall.planLifetime")}
                desc={t("paywall.lifetimeDesc")}
                price={priceStr("lifetime")}
                period={t("paywall.perOnce")}
              />

              <View className="h-2" />
              <GradientCTA label={ctaLabel} disabled={busy} onPress={buy} />

              {ctaTrial && trialReminderArmed ? (
                <Text
                  style={{
                    color: THEME.muted,
                    fontSize: 11,
                    textAlign: "center",
                    marginTop: 8,
                    lineHeight: 16,
                    paddingHorizontal: 8,
                  }}
                >
                  {t("paywall.trialNote")}
                </Text>
              ) : null}

              {/* Secure payment */}
              <View className="flex-row items-center justify-center mt-3">
                <Ionicons name="lock-closed" size={12} color={THEME.muted} />
                <Text
                  style={{ color: THEME.muted, fontSize: 11, marginLeft: 6, textAlign: "center" }}
                >
                  {t("paywall.securePayment")}
                </Text>
              </View>

              <Pressable onPress={onRestore} disabled={busy} className="py-3 items-center">
                <Text style={{ color: THEME.muted, fontWeight: "600", opacity: busy ? 0.5 : 1 }}>
                  {t("paywall.restore")}
                </Text>
              </Pressable>
            </>
          )}

          <Text
            style={{
              color: THEME.muted,
              fontSize: 11,
              textAlign: "center",
              paddingHorizontal: 8,
              lineHeight: 16,
              marginTop: 8,
              marginBottom: 12,
            }}
          >
            {t("paywall.legalNote")}
          </Text>
          <View className="flex-row justify-center" style={{ gap: 24 }}>
            <Pressable onPress={() => Linking.openURL(privacyUrl())}>
              <Text
                style={{ color: THEME.muted, fontSize: 11, textDecorationLine: "underline" }}
              >
                {t("settings.privacy")}
              </Text>
            </Pressable>
            <Pressable onPress={() => Linking.openURL(termsUrl())}>
              <Text
                style={{ color: THEME.muted, fontSize: 11, textDecorationLine: "underline" }}
              >
                {t("settings.terms")}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
      <FeedbackHost />
    </AppBackground>
  );
}

export default function PaywallRoute() {
  return (
    <SafeAreaProvider>
      <PaywallScreen />
    </SafeAreaProvider>
  );
}
