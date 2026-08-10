import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";

import { useApp } from "../lib/store/AppContext";
import {
  getDownsellOffer,
  purchaseDownsell,
  type DownsellOffer,
} from "../lib/services/purchases";
import { purchaseToastFor } from "../lib/services/purchaseFlow";
import { privacyUrl, termsUrl } from "../lib/legal";
import { logEvent } from "../lib/analytics";
import { FeedbackHost, useFeedback } from "../components/Feedback";
import { LanguageChip } from "../components/onboarding/LanguageChip";
import { hapticSuccess } from "../lib/haptics";
import { AppBackground, GradientCTA, IconTile } from "../components/rich";
import { withAlpha } from "../components/rich/GlassCard";
import { MODAL_TOP_PAD, TABULAR, THEME, glow } from "../lib/theme/tokens";
import { pct } from "../lib/format";

/**
 * The last-chance annual offer, rebuilt to the mockup's 08 "Downsell"
 * composition: one centred, accent-bordered glow card carrying a small badge, a
 * short headline, the BILLED AMOUNT as the dominant element with the standard
 * price struck through beside it, the renewal disclosure, then the CTA and a
 * quiet decline. Nothing else competes with the price.
 */
function DownsellScreen() {
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
    <AppBackground>
      {/* The mockup's top cyan bloom behind the single offer card */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
          <Defs>
            <RadialGradient id="dsGlow" cx="50%" cy="18%" rx="120%" ry="50%">
              <Stop offset="0" stopColor={THEME.accent} stopOpacity={0.14} />
              <Stop offset="1" stopColor={THEME.accent} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#dsGlow)" />
        </Svg>
      </View>

      <View
        className="flex-1"
        style={{ paddingTop: Math.max(insets.top, MODAL_TOP_PAD), paddingBottom: insets.bottom + 16 }}
      >
        {/* Onboarding-sourced downsell carries the language chip too. */}
        {trigger === "onboarding" ? (
          <View className="flex-row justify-end px-6 pt-2 pb-2">
            <LanguageChip />
          </View>
        ) : null}

        <View className="flex-1 px-6 justify-center">
          {loading ? (
            <View className="items-center">
              <ActivityIndicator color={THEME.accent} />
              <Text style={{ color: THEME.muted, marginTop: 10, textAlign: "center" }}>
                {t("common.loading")}
              </Text>
            </View>
          ) : discount ? (
            <View
              className="items-center rounded-3xl p-5"
              style={[
                {
                  borderWidth: 1,
                  borderColor: THEME.accent,
                  backgroundColor: withAlpha(THEME.accent, 0.08),
                  gap: 10,
                },
                glow(THEME.accent, 34, 0.4),
              ]}
            >
              <View
                className="rounded-full px-3 py-1"
                style={{ backgroundColor: withAlpha(THEME.accent, 0.18) }}
              >
                <Text style={{ color: THEME.accent, fontSize: 11, fontWeight: "800" }}>
                  {t("downsell.savingsBadge", { percent: pct(offer!.savingsPercent) })}
                </Text>
              </View>

              <Text
                style={{
                  color: THEME.ink,
                  fontSize: 17,
                  fontWeight: "800",
                  textAlign: "center",
                }}
              >
                {t("downsell.title")}
              </Text>

              {/* The billed amount dominates */}
              <View className="flex-row items-baseline" style={{ gap: 10 }}>
                <Text
                  style={[
                    TABULAR,
                    { color: THEME.ink, fontSize: 34, fontWeight: "800" },
                  ]}
                >
                  {offer!.discountedPriceString}
                </Text>
                <Text
                  style={[
                    TABULAR,
                    {
                      color: THEME.muted,
                      fontSize: 15,
                      textDecorationLine: "line-through",
                    },
                  ]}
                >
                  {offer!.standardPriceString}
                </Text>
              </View>

              <Text
                style={{
                  color: THEME.muted,
                  fontSize: 11,
                  lineHeight: 16,
                  textAlign: "center",
                }}
              >
                {t("downsell.renewalDisclosure", {
                  discountPrice: offer!.discountedPriceString,
                  standardPrice: offer!.standardPriceString,
                })}
              </Text>

              <GradientCTA
                label={t("downsell.discountCta", { percent: pct(offer!.savingsPercent) })}
                disabled={busy}
                onPress={accept}
                style={{ alignSelf: "stretch", marginTop: 2 }}
              />
              <Pressable onPress={decline} disabled={busy} hitSlop={8}>
                <Text style={{ color: THEME.muted, fontSize: 12, fontWeight: "600" }}>
                  {t("downsell.decline")}
                </Text>
              </Pressable>
            </View>
          ) : (
            <View className="items-center" style={{ gap: 12 }}>
              {/* The discount headline promises a price; with nothing to show it
                  would be a bare claim, so the no-offer branch says so plainly.
                  The tile is the same visual anchor its sibling states carry, so
                  this branch is not two lines of text floating in empty space. */}
              <IconTile icon="pricetag-outline" size={44} radius={14} tint={THEME.muted} />
              <Text
                style={{
                  color: THEME.ink,
                  fontSize: 22,
                  fontWeight: "800",
                  textAlign: "center",
                }}
              >
                {t("downsell.noOfferTitle")}
              </Text>
              <Text
                style={{
                  color: THEME.muted,
                  textAlign: "center",
                  lineHeight: 20,
                  maxWidth: 280,
                }}
              >
                {t("downsell.fallbackSubtitle")}
              </Text>
            </View>
          )}
        </View>

        {!loading ? (
          <View className="px-6">
            {discount ? (
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
            ) : (
              <GradientCTA label={t("downsell.fallbackCta")} onPress={decline} />
            )}
          </View>
        ) : null}
      </View>
      <FeedbackHost />
    </AppBackground>
  );
}

export default function DownsellRoute() {
  return (
    <SafeAreaProvider>
      <DownsellScreen />
    </SafeAreaProvider>
  );
}
