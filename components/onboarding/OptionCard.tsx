import React from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { RADIUS, THEME, glow } from "../../lib/theme/tokens";
import { withAlpha } from "../rich/GlassCard";

type IconName = keyof typeof Ionicons.glyphMap;

/** Ink used on top of the accent fill (check marks) - the darkest tone of the
 *  Midnight wash, so a filled cyan disc never carries pure black. */
const ON_ACCENT = "#062126";
/** The unselected mark's ring. Lighter than THEME.border so an empty radio is
 *  visible as a control rather than reading as another card edge. */
const MARK_RING = "rgba(255,255,255,0.22)";

/**
 * A full-width quiz answer card. Three shapes, all driven by the props:
 *
 *   description + icon -> the tall "rich" card (unit choice): 84pt, a 44pt icon
 *                         plate, an 18pt label and a technical note under it.
 *   icon               -> the standard 64pt card with a 40pt plate.
 *   neither            -> the 60pt radio card (diabetes type), where an icon
 *                         would only add loaded imagery.
 *
 * The selected state is the same everywhere: a cyan tint, a 1.5pt accent edge
 * and a FILLED check disc (leading on the radio shape, trailing where an icon
 * plate already holds the leading slot).
 */
export function OptionCard({
  label,
  selected,
  onPress,
  icon,
  description,
  spacing = 12,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  icon?: IconName;
  /** Optional short technical note under the label (e.g. a unit example). */
  description?: string;
  /** Gap to the next card. The steps differ (the six-option diabetes list is
   *  tighter than the two-option unit list), so the caller owns it. */
  spacing?: number;
}) {
  const rich = !!icon && !!description;
  const plate = rich ? 44 : 40;
  const mark = 26;

  /** The trailing (or, with no icon, leading) selection mark. */
  const checkMark = (size: number) =>
    selected ? (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: RADIUS.full,
          backgroundColor: THEME.accent,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name="checkmark" size={Math.round(size * 0.58)} color={ON_ACCENT} />
      </View>
    ) : (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: RADIUS.full,
          borderWidth: 1.5,
          borderColor: MARK_RING,
        }}
      />
    );

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          gap: rich ? 16 : 14,
          minHeight: rich ? 84 : icon ? 64 : 60,
          paddingHorizontal: rich ? 20 : 18,
          paddingVertical: rich ? 18 : 16,
          borderRadius: rich ? RADIUS.xl : RADIUS.lg,
          marginBottom: spacing,
          // 1.5 both ways so selecting a card never shifts the row by half a
          // point (the accent edge is drawn over the hairline, not beside it).
          borderWidth: 1.5,
          borderColor: selected ? THEME.accent : THEME.border,
          backgroundColor: selected ? withAlpha(THEME.accent, 0.1) : THEME.glass,
        },
        selected ? glow(THEME.accent, 26, 0.35) : undefined,
      ]}
    >
      {icon ? (
        <View
          style={{
            width: plate,
            height: plate,
            borderRadius: rich ? 14 : RADIUS.md,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: selected
              ? withAlpha(THEME.accent, 0.14)
              : "rgba(255,255,255,0.06)",
          }}
        >
          <Ionicons name={icon} size={22} color={selected ? THEME.accent : THEME.muted} />
        </View>
      ) : (
        checkMark(24)
      )}

      <View style={{ flex: 1, gap: description ? 3 : 0 }}>
        <Text
          style={{
            color: THEME.ink,
            fontSize: rich ? 18 : 17,
            lineHeight: rich ? 24 : 23,
            fontWeight: selected || icon ? "600" : "500",
          }}
        >
          {label}
        </Text>
        {description ? (
          <Text style={{ color: THEME.muted, fontSize: 13, lineHeight: 18 }}>
            {description}
          </Text>
        ) : null}
      </View>

      {icon ? checkMark(mark) : null}
    </Pressable>
  );
}
