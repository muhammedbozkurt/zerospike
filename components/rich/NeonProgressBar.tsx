import React from "react";
import { View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { GLUCOSE_RICH, THEME, glow } from "../../lib/theme/tokens";
import { clamp } from "./svgGeom";

interface NeonProgressBarProps {
  value: number;
  max: number;
  height?: number;
  /** Gradient stops (default target-green -> cyan). */
  colors?: [string, string];
  style?: StyleProp<ViewStyle>;
}

/**
 * A neon progress bar: rounded track with a gradient fill (green -> cyan) that
 * glows in its own color. Used for the food carb-progress meter and any "N of M"
 * ring-style bar. The fill is an SVG rect gradient so the sweep is real, not a
 * flat block; the glow comes from a color-matched shadow on the fill container.
 */
export function NeonProgressBar({
  value,
  max,
  height = 8,
  colors = [GLUCOSE_RICH.target, THEME.accent],
  style,
}: NeonProgressBarProps) {
  const frac = clamp(max > 0 ? value / max : 0);
  const gid = `neon-${colors[0]}-${colors[1]}`.replace(/[^a-z0-9]/gi, "");

  return (
    <View
      style={[
        { height, borderRadius: height, backgroundColor: THEME.track, overflow: "hidden" },
        style,
      ]}
    >
      <View style={[{ height, width: `${frac * 100}%`, borderRadius: height }, glow(colors[1], 8, 0.7)]}>
        <Svg width="100%" height={height}>
          <Defs>
            <LinearGradient id={gid} x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={colors[0]} />
              <Stop offset="1" stopColor={colors[1]} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height={height} rx={height / 2} fill={`url(#${gid})`} />
        </Svg>
      </View>
    </View>
  );
}
