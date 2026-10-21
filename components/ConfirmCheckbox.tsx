import React from "react";
import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { HIT_TARGET, SPACE, THEME } from "../lib/theme/tokens";
import { hapticSelect } from "../lib/haptics";
import { Txt } from "./ui";

/**
 * A plain labelled checkbox row; the label wraps instead of clipping. `hint`
 * is a line under the row that says what ticking does; it shows only while the
 * box is unticked, so the meaning of the tick is visible before it is used.
 */
export function ConfirmCheckbox({
  checked,
  onToggle,
  label,
  disabled,
  hint,
}: {
  checked: boolean;
  onToggle: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <View>
    <Pressable
      onPress={() => {
        if (disabled) return;
        hapticSelect();
        onToggle(!checked);
      }}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: !!disabled }}
      accessibilityLabel={label}
      hitSlop={6}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: SPACE.md,
        minHeight: HIT_TARGET,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Ionicons
        name={checked ? "checkbox" : "square-outline"}
        size={24}
        color={checked ? THEME.accent : THEME.textMuted}
      />
      <Txt style={{ flex: 1 }}>{label}</Txt>
    </Pressable>
    {hint && !checked ? (
      <Txt kind="caption" tone="muted" style={{ marginStart: 24 + SPACE.md, marginTop: 2 }}>
        {hint}
      </Txt>
    ) : null}
    </View>
  );
}
