import React from "react";
import { Pressable, Text, View } from "react-native";

import { hapticSelect } from "../../lib/haptics";

export interface ChipOption<T extends string> {
  value: T;
  label: string;
}

/**
 * Single-choice chips for the feedback sheet: selected is the brand fill,
 * unselected the surface with a border, 44 pt tall, and a long label wraps to a
 * second line instead of being cut. Pressing the selected chip again clears it
 * when `clearable` is set (the survey's reason is optional).
 */
export function ChipGroup<T extends string>({
  options,
  value,
  onChange,
  clearable,
  disabled,
}: {
  options: readonly ChipOption<T>[];
  value: T | null;
  onChange: (value: T | null) => void;
  clearable?: boolean;
  disabled?: boolean;
}) {
  return (
    <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            disabled={disabled}
            onPress={() => {
              if (active && !clearable) return;
              hapticSelect();
              onChange(active ? null : opt.value);
            }}
            accessibilityRole="radio"
            accessibilityState={{ selected: active, disabled: !!disabled }}
            accessibilityLabel={opt.label}
            style={{ minHeight: 44, justifyContent: "center", maxWidth: "100%" }}
            className={`rounded-full px-4 py-2 border ${
              active ? "bg-brand border-brand" : "bg-glass border-hair"
            } ${disabled ? "opacity-50" : ""}`}
          >
            <Text
              className={`text-sm font-medium ${active ? "text-onAccent" : "text-ink"}`}
              style={{ flexShrink: 1 }}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
