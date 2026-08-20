import React from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import type { Food, Lang } from "../lib/db/types";
import { foodName } from "../lib/db/types";
import { num } from "../lib/format";
import { resolveFoodEmoji } from "../lib/foodMeta";
import { GLUCOSE_RICH, HIT_TARGET, TABULAR, THEME } from "../lib/theme/tokens";
import { categoryTileIcon, EMOJI_RENDERS } from "./FoodPlate";
import { IconTile } from "./rich";

interface Props {
  food: Food;
  lang: Lang;
  favorite?: boolean;
  onPress?: (food: Food) => void;
  onToggleFavorite?: (food: Food) => void;
  onLongPress?: (food: Food) => void;
}

/** GI band color, from the one glucose language (never the sole cue - the row
 *  always prints the GI number next to the dot). */
function giColor(gi: number): string {
  if (gi <= 55) return GLUCOSE_RICH.target;
  if (gi <= 69) return GLUCOSE_RICH.high;
  return GLUCOSE_RICH.wellAbove;
}

/**
 * A food row in the mockup's list composition: an illustrated plate on the
 * left, the name and its context in the middle, and the CARBOHYDRATE GRAMS as
 * the figure on the right. Carbs are what the user is here for, so carbs are
 * what the row leads with visually; GI/GL stay as secondary context.
 *
 * The context line WRAPS instead of clipping: at the 1.3 font-scale cap the
 * brand + GI + GL trio no longer fits one line on a narrow phone, and a row
 * that drops its GI is worse than a row that is one line taller.
 */
function FoodRowBase({
  food,
  lang,
  favorite,
  onPress,
  onToggleFavorite,
  onLongPress,
}: Props) {
  const { t } = useTranslation();
  const name = foodName(food, lang);

  return (
    <Pressable
      onPress={() => onPress?.(food)}
      onLongPress={() => onLongPress?.(food)}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${num(food.carb_100g)} ${t("common.grams")}`}
      className="flex-row items-center rounded-2xl bg-glass border border-hair px-3 py-2.5 mb-2 active:opacity-80"
      style={{ minHeight: HIT_TARGET + 12 }}
    >
      {/* The user's own emoji pick if there is one, else a specific
          illustration per dish (lib/foodMeta emojiFor) - not just the
          shelf's icon. See resolveFoodEmoji for the one place this priority
          is decided, shared with FoodIconTile below. */}
      <IconTile
        emoji={EMOJI_RENDERS ? resolveFoodEmoji(food) : undefined}
        icon={categoryTileIcon(food.category)}
        hero
        size={40}
        radius={14}
        style={{ marginRight: 12 }}
      />

      <View className="flex-1 pr-2">
        <View className="flex-row items-center">
          <Text
            style={{ color: THEME.ink, fontWeight: "700", fontSize: 14, flexShrink: 1 }}
            numberOfLines={1}
          >
            {name}
          </Text>
          {food.is_custom ? (
            <View className="ml-2 rounded-full bg-brand/15 px-2 py-0.5">
              <Text className="text-brand text-[10px] font-semibold">
                {t("food.custom")}
              </Text>
            </View>
          ) : null}
        </View>
        <View
          className="flex-row items-center flex-wrap"
          style={{ marginTop: 3, columnGap: 10, rowGap: 2 }}
        >
          {food.brand_name ? (
            <Text
              style={{ color: THEME.muted, fontSize: 11, maxWidth: 150 }}
              numberOfLines={1}
            >
              {food.brand_name}
            </Text>
          ) : null}
          {/* GI/GL only mean something once a real glycemic index is on file -
              zero is "not established", not "low" (see lib/db/seed.ts), so the
              block and its color dot stay off rather than print a false zero. */}
          {food.glycemic_index > 0 ? (
            <>
              <View className="flex-row items-center">
                <View
                  className="w-2 h-2 rounded-full mr-1.5"
                  style={{ backgroundColor: giColor(food.glycemic_index) }}
                />
                <Text style={[TABULAR, { color: THEME.muted, fontSize: 11 }]}>
                  {t("food.gi")} {food.glycemic_index}
                </Text>
              </View>
              <Text style={[TABULAR, { color: THEME.muted, fontSize: 11 }]}>
                {t("food.gl")} {food.glycemic_load}
              </Text>
            </>
          ) : null}
        </View>
      </View>

      {/* Carbohydrate grams, the row's headline figure */}
      <Text style={[TABULAR, { color: THEME.ink, fontWeight: "800", fontSize: 15 }]}>
        {num(food.carb_100g)}
        <Text style={{ color: THEME.muted, fontSize: 11, fontWeight: "600" }}>
          {t("common.grams")}
        </Text>
      </Text>

      {onToggleFavorite ? (
        <Pressable
          hitSlop={8}
          onPress={() => onToggleFavorite(food)}
          accessibilityRole="button"
          accessibilityState={{ selected: !!favorite }}
          accessibilityLabel={t("food.favorites")}
          style={{
            marginLeft: 4,
            minWidth: 36,
            minHeight: HIT_TARGET,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons
            name={favorite ? "star" : "star-outline"}
            size={19}
            color={favorite ? GLUCOSE_RICH.high : THEME.muted}
          />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

/**
 * Memoized like JournalItem: the catalogue list re-renders on search/filter
 * state that no single row cares about, and every visible row used to
 * re-render (and re-format) with it. Callback props must stay identity-stable
 * on the caller side (see app/(tabs)/food.tsx) or the shallow compare buys
 * nothing.
 */
export const FoodRow = React.memo(FoodRowBase);
