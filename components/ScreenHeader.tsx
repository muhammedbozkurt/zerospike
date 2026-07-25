import React from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { THEME } from "../lib/theme/tokens";
import { IconTile } from "./rich/IconTile";

/**
 * The mockup's sub-screen header: a leading icon-plate back action, then the
 * title LEFT-aligned right beside it (a single ~10px gap, no wide dead space),
 * and an optional trailing accessory (a date chip, etc.). E4a: the title reads
 * as a left-anchored nav title, not an optically-centred one, so the back plate
 * and title sit together the way every other pushed screen opens.
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
    <View className="flex-row items-center px-4 py-3">
      {onBack ? (
        <Pressable
          onPress={onBack}
          hitSlop={10}
          accessibilityLabel={accessibilityLabel}
          style={{ marginRight: 10 }}
        >
          <IconTile icon={backIcon} size={30} radius={10} tint={THEME.muted} />
        </Pressable>
      ) : null}
      <Text
        style={{ color: THEME.ink, fontSize: 17, fontWeight: "800", flex: 1, textAlign: "left" }}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.85}
      >
        {title}
      </Text>
      {right ? <View style={{ marginLeft: 10 }}>{right}</View> : null}
    </View>
  );
}
