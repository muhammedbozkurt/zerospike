import React, { useMemo } from "react";
import { Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import Svg, { Path } from "react-native-svg";

import { THEME, glow } from "../../lib/theme/tokens";
import { lerpHex, polar } from "./svgGeom";

interface ConicAvatarProps {
  /** Initials or a single glyph (e.g. an emblem char) rendered in the centre. */
  label?: string;
  size?: number;
  /** Conic color stops, wrapping back to the first. Default cyan -> violet -> cyan. */
  stops?: string[];
  /** Starting angle in degrees (mockup uses 200). */
  fromDeg?: number;
  style?: StyleProp<ViewStyle>;
}

/** Sample the conic gradient (a list of stops looping to the start) at 0..1. */
function conicColor(stops: string[], t: number): string {
  const loop = [...stops, stops[0]];
  const segs = loop.length - 1;
  const scaled = t * segs;
  const i = Math.min(segs - 1, Math.floor(scaled));
  return lerpHex(loop[i], loop[i + 1], scaled - i);
}

/**
 * A conic-gradient avatar, drawn as SVG wedges (react-native-svg has no native
 * conic gradient) with a color-matched glow and centered initials. Doubles as
 * the Spike emblem. The mockup's `.avatar` / brand mark.
 */
export function ConicAvatar({
  label,
  size = 28,
  stops: stopsProp,
  fromDeg = 200,
  style,
}: ConicAvatarProps) {
  const stops = useMemo(() => stopsProp ?? [THEME.accent, THEME.violet, THEME.accent], [stopsProp, THEME.scheme]);
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2;

  // 48 paths + a conic sample per path: recomputed only when the geometry or
  // colors actually change, not on every keystroke of an unrelated input on
  // the same screen (app/profile-setup.tsx re-renders this on each character).
  const wedges = useMemo(() => {
    const count = 48;
    const wedge = 360 / count;
    const paths = [];
    for (let i = 0; i < count; i++) {
      const a0 = fromDeg + i * wedge;
      const a1 = a0 + wedge + 0.6; // overlap to avoid hairline seams
      const p0 = polar(cx, cy, r, a0);
      const p1 = polar(cx, cy, r, a1);
      paths.push(
        <Path
          key={i}
          d={`M${cx},${cy} L${p0.x.toFixed(2)},${p0.y.toFixed(2)} A${r},${r} 0 0 1 ${p1.x.toFixed(2)},${p1.y.toFixed(2)} Z`}
          fill={conicColor(stops, i / count)}
        />
      );
    }
    return paths;
  }, [size, stops, fromDeg, cx, cy, r]);

  return (
    <View
      style={[
        { width: size, height: size, borderRadius: r, overflow: "hidden", alignItems: "center", justifyContent: "center" },
        glow(stops[0], size * 0.4, 0.6, "fill"),
        style,
      ]}
    >
      <Svg width={size} height={size} style={{ position: "absolute" }}>
        {wedges}
      </Svg>
      {label ? (
        <Text style={{ color: THEME.accentOnFill, fontWeight: "800", fontSize: size * 0.42 }}>{label}</Text>
      ) : null}
    </View>
  );
}
