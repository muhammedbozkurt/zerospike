import React from "react";
import { Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { PressableScale } from "../../lib/theme/motion";
import { GLUCOSE_RICH, RADIUS, THEME, glow } from "../../lib/theme/tokens";

interface GradientCTAProps {
  label: string;
  onPress?: () => void;
  /** Secondary (glass) variant, matching the mockup's `.cta.sub`. */
  variant?: "primary" | "sub";
  /** Danger gradient (SOS / delete) - a warm red sweep. */
  danger?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

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
  icon,
  style,
}: GradientCTAProps) {
  const sub = variant === "sub";
  const stops: [string, string] = danger
    ? ["#ff7a8a", GLUCOSE_RICH.low]
    : [THEME.accentSoft, THEME.accent];
  const glowColor = danger ? GLUCOSE_RICH.low : THEME.accent;
  const textColor = sub ? THEME.ink : danger ? "#fff" : "#00232b";

  return (
    <PressableScale
      onPress={disabled ? undefined : onPress}
      // This is the app's PRIMARY action on almost every screen and it carried no
      // role and no state at all: a screen reader announced the most important
      // control on the paywall, onboarding and SOS screens as plain text, and a
      // disabled one as fully available (the 0.5 opacity says nothing to it).
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={[
        {
          borderRadius: RADIUS.lg,
          overflow: "hidden",
          opacity: disabled ? 0.5 : 1,
          borderWidth: sub ? 1 : 0,
          borderColor: THEME.border,
          backgroundColor: sub ? THEME.glass : undefined,
        },
        !sub ? glow(glowColor, 22, 0.5, "fill") : undefined,
        style,
      ]}
    >
      {!sub ? (
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
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 13, paddingHorizontal: 14 }}>
        {icon}
        <Text
          style={{ color: textColor, fontWeight: "800", fontSize: 15, flexShrink: 1 }}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
        >
          {label}
        </Text>
      </View>
    </PressableScale>
  );
}
