import React, { useEffect, useMemo } from "react";
import { Text, View } from "react-native";
import Animated, {
  Easing,
  ReduceMotion,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion as useReanimatedReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import type { SharedValue } from "react-native-reanimated";
import Svg, { Circle, Defs, LinearGradient, Path, RadialGradient, Stop } from "react-native-svg";

import { SPACE, THEME, glow } from "../lib/theme/tokens";
import { useReducedMotion } from "../lib/useReducedMotion";
import {
  SPARK_BURST_MS,
  celebrationPlan,
  sparkSpecs,
  type SparkSpec,
  type SparkTone,
} from "../lib/proWelcome";

const STAGE = 250;
const BADGE = 116;
const HALO = 96;

// Four-point sparkle, centred on 0,0 with a 22 radius.
const STAR_PATH =
  "M0,-22 C2,-8 8,-2 22,0 C8,2 2,8 0,22 C-2,8 -8,2 -22,0 C-8,-2 -2,-8 0,-22 Z";

function toneColor(tone: SparkTone): string {
  switch (tone) {
    case "accent":
      return THEME.accent;
    case "strong":
      return THEME.accentStrong;
    case "target":
      return THEME.success;
    case "warm":
      return THEME.warning;
  }
}

function Spark({ spec, progress }: { spec: SparkSpec; progress: SharedValue<number> }) {
  const dx = Math.cos(spec.angle) * spec.distance;
  const dy = Math.sin(spec.angle) * spec.distance;
  // Each spark starts a little later than the first, inside the same burst.
  const lag = spec.delayMs / SPARK_BURST_MS;
  const style = useAnimatedStyle(() => {
    const p = Math.min(1, Math.max(0, (progress.value - lag) / (1 - lag)));
    return {
      opacity: interpolate(p, [0, 0.15, 0.65, 1], [0, 1, 0.9, 0]),
      transform: [
        { translateX: dx * p },
        { translateY: dy * p },
        { scale: interpolate(p, [0, 0.25, 1], [0.2, 1.15, 0.55]) },
        { rotate: `${interpolate(p, [0, 1], [0, spec.shape === "star" ? 90 : 0])}deg` },
      ],
    };
  });
  const color = toneColor(spec.tone);
  const half = spec.size / 2;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: "absolute",
          left: STAGE / 2 - half,
          top: STAGE / 2 - half,
          width: spec.size,
          height: spec.size,
        },
        style,
      ]}
    >
      {spec.shape === "star" ? (
        <Svg width={spec.size} height={spec.size} viewBox="-24 -24 48 48">
          <Path d={STAR_PATH} fill={color} />
        </Svg>
      ) : (
        <View style={{ flex: 1, borderRadius: half, backgroundColor: color }} />
      )}
    </Animated.View>
  );
}

/**
 * The Pro emblem on the welcome: a lit disc with a sparkle, a "PRO" tag, and a
 * one-shot burst of token-coloured sparks round it. The whole thing is
 * decoration (hidden from screen readers; the heading below carries the
 * message). With Reduce Motion on it is the same emblem standing still, no
 * sparks.
 */
