import React from "react";
import { I18nManager } from "react-native";
import type { StyleProp, TextStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";

/**
 * Names whose glyph is a fixed LTR arrow shape even though the NAME describes a
 * ROLE ("go back", "go forward"). Ionicons ships only that one drawing, so in
 * RTL the role point the wrong way unless mirrored here.
 */
const DIRECTIONAL_ICONS: ReadonlySet<string> = new Set([
  "chevron-back",
  "chevron-forward",
  "chevron-back-outline",
  "chevron-forward-outline",
  "arrow-back",
  "arrow-forward",
  "arrow-back-outline",
  "arrow-forward-outline",
]);

interface DirIconProps {
  name: keyof typeof Ionicons.glyphMap;
  size?: number;
  color?: string;
  style?: StyleProp<TextStyle>;
}

/**
 * Drop-in Ionicons wrapper: a directional glyph gets a horizontal flip
 * (scaleX: -1) when the layout direction is RTL, so the same icon asset draws
 * pointing the other way instead of shipping a second, mirrored asset. Every
 * other glyph (close, checkmark, ...) passes through untouched.
 */
export function DirIcon({ name, size, color, style }: DirIconProps) {
  const flip = I18nManager.isRTL && DIRECTIONAL_ICONS.has(name);
  return (
    <Ionicons
      name={name}
      size={size}
      color={color}
      style={flip ? [{ transform: [{ scaleX: -1 }] }, style] : style}
    />
  );
}
