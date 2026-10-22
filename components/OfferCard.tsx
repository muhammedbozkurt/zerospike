import React from "react";
import { Text, View, useWindowDimensions } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { withAlpha } from "./rich/GlassCard";
import { Txt } from "./ui";
import { RADIUS, SPACE, TABULAR, THEME, glow } from "../lib/theme/tokens";

interface OfferCardProps {
  /** Small rounded pill above the title, e.g. "20% off". */
  badgeText: string;
  /** The card headline. */
  title: string;
  /** The dominant, discounted price string (already formatted by the caller). */
  discountedPrice: string;
  /** The standard price, shown struck through beside the discounted one. */
  standardPrice: string;
  /** Legal renewal disclosure copy - passed through unchanged, never trimmed. */
  disclosure: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * The shared last-chance / winback offer card. Downsell and winback plug in
 * only their own copy and prices; the layout - badge, title, price pair,
 * renewal disclosure - is identical on both screens so the offer always reads
 * the same way regardless of which trigger led to it.
 */
export function OfferCard({
  badgeText,
  title,
  discountedPrice,
  standardPrice,
  disclosure,
  style,
}: OfferCardProps) {
  const { width } = useWindowDimensions();
  const cardWidth = Math.min(width - 48, 420);

  return (
    <View
      className="items-center"
      style={[
        {
          padding: SPACE.lg,
          borderRadius: RADIUS.lg,
          width: cardWidth,
          alignSelf: "center",
          borderWidth: 1,
          borderColor: THEME.accent,
          backgroundColor: withAlpha(THEME.accent, 0.08),
          gap: SPACE.md,
        },
        glow(THEME.accent, 34, 0.4),
        style,
      ]}
    >
      <View
        className="rounded-full px-3 py-1"
        style={{ backgroundColor: withAlpha(THEME.accent, 0.18) }}
      >
        <Txt kind="micro" tone="accent">
          {badgeText}
        </Txt>
      </View>

      <Txt kind="subtitle" accessibilityRole="header" style={{ textAlign: "center" }}>
        {title}
      </Txt>

      {/* The billed amount dominates */}
      <View className="flex-row items-baseline" style={{ gap: SPACE.md }}>
        <Text style={[TABULAR, { color: THEME.text, fontSize: 34, fontWeight: "800" }]}>
          {discountedPrice}
        </Text>
        <Txt tone="muted" tabular style={{ textDecorationLine: "line-through" }}>
          {standardPrice}
        </Txt>
      </View>

      <Txt kind="caption" tone="muted" style={{ textAlign: "center" }}>
        {disclosure}
      </Txt>
    </View>
  );
}
