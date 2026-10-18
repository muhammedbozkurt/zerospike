import React from "react";
import Animated, { useAnimatedProps, type SharedValue } from "react-native-reanimated";
import { Circle, G, Rect, Text as SvgText } from "react-native-svg";

import { PALETTES, THEME } from "../../lib/theme/tokens";
import { withAlpha } from "../rich/GlassCard";
import { hitBoxFor, type Region } from "./silhouette";
import { tierStroke, type Tier } from "./tiers";

const AnimatedRect = Animated.createAnimatedComponent(Rect);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** Gap between a region and its selection / next-up ring. */
export const HALO = 1.4;
const NEXT_STROKE = 2.4;
const NEXT_OUTER_GAP = 2.6;
const NEXT_OUTER_STROKE = 1.2;
const SELECT_STROKE = 1.6;
/** The next-up ring moves inside the plate when the region is also selected. */
const INNER_INSET = 2.4;

export function tierFill(tier: Tier): string {
  return THEME.heatRamp[tier];
}

function luminance(hex: string): number {
  const lin = (v: number): number => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const c = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** Whichever of the two theme inks reads better on this plate. */
export function inkFor(fill: string): string {
  const l = luminance(fill);
  const light = PALETTES.dark.text;
  const dark = PALETTES.light.text;
  const cr = (a: number, b: number): number => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  return cr(l, luminance(light)) >= cr(l, luminance(dark)) ? light : dark;
}

/** The single next-up cue: a thin bright outline that breathes. */
export function BreathRect({
  x,
  y,
  w,
  h,
  rx,
  breath,
  strokeWidth,
  outer = true,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  rx: number;
  breath: SharedValue<number>;
  strokeWidth: number;
  outer?: boolean;
}) {
  const animatedProps = useAnimatedProps(() => ({ opacity: breath.value }));
  const gap = (strokeWidth / NEXT_STROKE) * NEXT_OUTER_GAP;
  return (
    <>
      {outer ? (
        <AnimatedRect
          x={x - gap}
          y={y - gap}
          width={w + gap * 2}
          height={h + gap * 2}
          rx={rx + gap}
          fill="none"
          stroke={withAlpha(THEME.accentStrong, 0.35)}
          strokeWidth={(strokeWidth / NEXT_STROKE) * NEXT_OUTER_STROKE}
          animatedProps={animatedProps}
        />
      ) : null}
      <AnimatedRect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={rx}
        fill="none"
        stroke={THEME.accentStrong}
        strokeWidth={strokeWidth}
        animatedProps={animatedProps}
      />
    </>
  );
}

export function BreathCircle({
  cx,
  cy,
  r,
  breath,
  strokeWidth,
}: {
  cx: number;
  cy: number;
  r: number;
  breath: SharedValue<number>;
  strokeWidth: number;
}) {
  const animatedProps = useAnimatedProps(() => ({ opacity: breath.value }));
  return (
    <AnimatedCircle
      cx={cx}
      cy={cy}
      r={r}
      fill="none"
      stroke={THEME.accentStrong}
      strokeWidth={strokeWidth}
      animatedProps={animatedProps}
    />
  );
}

/**
 * One tappable region: rounded plate in its tier colour, a plain thin outline,
 * and the selection / next-up rings. The count is drawn only on the selected
 * region; the accessibility label carries every count regardless.
 */
export function RegionShape({
  region,
  tier,
  count,
  upx,
  selected,
  next,
  inert,
  breath,
  label,
  onPress,
}: {
  region: Region;
  tier: Tier;
  count: number;
  upx: number;
  selected: boolean;
  next: boolean;
  inert: boolean;
  breath: SharedValue<number>;
  label: string;
  onPress: () => void;
}) {
  const [bx, by, bw, bh] = region.box;
  const [hx, hy, hw, hh] = hitBoxFor(region);
  const fill = tierFill(tier);
  const countFont = 11 * upx;
  return (
    <G
      opacity={inert ? 0.32 : 1}
      onPress={inert ? undefined : onPress}
      accessible={!inert}
      accessibilityRole={inert ? undefined : "button"}
      accessibilityLabel={inert ? undefined : label}
    >
      {!inert ? <Rect x={hx} y={hy} width={hw} height={hh} fill="transparent" /> : null}
      {selected ? (
        <Rect
          x={bx - HALO}
          y={by - HALO}
          width={bw + HALO * 2}
          height={bh + HALO * 2}
          rx={region.rx + HALO}
          fill="none"
          stroke={THEME.accent}
          strokeWidth={SELECT_STROKE * upx}
        />
      ) : null}
      {next && !selected ? (
        <BreathRect
          x={bx - HALO}
          y={by - HALO}
          w={bw + HALO * 2}
          h={bh + HALO * 2}
          rx={region.rx + HALO}
          breath={breath}
          strokeWidth={NEXT_STROKE * upx}
        />
      ) : null}
      <Rect
        x={bx}
        y={by}
        width={bw}
        height={bh}
        rx={region.rx}
        fill={fill}
        stroke={THEME.borderStrong}
        strokeWidth={tierStroke(tier) * upx}
      />
      {next && selected ? (
        <BreathRect
          x={bx + INNER_INSET}
          y={by + INNER_INSET}
          w={bw - INNER_INSET * 2}
          h={bh - INNER_INSET * 2}
          rx={Math.max(0, region.rx - INNER_INSET)}
          breath={breath}
          strokeWidth={NEXT_STROKE * upx}
          outer={false}
        />
      ) : null}
      {selected && !inert ? (
        <SvgText
          x={bx + bw / 2}
          y={by + bh / 2 + countFont * 0.36}
          fontSize={countFont}
          fontWeight="bold"
          fill={inkFor(fill)}
          textAnchor="middle"
        >
          {String(count)}
        </SvgText>
      ) : null}
    </G>
  );
}
