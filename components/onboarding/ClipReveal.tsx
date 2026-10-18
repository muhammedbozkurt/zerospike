import React, { useEffect, useState } from "react";
import { View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";

import { DURATION, EASE_OUT } from "../../lib/theme/motion";

/**
 * Draws its child left to right by growing a clip window over it. The child is
 * laid out at the full measured width from the start (so a chart never
 * re-measures mid-draw); only the visible window moves. Reduce Motion shows the
 * final state at once. `active` false parks it closed, so a slide that is off
 * screen replays when it comes back.
 */
export function ClipReveal({
  height,
  width: fixedWidth,
  active = true,
  delay = 0,
  duration = DURATION.slow,
  style,
  children,
}: {
  height: number;
  width?: number;
  active?: boolean;
  delay?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
  children: (width: number) => React.ReactNode;
}) {
  const reduced = useReducedMotion();
  const [measured, setMeasured] = useState(0);
  const width = fixedWidth ?? measured;
  const progress = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) {
      progress.value = 1;
      return;
    }
    if (width === 0) {
      progress.value = 0;
      return;
    }
    progress.value = active
      ? withDelay(
          delay,
          withTiming(1, { duration, easing: EASE_OUT, reduceMotion: ReduceMotion.System })
        )
      : 0;
  }, [active, delay, duration, reduced, progress, width]);

  const clip = useAnimatedStyle(() => ({ width: progress.value * width }));

  return (
    <View
      style={[{ width: fixedWidth ?? "100%", height }, style]}
      onLayout={(e) => {
        const w = Math.round(e.nativeEvent.layout.width);
        if (w && w !== measured) setMeasured(w);
      }}
    >
      {width > 0 ? (
        <Animated.View style={[{ height, overflow: "hidden" }, clip]}>
          <View style={{ width, height }}>{children(width)}</View>
        </Animated.View>
      ) : null}
    </View>
  );
}
