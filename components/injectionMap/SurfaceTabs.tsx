import React from "react";
import { Pressable, Text, View } from "react-native";
import Animated, { useAnimatedStyle, type SharedValue } from "react-native-reanimated";

import { THEME } from "../../lib/theme/tokens";
import { withAlpha } from "../rich/GlassCard";
import type { Surface } from "./silhouette";
import { FONT_CAP, scaledMinHeight } from "../../lib/layoutForFontScale";
import { useFontScale } from "../../lib/useFontScale";

const TAB_H = 44;

function Dot({ breath }: { breath: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({ opacity: breath.value }));
  return (
    <Animated.View
      style={[
        { width: 6, height: 6, borderRadius: 3, marginLeft: 6, backgroundColor: THEME.accentStrong },
        style,
      ]}
    />
  );
}

/**
 * Front | Back switch above the figure. Two equal halves with a one-line label
 * each, so the longest translation still fits. A dot on the inactive tab marks
 * that the next-up region is on that face; it never switches the tab itself.
 */
export function SurfaceTabs({
  value,
  onChange,
  labels,
  dotOn,
  breath,
}: {
  value: Surface;
  onChange: (next: Surface) => void;
  labels: Record<Surface, string>;
  dotOn: Surface | null;
  breath: SharedValue<number>;
}) {
  const fontScale = useFontScale(FONT_CAP.chip);
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: "row",
        alignSelf: "stretch",
        minHeight: scaledMinHeight(TAB_H, fontScale, FONT_CAP.chip),
        padding: 3,
        gap: 3,
        borderRadius: TAB_H / 2,
        borderWidth: 1,
        borderColor: THEME.border,
        backgroundColor: THEME.surfaceInset,
      }}
    >
      {(["front", "back"] as const).map((key) => {
        const on = value === key;
        return (
          <Pressable
            key={key}
            onPress={() => onChange(key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={labels[key]}
            style={{
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: (TAB_H - 6) / 2,
              paddingHorizontal: 8,
              backgroundColor: on ? withAlpha(THEME.accent, 0.16) : "transparent",
              borderWidth: 1,
              borderColor: on ? withAlpha(THEME.accent, 0.5) : "transparent",
            }}
          >
            <Text
              numberOfLines={1}
              maxFontSizeMultiplier={FONT_CAP.chip}
              style={{
                flexShrink: 1,
                color: on ? THEME.accent : THEME.textMuted,
                fontSize: 13,
                fontWeight: "800",
              }}
            >
              {labels[key]}
            </Text>
            {dotOn === key && !on ? <Dot breath={breath} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}
