import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { Redirect, useNavigation, useRouter } from "expo-router";
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
import { PAYWALL_VERSION } from "../lib/analytics/eventSchema";
import { createWinbackExit } from "../lib/analytics/winbackExit";
import { shouldOpenWelcomeAfterPurchase } from "../lib/paywallPurchase";
import { FeedbackHost, useFeedback } from "../components/Feedback";
import { OfferCard } from "../components/OfferCard";
import { Button, Txt } from "../components/ui";
import { LegalLink } from "../components/LegalLink";
import { hapticSuccess } from "../lib/haptics";
import { AppBackground, GradientCTA, IconTile } from "../components/rich";
import { MODAL_TOP_PAD, SPACE, THEME } from "../lib/theme/tokens";
import { useThemeRemountLock } from "../lib/theme/ThemeProvider";
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
  const navigation = useNavigation();
  const exit = useMemo(() => createWinbackExit(logEvent), []);
  useThemeRemountLock();
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
    if (offer.hasRealDiscount) {
      exit.viewed();
      logEvent("winback_view");
    }
    // No real discount: the winback is skipped (redirects away). Log it so a
    // missing sandbox intro price is not mistaken for a broken winback.
    else logEvent("downsell_skipped_no_discount");
  }, [offer]);

  // Back, swipe down and the X all end here; nothing is blocked, only counted.
  useEffect(() => navigation.addListener("beforeRemove", () => exit.closed()), [navigation, exit]);

  function close() {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)");
  }

  function decline() {
    exit.closed();
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
        paywall_version: PAYWALL_VERSION,
        detail:
          res.ok || res.cancelled ? "none" : res.error === "alreadyOwned" ? "already_owned" : "store_error",
      });
      if (res.ok) {
        exit.purchased();
        logEvent("downsell_accept", { trigger: "winback" });
        logEvent("purchase_completed", {
          tier: "annual",
          source: "winback",
          paywall_version: PAYWALL_VERSION,
        });
        hapticSuccess();
        if (feedback) toast(t(feedback.key), feedback.kind);
        // A new purchase lands on the Pro welcome, like the paywall's; only an
        // already-owned recovery keeps the older plain exit.
        if (shouldOpenWelcomeAfterPurchase({ recovered: res.recovered === true, stepsLeft: false })) {
          router.replace("/pro-welcome");
        } else {
          close();
        }
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
            accessibilityRole="button"
            accessibilityLabel={t("common.close")}
          >
            <IconTile icon="close" size={30} radius={10} tint={THEME.textMuted} />
          </Pressable>
        </View>

        <View className="flex-1 px-6 justify-center items-center" style={{ gap: SPACE.md }}>
          {loading ? (
            <View className="items-center">
              <ActivityIndicator color={THEME.accent} />
              <Txt tone="muted" style={{ marginTop: SPACE.md, textAlign: "center" }}>
                {t("common.loading")}
              </Txt>
            </View>
          ) : (
            <>
              <Txt kind="title" style={{ fontSize: 34, lineHeight: 40 }}>👋</Txt>
              <Txt kind="title" accessibilityRole="header" style={{ textAlign: "center" }}>
                {t("winback.title")}
              </Txt>

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
            <Button
              variant="tertiary"
              label={t("winback.decline")}
              onPress={decline}
              disabled={busy}
              className="mt-1"
            />
            <View className="flex-row flex-wrap items-center justify-center">
              <LegalLink
                label={t("settings.privacy")}
                onPress={() => Linking.openURL(privacyUrl())}
              />
              <LegalLink
                label={t("settings.terms")}
                onPress={() => Linking.openURL(termsUrl())}
              />
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
