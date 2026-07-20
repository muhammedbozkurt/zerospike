import React from "react";
import { Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import type { GlucoseStatus } from "../../lib/glucose";
import { GLUCOSE_RICH, TABULAR, glow } from "../../lib/theme/tokens";
import { withAlpha } from "./GlassCard";

/** Map the app's GlucoseStatus onto the mockup's four-state rich palette. */
const STATUS_RICH: Record<GlucoseStatus, string> = {
  low: GLUCOSE_RICH.low,
  normal: GLUCOSE_RICH.target,
  elevated: GLUCOSE_RICH.high,
  high: GLUCOSE_RICH.veryHigh,
};

interface GlucoseChipProps {
  /** Reading value string (already unit-formatted), shown before the label. */
  value?: string;
  /** Status label text (e.g. "Hedefte"). Color is never the sole signal, so the
   *  chip always carries a value and/or this label. */
  label?: string;
  status: GlucoseStatus;
  /** Small dot before the content (default true). */
  dot?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * The glucose chip: a glowing tinted pill carrying a reading's value and label
 * in its status color. One chip language on every surface (journal, dashboard,
 * report). The mockup's `.gc` element.
 */
export function GlucoseChip({ value, label, status, dot = true, style }: GlucoseChipProps) {
  const color = STATUS_RICH[status];
  return (
    <View
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          alignSelf: "flex-start",
          gap: 4,
          borderRadius: 9,
          paddingHorizontal: 8,
          paddingVertical: 3,
          backgroundColor: withAlpha(color, 0.22),
        },
        glow(color, 12, 0.4),
        style,
      ]}
    >
      {dot ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} /> : null}
      {value ? <Text style={[TABULAR, { color, fontWeight: "800", fontSize: 11 }]}>{value}</Text> : null}
      {label ? <Text style={{ color, fontWeight: "800", fontSize: 11 }}>{label}</Text> : null}
    </View>
  );
}
