import React from "react";
import { Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { THEME } from "../../lib/theme/tokens";
import { withAlpha } from "./GlassCard";

interface IconTileProps {
  /** Emoji / glyph string (illustrated food & settings rows). */
  emoji?: string;
  /** Or an Ionicons name. */
  icon?: keyof typeof Ionicons.glyphMap;
  size?: number;
  radius?: number;
  /** Cyan-lit variant (a soft accent wash) - the mockup's `.hero-food`. */
  hero?: boolean;
  tint?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * A rounded "plate" holding an emoji or an icon: glass by default, or a
 * cyan-lit hero variant. The mockup's `.ico` / `.hero-food` - used on food
 * rows, settings rows, quiz options and empty states so icons stop floating
 * naked on the wash.
 */
export function IconTile({
  emoji,
  icon,
  size = 30,
  radius = 10,
  hero = false,
  tint = THEME.accent,
  style,
}: IconTileProps) {
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: radius,
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 1,
          borderColor: THEME.border,
          backgroundColor: hero ? withAlpha(THEME.accent, 0.13) : THEME.glass,
        },
        style,
      ]}
    >
      {emoji ? (
        <Text style={{ fontSize: size * 0.5 }}>{emoji}</Text>
      ) : icon ? (
        <Ionicons name={icon} size={size * 0.48} color={tint} />
      ) : null}
    </View>
  );
}
