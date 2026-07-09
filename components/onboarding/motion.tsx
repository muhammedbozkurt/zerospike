import React, { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, {
  Easing,
  ReduceMotion,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";

/**
 * Onboarding motion standard (mirrors the statura template): a single
 * fade-and-rise entrance and a count-up hook, both honoring the system
 * "Reduce Motion" setting so the flow degrades to plain, instant content.
 */
export const ENTRANCE_DURATION_MS = 380;
export const ENTRANCE_STAGGER_MS = 80;
const ENTRANCE_TRANSLATE_Y = 12;
const ENTRANCE_EASING = Easing.out(Easing.cubic);
export const COUNT_UP_DURATION_MS = 900;

interface FadeSlideInProps {
  children: ReactNode;
  delay?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
}

/** Fades in while rising a few points; delay drives the staggered cascade. */
export function FadeSlideIn({
  children,
  delay = 0,
  duration = ENTRANCE_DURATION_MS,
  style,
}: FadeSlideInProps) {
  const reduced = useReducedMotion();
  const progress = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) {
      progress.value = 1;
      return;
    }
    progress.value = withDelay(
      delay,
      withTiming(1, {
        duration,
        easing: ENTRANCE_EASING,
        reduceMotion: ReduceMotion.System,
      })
    );
  }, [delay, duration, reduced, progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * ENTRANCE_TRANSLATE_Y }],
  }));

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}

/**
 * Counts an integer from 0 up to `value`, returning the current whole number so
 * the caller can format it (e.g. through the mg/dL → unit helper). `onSettle`
 * fires once when the animation lands, for a confirming haptic.
 */
export function useCountUp(
  value: number,
  durationMs: number = COUNT_UP_DURATION_MS,
  onSettle?: () => void
): number {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(reduced ? value : 0);
  const progress = useSharedValue(reduced ? value : 0);
  const onSettleRef = useRef(onSettle);
  onSettleRef.current = onSettle;

  useEffect(() => {
    if (reduced) {
      setDisplay(value);
      progress.value = value;
      onSettleRef.current?.();
      return;
    }
    const notifySettle = () => onSettleRef.current?.();
    progress.value = withTiming(
      value,
      {
        duration: durationMs,
        easing: Easing.out(Easing.cubic),
        reduceMotion: ReduceMotion.System,
      },
      (finished) => {
        if (finished) runOnJS(notifySettle)();
      }
    );
  }, [value, reduced, durationMs, progress]);

  useAnimatedReaction(
    () => Math.round(progress.value),
    (current, previous) => {
      if (current !== previous) runOnJS(setDisplay)(current);
    },
    [progress]
  );

  return display;
}
