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
import type { Food } from "../../lib/db/types";
import { CATEGORIES, CATEGORY_ICON, Category } from "../../lib/db/categories";
import { FoodRow } from "../../components/FoodRow";
import { useFeedback } from "../../components/Feedback";

type Selection = Category | "favorites" | "custom";

export default function FoodScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { activeProfile, lang, dataVersion, bumpData } = useApp();
  const { confirm } = useFeedback();

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Selection | null>(null);
  const [all, setAll] = useState<Food[]>([]);
  const [favs, setFavs] = useState<Food[]>([]);
  const [searchResults, setSearchResults] = useState<Food[]>([]);
  const [favIds, setFavIds] = useState<Set<string>>(new Set());

  const loadAll = useCallback(async () => setAll(await listAllFoods()), []);
  const loadFavorites = useCallback(async () => {
    if (!activeProfile) return;
    const list = await listFavoriteFoods(activeProfile.id);
    setFavs(list);
    setFavIds(new Set(list.map((f) => f.id)));
  }, [activeProfile]);

  useEffect(() => {
    loadAll();
  }, [loadAll, dataVersion]);

  useFocusEffect(
    useCallback(() => {
      loadFavorites();
    }, [loadFavorites])
  );

  useEffect(() => {
    let active = true;
    (async () => {
      if (!query.trim()) return setSearchResults([]);
      const found = await searchFoods(query);
      if (active) setSearchResults(found);
    })();
    return () => {
      active = false;
    };
  }, [query, dataVersion]);

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

  function titleFor(sel: Selection): string {
    if (sel === "favorites") return t("food.favorites");
    if (sel === "custom") return t("food.custom");
    return t(`category.${sel}`);
  }
  function iconFor(sel: Selection): keyof typeof Ionicons.glyphMap {
    if (sel === "favorites") return "star";
    if (sel === "custom") return "create-outline";
    return CATEGORY_ICON[sel as Category] as keyof typeof Ionicons.glyphMap;
  }

  // Category grid tiles: Favorites, (Custom if any), then all categories.
  const tiles: { sel: Selection; count: number }[] = [
    { sel: "favorites", count: favs.length },
    ...(customFoods.length
      ? [{ sel: "custom" as Selection, count: customFoods.length }]
      : []),
    ...CATEGORIES.map((c) => ({ sel: c as Selection, count: byCat[c]?.length ?? 0 })),
  ];

  const SearchBar = (
    <View className="flex-row items-center rounded-2xl bg-zinc-900 border border-zinc-800 px-3.5 mb-3">
      <Ionicons name="search" size={18} color="#71717a" />
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder={t("food.searchPlaceholder")}
        placeholderTextColor="#52525b"
        className="flex-1 py-3 px-2.5 text-zinc-50 text-base"
      />
      {query ? (
        <Pressable hitSlop={10} onPress={() => setQuery("")}>
          <Ionicons name="close-circle" size={18} color="#52525b" />
        </Pressable>
      ) : null}
    </View>
  );

  const Actions = (
    <View className="flex-row gap-2.5 mb-3">
      <Pressable
        onPress={() => router.push("/scan")}
        className="flex-1 flex-row items-center justify-center rounded-2xl bg-brand active:bg-brandDark py-3"
      >
        <Ionicons name="barcode-outline" size={18} color="#000" />
        <Text className="text-black font-semibold ml-2">{t("food.scan")}</Text>
      </Pressable>
      <Pressable
        onPress={() => router.push("/add-food")}
        className="flex-1 flex-row items-center justify-center rounded-2xl bg-zinc-800 active:bg-zinc-700 py-3"
      >
        <Ionicons name="add-circle-outline" size={18} color="#e4e4e7" />
        <Text className="text-zinc-100 font-semibold ml-2">{t("food.addCustom")}</Text>
      </Pressable>
    </View>
  );

  const Header = (
    <View className="px-4 pt-2">
      <Text className="text-zinc-50 text-2xl font-bold mb-3">{t("food.title")}</Text>
      {SearchBar}
      {Actions}

      {mode === "grid" ? (
        <View className="flex-row flex-wrap justify-between mt-1">
          {tiles.map((tile) => (
            <Pressable
              key={tile.sel}
              onPress={() => setSelected(tile.sel)}
              className="w-[48%] rounded-2xl bg-zinc-900 border border-zinc-800 p-4 mb-3 active:bg-zinc-800"
            >
              <View className="w-10 h-10 rounded-full bg-brand/10 items-center justify-center mb-2.5">
                <Ionicons
                  name={iconFor(tile.sel)}
                  size={20}
                  color={tile.sel === "favorites" ? "#f59e0b" : "#22d3ee"}
                />
              </View>
              <Text className="text-zinc-100 font-semibold" numberOfLines={1}>
                {titleFor(tile.sel)}
              </Text>
              <Text className="text-zinc-500 text-xs mt-0.5">{tile.count}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {mode === "list" && selected ? (
        <Pressable
          onPress={() => setSelected(null)}
          className="flex-row items-center mb-3 mt-1"
        >
          <Ionicons name="chevron-back" size={20} color="#22d3ee" />
          <Ionicons name={iconFor(selected)} size={16} color="#22d3ee" style={{ marginLeft: 2 }} />
          <Text className="text-zinc-100 font-bold text-base ml-2">
            {titleFor(selected)}
          </Text>
          <Text className="text-zinc-600 text-xs ml-2">{listData.length}</Text>
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <View className="flex-1 bg-black" style={{ paddingTop: insets.top }}>
      <FlatList
        data={listData}
        keyExtractor={(f) => f.id}
        keyboardShouldPersistTaps="handled"
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
              onLongPress={onDeleteCustom}
            />
          </View>
        )}
        ListEmptyComponent={
          mode !== "grid" ? (
            <View className="items-center py-12">
              <Ionicons
                name={selected === "favorites" ? "star-outline" : "search-outline"}
                size={40}
                color="#3f3f46"
              />
              <Text className="text-zinc-600 text-center mt-3 px-8">
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
    </View>
  );
}
