import React from "react";
import { Pressable, Text } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { useApp } from "../lib/store/AppContext";
import { activeMealSlot, carbRatioForSlot } from "../lib/insulin";
import { calcFiguresAllowed } from "../lib/calcSetup";
import { insulinModeOf, insulinModeShowsBolus } from "../lib/insulinMode";
import { isolateLtr, num } from "../lib/format";
import { THEME } from "../lib/theme/tokens";
import type { MealSlot } from "../lib/db/types";
import { DirIcon } from "./DirIcon";

/**
 * Reference to the active meal slot's own carb ratio, tappable through to
 * where it is set (Profile). Uses carbRatioForSlot - the SAME lookup
 * estimateInsulin runs - so this line can never show a different ratio than
 * the calculator's own arithmetic for the same slot.
 *
 * A ratio is shown only once the user confirmed their own (ratios_confirmed 1).
 * Until then this is the single "Enter your ratios" line, and no number from a
 * stored value is quoted. Profiles without mealtime insulin see nothing.
 *
 * numberOfLines is 2, not 1: the line fits one row for every language this
 * app ships, but a longer translation (German routinely runs widest) wraps
 * instead of clipping rather than risk losing the slot name or the number.
 */
export function CarbRatioLine({
  slot,
  style,
}: {
  /** Defaults to the real-time active slot when the caller has none of its own. */
  slot?: MealSlot;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { activeProfile } = useApp();

  if (!activeProfile) return null;
  if (!insulinModeShowsBolus(insulinModeOf(activeProfile))) return null;

  const activeSlot = slot ?? activeMealSlot();
  const ratio = carbRatioForSlot(activeProfile, activeSlot);
  const hasRatio = calcFiguresAllowed(activeProfile) && Number.isFinite(ratio) && ratio > 0;
  // "1 U = 12 g" is a purely-LTR run (digits + a Latin unit abbreviation);
  // composed here and isolated (lib/format's LRI/PDI wrap - same pattern as
  // paywall.tsx/winback.tsx) so it renders as one atomic block regardless of
  // the surrounding paragraph's direction, instead of reordering under RTL.
  const ratioFragment = isolateLtr(
    `1 ${t("common.unitsShort")} = ${num(ratio)} ${t("common.grams")}`
  );
  const label = hasRatio
    ? t("ratio.line", { slot: t(`slot.${activeSlot}`), ratio: ratioFragment })
    : t("ratio.enter");

  return (
    <Pressable
      onPress={() => router.push("/settings/profile")}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      className="flex-row items-center mb-3"
      style={[{ gap: 6 }, style]}
    >
      <Ionicons
        name="water-outline"
        size={13}
        color={hasRatio ? THEME.textMuted : THEME.accent}
      />
      <Text
        numberOfLines={2}
        style={{
          color: hasRatio ? THEME.textMuted : THEME.accent,
          fontSize: 12,
          flex: 1,
        }}
      >
        {label}
      </Text>
      <DirIcon name="chevron-forward-outline" size={13} color={THEME.textMuted} />
    </Pressable>
  );
}
