import React from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { THEME, glow } from "../../lib/theme/tokens";

type IconName = keyof typeof Ionicons.glyphMap;

/**
 * A full-width quiz answer card (statura option pattern). Deliberately large:
 * the compact Segmented control left the choice looking tiny on a phone screen.
 * Comfortably above the 44pt touch-target floor, with a clear selected state.
 *
 * `icon` is optional. Where an icon would carry meaning it is shown in a tile;
 * where it would only add loaded imagery (e.g. diabetes type) the card falls
 * back to a radio dot, which still reads as a single-select.
 */
export function OptionCard({
  label,
  selected,
  onPress,
  icon,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  icon?: IconName;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={[{ minHeight: 60 }, selected ? glow(THEME.accent, 22, 0.4) : undefined]}
      className={`flex-row items-center rounded-2xl border px-4 mb-3 ${
        selected
          ? "border-brand bg-brand/10"
          : "border-hair bg-glass active:opacity-80"
      }`}
    >
      {icon ? (
        <View
          className={`w-10 h-10 rounded-xl items-center justify-center mr-3.5 ${
            selected ? "bg-brand/20" : "bg-zinc-800"
          }`}
        >
          <Ionicons name={icon} size={20} color={selected ? "#2ee6ff" : "#a1a1aa"} />
        </View>
      ) : (
        <View
          className={`w-6 h-6 rounded-full border-2 items-center justify-center mr-3.5 ${
            selected ? "border-brand" : "border-zinc-600"
          }`}
        >
          {selected ? <View className="w-3 h-3 rounded-full bg-brand" /> : null}
        </View>
      )}

      <Text
        className={`flex-1 text-base ${
          selected ? "text-brand font-semibold" : "text-zinc-200"
        }`}
      >
        {label}
      </Text>

      {selected ? (
        <Ionicons name="checkmark-circle" size={20} color="#2ee6ff" />
      ) : null}
    </Pressable>
  );
}
