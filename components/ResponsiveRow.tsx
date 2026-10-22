import React from "react";
import { View } from "react-native";
import type { ViewProps } from "react-native";

import { STACK_AT_SCALE } from "../lib/layoutForFontScale";
import { useFontScale } from "../lib/useFontScale";

/**
 * A row that becomes a column at large text. Use it for a label + control (or
 * label + value) pair that is `flexDirection: "row"` at the default size: the
 * pair keeps the same row layout up to STACK_AT_SCALE, then each part gets the
 * full width. Pass the row's own style/className as usual; at large text only
 * the direction and alignment are overridden.
 */
export function ResponsiveRow({ style, children, ...rest }: ViewProps) {
  const stacked = useFontScale() > STACK_AT_SCALE;
  return (
    <View
      {...rest}
      style={[
        style,
        stacked ? { flexDirection: "column", alignItems: "stretch", justifyContent: "flex-start" } : null,
      ]}
    >
      {children}
    </View>
  );
}
