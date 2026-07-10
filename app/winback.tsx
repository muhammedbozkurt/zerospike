import React, { useEffect, useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Redirect, useRouter } from "expo-router";
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
import { hapticSuccess } from "../lib/haptics";

export default function WinbackScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { refreshPro } = useApp();
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
    if (offer.hasRealDiscount) logEvent("winback_view");
    // No real discount: the winback is skipped (redirects away). Log it so a
    // missing sandbox intro price is not mistaken for a broken winback.
    else logEvent("downsell_skipped_no_discount", { trigger: "winback" });
  }, [offer]);

  function close() {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)");
  }

  function decline() {
    logEvent("downsell_dismiss", { trigger: "winback" });
    close();
  }

  async function accept() {
    if (busy || !offer?.hasRealDiscount) return;
    setBusy(true);
    try {
      const res = await purchaseDownsell();
      await refreshPro();
      const feedback = purchaseToastFor(res);
      if (res.ok) {
        logEvent("downsell_accept", { trigger: "winback" });
        logEvent("purchase_completed", { tier: "annual" });
        hapticSuccess();
        if (feedback) toast(t(feedback.key), feedback.kind);
        close();
      } else if (feedback) {
        // Real store error: an honest message instead of a silent stay.
        toast(t(feedback.key), feedback.kind);
      }
    } finally {
      setBusy(false);
    }
  }

  // A winback with no real discount must never appear.
  if (offer && !offer.hasRealDiscount) return <Redirect href="/(tabs)" />;

  const loading = offer === null;

  return (
    <View className="flex-1 bg-zinc-950">
      <View
        className="flex-1"
        style={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }}
      >
        <View className="flex-row justify-end px-4">
          <Pressable onPress={decline} hitSlop={10} className="p-1">
            <Ionicons name="close" size={26} color="#71717a" />
          </Pressable>
        </View>

        <View className="flex-1 px-6 justify-center">
          {loading ? (
            <Text className="text-zinc-500 text-center">{t("common.loading")}</Text>
          ) : (
            <>
              <View className="w-16 h-16 rounded-3xl bg-brand/15 items-center justify-center mb-5 self-start">
                <Ionicons name="heart-outline" size={28} color="#22d3ee" />
              </View>
              <Text className="text-zinc-50 text-3xl font-bold">
                {t("winback.title")}
              </Text>
              <Text className="text-zinc-400 mt-2 leading-5">
                {t("winback.subtitle", { percent: offer!.savingsPercent })}
              </Text>

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
            </>
          )}
        </View>

        {!loading ? (
          <View className="px-6">
            <Button
              label={t("winback.cta", { percent: offer!.savingsPercent })}
              size="lg"
              loading={busy}
              onPress={accept}
            />
            <Pressable onPress={decline} disabled={busy} className="py-3 items-center mt-1">
              <Text className="text-zinc-400 font-medium">{t("winback.decline")}</Text>
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
          </View>
        ) : null}
      </View>
      <FeedbackHost />
    </View>
  );
}
