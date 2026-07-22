import React from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { THEME } from "../lib/theme/tokens";
import { IconTile } from "./rich/IconTile";

/**
 * The mockup's sub-screen header: a leading icon-plate action, a centred title,
 * and a balancing spacer (or a trailing action) so the title stays optically
 * centred. Used by every pushed/presented screen so they all open the same way.
 */
export function ScreenHeader({
  title,
  onBack,
  backIcon = "chevron-back",
  right,
  accessibilityLabel,
}: {
  title: string;
  onBack?: () => void;
  backIcon?: keyof typeof Ionicons.glyphMap;
  right?: React.ReactNode;
  accessibilityLabel?: string;
}) {
  return (
    <View className="flex-row items-center justify-between px-4 py-3">
      {onBack ? (
        <Pressable onPress={onBack} hitSlop={10} accessibilityLabel={accessibilityLabel}>
          <IconTile icon={backIcon} size={30} radius={10} tint={THEME.muted} />
        </Pressable>
      ) : (
        <View style={{ width: 30 }} />
      )}
      <Text
        style={{ color: THEME.ink, fontSize: 16, fontWeight: "800", flex: 1, textAlign: "center" }}
        numberOfLines={1}
      >
        {title}
      </Text>
      {right ?? <View style={{ width: 30 }} />}
    </View>
  );
}
