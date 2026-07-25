import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { RADIUS, THEME } from "../lib/theme/tokens";

/**
 * A small (i) info control. Tapping toggles a short balloon of explanatory text
 * so a form can move its long "why" sentences off the surface and stay one
 * screen tall. The balloon renders in normal flow (below the icon) rather than
 * as an absolute popover, so it can never be clipped by a card's overflow.
 *
 * Regulation text is moved here, not deleted - a disclaimer that must be shown
 * stays visible; only the explanatory prose collapses.
 */
export function Tooltip({
  text,
  size = 15,
  tint = THEME.muted,
  style,
}: {
  text: string;
  size?: number;
  tint?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={style}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={text}
      >
        <Ionicons name="information-circle-outline" size={size} color={tint} />
      </Pressable>
      {open ? (
        <View
          style={{
            marginTop: 6,
            maxWidth: 280,
            backgroundColor: THEME.bg.g2,
            borderColor: THEME.border,
            borderWidth: 1,
            borderRadius: RADIUS.md,
            paddingHorizontal: 10,
            paddingVertical: 8,
          }}
        >
          <Text style={{ color: THEME.ink, fontSize: 11, lineHeight: 16 }}>{text}</Text>
        </View>
      ) : null}
    </View>
  );
}
