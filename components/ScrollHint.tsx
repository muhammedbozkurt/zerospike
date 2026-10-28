import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { SCROLL_HINT_GAP_PT, scrollHintMotion } from "../lib/scrollHint";
import { useReduceMotion } from "../lib/useScrollHint";
import { useFontScale } from "../lib/useFontScale";
import { scrollHintAllowed } from "../lib/layoutForFontScale";
import { THEME } from "../lib/theme/tokens";

const SIZE = 32;
const BOB_PT = 5;

/**
 * Small down chevron at the bottom centre of a scroll area. Place it right
 * AFTER the ScrollView (a sibling): it hangs from a zero-height anchor at the
 * ScrollView's bottom edge, so a footer/CTA below the ScrollView is never
 * covered and `bottomOffset` (lib/scrollHint hintBottomOffset) is measured from
 * that edge. Decorative: hidden from screen readers and never takes a touch.
 * Reduce Motion: one static frame, no fade, no bob.
 */
export function ScrollHint({
  visible,
  bottomOffset,
  inFlow = false,
}: {
  visible: boolean;
  bottomOffset: number;
  /** Reserve its own strip under the ScrollView instead of floating over the
   *  last visible line, so the chevron never sits on text. */
  inFlow?: boolean;
}): React.ReactElement | null {
  const reduce = useReduceMotion();
  const fontScale = useFontScale();
  const opacity = useRef(new Animated.Value(0)).current;
  const bob = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    const motion = scrollHintMotion(reduce);
    if (visible) {
      setMounted(true);
      if (!motion.animate) {
        opacity.setValue(1);
        bob.setValue(0);
        return;
      }
      bob.setValue(0);
      opacity.setValue(0);
      const fadeIn = Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true });
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(bob, { toValue: 1, duration: 450, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(bob, { toValue: 0, duration: 450, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ]),
        { iterations: motion.loops },
      );
      fadeIn.start();
      loop.start();
      return () => {
        fadeIn.stop();
        loop.stop();
      };
    }
    if (!motion.fade) {
      opacity.setValue(0);
      setMounted(false);
      return;
    }
    const fadeOut = Animated.timing(opacity, { toValue: 0, duration: 160, useNativeDriver: true });
    fadeOut.start(({ finished }) => {
      if (finished) setMounted(false);
    });
    return () => fadeOut.stop();
  }, [visible, reduce, opacity, bob]);

  // Large text: the chevron is an overlay and would sit on the (now tall) text
  // lines; content running off the screen edge already says "scroll".
  if (!mounted || !scrollHintAllowed(fontScale)) return null;

  const chip = (
    <Animated.View
      style={{
        opacity,
        transform: [{ translateY: bob.interpolate({ inputRange: [0, 1], outputRange: [0, BOB_PT] }) }],
      }}
    >
      <View
        style={{
          width: SIZE,
          height: SIZE,
          borderRadius: SIZE / 2,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: THEME.surfaceRaised,
          borderWidth: 1,
          borderColor: THEME.border,
          opacity: 0.92,
        }}
      >
        <Ionicons name="chevron-down" size={18} color={THEME.text} />
      </View>
    </Animated.View>
  );

  if (inFlow) {
    return (
      <View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          height: SIZE + BOB_PT + 4,
          marginBottom: Math.max(0, bottomOffset - SCROLL_HINT_GAP_PT),
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {chip}
      </View>
    );
  }

  return (
    <View
      pointerEvents="none"
      collapsable={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ height: 0, zIndex: 5 }}
    >
      <View style={{ position: "absolute", left: 0, right: 0, bottom: bottomOffset, alignItems: "center" }}>
        {chip}
      </View>
    </View>
  );
}
