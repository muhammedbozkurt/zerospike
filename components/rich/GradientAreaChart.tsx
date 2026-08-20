import React, { useMemo, useState } from "react";
import { View } from "react-native";
import type { LayoutChangeEvent, StyleProp, ViewStyle } from "react-native";
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from "react-native-svg";

import { GLUCOSE_RICH, THEME, glow } from "../../lib/theme/tokens";
import { pathsFromPoints, ribbonPath, seriesPoints } from "./svgGeom";

/** One shaded ribbon layered behind the line (a percentile band): `upper`/
 *  `lower` must be the SAME length as `data`, one value per point. */
export interface GradientAreaBand {
  upper: number[];
  lower: number[];
  color?: string;
  opacity?: number;
}

interface GradientAreaChartProps {
  data: number[];
  /** Fixed width (points). Omit to auto-fill the parent's measured width so the
   *  curve spans the whole panel and its last point reaches the right edge (E2:
   *  the AGP profile has to touch the 24:00 axis end, not stop short of it). */
  width?: number;
  height?: number;
  /** Line + area color (default cyan accent). */
  color?: string;
  /** Draw a translucent target band. Values are in the same domain as `data`;
   *  the band is placed by min/max of `data` like the line. */
  targetBand?: { min: number; max: number };
  /** Extra shaded ribbons behind the line/area (e.g. p25-p75 then p5-p95 -
   *  widest first so a narrower one draws on top of it). When present, the
   *  chart's Y-domain stretches to fit every band's values too, not just
   *  `data`'s own min/max, so the line and its ribbons never disagree about
   *  where a value sits (see seriesPoints). */
  bands?: GradientAreaBand[];
  /** Soft colored glow under the line (default true). */
  lineGlow?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * A gradient area chart: soft area fill fading to nothing, a glowing line on
 * top, and an optional green target band behind it. One shape for the AGP curve,
 * the hourly-pattern chart and the onboarding preview - the mockup's signature
 * "gradyan alan grafigi". Generalises the small Sparkline to a full panel.
 *
 * When `width` is omitted the SVG measures its container (onLayout) and draws at
 * that full width, so the plotted series always reaches the right edge instead
 * of a fixed 300pt canvas leaving an empty strip under the 24:00 tick.
 */
export function GradientAreaChart({
  data,
  width,
  height = 76,
  color = THEME.accent,
  targetBand,
  bands,
  lineGlow = true,
  style,
}: GradientAreaChartProps) {
  const [measured, setMeasured] = useState(0);
  // Undefined until measured (no 300pt guess): the container below always
  // reserves the final `height`, so nothing shifts vertically while this stays
  // 0 - only the SVG itself waits, so it never draws at a width it will
  // immediately have to redraw at.
  const w = width ?? measured;
  const onLayout =
    width == null
      ? (e: LayoutChangeEvent) => {
          const lw = Math.round(e.nativeEvent.layout.width);
          if (lw && lw !== measured) setMeasured(lw);
        }
      : undefined;

  // Y-domain: `data`'s own min/max, stretched to also fit every band's values
  // when bands are given - so the median line and its percentile ribbons are
  // never independently min/max-fit (which would make them visually disagree
  // about where a value sits). With no bands this is byte-identical to the
  // domain seriesPaths would have picked on its own.
  const domain = useMemo(() => {
    if (!data.length) return null;
    let min = Math.min(...data);
    let max = Math.max(...data);
    for (const b of bands ?? []) {
      for (const v of b.upper) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
      for (const v of b.lower) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    return { min, max };
  }, [data, bands]);

  const { line, area } = useMemo(() => {
    if (w <= 0 || !domain) return { line: "", area: "" };
    const pts = seriesPoints(data, w, height, domain.min, domain.max);
    return pathsFromPoints(pts, w, height);
  }, [data, w, height, domain]);

  const bandPaths = useMemo(() => {
    if (w <= 0 || !domain || !bands || bands.length === 0) return [];
    return bands.map((b) => ({
      d: ribbonPath(
        seriesPoints(b.upper, w, height, domain.min, domain.max),
        seriesPoints(b.lower, w, height, domain.min, domain.max)
      ),
      color: b.color ?? color,
      opacity: b.opacity ?? 0.15,
    }));
  }, [bands, w, height, domain, color]);

  const gid = `area-${w}-${height}`;

  let bandRect: { y: number; h: number } | null = null;
  if (w > 0 && targetBand && domain) {
    const span = domain.max - domain.min || 1;
    const pad = 3;
    const yFor = (v: number) => pad + (1 - (v - domain.min) / span) * (height - pad * 2);
    const yTop = yFor(targetBand.max);
    const yBot = yFor(targetBand.min);
    bandRect = { y: Math.min(yTop, yBot), h: Math.abs(yBot - yTop) };
  }

  return (
    <View
      onLayout={onLayout}
      style={[{ width: width ?? "100%", height }, lineGlow ? glow(color, 10, 0.35) : undefined, style]}
    >
      {w > 0 ? (
        <Svg width={w} height={height}>
          <Defs>
            <LinearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={color} stopOpacity={0.38} />
              <Stop offset="1" stopColor={color} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          {bandRect ? (
            <Rect x="0" y={bandRect.y} width={w} height={bandRect.h} fill={GLUCOSE_RICH.target} opacity={0.12} />
          ) : null}
          {bandPaths.map((b, i) =>
            b.d ? <Path key={i} d={b.d} fill={b.color} opacity={b.opacity} /> : null
          )}
          {area ? <Path d={area} fill={`url(#${gid})`} /> : null}
          {line ? <Path d={line} stroke={color} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" /> : null}
        </Svg>
      ) : null}
    </View>
  );
}
