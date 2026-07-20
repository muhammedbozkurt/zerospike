import React from "react";
import { View } from "react-native";
import type { ViewProps, StyleProp, ViewStyle } from "react-native";

import { THEME, RADIUS, glow } from "../../lib/theme/tokens";

interface GlassCardProps extends ViewProps {
  /** Colored glow shadow. `true` uses the cyan accent; a hex string tints it to
   *  the surface's own color (a hero glucose card glows in its status color). */
  glow?: boolean | string;
  /** Accent-tinted radial-ish surface (a slightly brighter, lit card). */
  accent?: boolean;
  radius?: number;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

/**
 * The Midnight Monitor glass card: a translucent fill on the dark wash, a fine
 * light border, a top inset highlight line, and (optionally) a color-matched
 * glow. This is the mockup's `.card` / `.glow` rebuilt for RN. Hero surfaces
 * pass `glow`; lit surfaces pass `accent`.
 */
export function GlassCard({
  glow: glowProp,
  accent,
  radius = RADIUS.lg,
  style,
  children,
  ...rest
}: GlassCardProps) {
  const glowColor = glowProp === true ? THEME.accent : typeof glowProp === "string" ? glowProp : undefined;
  return (
    <View
      style={[
        {
          borderRadius: radius,
          borderWidth: 1,
          borderColor: accent ? withAlpha(THEME.accent, 0.35) : THEME.border,
          backgroundColor: accent ? withAlpha(THEME.accent, 0.1) : THEME.glass,
          padding: 12,
        },
        glowColor ? glow(glowColor, 30, 0.4) : undefined,
        style,
      ]}
      {...rest}
    >
      {/* top inset highlight - the `inset 0 1px 0 rgba(255,255,255,.06)` line */}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: 0,
          left: radius,
          right: radius,
          height: 1,
          backgroundColor: THEME.glassInset,
          borderTopLeftRadius: radius,
          borderTopRightRadius: radius,
        }}
      />
      {children}
    </View>
  );
}

/** Convert `#rrggbb` + alpha into an `rgba()` string (design tokens are hex). */
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
