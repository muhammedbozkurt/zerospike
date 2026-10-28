import React from "react";
import { Pressable, Text, View } from "react-native";
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";

import { DURATION, SPRING } from "../../lib/theme/motion";

import { RADIUS, THEME, glow } from "../../lib/theme/tokens";
import { withAlpha } from "../rich/GlassCard";

type IconName = keyof typeof Ionicons.glyphMap;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const PRESS_SCALE = 0.98;


/**
 * A full-width quiz answer card. Three shapes, all driven by the props:
 *
 *   description + icon -> the tall "rich" card (unit choice): 84pt, a 44pt icon
 *                         plate, an 18pt label and a technical note under it.
 *   icon               -> the standard 64pt card with a 40pt plate.
 *   neither            -> the 60pt radio card (diabetes type), where an icon
 *                         would only add loaded imagery.
 *
 * The selected state is the same everywhere: a cyan tint, a 1.5pt accent edge
 * and a FILLED check disc (leading on the radio shape, trailing where an icon
 * plate already holds the leading slot).
 */
export function OptionCard({
  label,
  selected,
  onPress,
  icon,
  description,
  spacing = 12,
  dimmed = false,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  icon?: IconName;
  /** Optional short technical note under the label (e.g. a unit example). */
  description?: string;
  /** Gap to the next card. The steps differ (the six-option diabetes list is
   *  tighter than the two-option unit list), so the caller owns it. */
  spacing?: number;
  /** An answer this device cannot honour right now (Health Connect missing):
   *  drawn quieter, still tappable so the press can point at the fix. */
  dimmed?: boolean;
}) {
  const rich = !!icon && !!description;
  const plate = rich ? 44 : 40;
  const mark = 26;
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  /** The trailing (or, with no icon, leading) selection mark. */
  const checkMark = (size: number) =>
    selected ? (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: RADIUS.full,
          backgroundColor: THEME.accentFill,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name="checkmark" size={Math.round(size * 0.58)} color={THEME.accentOnFill} />
      </View>
    ) : (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: RADIUS.full,
          borderWidth: 1.5,
          borderColor: THEME.borderStrong,
        }}
      />
    );

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={() => {
        if (!reduced) {
          scale.value = withTiming(PRESS_SCALE, {
            duration: DURATION.fast / 2,
            reduceMotion: ReduceMotion.System,
          });
        }
      }}
      onPressOut={() => {
        if (!reduced) scale.value = withSpring(1, SPRING);
      }}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      accessibilityHint={description}
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          gap: rich ? 16 : 14,
          minHeight: rich ? 84 : icon ? 64 : 60,
          paddingHorizontal: rich ? 20 : 18,
          paddingVertical: rich ? 18 : 16,
          borderRadius: rich ? RADIUS.xl : RADIUS.lg,
          marginBottom: spacing,
          // 1.5 both ways so selecting a card never shifts the row by half a
          // point (the accent edge is drawn over the hairline, not beside it).
          borderWidth: 1.5,
          borderColor: selected ? THEME.accent : THEME.border,
          backgroundColor: selected ? withAlpha(THEME.accent, 0.1) : THEME.surface,
          opacity: dimmed ? 0.6 : 1,
        },
        selected ? glow(THEME.accent, 26, 0.35) : undefined,
        pressStyle,
      ]}
    >
      {icon ? (
        <View
          style={{
            width: plate,
            height: plate,
            borderRadius: rich ? 14 : RADIUS.md,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: selected
              ? withAlpha(THEME.accent, 0.14)
              : THEME.surfaceInset,
          }}
        >
          <Ionicons name={icon} size={22} color={selected ? THEME.accent : THEME.textMuted} />
        </View>
      ) : (
        checkMark(24)
      )}

      <View style={{ flex: 1, gap: description ? 3 : 0 }}>
        <Text
          style={{
            color: THEME.text,
            fontSize: rich ? 18 : 17,
            lineHeight: rich ? 24 : 23,
            fontWeight: selected || icon ? "600" : "500",
          }}
        >
          {label}
        </Text>
        {description ? (
          <Text style={{ color: THEME.textMuted, fontSize: 13, lineHeight: 18 }}>
            {description}
          </Text>
        ) : null}
      </View>

      {icon ? checkMark(mark) : null}
    </AnimatedPressable>
  );
}
