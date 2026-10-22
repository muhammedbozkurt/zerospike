import { useEffect, useState } from "react";
import { AccessibilityInfo, Animated } from "react-native";

import { fadeDuration, motionDuration } from "./reducedMotion";

export { REDUCED_FADE_MS, fadeDuration, motionDuration, slideDistance } from "./reducedMotion";

// Module cache: the first read is async, so a sheet that opens right after
// launch would otherwise animate once before the setting arrives.
let current = false;
const listeners = new Set<(v: boolean) => void>();

function publish(v: boolean) {
  if (v === current) return;
  current = v;
  listeners.forEach((l) => l(v));
}

AccessibilityInfo.isReduceMotionEnabled()
  .then((v) => publish(!!v))
  .catch(() => {});
AccessibilityInfo.addEventListener("reduceMotionChanged", (v) => publish(!!v));

export function isReducedMotionNow(): boolean {
  return current;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(current);
  useEffect(() => {
    listeners.add(setReduced);
    setReduced(current);
    return () => {
      listeners.delete(setReduced);
    };
  }, []);
  return reduced;
}

type TimingConfig = Animated.TimingAnimationConfig;
type SpringConfig = Animated.SpringAnimationConfig;

/** Timing that snaps to the target when Reduce Motion is on. */
export function animate(reduced: boolean, value: Animated.Value, config: TimingConfig): Animated.CompositeAnimation {
  return Animated.timing(value, { ...config, duration: motionDuration(reduced, config.duration ?? 500) });
}

/** Opacity-only timing: under Reduce Motion a short fade instead of snapping. */
export function animateFade(reduced: boolean, value: Animated.Value, config: TimingConfig): Animated.CompositeAnimation {
  return Animated.timing(value, { ...config, duration: fadeDuration(reduced, config.duration ?? 500) });
}

/** Spring that becomes an instant set when Reduce Motion is on. */
export function animateSpring(reduced: boolean, value: Animated.Value, config: SpringConfig): Animated.CompositeAnimation {
  if (!reduced) return Animated.spring(value, config);
  return Animated.timing(value, { toValue: config.toValue as number, duration: 0, useNativeDriver: config.useNativeDriver });
}
