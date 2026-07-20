import React from "react";
import { View } from "react-native";
import Svg, { Path, Circle, Defs, LinearGradient, Stop } from "react-native-svg";

import { COLORS, glow } from "../lib/theme/tokens";

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  /** Draw a soft area fill under the line. */
  fill?: boolean;
  /** Mark the most recent point. */
  showLast?: boolean;
  strokeWidth?: number;
  /** Midnight Monitor glow: a color-matched shadow behind the line (default off,
   *  so existing tiles are unchanged; the rich surfaces opt in). */
  glow?: boolean;
}

/**
 * A minimal trend line for stat tiles. Pure SVG, no axes - just the shape of the
 * recent series. Flat/short series render a centered baseline rather than a
 * spike, so an empty week never looks alarming.
 */
export function Sparkline({
  data,
  width = 96,
  height = 32,
  color = COLORS.brand,
  fill = true,
  showLast = true,
  strokeWidth = 2,
  glow: glowProp = false,
}: SparklineProps) {
  const pad = strokeWidth + 1;
  const w = width;
  const h = height;

  if (!data || data.length === 0) {
    return <View style={{ width: w, height: h }} />;
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const n = data.length;
  const stepX = n > 1 ? (w - pad * 2) / (n - 1) : 0;

  const x = (i: number) => pad + i * stepX;
  const y = (v: number) => pad + (1 - (v - min) / span) * (h - pad * 2);

  const points = data.map((v, i) => ({ x: x(i), y: n > 1 ? y(v) : h / 2 }));
  const line = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");
  const area = `${line} L${points[points.length - 1].x.toFixed(1)},${h - pad} L${points[0].x.toFixed(1)},${h - pad} Z`;
  const last = points[points.length - 1];
  const gid = `spark-${Math.round(w)}-${Math.round(h)}`;

  return (
    <View style={glowProp ? glow(color, 6, 0.6) : undefined}>
    <Svg width={w} height={h}>
      {fill ? (
        <Defs>
          <LinearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity={0.25} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </LinearGradient>
        </Defs>
      ) : null}
      {fill && n > 1 ? <Path d={area} fill={`url(#${gid})`} /> : null}
      <Path
        d={line}
        stroke={color}
        strokeWidth={strokeWidth}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {showLast ? <Circle cx={last.x} cy={last.y} r={strokeWidth + 0.5} fill={color} /> : null}
    </Svg>
    </View>
  );
}
