import React from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import type { Food, Lang } from "../../lib/db/types";
import { foodName } from "../../lib/db/types";
import { HIT_TARGET, INPUT_TEXT, THEME } from "../../lib/theme/tokens";
import { upper } from "../../lib/upper";
import { FoodRow } from "../FoodRow";
import { searchBlockGroups } from "./mealCards";

const RESULTS_MAX = 30;

function FoodChip({ food, lang, onPress }: { food: Food; lang: Lang; onPress: () => void }) {
  const name = foodName(food, lang);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={name}
      style={{
        minHeight: HIT_TARGET,
        maxWidth: 220,
        justifyContent: "center",
        borderRadius: 999,
        paddingHorizontal: 14,
        borderWidth: 1,
        borderColor: THEME.border,
        backgroundColor: THEME.surface,
      }}
    >
      <Text numberOfLines={1} style={{ color: THEME.text, fontSize: 14, fontWeight: "500" }}>
        {name}
      </Text>
    </Pressable>
  );
}

function ChipGroup({
  title,
  foods,
  lang,
  onPick,
}: {
  title: string;
  foods: readonly Food[];
  lang: Lang;
  onPick: (food: Food) => void;
}) {
  if (foods.length === 0) return null;
  return (
    <View style={{ marginTop: 12 }}>
      <Text
        style={{
          color: THEME.textMuted,
          fontSize: 11,
          fontWeight: "700",
          letterSpacing: 0.6,
          marginBottom: 6,
        }}
      >
        {upper(title)}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: 8, paddingEnd: 4 }}
      >
        {foods.map((food) => (
          <FoodChip key={food.id} food={food} lang={lang} onPress={() => onPick(food)} />
        ))}
      </ScrollView>
    </View>
  );
}

/**
 * The "add a food" half of the meal sheet: a search field; with the field
 * empty, "Recently used" and "Favorites" chips (and, for a user with neither,
 * the three starter foods); with a query, the matching foods as FoodRow.
 * Presentational: the parent runs the (debounced) search and resolves the
 * starter names to catalogue foods.
 */
export function FoodSearchBlock({
  query,
  onQueryChange,
  results,
  recents,
  favorites,
  starters,
  lang,
  onPick,
  inMealIds,
  autoFocus,
}: {
  query: string;
  onQueryChange: (text: string) => void;
  results: readonly Food[];
  recents: readonly Food[];
  favorites: readonly Food[];
  starters: readonly Food[];
  lang: Lang;
  onPick: (food: Food) => void;
  /** Foods already in the meal read as added. */
  inMealIds?: ReadonlySet<string>;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  const searching = query.trim().length > 0;
  const groups = searchBlockGroups({ recents, favorites, starters });

  return (
    <View>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          minHeight: HIT_TARGET,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: THEME.border,
          backgroundColor: THEME.surface,
          paddingHorizontal: 12,
          columnGap: 8,
        }}
      >
        <Ionicons name="search" size={18} color={THEME.textMuted} />
        <TextInput
          value={query}
          onChangeText={onQueryChange}
          placeholder={t("food.searchPlaceholder")}
          placeholderTextColor={THEME.placeholder}
          autoFocus={autoFocus}
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel={t("food.searchPlaceholder")}
          style={[INPUT_TEXT, { flex: 1, color: THEME.text, minHeight: HIT_TARGET }]}
        />
        {searching ? (
          <Pressable
            onPress={() => onQueryChange("")}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t("common.close")}
          >
            <Ionicons name="close-circle" size={18} color={THEME.textMuted} />
          </Pressable>
        ) : null}
      </View>

      {searching ? (
        <View style={{ marginTop: 10 }}>
          {results.length === 0 ? (
            <Text style={{ color: THEME.textMuted, fontSize: 13, paddingVertical: 8 }}>
              {t("food.noResults")}
            </Text>
          ) : (
            results
              .slice(0, RESULTS_MAX)
              .map((food) => (
                <FoodRow
                  key={food.id}
                  food={food}
                  lang={lang}
                  onPress={onPick}
                  inMeal={inMealIds?.has(food.id)}
                />
              ))
          )}
        </View>
      ) : (
        <>
          <ChipGroup title={t("mealCompose.recents")} foods={groups.recents} lang={lang} onPick={onPick} />
          <ChipGroup title={t("food.favorites")} foods={groups.favorites} lang={lang} onPick={onPick} />
          <ChipGroup title={t("mealCompose.starters")} foods={groups.starters} lang={lang} onPick={onPick} />
        </>
      )}
    </View>
  );
}
