import React from "react";
import { Pressable, Text } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { useApp } from "../lib/store/AppContext";
import { activeMealSlot, carbRatioForSlot } from "../lib/insulin";
import { calcFiguresAllowed } from "../lib/calcSetup";
import { ratioConfirmState, ratioSetupOpenOptions, ratioStateCardKind } from "../lib/ratioConfirmCard";
import { insulinModeOf, insulinModeShowsBolus } from "../lib/insulinMode";
import { calculatorHiddenForRegion } from "../lib/regionFlags";
import { isolateLtr, num } from "../lib/format";
import { THEME } from "../lib/theme/tokens";
import type { MealSlot } from "../lib/db/types";
import { DirIcon } from "./DirIcon";
import { RatioStateCard } from "./RatioStateCard";

/**
 * Reference to the active meal slot's own carb ratio, tappable through to
 * where it is set (Profile). Uses carbRatioForSlot - the SAME lookup
 * estimateInsulin runs - so this line can never show a different ratio than
 * the calculator's own arithmetic for the same slot.
 *
 * A ratio is shown only once the user confirmed their own (ratios_confirmed 1).
 * Until then no number from a stored value is quoted: "Enter your ratios" when
 * none are saved, "Confirm ratios" when the user's own values are saved but not
 * confirmed. On the calculator (variant "card") that is the large state card
 * (components/RatioStateCard.tsx); elsewhere it stays one compact line. Profiles
 * without mealtime insulin, and regions where the calculator is hidden, see
 * nothing.
 *
 * numberOfLines is 2, not 1: the line fits one row for every language this
 * app ships, but a longer translation (German routinely runs widest) wraps
 * instead of clipping rather than risk losing the slot name or the number.
 */
export function CarbRatioLine({
  slot,
  style,
  returnAfterConfirm,
  variant = "line",
  onOpenSetup,
}: {
  /** Defaults to the real-time active slot when the caller has none of its own. */
  slot?: MealSlot;
  style?: StyleProp<ViewStyle>;
  /** The line is on the calculator: once the ratios are confirmed in Profile and
   *  Targets, Profile goes back here, to the same open record. */
  returnAfterConfirm?: boolean;
  /** "card" (the calculator only): the large state card while no figure is
   *  allowed. "line" (default, the Food tab): one compact tappable line. */
  variant?: "line" | "card";
  /** Card variant: opens the ratios sheet on this screen; without it the card
   *  goes to Profile. */
  onOpenSetup?: (opts: { emphasizeConfirm: boolean }) => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { activeProfile } = useApp();

  if (!activeProfile) return null;
  if (!insulinModeShowsBolus(insulinModeOf(activeProfile))) return null;
  if (calculatorHiddenForRegion()) return null;

  const state = ratioConfirmState(activeProfile);
  const cardKind = ratioStateCardKind(state);
  const profileParams = (): { returnTo?: string; highlight?: string } => ({
    ...(returnAfterConfirm ? { returnTo: "calculator" } : {}),
    ...(state === "unconfirmed" ? { highlight: "confirm" } : {}),
  });
  if (cardKind && variant === "card") {
    return (
      <RatioStateCard
        kind={cardKind}
        onPress={() => {
          const opts = ratioSetupOpenOptions(state);
          if (onOpenSetup) {
            onOpenSetup(opts);
            return;
          }
          router.push({ pathname: "/settings/profile", params: profileParams() });
        }}
      />
    );
  }

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
    : state === "unconfirmed"
      ? t("ratioConfirm.confirmAction")
      : t("ratio.enter");

  return (
    <Pressable
      onPress={() => router.push({ pathname: "/settings/profile", params: profileParams() })}
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
