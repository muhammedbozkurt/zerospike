import React from "react";
import { Text, View } from "react-native";

import { THEME } from "../../lib/theme/tokens";
import { upper } from "../../lib/upper";

/** Small tracked caption above one mock section (Lock Screen / Live Activity /
 *  Home Screen / Mini Widgets). Fixed height, so the section stack below it is
 *  laid out on known offsets rather than on whatever the type happens to
 *  measure. upper() not toUpperCase(), so the Turkish "i" survives. */
export function SectionHeading({
  children,
  size,
  height,
}: {
  children: string;
  size: number;
  height: number;
}) {
  return (
    <View style={{ height, justifyContent: "flex-end" }}>
      <Text
        style={{
          fontSize: size,
          lineHeight: Math.round(size * 1.2),
          fontWeight: "700",
          letterSpacing: 1.2,
          color: THEME.accent,
          // "left" resolves as the logical "start" under RN's own forceRTL,
          // so this still reads on the right in Arabic - a conditional
          // isRTL ? "right" : "left" would fight that auto-mirroring rather
          // than follow it.
          textAlign: "left",
        }}
        numberOfLines={1}
      >
        {upper(children)}
      </Text>
    </View>
  );
}
