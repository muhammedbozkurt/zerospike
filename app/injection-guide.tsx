import React, { useRef, useState } from "react";
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import Svg, { Circle, Ellipse, Path } from "react-native-svg";

import { INJECTION_STEPS } from "../lib/data/injectionGuide";
import { AppBackground, GlassCard, GradientCTA } from "../components/rich";
import { ScreenHeader } from "../components/ScreenHeader";
import { FeedbackHost } from "../components/Feedback";
import { GLUCOSE_RICH, THEME, glow } from "../lib/theme/tokens";
import { withAlpha } from "../components/rich/GlassCard";

/**
 * General injection-technique guide (free, available to everyone).
 *
 * Rebuilt to the mockup's "Enjeksiyon rehberi" composition: ONE glowing card at
 * a time carrying a lit body illustration, a short title and neutral body copy,
 * with pager dots underneath and a single close action. The old screen was a
 * scrolling wall of numbered rows; this is the same content paced one idea per
 * card, which is what the mockup shows and what a technique guide should be.
 *
 * Content still comes from lib/data/injectionGuide.ts. Every step defers to the
 * user's care team and contains no doses, products or personal instructions.
 */

/** The lit torso mark from the mockup's guide card. */
function BodyMark() {
  return (
    <Svg width={74} height={106} viewBox="0 0 74 106">
      <Ellipse
        cx={37}
        cy={15}
        rx={11}
        ry={13}
        fill="rgba(255,255,255,0.03)"
        stroke={THEME.border}
        strokeWidth={1.5}
      />
      <Path
        d="M24,30 h26 a5,5 0 0 1 5,5 v28 a9,9 0 0 1 -9,9 h-18 a9,9 0 0 1 -9,-9 v-28 a5,5 0 0 1 5,-5Z"
        fill={withAlpha(THEME.accent, 0.1)}
        stroke={THEME.accent}
        strokeWidth={1.5}
      />
      <Circle cx={37} cy={48} r={4} fill={THEME.accent} />
    </Svg>
  );
}

export default function InjectionGuideScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [page, setPage] = useState(0);
  const scroller = useRef<ScrollView>(null);

  const pageWidth = width;
  const cardWidth = width - 32;

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const next = Math.round(e.nativeEvent.contentOffset.x / pageWidth);
    if (next !== page) setPage(next);
  }

  return (
    <AppBackground style={{ paddingTop: insets.top }}>
      <ScreenHeader
        title={t("injectionGuide.screenTitle")}
        onBack={() => router.back()}
        backIcon="close"
        accessibilityLabel={t("common.close")}
      />

      {/* Prominent medical disclaimer, above the deck */}
      <View
        className="flex-row items-start rounded-2xl mx-4 p-4 mb-2"
        style={{
          borderWidth: 1,
          borderColor: withAlpha(GLUCOSE_RICH.high, 0.3),
          backgroundColor: withAlpha(GLUCOSE_RICH.high, 0.1),
        }}
      >
        <Ionicons name="medical-outline" size={17} color={GLUCOSE_RICH.high} />
        <View className="flex-1 ml-3">
          <Text style={{ color: GLUCOSE_RICH.high, fontWeight: "800", fontSize: 13 }}>
            {t("disclaimer.title")}
          </Text>
          <Text style={{ color: THEME.ink, fontSize: 12, lineHeight: 18, marginTop: 2, opacity: 0.85 }}>
            {t("injectionGuide.disclaimer")}
          </Text>
        </View>
      </View>

      {/* One step per glowing card */}
      <ScrollView
        ref={scroller}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        style={{ flexGrow: 0 }}
      >
        {INJECTION_STEPS.map((step, i) => (
          <View key={step.titleKey} style={{ width: pageWidth, paddingHorizontal: 16 }}>
            <GlassCard
              glow
              style={{ width: cardWidth, alignItems: "center", paddingVertical: 22, gap: 10 }}
            >
              <View style={glow(THEME.accent, 30, 0.45)}>
                <BodyMark />
              </View>
              <View className="flex-row items-center" style={{ gap: 8 }}>
                <Text style={{ color: THEME.accent, fontSize: 12, fontWeight: "800" }}>
                  {i + 1}
                </Text>
                <Ionicons
                  name={step.icon as keyof typeof Ionicons.glyphMap}
                  size={16}
                  color={THEME.accent}
                />
                <Text style={{ color: THEME.ink, fontSize: 15, fontWeight: "800" }}>
                  {t(step.titleKey)}
                </Text>
              </View>
              <Text
                style={{
                  color: THEME.muted,
                  fontSize: 13,
                  lineHeight: 20,
                  textAlign: "center",
                  paddingHorizontal: 8,
                }}
              >
                {t(step.bodyKey)}
              </Text>
            </GlassCard>
          </View>
        ))}
      </ScrollView>

      {/* Pager dots (mockup 07) */}
      <View className="flex-row justify-center mt-4" style={{ gap: 6 }}>
        {INJECTION_STEPS.map((step, i) => (
          <View
            key={step.titleKey}
            style={[
              {
                width: 6,
                height: 6,
                borderRadius: 99,
                backgroundColor: i === page ? THEME.accent : THEME.border,
              },
              i === page ? glow(THEME.accent, 6, 0.8) : undefined,
            ]}
          />
        ))}
      </View>

      <View className="flex-1" />
      <View style={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 16 }}>
        <GradientCTA
          label={t("common.close")}
          variant="sub"
          onPress={() => router.back()}
        />
      </View>
      <FeedbackHost />
    </AppBackground>
  );
}
