import React, { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { Pressable } from "react-native";
import type { PressableProps } from "react-native";
import Animated, {
  Easing,
  FadeInDown,
  FadeOutUp,
  LinearTransition,
  ReduceMotion,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { hapticSelect } from "../haptics";

/**
 * zerospike motion language - one place for the app's animation vocabulary.
 *
 * Every primitive honors the system "Reduce Motion" setting: when it is on, the
 * animation collapses to its final state instantly (a snap), so the app stays
 * fully usable and never animates against a user who asked it not to.
 */

/* ── Timing ────────────────────────────────────────────────────────────────*/
export const DURATION = {
  fast: 180,
  base: 350,
  slow: 520,
  count: 900,
} as const;

export const STAGGER_MS = 60;
const ENTRANCE_TRANSLATE_Y = 12;
export const EASE_OUT = Easing.out(Easing.cubic);

/** Spring for sheets, swipe-return and playful springs. */
export const SPRING = { damping: 18, stiffness: 220, mass: 1 } as const;

/** Ready-made list item enter/exit + layout, used by the journal feed. */
export const listEntering = FadeInDown.duration(DURATION.base).easing(EASE_OUT);
export const listExiting = FadeOutUp.duration(DURATION.fast);
export const listLayout = LinearTransition.springify().damping(SPRING.damping).stiffness(SPRING.stiffness);

/** Stagger delay for the Nth item in a cascade. */
export const stagger = (index: number, step = STAGGER_MS): number => index * step;

interface FadeSlideInProps {
  children: ReactNode;
  delay?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
}

/** Fades in while rising a few points; `delay` drives the staggered cascade. */
export function FadeSlideIn({
  children,
  delay = 0,
  duration = DURATION.base,
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
      withTiming(1, { duration, easing: EASE_OUT, reduceMotion: ReduceMotion.System })
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
 * the caller can format it. `onSettle` fires once when the animation lands (for
 * a confirming haptic). Snaps to `value` under Reduce Motion.
 */
export function useCountUp(
  value: number,
  durationMs: number = DURATION.count,
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
      { duration: durationMs, easing: EASE_OUT, reduceMotion: ReduceMotion.System },
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

interface PressableScaleProps extends PressableProps {
  children: ReactNode;
  /** Pressed scale (default 0.96). */
  scaleTo?: number;
  /** Fire a light selection haptic on press-in (default true). */
  haptic?: boolean;
  style?: StyleProp<ViewStyle>;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * Pressable that scales to 0.96 on touch with a light haptic - the app's
 * standard "this is tappable" affordance. Under Reduce Motion the scale is
 * skipped (the haptic still fires).
 */
export function PressableScale({
  children,
  scaleTo = 0.96,
  haptic = true,
  style,
  onPressIn,
  onPressOut,
  ...rest
}: PressableScaleProps) {
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressable
      style={[style, animatedStyle]}
      onPressIn={(e) => {
        if (haptic) hapticSelect();
        if (!reduced) scale.value = withTiming(scaleTo, { duration: 90, easing: EASE_OUT });
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        if (!reduced) scale.value = withSpring(1, SPRING);
        onPressOut?.(e);
      }}
      {...rest}
    >
      {children}
    </AnimatedPressable>
  );
}
