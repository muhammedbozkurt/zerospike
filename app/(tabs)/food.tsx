import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { useApp } from "../../lib/store/AppContext";
import { searchFoods, deleteFood, listAllFoods } from "../../lib/db/foods";
import {
  listFavoriteFoods,
  toggleFavorite as dbToggleFav,
} from "../../lib/db/favorites";
import { addMealLog, getRecentMeals, type RecentMeal } from "../../lib/db/logs";
import { getJournal, type MealEntry } from "../../lib/db/journal";
import type { Food } from "../../lib/db/types";
import { foodName } from "../../lib/db/types";
import { CATEGORIES, CATEGORY_EMOJI, Category } from "../../lib/db/categories";
import { FoodRow } from "../../components/FoodRow";
import { useFeedback } from "../../components/Feedback";
import { keyboardAwareScrollProps } from "../../lib/keyboard";
import {
  AppBackground,
  GlassCard,
  IconTile,
  NeonProgressBar,
} from "../../components/rich";
import { formatDateKey } from "../../lib/format";
import { hapticSuccess } from "../../lib/haptics";
import { TABULAR, THEME } from "../../lib/theme/tokens";
import { mealSlotForHour } from "../../lib/insulin";

type Selection = Category | "favorites" | "custom";

/** Illustrated plate per meal slot, for the day's journal rows. */
const SLOT_EMOJI = {
  breakfast: "🍳",
  lunch: "🥗",
  dinner: "🍲",
} as const;

