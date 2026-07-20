import React from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import type { Food, Lang } from "../lib/db/types";
import { foodName } from "../lib/db/types";
import { num } from "../lib/format";

interface Props {
  food: Food;
  lang: Lang;
  favorite?: boolean;
  onPress?: (food: Food) => void;
  onToggleFavorite?: (food: Food) => void;
  onLongPress?: (food: Food) => void;
}

function giColor(gi: number): string {
  if (gi <= 55) return "#10b981";
  if (gi <= 69) return "#f59e0b";
  return "#f43f5e";
}

export function FoodRow({
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
      className="flex-row items-center rounded-2xl bg-glass border border-hair px-4 py-3 mb-2.5"
    >
      <View className="flex-1 pr-2">
        <View className="flex-row items-center">
          <Text className="text-zinc-100 font-semibold text-base" numberOfLines={1}>
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
        {food.brand_name ? (
          <Text className="text-zinc-500 text-xs">{food.brand_name}</Text>
        ) : null}
        <View className="flex-row items-center mt-1.5 gap-3">
          <Text className="text-zinc-400 text-xs">
            {num(food.carb_100g)} {t("common.grams")}/100g
          </Text>
          <View className="flex-row items-center">
            <View
              className="w-2 h-2 rounded-full mr-1"
              style={{ backgroundColor: giColor(food.glycemic_index) }}
            />
            <Text className="text-zinc-400 text-xs">
              {t("food.gi")} {food.glycemic_index}
            </Text>
          </View>
          <Text className="text-zinc-500 text-xs">
            {t("food.gl")} {food.glycemic_load}
          </Text>
        </View>
      </View>

      {onToggleFavorite ? (
        <Pressable
          hitSlop={10}
          onPress={() => onToggleFavorite(food)}
          className="p-1.5"
        >
          <Ionicons
            name={favorite ? "star" : "star-outline"}
            size={20}
            color={favorite ? "#f59e0b" : "#52525b"}
          />
        </Pressable>
      ) : null}
      <Ionicons name="chevron-forward" size={18} color="#52525b" />
    </Pressable>
  );
}
