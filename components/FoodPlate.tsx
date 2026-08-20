import React from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Device from "expo-device";

import { CATEGORY_ICON, categoryEmoji } from "../lib/db/categories";
import type { Food } from "../lib/db/types";
import { emojiFor } from "../lib/foodMeta";
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
 * The illustrated CATEGORY plate multi-item surfaces lead with (journal rows,
 * template item rows, recent-meal pills, the category grid). ONE place
 * decides what a shelf looks like, so two rows in the same category carry the
 * same picture, and the emoji always travels with an icon that is guaranteed
 * to render. A screen showing ONE already-picked food (the calculator's food
 * card, a meal response's summary) wants the dish-specific plate instead -
 * see FoodIconTile below, the same emojiFor source FoodRow's browse list uses.
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

interface FoodIconTileProps {
  /** The specific dish this tile illustrates - only `name_en` and `category`
   *  are read, so a catalogue row, a barcode result or the synthetic Food a
   *  screen builds for a template/typed-name entry all work unchanged. */
  food: Pick<Food, "name_en" | "category">;
  size?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * The plate for ONE specific, already-selected food - the catalogue's
 * per-dish icon (lib/foodMeta emojiFor) over the same categoryTileIcon
 * fallback FoodPlate uses, so a dish FoodRow already illustrates specifically
 * (the browse list) looks the same everywhere the user is shown that exact
 * food again (the calculator's food card, a meal response's summary), not
 * just its shelf's generic plate.
 */
export function FoodIconTile({ food, size = 40, radius = 14, style }: FoodIconTileProps) {
  return (
    <IconTile
      emoji={EMOJI_RENDERS ? emojiFor(food.name_en, food.category) : undefined}
      icon={categoryTileIcon(food.category)}
      hero
      size={size}
      radius={radius}
      style={style}
    />
  );
}
