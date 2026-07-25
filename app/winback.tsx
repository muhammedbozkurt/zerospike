import React, { useEffect, useState } from "react";
import { Linking, Pressable, Text, View, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
import { hapticSuccess } from "../lib/haptics";
import { AppBackground, GlassCard, GradientCTA, IconTile } from "../components/rich";
import { TABULAR, THEME } from "../lib/theme/tokens";

/**
 * The return offer for a lapsed subscriber, rebuilt to the mockup's 08
 * "Winback" composition: a centred emblem, a warm headline, one line of copy,
 * then a single glowing offer row where the plan sits left and the billed
 * amount sits right, a full-width CTA and a quiet "not now".
 */
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
    <AppBackground>
      <View
        className="flex-1"
        style={{ paddingTop: Platform.OS === "ios" ? 8 : insets.top + 8, paddingBottom: insets.bottom + 16 }}
      >
        <View className="flex-row justify-end px-4">
          <Pressable
            onPress={decline}
            hitSlop={10}
            accessibilityLabel={t("common.close")}
          >
            <IconTile icon="close" size={30} radius={10} tint={THEME.muted} />
          </Pressable>
        </View>

        <View className="flex-1 px-6 justify-center items-center" style={{ gap: 12 }}>
          {loading ? (
            <Text style={{ color: THEME.muted, textAlign: "center" }}>
              {t("common.loading")}
            </Text>
          ) : (
            <>
              <Text style={{ fontSize: 34 }}>👋</Text>
              <Text
                style={{
                  color: THEME.ink,
                  fontSize: 24,
                  fontWeight: "800",
                  textAlign: "center",
                }}
              >
                {t("winback.title")}
              </Text>
              <Text
                style={{
                  color: THEME.muted,
                  textAlign: "center",
                  lineHeight: 20,
                  maxWidth: 280,
                }}
              >
                {t("winback.subtitle", { percent: offer!.savingsPercent })}
              </Text>

              <GlassCard glow style={{ alignSelf: "stretch", marginTop: 4 }}>
                <View className="flex-row items-center justify-between">
                  <View className="flex-1 pr-3">
                    <Text style={{ color: THEME.ink, fontSize: 14, fontWeight: "800" }}>
                      {t("downsell.savingsBadge", { percent: offer!.savingsPercent })}
                    </Text>
                    <Text
                      style={[
                        TABULAR,
                        {
                          color: THEME.muted,
                          fontSize: 12,
                          textDecorationLine: "line-through",
                          marginTop: 2,
                        },
                      ]}
                    >
                      {offer!.standardPriceString}
                    </Text>
                  </View>
                  <Text
                    style={[TABULAR, { color: THEME.ink, fontSize: 22, fontWeight: "800" }]}
                  >
                    {offer!.discountedPriceString}
                  </Text>
                </View>
                <Text
                  style={{
                    color: THEME.muted,
                    fontSize: 11,
                    lineHeight: 16,
                    marginTop: 10,
                  }}
                >
                  {t("downsell.renewalDisclosure", {
                    discountPrice: offer!.discountedPriceString,
                    standardPrice: offer!.standardPriceString,
                  })}
                </Text>
              </GlassCard>
            </>
          )}
        </View>

        {!loading ? (
          <View className="px-6">
            <GradientCTA
              label={t("winback.cta", { percent: offer!.savingsPercent })}
              disabled={busy}
              onPress={accept}
            />
            <Pressable
              onPress={decline}
              disabled={busy}
              className="py-3 items-center mt-1"
            >
              <Text style={{ color: THEME.muted, fontWeight: "600" }}>
                {t("winback.decline")}
              </Text>
            </Pressable>
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
          </View>
        ) : null}
      </View>
      <FeedbackHost />
    </AppBackground>
  );
}
