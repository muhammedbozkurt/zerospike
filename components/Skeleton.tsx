import React, { useEffect } from "react";
import type { DimensionValue, StyleProp, ViewStyle } from "react-native";
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { RADIUS, THEME } from "../lib/theme/tokens";

interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Shimmering placeholder block, used instead of a spinner while data loads. The
 * pulse is disabled under Reduce Motion (it renders as a static muted block).
 */
export function Skeleton({
  width = "100%",
  height = 16,
  radius = RADIUS.sm,
  style,
}: SkeletonProps) {
  const reduced = useReducedMotion();
  const opacity = useSharedValue(reduced ? 0.5 : 0.35);

  useEffect(() => {
    if (reduced) return;
    opacity.value = withRepeat(
      withTiming(0.7, { duration: 850, easing: Easing.inOut(Easing.quad), reduceMotion: ReduceMotion.System }),
      -1,
      true
    );
  }, [reduced, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      style={[
        { width, height, borderRadius: radius, backgroundColor: THEME.track },
        animatedStyle,
        style,
      ]}
    />
  );
}

/** A stack of skeleton lines, for list/card loading states. */
export function SkeletonGroup({ lines = 3, gap = 10 }: { lines?: number; gap?: number }) {
  return (
    <>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          width={i === lines - 1 ? "60%" : "100%"}
          style={{ marginBottom: i === lines - 1 ? 0 : gap }}
        />
      ))}
    </>
  );
}
