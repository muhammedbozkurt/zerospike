import React from "react";
import { Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";

import { GLUCOSE_RICH, THEME, TABULAR, glow } from "../../lib/theme/tokens";
import { arcPath, clamp, glucoseFraction } from "./svgGeom";

interface GlucoseRingProps {
  /** Raw mg/dL value - drives the default sweep fraction. */
  value?: number;
  /** Big centre text (pre-formatted in the user's unit); falls back to `value`. */
  display?: string;
  /** Unit / period caption under the value (e.g. "mg/dL - 20dk"). */
  caption?: string;
  /** Status color for the value + gradient start (the glucose language). */
  color?: string;
  /** Gradient end; defaults to the cyan accent so the arc reads target -> cyan. */
  gradientTo?: string;
  /** 0..1 sweep override; defaults to a 40..300 mg/dL mapping of `value`. */
  fraction?: number;
  size?: number;
  strokeWidth?: number;
  /** Degrees of open gauge sweep (default 270, opening at the bottom). */
  sweep?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * The signature glucose ring gauge: a gradient arc (status color -> cyan) with a
 * soft colored glow and a tabular value in the centre. This is the hero of the
 * dashboard, the onboarding reveal and the Watch face. SVG arc, no libraries.
 *
 * Decorative sweep only - the exact fill is never read as a measurement; the
 * numeric value + caption always sit in the centre, so the reading stays legible
 * in greyscale and for color-vision differences.
 */
export function GlucoseRing({
  value,
  display,
  caption,
  color = GLUCOSE_RICH.target,
  gradientTo = THEME.accent,
  fraction,
  size = 132,
  strokeWidth = 9,
  sweep = 270,
  style,
}: GlucoseRingProps) {
  const cx = size / 2;
  const cy = size / 2;
  const r = (size - strokeWidth) / 2 - 2;
  const start = 90 + (360 - sweep) / 2; // bottom-opening gauge
  const frac = clamp(fraction ?? (value != null ? glucoseFraction(value) : 0.5));
  const end = start + sweep * frac;
  const gid = `ring-${Math.round(size)}`;

  const centre = display ?? (value != null ? String(Math.round(value)) : "-");

  return (
    <View style={[{ width: size, height: size, borderRadius: size / 2 }, glow(gradientTo, 22, 0.45, "fill"), style]}>
      <Svg width={size} height={size}>
        <Defs>
          <LinearGradient id={gid} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={color} />
            <Stop offset="1" stopColor={gradientTo} />
          </LinearGradient>
        </Defs>
        <Path
          d={arcPath(cx, cy, r, start, start + sweep)}
          stroke={THEME.track}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          fill="none"
        />
        {/* faint wide underlay = the drop-shadow glow of the fill */}
        <Path
          d={arcPath(cx, cy, r, start, end)}
          stroke={gradientTo}
          strokeOpacity={0.25}
          strokeWidth={strokeWidth + 6}
          strokeLinecap="round"
          fill="none"
        />
        <Path
          d={arcPath(cx, cy, r, start, end)}
          stroke={`url(#${gid})`}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          fill="none"
        />
      </Svg>
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          alignItems: "center",
          justifyContent: "center",
          paddingTop: size * 0.08,
        }}
      >
        <Text style={[TABULAR, { color, fontSize: size * 0.24, fontWeight: "800", lineHeight: size * 0.26 }]}>
          {centre}
        </Text>
        {caption ? (
          <Text style={{ color: THEME.muted, fontSize: size * 0.075, marginTop: 1 }}>{caption}</Text>
        ) : null}
      </View>
    </View>
  );
}
