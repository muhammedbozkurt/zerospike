import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
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
import { OfferCard } from "../components/OfferCard";
import { PaywallPreview } from "../components/PaywallPreview";
import { hapticSuccess } from "../lib/haptics";
import { AppBackground, GradientCTA, IconTile } from "../components/rich";
import { MODAL_TOP_PAD, THEME } from "../lib/theme/tokens";
import { useThemeRemountLock } from "../lib/theme/ThemeProvider";
import { isolateLtr, pct } from "../lib/format";

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
  // 2.3.4: every real caller (paywall.tsx, the day-7 trigger) always passes
  // its own trigger now that onboarding no longer hands off here - "inapp" is
  // just the same fallback paywall.tsx's own `exit()` uses for an unparsed
  // route.
  const trigger = triggerParam ?? "inapp";
  useThemeRemountLock();
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
    logEvent("downsell_view", { trigger });
    // Distinguishes "no real discount configured" (e.g. sandbox missing an intro
    // price) from a bug: the honest fallback is shown, not the discount card.
    if (!offer.hasRealDiscount) {
      logEvent("downsell_skipped_no_discount");
    }
  }, [offer, trigger]);

  // This screen always opens ON TOP of wherever the user already was (the
  // paywall, or the dashboard for the day-7 trigger), so leaving it returns
  // there instead of resetting to the tabs root - falling back to that reset
  // only if there is truly nothing to go back to (e.g. this screen was
  // somehow the only one on the stack).
  async function goHome() {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)");
    }
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
      logEvent("purchase_result", {
        result: res.ok ? "success" : res.cancelled ? "cancelled" : "error",
        product: "downsell_annual",
        reason: "direct",
        variant: "default",
        trial: false,
        detail:
          res.ok || res.cancelled ? "none" : res.error === "alreadyOwned" ? "already_owned" : "store_error",
      });
      if (res.ok) {
        logEvent("downsell_accept", { trigger });
        logEvent("purchase_completed", { tier: "annual", source: "downsell" });
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
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ flexGrow: 1, justifyContent: "center", paddingHorizontal: 24 }}
          showsVerticalScrollIndicator={false}
        >
          {loading ? (
            <View className="items-center">
              <ActivityIndicator color={THEME.accent} />
              <Text style={{ color: THEME.textMuted, marginTop: 10, textAlign: "center" }}>
                {t("common.loading")}
              </Text>
            </View>
          ) : discount ? (
            <View className="items-center" style={{ gap: 14 }}>
              <View style={{ width: "100%", maxWidth: 420 }}>
                <PaywallPreview />
              </View>
              <OfferCard
                // Bidi: same "just the number+sign pair" isolate proven on the
                // paywall's own savePercent badge (writingDirection alone was
                // verified NOT enough on-device for this under RTL).
                badgeText={t("downsell.savingsBadge", {
                  percent: isolateLtr(pct(offer!.savingsPercent)),
                })}
                title={t("downsell.title")}
                discountedPrice={offer!.discountedPriceString ?? ""}
                standardPrice={offer!.standardPriceString ?? ""}
                disclosure={t("downsell.renewalDisclosure", {
                  discountPrice: offer!.discountedPriceString,
                  standardPrice: offer!.standardPriceString,
                })}
              />

              <GradientCTA
                label={t("downsell.acceptCta")}
                disabled={busy}
                onPress={accept}
                style={{ width: "100%", maxWidth: 420, alignSelf: "center" }}
              />

              {/* Kept outside the card, well below the CTA: a quiet way out that
                  never competes with the offer itself. */}
              <Pressable onPress={decline} disabled={busy} hitSlop={8} style={{ marginTop: 12 }}>
                <Text style={{ color: THEME.textMuted, fontSize: 12, fontWeight: "600" }}>
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
              <IconTile icon="pricetag-outline" size={44} radius={14} tint={THEME.textMuted} />
              <Text
                style={{
                  color: THEME.text,
                  fontSize: 22,
                  fontWeight: "800",
                  textAlign: "center",
                }}
              >
                {t("downsell.noOfferTitle")}
              </Text>
              <Text
                style={{
                  color: THEME.textMuted,
                  textAlign: "center",
                  lineHeight: 20,
                  maxWidth: 280,
                }}
              >
                {t("downsell.fallbackSubtitle")}
              </Text>
            </View>
          )}
        </ScrollView>

        {!loading ? (
          <View className="px-6">
            {discount ? (
              <View className="flex-row justify-center" style={{ gap: 24 }}>
                <Pressable onPress={() => Linking.openURL(privacyUrl())}>
                  <Text
                    style={{ color: THEME.textMuted, fontSize: 11, textDecorationLine: "underline" }}
                  >
                    {t("settings.privacy")}
                  </Text>
                </Pressable>
                <Pressable onPress={() => Linking.openURL(termsUrl())}>
                  <Text
                    style={{ color: THEME.textMuted, fontSize: 11, textDecorationLine: "underline" }}
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
