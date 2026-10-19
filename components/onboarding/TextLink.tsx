import React from "react";
import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { Txt } from "../ui";
import { withAlpha } from "../rich/GlassCard";
import { HIT_TARGET, SPACE, THEME } from "../../lib/theme/tokens";
import { RIPPLE_ALPHA } from "../../lib/theme/uiPrimitives";

/**
 * An accent text action (an alternative shape of a step, a details toggle).
 * Button's tertiary is muted, so an accent link composes the same pieces here:
 * Txt label, 44 pt floor, Android ripple, optional trailing chevron.
 */
export function TextLink({
  label,
  onPress,
  chevron,
  expanded,
  align = "center",
  style,
}: {
  label: string;
  onPress: () => void;
  chevron?: boolean;
  expanded?: boolean;
  align?: "center" | "start";
  style?: React.ComponentProps<typeof View>["style"];
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={expanded === undefined ? undefined : { expanded }}
      android_ripple={{ color: withAlpha(THEME.accent, RIPPLE_ALPHA), foreground: true }}
      className="active:opacity-80"
      style={[
        {
          minHeight: HIT_TARGET,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: align === "center" ? "center" : "flex-start",
          alignSelf: align === "center" ? "stretch" : "flex-start",
          gap: SPACE.xs,
        },
        style,
      ]}
    >
      <Txt kind="body" tone="accent" style={{ fontWeight: "500", flexShrink: 1 }}>
        {label}
      </Txt>
      {chevron ? (
        <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={14} color={THEME.accent} />
      ) : null}
    </Pressable>
  );
}