export function ProCelebration() {
  const reducedApp = useReducedMotion();
  const reducedSys = useReanimatedReducedMotion();
  const plan = celebrationPlan(reducedApp || reducedSys);
  const specs = useMemo(() => sparkSpecs(plan.sparks), [plan.sparks]);

  const badge = useSharedValue(plan.animate ? 0 : 1);
  const tag = useSharedValue(plan.animate ? 0 : 1);
  const burst = useSharedValue(0);
  const pulse = useSharedValue(0);

  useEffect(() => {
    if (!plan.animate) {
      cancelAnimation(badge);
      cancelAnimation(tag);
      cancelAnimation(burst);
      cancelAnimation(pulse);
      badge.value = 1;
      tag.value = 1;
      burst.value = 0;
      pulse.value = 0;
      return;
    }
    badge.value = withDelay(
      80,
      withSpring(1, { damping: 8, stiffness: 120, mass: 0.9, reduceMotion: ReduceMotion.System })
    );
    tag.value = withDelay(
      520,
      withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.System })
    );
    burst.value = withDelay(
      260,
      withTiming(1, { duration: SPARK_BURST_MS, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.System })
    );
    pulse.value = withDelay(
      260,
      withTiming(1, { duration: 1100, easing: Easing.out(Easing.quad), reduceMotion: ReduceMotion.System })
    );
  }, [plan.animate, badge, tag, burst, pulse]);

  const badgeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(badge.value, [0, 0.25, 1], [0, 1, 1]),
    transform: [{ scale: interpolate(badge.value, [0, 1], [0.3, 1]) }],
  }));
  const haloStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pulse.value, [0, 0.1, 1], [0, 0.55, 0]),
    transform: [{ scale: interpolate(pulse.value, [0, 1], [0.85, 2.1]) }],
  }));
  const tagStyle = useAnimatedStyle(() => ({
    opacity: tag.value,
    transform: [{ translateY: interpolate(tag.value, [0, 1], [8, 0]) }],
  }));

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: STAGE, height: STAGE, marginTop: -SPACE.xl, alignSelf: "center", alignItems: "center", justifyContent: "center" }}
    >
      <Svg width={STAGE} height={STAGE} style={{ position: "absolute" }}>
        <Defs>
          <RadialGradient id="proGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={THEME.accent} stopOpacity={0.4} />
            <Stop offset="0.55" stopColor={THEME.accent} stopOpacity={0.12} />
            <Stop offset="1" stopColor={THEME.accent} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={STAGE / 2} cy={STAGE / 2} r={STAGE / 2} fill="url(#proGlow)" />
      </Svg>

      {plan.animate ? (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              width: HALO,
              height: HALO,
              borderRadius: HALO / 2,
              borderWidth: 2,
              borderColor: THEME.accent,
            },
            haloStyle,
          ]}
        />
      ) : null}

      <Animated.View style={[{ width: BADGE, height: BADGE }, glow(THEME.accentFill, 26, 0.55, "shadowless"), badgeStyle]}>
        <Svg width={BADGE} height={BADGE} viewBox="0 0 116 116">
          <Defs>
            <LinearGradient id="proDisc" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={THEME.accentStrong} />
              <Stop offset="1" stopColor={THEME.accentFill} />
            </LinearGradient>
          </Defs>
          <Circle cx="58" cy="58" r="54" fill="none" stroke={THEME.accent} strokeOpacity={0.45} strokeWidth="2" />
          <Circle cx="58" cy="58" r="47" fill="url(#proDisc)" />
          <Circle cx="58" cy="58" r="40" fill="none" stroke={THEME.accentOnFill} strokeOpacity={0.3} strokeWidth="1.5" />
          <Path d={STAR_PATH} transform="translate(58 56) scale(1.45)" fill={THEME.accentOnFill} />
          <Path d={STAR_PATH} transform="translate(82 33) scale(0.42)" fill={THEME.accentOnFill} fillOpacity={0.85} />
        </Svg>
        <Animated.View
          style={[
            {
              position: "absolute",
              bottom: -12,
              alignSelf: "center",
              paddingHorizontal: 12,
              paddingVertical: 3,
              borderRadius: 999,
              backgroundColor: THEME.accentFill,
              borderWidth: 2,
              borderColor: THEME.bg.base,
            },
            tagStyle,
          ]}
        >
          <Text
            allowFontScaling={false}
            style={{ color: THEME.accentOnFill, fontWeight: "900", fontSize: 12, letterSpacing: 1.2 }}
          >
            PRO
          </Text>
        </Animated.View>
      </Animated.View>

      {plan.animate ? specs.map((spec, i) => <Spark key={i} spec={spec} progress={burst} />) : null}
    </View>
  );
}
