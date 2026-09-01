import React from "react";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { RADIUS, THEME } from "../../lib/theme/tokens";
import { withAlpha } from "../rich/GlassCard";

/**
 * The step's anchor glyph: one rounded plate above the interaction block, so
 * every question in the quiz opens with the same visual beat instead of a wall
 * of cards. Steps whose own content already fills the frame (the six-option
 * diabetes list, the two range editors, the widget band) pass no glyph at all.
 *
 * `tone` is "accent" everywhere except the disclaimer, which is the one step
 * that is a notice rather than a question and carries the caution hue.
 */
export function StepGlyph({
  icon,
  tone = "accent",
  dense = false,
  spacing,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tone?: "accent" | "caution";
  /** Short screen: the plate gives up height with the rest of the rhythm. */
  dense?: boolean;
  /** Gap to the interaction block below. */
  spacing?: number;
}) {
  const size = dense ? 64 : 76;
  const hue = tone === "caution" ? THEME.caution : THEME.accent;
  return (
    <View style={{ alignItems: "center", marginBottom: spacing ?? (dense ? 12 : 18) }}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: RADIUS["2xl"],
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 1,
          borderColor: tone === "caution" ? withAlpha(hue, 0.35) : THEME.border,
          backgroundColor: tone === "caution" ? withAlpha(hue, 0.1) : THEME.glass,
        }}
      >
        <Ionicons name={icon} size={dense ? 28 : 34} color={hue} />
      </View>
    </View>
  );
}
