import React from "react";
import { View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from "react-native-svg";

import { GLUCOSE_RICH, THEME, glow } from "../../lib/theme/tokens";
import { seriesPaths } from "./svgGeom";

interface GradientAreaChartProps {
  data: number[];
  width?: number;
  height?: number;
  /** Line + area color (default cyan accent). */
  color?: string;
  /** Draw a translucent target band. Values are in the same domain as `data`;
   *  the band is placed by min/max of `data` like the line. */
  targetBand?: { min: number; max: number };
  /** Soft colored glow under the line (default true). */
  lineGlow?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * A gradient area chart: soft area fill fading to nothing, a glowing line on
 * top, and an optional green target band behind it. One shape for the AGP curve,
 * the hourly-pattern chart and the onboarding preview - the mockup's signature
 * "gradyan alan grafigi". Generalises the small Sparkline to a full panel.
 */
export function GradientAreaChart({
  data,
  width = 300,
  height = 76,
  color = THEME.accent,
  targetBand,
  lineGlow = true,
  style,
}: GradientAreaChartProps) {
  const { line, area } = seriesPaths(data, width, height);
  const gid = `area-${width}-${height}`;

  let bandRect: { y: number; h: number } | null = null;
  if (targetBand && data.length) {
    const min = Math.min(...data);
    const max = Math.max(...data);
    const span = max - min || 1;
    const pad = 3;
    const yFor = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2);
    const yTop = yFor(targetBand.max);
    const yBot = yFor(targetBand.min);
    bandRect = { y: Math.min(yTop, yBot), h: Math.abs(yBot - yTop) };
  }

  return (
    <View style={[{ width, height }, lineGlow ? glow(color, 10, 0.35) : undefined, style]}>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity={0.38} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        {bandRect ? (
          <Rect x="0" y={bandRect.y} width={width} height={bandRect.h} fill={GLUCOSE_RICH.target} opacity={0.12} />
        ) : null}
        {area ? <Path d={area} fill={`url(#${gid})`} /> : null}
        {line ? <Path d={line} stroke={color} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" /> : null}
      </Svg>
    </View>
  );
}
