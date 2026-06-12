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
  PlanId,
} from "../lib/services/purchases";
import { FREE_LOG_LIMIT, FREE_CUSTOM_FOOD_LIMIT } from "../lib/guardrails";
import { privacyUrl, termsUrl } from "../lib/legal";
import { Button } from "../components/ui";
import { useFeedback } from "../components/Feedback";

function Feature({ text }: { text: string }) {
  return (
    <View className="flex-row items-center mb-3">
      <View className="w-6 h-6 rounded-full bg-brand/15 items-center justify-center mr-3">
        <Ionicons name="checkmark" size={15} color="#22d3ee" />
      </View>
      <Text className="text-zinc-200 flex-1">{text}</Text>
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
  best,
}: {
  selected: boolean;
  onSelect: () => void;
  name: string;
  desc: string;
  price: string;
  period: string;
  best?: string;
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
        <View className="flex-row items-center">
          <Text className="text-zinc-50 font-bold text-base">{name}</Text>
          {best ? (
            <View className="ml-2 rounded-full bg-brand px-2 py-0.5">
              <Text className="text-black text-[10px] font-bold">{best}</Text>
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
  const [plan, setPlan] = useState<PlanId>("lifetime");
  const [prices, setPrices] = useState<Partial<Record<PlanId, string>>>({});

  // Real localized store prices (no-op/empty in mock mode → static fallback).
  useEffect(() => {
    getOfferingPrices()
      .then(setPrices)
      .catch(() => {});
  }, []);

  const price = (p: PlanId) => prices[p] ?? priceFor(p, lang);

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
      : null;

  async function buy() {
    setBusy(true);
    const ok = await purchasePro(plan);
    await refreshPro();
    setBusy(false);
    if (ok) {
      toast(t("paywall.activated"), "success");
      router.back();
    }
    // cancelled or failed → stay on the paywall, no message
  }

  async function onRestore() {
    setBusy(true);
    const ok = await restore();
    await refreshPro();
    setBusy(false);
    if (ok) {
      toast(t("paywall.restored"), "success");
      router.back();
    } else {
      toast(t("paywall.nothingToRestore"), "info");
    }
  }

  const ctaPeriod =
    plan === "monthly" ? t("paywall.perMonth") : ` ${t("paywall.perOnce")}`;

  return (
    <View className="flex-1 bg-zinc-950" style={{ paddingTop: insets.top }}>
      <View className="flex-row justify-end px-4 py-2">
        <Pressable onPress={() => router.back()} hitSlop={10} className="p-1">
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

        <View className="rounded-2xl bg-zinc-900 border border-zinc-800 p-5 mb-6">
          <Feature text={t("paywall.featureUnlimited")} />
          <Feature text={t("paywall.featureFamily")} />
          <Feature text={t("paywall.featureExport")} />
          <Feature text={t("paywall.featureFavorites")} />
        </View>

        {/* Plans */}
        <PlanCard
          selected={plan === "lifetime"}
          onSelect={() => setPlan("lifetime")}
          name={t("paywall.planLifetime")}
          desc={t("paywall.lifetimeDesc")}
          price={price("lifetime")}
          period={t("paywall.perOnce")}
          best={t("paywall.bestValue")}
        />
        <PlanCard
          selected={plan === "monthly"}
          onSelect={() => setPlan("monthly")}
          name={t("paywall.planMonthly")}
          desc={t("paywall.monthlyDesc")}
          price={price("monthly")}
          period={t("paywall.perMonth")}
        />

        <View className="h-2" />
        <Button
          label={`${t("paywall.cta")} · ${price(plan)}${ctaPeriod}`}
          size="lg"
          loading={busy}
          onPress={buy}
        />

        <Pressable onPress={onRestore} className="py-4 items-center">
          <Text className="text-zinc-400 font-medium">{t("paywall.restore")}</Text>
        </Pressable>

        <Text className="text-zinc-600 text-xs text-center px-4 mb-3">
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
