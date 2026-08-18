import React from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import { HIT_TARGET, THEME } from "../lib/theme/tokens";
import { DirIcon } from "./DirIcon";

/**
 * The mockup's sub-screen header: a leading icon-plate back action, then the
 * title LEFT-aligned right beside it (a single ~10px gap, no wide dead space),
 * and an optional trailing accessory (a date chip, etc.). E4a: the title reads
 * as a left-anchored nav title, not an optically-centred one, so the back plate
 * and title sit together the way every other pushed screen opens.
 *
 * The plate is icon-only, so it carries no text a screen reader could read. The
 * label is therefore DEFAULTED from the icon (close vs. back) instead of being
 * left to each caller: several screens passed nothing, and the only way out of
 * those screens was announced as an unlabelled button.
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
  const { t } = useTranslation();
  const backLabel =
    accessibilityLabel ??
    (backIcon === "close" ? t("common.close") : t("common.back"));
  return (
    <View className="flex-row items-center px-4 py-3">
      {onBack ? (
        <Pressable
          onPress={onBack}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={backLabel}
          // The plate itself is 30pt; the host guarantees the 44pt target.
          style={{
            marginRight: 3,
            marginLeft: -7,
            minWidth: HIT_TARGET,
            minHeight: HIT_TARGET,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {/* The plate is IconTile's look, reproduced by hand: IconTile only
              renders a plain Ionicons glyph, which never flips in RTL, and
              `backIcon` (chevron-back by default) is exactly the case DirIcon
              exists for. */}
          <View
            style={{
              width: 30,
              height: 30,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: THEME.border,
              backgroundColor: THEME.glass,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <DirIcon name={backIcon} size={14} color={THEME.muted} />
          </View>
        </Pressable>
      ) : null}
      <Text
        style={{ color: THEME.ink, fontSize: 17, fontWeight: "800", flex: 1, textAlign: "left" }}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        accessibilityRole="header"
      >
        {title}
      </Text>
      {right ? <View style={{ marginLeft: 10 }}>{right}</View> : null}
    </View>
  );
}
