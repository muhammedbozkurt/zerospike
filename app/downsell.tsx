import React, { useEffect, useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { AppBackgroundFill } from "../components/rich";
import { useTranslation } from "react-i18next";

import { useApp } from "../lib/store/AppContext";
import {
  getDownsellOffer,
  purchaseDownsell,
  type DownsellOffer,
} from "../lib/services/purchases";
import { purchaseToastFor } from "../lib/services/purchaseFlow";
import { privacyUrl, termsUrl } from "../lib/legal";
import { logEvent } from "../lib/analytics";
import { Button } from "../components/ui";
import { FeedbackHost, useFeedback } from "../components/Feedback";
import { LanguageChip } from "../components/onboarding/LanguageChip";
import { hapticSuccess } from "../lib/haptics";

export default function DownsellScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { trigger: triggerParam } = useLocalSearchParams<{ trigger?: string }>();
  const trigger = triggerParam ?? "onboarding";
  const { refreshPro, completeOnboarding } = useApp();
  const { toast } = useFeedback();
  const [offer, setOffer] = useState<DownsellOffer | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    getDownsellOffer()
      .then((o) => alive && setOffer(o))
      .catch(
        () =>
          alive &&
          setOffer({
            hasRealDiscount: false,
            discountedPriceString: null,
            standardPriceString: null,
            savingsPercent: 0,
          })
      );
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!offer) return;
    logEvent("downsell_view", { trigger });
    // Distinguishes "no real discount configured" (e.g. sandbox missing an intro
    // price) from a bug: the honest fallback is shown, not the discount card.
    if (!offer.hasRealDiscount) {
      logEvent("downsell_skipped_no_discount", { trigger });
    }
  }, [offer, trigger]);

  // Reached from the onboarding paywall, so complete onboarding on the way out.
  async function goHome() {
    if (trigger === "onboarding") await completeOnboarding();
    router.replace("/(tabs)");
  }

  function decline() {
    logEvent("downsell_dismiss", { trigger });
    goHome();
  }

  async function accept() {
    if (busy || !offer?.hasRealDiscount) return;
    setBusy(true);
    try {
      const res = await purchaseDownsell();
      await refreshPro();
      const feedback = purchaseToastFor(res);
      if (res.ok) {
        logEvent("downsell_accept", { trigger });
        logEvent("purchase_completed", { tier: "annual" });
        hapticSuccess();
        if (feedback) toast(t(feedback.key), feedback.kind);
        goHome();
      } else if (feedback) {
        // Real store error: an honest message instead of a silent stay.
        toast(t(feedback.key), feedback.kind);
      }
    } finally {
      setBusy(false);
    }
  }

  const loading = offer === null;
  const discount = offer?.hasRealDiscount ?? false;

  return (
    <View className="flex-1">
      <AppBackgroundFill />
      <View
        className="flex-1"
        style={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }}
      >
        {/* Onboarding-sourced downsell carries the language chip too. */}
        {trigger === "onboarding" ? (
          <View className="flex-row justify-end px-6 pb-2">
            <LanguageChip />
          </View>
        ) : null}

        <View className="flex-1 px-6 justify-center">
          {loading ? (
            <Text className="text-zinc-500 text-center">{t("common.loading")}</Text>
          ) : (
            <>
              <View className="w-16 h-16 rounded-3xl bg-brand/15 items-center justify-center mb-5 self-start">
                <Ionicons name="gift-outline" size={28} color="#2ee6ff" />
              </View>
              <Text className="text-zinc-50 text-3xl font-bold">
                {t("downsell.title")}
              </Text>
              <Text className="text-zinc-400 mt-2 leading-5">
                {discount
                  ? t("downsell.discountSubtitle", { percent: offer!.savingsPercent })
                  : t("downsell.fallbackSubtitle")}
              </Text>

              {discount ? (
                <View className="rounded-2xl bg-zinc-900 border border-brand/40 p-5 mt-6">
                  <View className="flex-row items-baseline">
                    <Text className="text-brand text-3xl font-bold">
                      {offer!.discountedPriceString}
                    </Text>
                    <Text className="text-zinc-500 text-base ml-3 line-through">
                      {offer!.standardPriceString}
                    </Text>
                  </View>
                  <Text className="text-emerald-400 text-xs font-bold mt-1">
                    {t("downsell.savingsBadge", { percent: offer!.savingsPercent })}
                  </Text>
                  <Text className="text-zinc-500 text-[11px] leading-4 mt-3">
                    {t("downsell.renewalDisclosure", {
                      discountPrice: offer!.discountedPriceString,
                      standardPrice: offer!.standardPriceString,
                    })}
                  </Text>
                </View>
              ) : null}
            </>
          )}
        </View>

        {!loading ? (
          <View className="px-6">
            {discount ? (
              <>
                <Button
                  label={t("downsell.discountCta", { percent: offer!.savingsPercent })}
                  size="lg"
                  loading={busy}
                  onPress={accept}
                />
                <Pressable onPress={decline} disabled={busy} className="py-3 items-center mt-1">
                  <Text className="text-zinc-400 font-medium">{t("downsell.decline")}</Text>
                </Pressable>
                <View className="flex-row justify-center gap-6 mt-1">
                  <Pressable onPress={() => Linking.openURL(privacyUrl())}>
                    <Text className="text-zinc-600 text-xs underline">
                      {t("settings.privacy")}
                    </Text>
                  </Pressable>
                  <Pressable onPress={() => Linking.openURL(termsUrl())}>
                    <Text className="text-zinc-600 text-xs underline">
                      {t("settings.terms")}
                    </Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <Button label={t("downsell.fallbackCta")} size="lg" onPress={decline} />
            )}
          </View>
        ) : null}
      </View>
      <FeedbackHost />
    </View>
  );
}
