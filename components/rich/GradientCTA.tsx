import React from "react";
import { ActivityIndicator, Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { PressableScale } from "../../lib/theme/motion";
import { lerpHex } from "./svgGeom";
import { GLUCOSE_RICH, RADIUS, THEME, glow } from "../../lib/theme/tokens";

interface GradientCTAProps {
  label: string;
  onPress?: () => void;
  /** Secondary (glass) variant, matching the mockup's `.cta.sub`. */
  variant?: "primary" | "sub";
  /** Danger gradient (SOS / delete) - a warm red sweep. */
  danger?: boolean;
  disabled?: boolean;
  /** Taller pill for a screen whose one pinned action closes the page
   *  (onboarding's footer). "md" stays the app-wide default everywhere else. */
  size?: "md" | "lg";
  /** Swaps the label for a spinner and blocks the press, like ui.tsx Button. */
  loading?: boolean;
  /** Lets the label wrap onto two lines (centred, no font shrinking). */
  allowTwoLines?: boolean;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

const CTA_SIZE = {
  md: { padV: 13, padH: 14, font: 15 },
  lg: { padV: 17, padH: 20, font: 17 },
} as const;

/**
 * The signature call-to-action: a glowing cyan gradient (light -> accent) with
 * dark ink, or a glass secondary, or a warm danger sweep. The mockup's `.cta`.
 * SVG-backed gradient (no expo-linear-gradient) so the sweep is real.
 */
export function GradientCTA({
  label,
  onPress,
  variant = "primary",
  danger = false,
  disabled = false,
  size = "md",
  loading = false,
  allowTwoLines = false,
  icon,
  style,
}: GradientCTAProps) {
  const sub = variant === "sub";
  const metrics = CTA_SIZE[size];
  const isOff = disabled || loading;
  const light = THEME.scheme === "light";
  const stops: [string, string] = danger
    ? [light ? GLUCOSE_RICH.low : lerpHex(GLUCOSE_RICH.low, THEME.text, 0.3), GLUCOSE_RICH.low]
    : [light ? THEME.accentFill : THEME.accentStrong, THEME.accentFill];
  const glowColor = danger ? GLUCOSE_RICH.low : THEME.accentFill;
  const flatOff = isOff && !loading && !sub && light;
  const textColor = sub ? THEME.text : flatOff ? THEME.textMuted : THEME.accentOnFill;

  return (
    <PressableScale
      onPress={isOff ? undefined : onPress}
      // This is the app's PRIMARY action on almost every screen and it carried no
      // role and no state at all: a screen reader announced the most important
      // control on the paywall, onboarding and SOS screens as plain text, and a
      // disabled one as fully available (the 0.5 opacity says nothing to it).
      disabled={isOff}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isOff, busy: loading }}
      style={[
        {
          borderRadius: RADIUS.lg,
          overflow: "hidden",
          opacity: isOff && !flatOff ? 0.5 : 1,
          borderWidth: sub || flatOff ? 1 : 0,
          borderColor: flatOff ? THEME.borderStrong : THEME.border,
          backgroundColor: sub ? THEME.surface : flatOff ? THEME.track : undefined,
        },
        !sub && !flatOff ? glow(glowColor, 22, 0.5, "fill") : undefined,
        style,
      ]}
    >
      {!sub && !flatOff ? (
        <Svg style={{ position: "absolute", width: "100%", height: "100%" }}>
          <Defs>
            <LinearGradient id={`cta-${stops[0]}${stops[1]}`.replace(/[^a-z0-9]/gi, "")} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={stops[0]} />
              <Stop offset="1" stopColor={stops[1]} />
            </LinearGradient>
          </Defs>
          <Rect
            x="0"
            y="0"
            width="100%"
            height="100%"
            fill={`url(#${`cta-${stops[0]}${stops[1]}`.replace(/[^a-z0-9]/gi, "")})`}
          />
        </Svg>
      ) : null}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          paddingVertical: metrics.padV,
          paddingHorizontal: metrics.padH,
        }}
      >
        {loading ? (
          <ActivityIndicator color={textColor} />
        ) : (
          <>
            {icon}
            {/* allowTwoLines (the paywall's price-carrying labels): wrap onto a
                second line instead of shrinking, because adjustsFontSizeToFit
                clips silently on Android. Every other CTA keeps one line. At
                large text the global Text wrapper (lib/theme/fontScale.ts)
                drops the line limit and the shrink, so the pill grows. */}
            <Text
              style={{
                color: textColor,
                fontWeight: "800",
                fontSize: metrics.font,
                flexShrink: 1,
                textAlign: "center",
              }}
              numberOfLines={allowTwoLines ? 2 : 1}
              adjustsFontSizeToFit={!allowTwoLines}
              minimumFontScale={allowTwoLines ? undefined : 0.7}
            >
              {label}
            </Text>
          </>
        )}
      </View>
    </PressableScale>
  );
}
