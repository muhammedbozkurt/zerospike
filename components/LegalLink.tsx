import React from "react";
import { Pressable } from "react-native";

import { HIT_TARGET, SPACE, THEME } from "../lib/theme/tokens";
import { RIPPLE_ALPHA } from "../lib/theme/uiPrimitives";
import { withAlpha } from "./rich/GlassCard";
import { Txt } from "./ui";

interface LegalLinkProps {
  label: string;
  onPress: () => void;
}

/**
 * Privacy / terms link on the purchase screens. The text may wrap inside the
 * link (no line cap) so a long translation never overflows a narrow column; the underline and the link role tell it apart from the buttons next
 * to it, and the 44 pt floor keeps it tappable.
 */
export function LegalLink({ label, onPress }: LegalLinkProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={label}
      hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
      android_ripple={{ color: withAlpha(THEME.text, RIPPLE_ALPHA), foreground: true }}
      style={{
        minHeight: HIT_TARGET,
        justifyContent: "center",
        paddingHorizontal: SPACE.md,
        flexShrink: 1,
      }}
    >
      <Txt
        kind="caption"
        tone="muted"
        style={{ textAlign: "center", textDecorationLine: "underline" }}
      >
        {label}
      </Txt>
    </Pressable>
  );
}