export default function FoodScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { activeProfile, lang, dataVersion, bumpData } = useApp();
  const { confirm, actionSheet } = useFeedback();

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Selection | null>(null);
  const [all, setAll] = useState<Food[]>([]);
  const [favs, setFavs] = useState<Food[]>([]);
  const [searchResults, setSearchResults] = useState<Food[]>([]);
  const [favIds, setFavIds] = useState<Set<string>>(new Set());
  const [recent, setRecent] = useState<RecentMeal[]>([]);
  const [todayMeals, setTodayMeals] = useState<MealEntry[]>([]);

  const loadAll = useCallback(async () => setAll(await listAllFoods(lang)), [lang]);
  const loadFavorites = useCallback(async () => {
    if (!activeProfile) return;
    const list = await listFavoriteFoods(activeProfile.id);
    setFavs(list);
    setFavIds(new Set(list.map((f) => f.id)));
  }, [activeProfile]);
  const loadRecent = useCallback(async () => {
    if (!activeProfile) return;
    setRecent(await getRecentMeals(activeProfile.id, 8));
  }, [activeProfile]);

  // Today's meals drive the hero: this tab is a meal journal first and a food
  // catalogue second, which is the order the mockup puts them in.
  const loadToday = useCallback(async () => {
    if (!activeProfile) return;
    const feed = await getJournal(activeProfile.id, lang, 120);
    const todayKey = formatDateKey(new Date().toISOString());
    setTodayMeals(
      feed.filter(
        (e): e is MealEntry =>
          e.kind === "meal" && formatDateKey(e.logged_at) === todayKey
      )
    );
  }, [activeProfile, lang]);

  useEffect(() => {
    loadAll();
  }, [loadAll, dataVersion]);

  useEffect(() => {
    loadToday();
  }, [loadToday, dataVersion]);

  useFocusEffect(
    useCallback(() => {
      loadFavorites();
      loadRecent();
      loadToday();
    }, [loadFavorites, loadRecent, loadToday])
  );

  useEffect(() => {
    let active = true;
    (async () => {
      if (!query.trim()) return setSearchResults([]);
      const found = await searchFoods(query, lang);
      if (active) setSearchResults(found);
    })();
    return () => {
      active = false;
    };
  }, [query, dataVersion, lang]);

  const customFoods = useMemo(() => all.filter((f) => f.is_custom === 1), [all]);
  const byCat = useMemo(() => {
    const map: Record<string, Food[]> = {};
    for (const f of all) {
      if (f.is_custom === 1) continue;
      (map[f.category] ||= []).push(f);
    }
    return map;
  }, [all]);

  // What the list shows: search > drilled category > nothing (grid landing).
  const mode: "search" | "list" | "grid" = query.trim()
    ? "search"
    : selected
    ? "list"
    : "grid";

  const listData: Food[] = useMemo(() => {
    if (mode === "search") return searchResults;
    if (mode === "list") {
      if (selected === "favorites") return favs;
      if (selected === "custom") return customFoods;
      return byCat[selected as string] ?? [];
    }
    return [];
  }, [mode, searchResults, selected, favs, customFoods, byCat]);

  /**
   * One-tap re-log. A catalogue food reopens in the calculator (its portion is
   * adjustable there); a typed-name meal has no catalogue row to reopen, so it
   * is written straight back with the same name and carbs it had last time.
   */
  async function reLog(r: RecentMeal) {
    if (r.food) {
      router.push({
        pathname: "/calculator",
        params: { foodId: r.food.id, portion: String(r.portion_g) },
      });
      return;
    }
    if (!activeProfile) return;
    await addMealLog({
      profile_id: activeProfile.id,
      food_id: null,
      custom_food_name: r.name,
      portion_g: r.portion_g,
      calculated_carbs_g: r.carbs_g,
      insulin_dose_units: 0,
    });
    hapticSuccess();
    bumpData();
  }

  async function onToggleFav(food: Food) {
    if (!activeProfile) return;
    await dbToggleFav(activeProfile.id, food.id);
    await loadFavorites();
  }

  async function onDeleteCustom(food: Food) {
    if (!food.is_custom) return;
    const ok = await confirm({
      message: t("food.deleteFood"),
      confirmLabel: t("common.delete"),
      destructive: true,
    });
    if (!ok) return;
    await deleteFood(food.id);
    bumpData();
  }

  // Long press on a custom food = edit/delete menu; seeded catalog and cached
  // barcode rows are not the user's to edit, so they get no menu at all.
  function onCustomLongPress(food: Food) {
    if (!food.is_custom) return;
    actionSheet({
      title: foodName(food, lang),
      actions: [
        {
          label: t("common.edit"),
          icon: "create-outline",
          onPress: () =>
            router.push({ pathname: "/add-food", params: { foodId: food.id } }),
        },
        {
          label: t("common.delete"),
          icon: "trash-outline",
          destructive: true,
          onPress: () => {
            void onDeleteCustom(food);
          },
        },
      ],
    });
  }

  function titleFor(sel: Selection): string {
    if (sel === "favorites") return t("food.favorites");
    if (sel === "custom") return t("food.custom");
    return t(`category.${sel}`);
  }
  /** The illustrated plate the mockup puts on every food surface. */
  function emojiFor(sel: Selection): string {
    if (sel === "favorites") return "⭐";
    if (sel === "custom") return "✏️";
    return CATEGORY_EMOJI[sel as Category] ?? "🍽️";
  }

  // Category grid tiles: Favorites, (Custom if any), then all categories.
  const tiles: { sel: Selection; count: number }[] = [
    { sel: "favorites", count: favs.length },
    ...(customFoods.length
      ? [{ sel: "custom" as Selection, count: customFoods.length }]
      : []),
    ...CATEGORIES.map((c) => ({ sel: c as Selection, count: byCat[c]?.length ?? 0 })),
  ];

  // Search row with the scan action inline, as the mockup's B04 search bar.
  const SearchBar = (
    <View className="flex-row items-center rounded-2xl bg-glass border border-hair px-3 mb-3">
      <Ionicons name="search" size={17} color={THEME.muted} />
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder={t("food.searchPlaceholder")}
        placeholderTextColor="rgba(137,163,176,0.6)"
        className="flex-1 py-3 px-2.5"
        style={{ color: THEME.ink, fontSize: 14 }}
      />
      {query ? (
        <Pressable hitSlop={10} onPress={() => setQuery("")} className="mr-1">
          <Ionicons name="close-circle" size={18} color={THEME.muted} />
        </Pressable>
      ) : null}
      <Pressable
        onPress={() => router.push("/scan")}
        hitSlop={8}
        accessibilityLabel={t("food.scan")}
      >
        <View
          className="w-7 h-7 rounded-lg items-center justify-center"
          style={{ backgroundColor: THEME.accent }}
        >
          <Ionicons name="barcode-outline" size={15} color="#03181c" />
        </View>
      </Pressable>
    </View>
  );

  const carbMax = activeProfile?.daily_carb_target_g ?? 200;
  const carbMin = activeProfile?.daily_carb_target_min_g ?? Math.round(carbMax * 0.8);
  const todayCarbs = Math.round(
    todayMeals.reduce((sum, m) => sum + (m.calculated_carbs_g || 0), 0)
  );

  const Header = (
    <View className="px-4 pt-2">
      {/* Header (mockup B03: title left, one add action right) */}
      <View className="flex-row items-center justify-between mb-3">
        <Text style={{ color: THEME.ink, fontSize: 24, fontWeight: "800" }}>
          {t("food.title")}
        </Text>
        <Pressable
          onPress={() => router.push("/add-food")}
          hitSlop={8}
          accessibilityLabel={t("food.addCustom")}
        >
          <IconTile icon="add" size={32} radius={10} />
        </Pressable>
      </View>

      {/* Hero: today's carbohydrate total against the user's own range */}
      <GlassCard glow style={{ alignItems: "center", paddingVertical: 14, marginBottom: 12 }}>
        <Text
          style={{
            color: THEME.muted,
            fontSize: 9,
            letterSpacing: 1.3,
            textTransform: "uppercase",
            fontWeight: "800",
          }}
        >
          {t("dashboard.dailyCarbs")}
        </Text>
        <View className="flex-row items-baseline mt-1" style={{ gap: 4 }}>
          <Text
            style={[TABULAR, { color: THEME.accent, fontSize: 34, fontWeight: "800" }]}
          >
            {todayCarbs}
          </Text>
          <Text style={{ color: THEME.muted, fontSize: 13 }}>
            / {carbMin}-{carbMax} {t("common.grams")}
          </Text>
        </View>
        <NeonProgressBar
          value={todayCarbs}
          max={carbMax}
          style={{ alignSelf: "stretch", marginTop: 10 }}
        />
      </GlassCard>

      {/* Today's meals, as the mockup's illustrated rows */}
      {todayMeals.length > 0 ? (
        <View className="mb-4">
          <Text className="text-xs font-semibold uppercase tracking-wider text-mut mb-2">
            {t("common.today")}
          </Text>
          {todayMeals.map((meal) => (
            <Pressable
              key={meal.id}
              onPress={() =>
                router.push({ pathname: "/calculator", params: { mealLogId: meal.id } })
              }
              className="flex-row items-center rounded-xl bg-glass border border-hair px-3 py-2.5 mb-2 active:opacity-80"
            >
              <IconTile
                emoji={SLOT_EMOJI[mealSlotForHour(new Date(meal.logged_at).getHours())]}
                hero
                size={36}
                radius={12}
                style={{ marginRight: 10 }}
              />
              <View className="flex-1 pr-2">
                <Text
                  style={{ color: THEME.ink, fontSize: 13, fontWeight: "700" }}
                  numberOfLines={1}
                >
                  {t(`slot.${mealSlotForHour(new Date(meal.logged_at).getHours())}`)}
                </Text>
                <Text style={{ color: THEME.muted, fontSize: 11 }} numberOfLines={1}>
                  {meal.display_name}
                </Text>
              </View>
              <Text
                style={[TABULAR, { color: THEME.ink, fontSize: 14, fontWeight: "800" }]}
              >
                {Math.round(meal.calculated_carbs_g)}
                <Text style={{ color: THEME.muted, fontSize: 11, fontWeight: "600" }}>
                  {t("common.grams")}
                </Text>
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {SearchBar}

      {mode === "grid" && recent.length > 0 ? (
        <View className="mb-4">
          <Text className="text-xs font-semibold uppercase tracking-wider text-mut mb-2">
            {t("food.recent")}
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {recent.map((r, i) => (
              <Pressable
                key={r.food ? r.food.id : `custom-${i}-${r.name}`}
                onPress={() => reLog(r)}
                className="flex-row items-center rounded-full bg-glass border border-hair px-3 py-2 active:opacity-80"
              >
                <Text style={{ fontSize: 13 }}>
                  {r.food ? (CATEGORY_EMOJI[r.food.category as Category] ?? "🍽️") : "🍽️"}
                </Text>
                <Text
                  style={{ color: THEME.ink, fontSize: 13, marginLeft: 6 }}
                  numberOfLines={1}
                >
                  {r.food ? foodName(r.food, lang) : r.name}
                </Text>
                <Text style={{ color: THEME.muted, fontSize: 11, marginLeft: 6 }}>
                  {Math.round(r.carbs_g)}
                  {t("common.grams")}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {mode === "grid" ? (
        <View className="flex-row flex-wrap justify-between mt-1">
          {tiles.map((tile) => (
            <Pressable
              key={tile.sel}
              onPress={() => setSelected(tile.sel)}
              className="w-[48%] rounded-2xl bg-glass border border-hair p-4 mb-3 active:opacity-80"
            >
              <IconTile
                emoji={emojiFor(tile.sel)}
                hero
                size={40}
                radius={12}
                style={{ marginBottom: 10 }}
              />
              <Text className="text-ink font-semibold" numberOfLines={1}>
                {titleFor(tile.sel)}
              </Text>
              <Text className="text-mut text-xs mt-0.5">{tile.count}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {mode === "list" && selected ? (
        <Pressable
          onPress={() => setSelected(null)}
          className="flex-row items-center mb-3 mt-1"
        >
          <Ionicons name="chevron-back" size={20} color={THEME.accent} />
          <Text style={{ fontSize: 15, marginLeft: 2 }}>{emojiFor(selected)}</Text>
          <Text style={{ color: THEME.ink, fontWeight: "800", fontSize: 15, marginLeft: 8 }}>
            {titleFor(selected)}
          </Text>
          <Text style={{ color: THEME.muted, fontSize: 11, marginLeft: 8 }}>
            {listData.length}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <AppBackground style={{ paddingTop: insets.top }}>
      <FlatList
        {...keyboardAwareScrollProps}
        data={listData}
        keyExtractor={(f) => f.id}
        ListHeaderComponent={Header}
        renderItem={({ item }) => (
          <View className="px-4">
            <FoodRow
              food={item}
              lang={lang}
              favorite={favIds.has(item.id)}
              onPress={(f) =>
                router.push({ pathname: "/calculator", params: { foodId: f.id } })
              }
              onToggleFavorite={onToggleFav}
              onLongPress={onCustomLongPress}
            />
          </View>
        )}
        ListEmptyComponent={
          mode !== "grid" ? (
            <View className="items-center py-12">
              <Ionicons
                name={selected === "favorites" ? "star-outline" : "search-outline"}
                size={40}
                color={THEME.muted}
              />
              <Text style={{ color: THEME.muted, textAlign: "center", marginTop: 12, paddingHorizontal: 32 }}>
                {selected === "favorites"
                  ? t("food.noFavorites")
                  : t("food.noResults")}
              </Text>
            </View>
          ) : null
        }
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        showsVerticalScrollIndicator={false}
      />
    </AppBackground>
  );
}
