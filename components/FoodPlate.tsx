import React from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Device from "expo-device";

import { CATEGORY_ICON, categoryEmoji } from "../lib/db/categories";
import { IconTile } from "./rich/IconTile";

/* Current iOS simulator runtimes ship without a color emoji font (see
 * docs/build-prompt-r9.1-capture-ios.md), so every emoji draws as a "?" tofu
 * box there. Simulators are never customer devices; prefer the Ionicons plate
 * on them so dev/QA sees the intended per-category art. */
export const EMOJI_RENDERS = Device.isDevice;

/**
 * The Ionicons glyph that stands in for a category when its emoji cannot be
 * drawn: an unmapped/blank category value, or a device whose emoji font is
 * missing. Falls back twice - the map's own catch-all, then a plate - so this
 * never hands IconTile a name Ionicons would render as a "?" box.
 */
export function categoryTileIcon(
  category: string | null | undefined
): keyof typeof Ionicons.glyphMap {
  const name =
    (CATEGORY_ICON as Record<string, string | undefined>)[category ?? ""] ??
    (CATEGORY_ICON as Record<string, string | undefined>).other ??
    "restaurant-outline";
  return (
    name in Ionicons.glyphMap ? name : "restaurant-outline"
  ) as keyof typeof Ionicons.glyphMap;
}

interface FoodPlateProps {
  /** A `foods.category` value. Anything unrecognised gets the catch-all plate. */
  category: string | null | undefined;
  size?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * The illustrated plate every food surface leads with (rows, template items,
 * the category grid, a meal's response header). ONE place decides what a
 * category looks like, so the same food carries the same picture everywhere,
 * and the emoji always travels with an icon that is guaranteed to render.
 */
export function FoodPlate({ category, size = 40, radius = 14, style }: FoodPlateProps) {
  return (
    <IconTile
      emoji={EMOJI_RENDERS ? categoryEmoji(category ?? "") : undefined}
      icon={categoryTileIcon(category)}
      hero
      size={size}
      radius={radius}
      style={style}
    />
  );
}
