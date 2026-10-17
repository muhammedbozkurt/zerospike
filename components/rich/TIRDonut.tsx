import React from "react";
import { Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import Svg, { Circle, G } from "react-native-svg";

import { GLUCOSE_RICH, THEME, TABULAR } from "../../lib/theme/tokens";

export interface DonutSegment {
  /** Share of the ring, 0..1 (the parts should sum to <= 1). */
  value: number;
  color: string;
  /** Whether this segment gets the soft glow (usually the target slice). */
  glow?: boolean;
}

interface TIRDonutProps {
  segments: DonutSegment[];
  /** Big centre number (e.g. the time-in-range percent). */
  centerValue?: string;
  /** Small suffix after the centre number (e.g. "%"). */
  centerSuffix?: string;
  /** Render `centerSuffix` BEFORE the number (Turkish writes "%92"). */
  centerSuffixFirst?: boolean;
  size?: number;
  strokeWidth?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Time-in-range donut: colored arcs for low / target / high (/ very-high) laid
 * around a ring with the headline percent in the centre. The colors come from
 * the one glucose language, so a slice reads the same here as on a chip or the
 * dashboard ring. Every slice is labeled elsewhere by its number, never color
 * alone. This is the mockup's Insights donut.
 */
export function TIRDonut({
  segments,
  centerValue,
  centerSuffix,
  centerSuffixFirst = false,
  size = 96,
  strokeWidth = 11,
  style,
}: TIRDonutProps) {
  const cx = size / 2;
  const cy = size / 2;
  // Glow segments draw at strokeWidth + 2 (below); the radius must budget for
  // that THICKEST stroke or the ring's outer edge lands 1px outside the SVG on
  // all four tangent points and gets flat-clipped there.
  const r = (size - (strokeWidth + 2)) / 2;
  const c = 2 * Math.PI * r;
  let acc = 0;

  return (
    <View style={[{ width: size, height: size }, style]}>
      <Svg width={size} height={size}>
        <Circle cx={cx} cy={cy} r={r} stroke={THEME.track} strokeWidth={strokeWidth} fill="none" />
        <G rotation={-90} origin={`${cx}, ${cy}`}>
          {segments.map((seg, i) => {
            const dash = Math.max(0, seg.value) * c;
            const offset = -acc * c;
            acc += Math.max(0, seg.value);
            return (
              <Circle
                key={i}
                cx={cx}
                cy={cy}
                r={r}
                stroke={seg.color}
                strokeWidth={seg.glow ? strokeWidth + 2 : strokeWidth}
                strokeDasharray={`${dash} ${c - dash}`}
                strokeDashoffset={offset}
                strokeLinecap="butt"
                fill="none"
                opacity={seg.glow ? 1 : 0.95}
              />
            );
          })}
        </G>
      </Svg>
      {centerValue != null ? (
        <View
          pointerEvents="none"
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}
        >
          {/* Bidi: centerSuffixFirst already puts the sign on the right side
              of centerValue for the language; pin the whole run LTR so an
              RTL base paragraph direction cannot reorder it again (same
              fix family as StatCard's suffix row). */}
          <Text
            style={[
              TABULAR,
              {
                color: THEME.text,
                fontSize: size * 0.22,
                fontWeight: "800",
                writingDirection: "ltr",
              },
            ]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
          >
            {centerSuffix && centerSuffixFirst ? (
              <Text style={{ fontSize: size * 0.12, color: THEME.textMuted }}>{centerSuffix}</Text>
            ) : null}
            {centerValue}
            {centerSuffix && !centerSuffixFirst ? (
              <Text style={{ fontSize: size * 0.12, color: THEME.textMuted }}>{centerSuffix}</Text>
            ) : null}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** Convenience: build the four-state TIR segments from percentages (0..100). */
export function tirSegments(pct: {
  low: number;
  target: number;
  high: number;
  veryHigh?: number;
}): DonutSegment[] {
  return [
    { value: pct.low / 100, color: GLUCOSE_RICH.low },
    { value: pct.target / 100, color: GLUCOSE_RICH.target, glow: true },
    { value: pct.high / 100, color: GLUCOSE_RICH.high },
    ...(pct.veryHigh ? [{ value: pct.veryHigh / 100, color: GLUCOSE_RICH.veryHigh }] : []),
  ];
}
