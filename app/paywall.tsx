import React, { useEffect, useState } from "react";
import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { useApp } from "../lib/store/AppContext";
import {
  purchasePro,
  restore,
  priceFor,
  getOfferingPrices,
  PRO_PRODUCTS,
  PlanId,
} from "../lib/services/purchases";
import { FREE_LOG_LIMIT, FREE_CUSTOM_FOOD_LIMIT } from "../lib/guardrails";
import { privacyUrl, termsUrl } from "../lib/legal";
import { logEvent } from "../lib/analytics";
import { Button } from "../components/ui";
import { useFeedback } from "../components/Feedback";
import { hapticSelect, hapticSuccess } from "../lib/haptics";

/** Annual savings vs paying monthly for a year (locale-independent USD ratio). */
function annualSavingsPct(): number {
  const n = (s: string) => parseFloat(s.replace(/[^0-9.]/g, "")) || 0;
  const m = n(PRO_PRODUCTS.monthly.priceUSD);
  const a = n(PRO_PRODUCTS.annual.priceUSD);
  return m > 0 && a > 0 ? Math.round((1 - a / (m * 12)) * 100) : 0;
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
  price,
  period,
  badge,
  save,
}: {
  selected: boolean;
  onSelect: () => void;
  name: string;
  desc: string;
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
  const { reason } = useLocalSearchParams<{ reason?: string }>();
  const { refreshPro, lang } = useApp();
  const { toast } = useFeedback();
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<PlanId>("annual");
  const [prices, setPrices] = useState<Partial<Record<PlanId, string>>>({});

  // Real localized store prices (no-op/empty in mock mode → static fallback).
  useEffect(() => {
    getOfferingPrices()
      .then(setPrices)
      .catch(() => {});
  }, []);

  useEffect(() => {
    logEvent("paywall_view", { source: reason ?? "direct", trial_eligible: false });
  }, [reason]);

  const price = (p: PlanId) => prices[p] ?? priceFor(p, lang);
  const savePct = annualSavingsPct();

  function selectPlan(p: PlanId) {
    hapticSelect();
    logEvent("paywall_tier_selected", { tier: p });
    setPlan(p);
  }

  function dismiss() {
    logEvent("paywall_dismiss", { source: reason ?? "direct" });
    router.back();
  }

  const limit =
    reason === "logs"
      ? {
          title: t("paywall.limitTitleLogs"),
          body: t("paywall.limitBodyLogs", { limit: FREE_LOG_LIMIT }),
        }
      : reason === "foods"
      ? {
          title: t("paywall.limitTitleFoods"),
          body: t("paywall.limitBodyFoods", { limit: FREE_CUSTOM_FOOD_LIMIT }),
        }
      : reason === "profiles"
      ? {
          title: t("paywall.limitTitleProfiles"),
          body: t("paywall.limitBodyProfiles"),
        }
      : reason === "rotation"
      ? {
          title: t("paywall.limitTitleRotation"),
          body: t("paywall.limitBodyRotation"),
        }
      : reason === "pens"
      ? {
          title: t("paywall.limitTitlePens"),
          body: t("paywall.limitBodyPens"),
        }
      : null;

  async function buy() {
    if (busy) return;
    setBusy(true);
    try {
      const ok = await purchasePro(plan);
      await refreshPro();
      if (ok) {
        logEvent("purchase_completed", { tier: plan });
        hapticSuccess();
        toast(t("paywall.activated"), "success");
        router.back();
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
        router.back();
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
              t("paywall.featureUnlimited"),
              t("paywall.featureFavorites"),
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

        {/* Plans */}
        <PlanCard
          selected={plan === "monthly"}
          onSelect={() => selectPlan("monthly")}
          name={t("paywall.planMonthly")}
          desc={t("paywall.monthlyDesc")}
          price={price("monthly")}
          period={t("paywall.perMonth")}
        />
        <PlanCard
          selected={plan === "annual"}
          onSelect={() => selectPlan("annual")}
          name={t("paywall.planAnnual")}
          desc={t("paywall.annualDesc")}
          price={price("annual")}
          period={t("paywall.perYear")}
          badge={t("paywall.mostPopular")}
          save={savePct > 0 ? t("paywall.savePercent", { percent: savePct }) : undefined}
        />
        <PlanCard
          selected={plan === "lifetime"}
          onSelect={() => selectPlan("lifetime")}
          name={t("paywall.planLifetime")}
          desc={t("paywall.lifetimeDesc")}
          price={price("lifetime")}
          period={t("paywall.perOnce")}
        />

        <View className="h-2" />
        <Button
          label={`${t("paywall.cta")} · ${price(plan)}${ctaPeriod}`}
          size="lg"
          loading={busy}
          onPress={buy}
        />

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

        <Text className="text-zinc-600 text-[11px] text-center px-2 leading-4 mb-3">
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
