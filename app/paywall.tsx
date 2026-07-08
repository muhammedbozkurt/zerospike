import React, { useEffect, useState } from "react";
import { Linking, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { useApp } from "../lib/store/AppContext";
import {
  purchasePro,
  restore,
  loadOfferings,
  type OfferingsResult,
  PlanId,
} from "../lib/services/purchases";
import {
  canShowDownsell,
  getDownsellState,
  recordDownsellShown,
  type DownsellTrigger,
} from "../lib/services/downsell";
import { scheduleTrialEndingReminder } from "../lib/services/notifications";
import { FREE_CUSTOM_FOOD_LIMIT } from "../lib/guardrails";
import { privacyUrl, termsUrl } from "../lib/legal";
import { logEvent } from "../lib/analytics";
import { Button } from "../components/ui";
import { useFeedback } from "../components/Feedback";
import { hapticSelect, hapticSuccess } from "../lib/haptics";

/** Default free-trial length for the annual plan (RC intro offer). */
const TRIAL_DAYS = 7;

/** Formats a raw amount in its store currency (for derived per-month / savings). */
function fmtMoney(amount: number, currencyCode: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currencyCode,
    }).format(amount);
  } catch {
    return String(Math.round(amount * 100) / 100);
  }
}

function FeatureGroup({ title, items }: { title: string; items: string[] }) {
  return (
    <View className="mb-4">
      <Text className="text-brand text-xs font-bold uppercase tracking-wider mb-2">
        {title}
      </Text>
      {items.map((text, i) => (
        <View key={i} className="flex-row items-center mb-2">
          <Ionicons name="checkmark-circle" size={16} color="#22d3ee" />
          <Text className="text-zinc-200 flex-1 ml-2.5 text-[13px]">{text}</Text>
        </View>
      ))}
    </View>
  );
}

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
  price: string;
  period: string;
  badge?: string;
  save?: string;
}) {
  return (
    <Pressable
      onPress={onSelect}
      className={`rounded-2xl border p-4 flex-row items-center mb-3 ${
        selected ? "border-brand bg-brand/10" : "border-zinc-800 bg-zinc-900"
      }`}
    >
      <View
        className={`w-5 h-5 rounded-full border-2 items-center justify-center mr-3 ${
          selected ? "border-brand" : "border-zinc-600"
        }`}
      >
        {selected ? <View className="w-2.5 h-2.5 rounded-full bg-brand" /> : null}
      </View>

      <View className="flex-1">
        <View className="flex-row items-center flex-wrap">
          <Text className="text-zinc-50 font-bold text-base mr-2">{name}</Text>
          {badge ? (
            <View className="rounded-full bg-brand px-2 py-0.5 mr-2">
              <Text className="text-black text-[10px] font-bold">{badge}</Text>
            </View>
          ) : null}
          {save ? (
            <View className="rounded-full bg-emerald-500/15 px-2 py-0.5">
              <Text className="text-emerald-400 text-[10px] font-bold">{save}</Text>
            </View>
          ) : null}
        </View>
        <Text className="text-zinc-400 text-xs mt-0.5" numberOfLines={2}>
          {desc}
        </Text>
        {foot ? <Text className="text-zinc-500 text-[11px] mt-0.5">{foot}</Text> : null}
      </View>

      <View className="items-end ml-2">
        <Text className="text-zinc-50 font-bold text-base">{price}</Text>
        <Text className="text-zinc-500 text-xs">{period}</Text>
      </View>
    </Pressable>
  );
}

