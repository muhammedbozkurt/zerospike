import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
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
import { FeedbackHost, useFeedback } from "../components/Feedback";
import { OfferCard } from "../components/OfferCard";
import { hapticSuccess } from "../lib/haptics";
import { AppBackground, GradientCTA, IconTile } from "../components/rich";
import { MODAL_TOP_PAD, THEME } from "../lib/theme/tokens";
import { isolateLtr, pct } from "../lib/format";

/**
 * The return offer for a lapsed subscriber, rebuilt to the mockup's 08
 * "Winback" composition: a centred emblem, a warm headline, one line of copy,
 * then a single glowing offer row where the plan sits left and the billed
 * amount sits right, a full-width CTA and a quiet "not now".
 */
function WinbackScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { refreshPro } = useApp();
  const { toast } = useFeedback();
  const { width } = useWindowDimensions();
  // Same cap as OfferCard's own cardWidth, so the bottom band (CTA + decline +
  // legal) lines up edge-to-edge with the card above it on wide/tablet screens
  // instead of stretching to the full px-6 width.
  const bottomColWidth = Math.min(width - 48, 420);
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
    else logEvent("downsell_skipped_no_discount");
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
        logEvent("downsell_accept", { trigger: "winback" });
        logEvent("purchase_completed", { tier: "annual", source: "winback" });
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
    <AppBackground>
      <View
        className="flex-1"
        style={{ paddingTop: Math.max(insets.top, MODAL_TOP_PAD), paddingBottom: insets.bottom + 16 }}
      >
        <View className="flex-row justify-end px-4 pt-2">
          <Pressable
            onPress={decline}
            hitSlop={10}
            accessibilityLabel={t("common.close")}
          >
            <IconTile icon="close" size={30} radius={10} tint={THEME.textMuted} />
          </Pressable>
        </View>

        <View className="flex-1 px-6 justify-center items-center" style={{ gap: 12 }}>
          {loading ? (
            <View className="items-center">
              <ActivityIndicator color={THEME.accent} />
              <Text style={{ color: THEME.textMuted, marginTop: 10, textAlign: "center" }}>
                {t("common.loading")}
              </Text>
            </View>
          ) : (
            <>
              <Text style={{ fontSize: 34 }}>👋</Text>
              <Text
                style={{
                  color: THEME.text,
                  fontSize: 24,
                  fontWeight: "800",
                  textAlign: "center",
                }}
              >
                {t("winback.title")}
              </Text>

              <OfferCard
                // Bidi: same "just the number+sign pair" isolate proven on the
                // paywall's own savePercent badge (writingDirection alone was
                // verified NOT enough on-device for this under RTL).
                badgeText={t("downsell.savingsBadge", {
                  percent: isolateLtr(pct(offer!.savingsPercent)),
                })}
                title={t("winback.subtitle", { percent: isolateLtr(pct(offer!.savingsPercent)) })}
                discountedPrice={offer!.discountedPriceString ?? ""}
                standardPrice={offer!.standardPriceString ?? ""}
                disclosure={t("downsell.renewalDisclosure", {
                  discountPrice: offer!.discountedPriceString,
                  standardPrice: offer!.standardPriceString,
                })}
                style={{ marginTop: 4 }}
              />
            </>
          )}
        </View>

        {!loading ? (
          <View style={{ width: bottomColWidth, alignSelf: "center" }}>
            <GradientCTA
              label={t("winback.cta", { percent: isolateLtr(pct(offer!.savingsPercent)) })}
              disabled={busy}
              onPress={accept}
            />
            <Pressable
              onPress={decline}
              disabled={busy}
              className="py-3 items-center mt-1"
            >
              <Text style={{ color: THEME.textMuted, fontWeight: "600" }}>
                {t("winback.decline")}
              </Text>
            </Pressable>
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
          </View>
        ) : null}
      </View>
      <FeedbackHost />
    </AppBackground>
  );
}

export default function WinbackRoute() {
  return (
    <SafeAreaProvider>
      <WinbackScreen />
    </SafeAreaProvider>
  );
}
