import React from "react";
import { Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { THEME } from "../../lib/theme/tokens";
import { withAlpha } from "./GlassCard";

interface IconTileProps {
  /** Emoji / glyph string (illustrated food & settings rows). */
  emoji?: string;
  /** Ionicons name. Used on its own, or as the FALLBACK when `emoji` resolves
   *  to nothing - so a plate is never a blank box. */
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
 *
 * A caller may pass BOTH: the emoji is the illustration, the Ionicons name is
 * the guarantee. An unclassified row, a category the emoji map does not know,
 * or a stripped string used to render an empty plate; now it falls through to
 * the icon, which ships with the app as a font.
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
  const glyph = typeof emoji === "string" ? emoji.trim() : "";
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
          backgroundColor: hero ? withAlpha(THEME.accent, 0.13) : THEME.surface,
        },
        style,
      ]}
    >
      {glyph ? (
        // The plate is a fixed square, so its glyph must not grow with the OS
        // text size: a scaled emoji overflows the box it is meant to sit in.
        <Text allowFontScaling={false} style={{ fontSize: Math.round(size * 0.5) }}>
          {glyph}
        </Text>
      ) : icon ? (
        <Ionicons name={icon} size={Math.round(size * 0.48)} color={tint} />
      ) : null}
    </View>
  );
}