export default function PaywallScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { reason, context: ctxParam } = useLocalSearchParams<{
    reason?: string;
    context?: string;
  }>();
  const context: DownsellTrigger =
    ctxParam === "onboarding" ? "onboarding" : "inapp";
  const { refreshPro, completeOnboarding } = useApp();
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

  useEffect(() => {
    if (!offer) return;
    logEvent("paywall_view", {
      source: reason ?? "direct",
      trial_eligible: annualTrial,
    });
  }, [offer, reason, annualTrial]);

  const priceStr = (p: PlanId) => plans[p]?.priceString ?? "";

  // Derived, currency-correct: annual per-month and savings vs 12 months.
  const monthly = plans.monthly;
  const annual = plans.annual;
  const savePct =
    monthly && annual && monthly.price > 0
      ? Math.round((1 - annual.price / (monthly.price * 12)) * 100)
      : 0;
  const annualPerMonth =
    annual && annual.price > 0
      ? fmtMoney(annual.price / 12, annual.currencyCode)
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

  async function dismiss() {
    logEvent("paywall_dismiss", { source: reason ?? "direct" });
    // Dismissing the paywall is the downsell trigger: first time always, then a
    // single 7-day re-armed retry, capped at 2 lifetime shows.
    const state = await getDownsellState();
    if (canShowDownsell(state, Date.now())) {
      await recordDownsellShown(context, Date.now());
      router.replace({ pathname: "/downsell", params: { trigger: context } });
      return;
    }
    await exit();
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
            : reason === "pens"
              ? { title: t("paywall.limitTitlePens"), body: t("paywall.limitBodyPens") }
              : null;

  async function buy() {
    if (busy) return;
    setBusy(true);
    try {
      const ok = await purchasePro(plan);
      await refreshPro();
      if (ok) {
        logEvent("purchase_completed", { tier: plan });
        if (plan === "annual" && annualTrial) {
          logEvent("trial_started", { tier: "annual" });
          scheduleTrialEndingReminder(TRIAL_DAYS).catch(() => {});
        }
        hapticSuccess();
        toast(t("paywall.activated"), "success");
        await exit();
      }
      // cancelled or failed → stay on the paywall, no message
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
  const ctaLabel = ctaTrial
    ? t("paywall.ctaTrial")
    : `${t("paywall.cta")} · ${priceStr(plan)}${ctaPeriod}`;

  const loading = offer === null;
  const unavailable = offer?.status === "unavailable";

  return (
    <View className="flex-1 bg-zinc-950" style={{ paddingTop: insets.top }}>
      <View className="flex-row justify-end px-4 py-2">
        <Pressable onPress={dismiss} hitSlop={10} className="p-1">
          <Ionicons name="close" size={26} color="#71717a" />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 24 }}
        showsVerticalScrollIndicator={false}
      >
        <View className="items-center mb-6">
          <View className="w-16 h-16 rounded-3xl bg-brand/15 items-center justify-center mb-4">
            <Ionicons name="sparkles" size={28} color="#22d3ee" />
          </View>
          <Text className="text-zinc-50 text-3xl font-bold">
            {t("paywall.title")}
          </Text>
          <Text className="text-zinc-400 text-center mt-2 px-2">
            {t("paywall.subtitle")}
          </Text>
        </View>

        {limit ? (
          <View className="rounded-2xl bg-amber-500/10 border border-amber-500/30 p-4 mb-6">
            <Text className="text-amber-300 font-semibold mb-1">{limit.title}</Text>
            <Text className="text-amber-200/80 text-sm leading-5">{limit.body}</Text>
          </View>
        ) : null}

        {/* Grouped benefits */}
        <View className="rounded-2xl bg-zinc-900 border border-zinc-800 p-5 mb-6">
          <FeatureGroup
            title={t("paywall.groupTracking")}
            items={[
              // Health sync is iOS-only (Health Connect removed for Play policy).
              ...(Platform.OS === "ios" ? [t("paywall.featureHealthSync")] : []),
              t("paywall.featureCustomFoods"),
              t("paywall.featureFamily"),
            ]}
          />
          <FeatureGroup
            title={t("paywall.groupInjection")}
            items={[t("paywall.featureInjection"), t("paywall.featurePens")]}
          />
          <FeatureGroup
            title={t("paywall.groupInsights")}
            items={[
              t("paywall.featureInsights"),
              t("paywall.featurePdf"),
              t("paywall.featureExport"),
            ]}
          />
        </View>

        {loading ? (
          <View className="items-center py-8">
            <Text className="text-zinc-500">{t("common.loading")}</Text>
          </View>
        ) : unavailable ? (
          // Release-only: prices could not be loaded. Never show fake prices —
          // offer a retry instead.
          <View className="rounded-2xl bg-zinc-900 border border-zinc-800 p-5 items-center">
            <Ionicons name="cloud-offline-outline" size={28} color="#71717a" />
            <Text className="text-zinc-300 text-center mt-3 mb-4">
              {t("paywall.pricesUnavailable")}
            </Text>
            <Button
              label={t("paywall.retry")}
              onPress={() => setReloadToken((n) => n + 1)}
            />
          </View>
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
                annualTrial ? t("paywall.annualTrialDesc") : t("paywall.annualDesc")
              }
              foot={
                annualPerMonth
                  ? t("paywall.perMonthApprox", { price: annualPerMonth })
                  : undefined
              }
              price={priceStr("annual")}
              period={t("paywall.perYear")}
              badge={t("paywall.mostPopular")}
              save={savePct > 0 ? t("paywall.savePercent", { percent: savePct }) : undefined}
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
            <Button label={ctaLabel} size="lg" loading={busy} onPress={buy} />

            {ctaTrial ? (
              <Text className="text-zinc-400 text-xs text-center mt-2 px-2 leading-4">
                {t("paywall.trialNote")}
              </Text>
            ) : null}

            {/* Secure payment */}
            <View className="flex-row items-center justify-center mt-3">
              <Ionicons name="lock-closed" size={12} color="#52525b" />
              <Text className="text-zinc-500 text-xs ml-1.5 text-center">
                {t("paywall.securePayment")}
              </Text>
            </View>

            <Pressable onPress={onRestore} disabled={busy} className="py-3 items-center">
              <Text className={`font-medium ${busy ? "text-zinc-600" : "text-zinc-400"}`}>
                {t("paywall.restore")}
              </Text>
            </Pressable>
          </>
        )}

        <Text className="text-zinc-600 text-[11px] text-center px-2 leading-4 mb-3 mt-2">
          {t("paywall.legalNote")}
        </Text>
        <View className="flex-row justify-center gap-6">
          <Pressable onPress={() => Linking.openURL(privacyUrl())}>
            <Text className="text-zinc-500 text-xs underline">
              {t("settings.privacy")}
            </Text>
          </Pressable>
          <Pressable onPress={() => Linking.openURL(termsUrl())}>
            <Text className="text-zinc-500 text-xs underline">
              {t("settings.terms")}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
