import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  BackHandler,
  Easing,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { useApp } from "../../lib/store/AppContext";
import { mealEditMode, mealEditRoute } from "../../lib/mealRoute";
import {
  searchFoods,
  deleteFood,
  countFoodsByCategory,
  getFood,
  listCustomFoods,
  listFoodsByCategory,
} from "../../lib/db/foods";
import { type DeletionSnapshot } from "../../lib/db/undo";
import { useUndoBatch } from "../../components/useUndoBatch";
import { DirIcon } from "../../components/DirIcon";
import {
  listFavoriteFoods,
  toggleFavorite as dbToggleFav,
} from "../../lib/db/favorites";
import {
  addMealLog,
  deleteMealRecord,
  getRecentMeals,
  type RecentMeal,
} from "../../lib/db/logs";
import { getJournal, type GlucoseEntry, type MealEntry } from "../../lib/db/journal";
import {
  createTemplate,
  deleteTemplate,
  listTemplatesWithItems,
  logTemplate,
  reorderTemplates,
  setTemplateUsage,
  type TemplateWithItems,
} from "../../lib/db/mealTemplates";
import { rankTemplates, templateNameTaken } from "../../lib/mealTemplates";
import {
  addComposeItem,
  addEstimateLines,
  composeCanSave,
  composeCanSaveTemplate,
  composeItemFromFood,
  composeMealInput,
  composeTemplateItems,
  composeTotals,
  removeComposeItem,
  type ComposeItem,
} from "../../lib/mealCompose";
import { MealComposeSheet } from "../../components/MealComposeSheet";
import { CarbEstimateSheet, type CarbEstimateSource } from "../../components/CarbEstimateSheet";
import { carbEstimateConfigured } from "../../lib/ai/carbEstimateClient";
import { sceneFoods, sceneStarters } from "../../lib/mealScene";
import { mealIdsWithResponse } from "../../lib/mealResponse";
import { insulinModeOf, insulinModeShowsBolus } from "../../lib/insulinMode";
import {
  schedulePostMealReminder,
  noteJournalActivity,
} from "../../lib/services/notifications";
import { applyAfterDelete } from "../../lib/afterDelete";
import { logCrash, logEvent } from "../../lib/analytics";
import { noteFirstLog } from "../../lib/services/firstLog";
import type { Food, Lang, MealSlot } from "../../lib/db/types";
import { foodName } from "../../lib/db/types";
import { getCatalogFoodByEnglishName } from "../../lib/db/foods";
import { isScreenshotMode } from "../../lib/screenshotMode";
import { CATEGORIES, Category } from "../../lib/db/categories";
import { FoodRow } from "../../components/FoodRow";
import { OffSearchResults } from "../../components/OffSearchResults";
import { CarbRatioLine } from "../../components/CarbRatioLine";
import { EMOJI_RENDERS, FoodPlate } from "../../components/FoodPlate";
import { EmptyState } from "../../components/EmptyState";
import { Skeleton } from "../../components/Skeleton";
import { useFeedback, type SheetAction } from "../../components/Feedback";
import { keyboardAwareScrollProps } from "../../lib/keyboard";
import {
  AppBackground,
  GlassCard,
  GradientCTA,
  IconTile,
  NeonProgressBar,
  withAlpha,
} from "../../components/rich";
import { InlineDateTimePicker } from "../../components/InlineDateTimePicker";
import { formatDateKey, formatTime, num, relativeDay } from "../../lib/format";
import { hapticSelect, hapticSuccess } from "../../lib/haptics";
import { HIT_TARGET, INPUT_TEXT, TABULAR, THEME } from "../../lib/theme/tokens";
import { mealSlotForHour } from "../../lib/insulin";
import { useLayout } from "../../lib/useLayout";
import { upper } from "../../lib/upper";

type Selection = Category | "favorites" | "custom";

/**
 * The languages the catalogue carries no name column for: lib/db/types foodName
 * shows them the English name, so a search typed in Italian, Portuguese, Arabic
 * or Japanese matches nothing the user did not add themselves. An empty result
 * in those four says WHY, instead of reading as an empty catalogue.
 */
const ENGLISH_SEARCH_LANGS: readonly Lang[] = ["it", "pt", "ar", "ja"];

/**
 * The landing grid is DATA, not a header. Every mode renders the same FlatList
 * with the same small ListHeaderComponent (title + hero + search field); only
 * the rows differ. Keeping one container type is what stops the search field
 * from being torn down and rebuilt on the first typed character - the whole
 * subtree used to be swapped between a ScrollView and a FlatList there, which
 * cost focus and the keyboard on every keystroke that changed the mode.
 *
 * Putting the bands in `data` also keeps the header small and near-fixed, so a
 * focus reload can no longer resize it under a live VirtualizedList (the
 * corrupted-scroll bug the ScrollView branch was meant to solve).
 */
type GridBand = "today" | "templates" | "recent" | "categories";
const GRID_BANDS: readonly GridBand[] = ["today", "templates", "recent", "categories"];
/** Two-column tablet: today and templates live in the right column, so the
 *  left list only carries the catalogue bands. */
const GRID_BANDS_LEFT: readonly GridBand[] = ["recent", "categories"];

/** Two columns only from this window width up; 600-700 stays one column. */
const TWO_COL_MIN_DP = 700;
/** Cap for each of the two columns (the columns carry their own 16 inset). */
const COL_MAX_WIDTH = 560;

type ListRow = GridBand | Food;

/** Keystroke quiet period before the catalog is searched. */
const SEARCH_DEBOUNCE_MS = 250;

/** Below this many local matches, a search offers the Open Food Facts
 *  button underneath its results (empty counts as "below" too). */
const OFF_SEARCH_MAX_RESULTS = 3;

/** Illustrated plate per meal slot, for the day's journal rows. */
const SLOT_EMOJI: Record<MealSlot, string> = {
  breakfast: "🍳",
  lunch: "🥗",
  dinner: "🍲",
};

/** The guaranteed glyph behind each slot plate (see components/FoodPlate). */
const SLOT_ICON: Record<MealSlot, keyof typeof Ionicons.glyphMap> = {
  breakfast: "sunny-outline",
  lunch: "partly-sunny-outline",
  dinner: "moon-outline",
};

/** How many journal rows / recipes a section shows before "show more". The tab
 *  is a landing screen, not a history: nothing here scrolls forever. */
const TODAY_PREVIEW = 4;
const TEMPLATE_PREVIEW = 4;

/** Half-gutter inside each category cell (cells carry their own padding, so the
 *  grid stays exact at any column count and the last row never spreads). */
const GRID_GUTTER = 5;

/** Content comparison (not object identity) for the small lists a focus reload
 *  re-fetches. Returning the previous array from a state setter is a documented
 *  React bail-out, so a focus that found nothing new never re-renders the grid
 *  header mid-scroll. Every list here is small (favorites/recent/today/templates),
 *  so JSON comparison is cheap. */
function sameList<T>(a: T[], b: T[]): boolean {
  return a.length === b.length && JSON.stringify(a) === JSON.stringify(b);
}

/** Stable across every render (module scope, no closed-over state), so the
 *  FlatList never sees a new keyExtractor identity - part of what FoodRow's
 *  React.memo needs to actually pay off. Band keys carry a prefix so they can
 *  never collide with a food id. */
function rowKeyExtractor(row: ListRow): string {
  return typeof row === "string" ? `band:${row}` : row.id;
}

/** Rows a long press may edit/delete: the user's own custom foods, and a
 *  barcode result cached from Open Food Facts (source "off"). The seeded
 *  catalog is neither, and stays read-only. */
function isEditableFood(food: Food): boolean {
  return food.is_custom === 1 || food.source === "off";
}

/** Section caption, one voice for every band on this screen. */
function SectionHeading({
  label,
  right,
}: {
  label: string;
  right?: React.ReactNode;
}) {
  return (
    <View className="flex-row items-center justify-between mb-2">
      <Text
        style={{
          color: THEME.textMuted,
          fontSize: 11,
          letterSpacing: 1.2,
          fontWeight: "800",
          flexShrink: 1,
          paddingRight: 8,
        }}
        numberOfLines={1}
      >
        {label}
      </Text>
      {right}
    </View>
  );
}

/** The "show more / show less" affordance a capped section ends with. */
function ShowMoreButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="items-center justify-center rounded-xl mb-2 active:opacity-80"
      style={{ minHeight: HIT_TARGET, borderWidth: 1, borderColor: THEME.border }}
    >
      <Text style={{ color: THEME.accent, fontSize: 13, fontWeight: "700" }}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Bulgu 3b: tapping a saved template opens THIS instead of writing the meal
 * outright - what it contains, its total, and when it happened (defaulting to
 * "now", the same convention every quick-add sheet uses), with one explicit
 * Save. food.tsx is a tab (root view controller), so a plain absolute overlay
 * presents cleanly here without the RN-Modal-over-modal problem the Feedback
 * host works around (see QuickAddSheet, which is the same situation).
 */
function TemplateConfirmSheet({
  entry,
  saving,
  onClose,
  onConfirm,
}: {
  entry: TemplateWithItems;
  saving: boolean;
  onClose: () => void;
  onConfirm: (when: Date) => void;
}) {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const anim = useRef(new Animated.Value(0)).current;
  // null = "now"; a Date is an explicit pick (same convention as the glucose
  // and medication quick-add sheets).
  const [at, setAt] = useState<Date | null>(null);
  const [timePickerOpen, setTimePickerOpen] = useState(false);

  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [anim]);

  // Android hardware back closes the sheet instead of popping the tab under it
  // (see QuickAddSheet for why this is needed on a plain absolute overlay).
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);

  const shown = at ?? new Date();

  return (
    <View
      style={[StyleSheet.absoluteFill, { zIndex: 200 }]}
      accessibilityViewIsModal
      importantForAccessibility="yes"
      onAccessibilityEscape={onClose}
    >
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: anim }]}>
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.7)" }]} // theme-ok
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t("common.cancel")}
        />
      </Animated.View>
      <View style={{ flex: 1, justifyContent: "flex-end" }} pointerEvents="box-none">
        <Animated.View
          style={{
            transform: [
              {
                translateY: anim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [40, 0],
                }),
              },
            ],
          }}
        >
          <Pressable
            className="rounded-t-3xl border-t border-x border-hair px-4 pt-3"
            style={{ backgroundColor: THEME.bg.g1, paddingBottom: insets.bottom + 20 }}
            onPress={(e) => e.stopPropagation()}
            accessible={false}
            focusable={false}
            importantForAccessibility="auto"
          >
            <View className="items-center mb-2">
              <View className="w-10 h-1 rounded-full bg-hair" />
            </View>

            <Text
              style={{ color: THEME.text, fontSize: 17, fontWeight: "800", marginBottom: 12 }}
              numberOfLines={2}
            >
              {entry.template.name}
            </Text>

            <Text className="text-xs font-semibold tracking-wider text-mut mb-2">
              {upper(t("templates.items"))}
            </Text>
            {entry.items.length === 0 ? (
              <View className="rounded-2xl bg-glass border border-hair px-3.5 py-3.5 mb-3">
                <Text style={{ color: THEME.textMuted, fontSize: 12, lineHeight: 17 }}>
                  {t("templates.emptyItemsLog")}
                </Text>
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 220 }} showsVerticalScrollIndicator={false}>
                {entry.items.map((item) => (
                  <View
                    key={item.id}
                    className="flex-row items-center rounded-2xl bg-glass border border-hair px-3 py-2.5 mb-2"
                  >
                    <FoodPlate
                      category={item.category}
                      size={32}
                      radius={12}
                      style={{ marginRight: 10 }}
                    />
                    <View className="flex-1 pr-2">
                      <Text
                        style={{ color: THEME.text, fontSize: 13, fontWeight: "700" }}
                        numberOfLines={1}
                      >
                        {item.name}
                      </Text>
                      {item.missingFood ? (
                        <Text
                          style={{ color: THEME.textMuted, fontSize: 10, marginTop: 1 }}
                          numberOfLines={1}
                        >
                          {t("templates.missingFood")}
                        </Text>
                      ) : null}
                    </View>
                    <Text style={[TABULAR, { color: THEME.text, fontSize: 13, fontWeight: "800" }]}>
                      {Math.round(item.carbs_g)}
                      <Text style={{ color: THEME.textMuted, fontSize: 10, fontWeight: "600" }}>
                        {t("common.grams")}
                      </Text>
                    </Text>
                  </View>
                ))}
              </ScrollView>
            )}

            <View className="flex-row items-center justify-between rounded-2xl bg-glass border border-hair px-3.5 py-3 mb-3 mt-1">
              <Text className="text-xs font-semibold tracking-wider text-mut">
                {upper(t("templates.total"))}
              </Text>
              <Text style={[TABULAR, { color: THEME.accent, fontSize: 20, fontWeight: "800" }]}>
                {Math.round(entry.carbs_g)}
                <Text style={{ color: THEME.textMuted, fontSize: 12, fontWeight: "600" }}>
                  {t("common.grams")}
                </Text>
              </Text>
            </View>

            <Pressable
              onPress={() => setTimePickerOpen((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel={t("calculator.loggedTime")}
              className="flex-row items-center rounded-2xl bg-glass border border-hair px-3.5 py-3 mb-3"
              style={{ minHeight: HIT_TARGET }}
            >
              <Ionicons name="time-outline" size={16} color={THEME.textMuted} />
              <Text style={{ color: THEME.text, marginLeft: 8, fontSize: 13 }}>
                {relativeDay(shown.toISOString(), {
                  today: t("common.today"),
                  yesterday: t("common.yesterday"),
                })}
                {" · "}
                {formatTime(shown.toISOString())}
              </Text>
            </Pressable>
            <InlineDateTimePicker
              visible={timePickerOpen}
              value={shown}
              max={new Date()}
              locale={i18n.language}
              onChange={setAt}
              onClose={() => setTimePickerOpen(false)}
            />

            <GradientCTA
              label={t("templates.logNow")}
              disabled={saving || entry.items.length === 0}
              onPress={() => onConfirm(shown)}
            />
          </Pressable>
        </Animated.View>
      </View>
    </View>
  );
}

export default function FoodScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { activeProfile, lang, dataVersion, bumpData, isProUser } = useApp();
  const { actionSheet, confirm, toast } = useFeedback();
  const deleteWithUndo = useUndoBatch(bumpData);
  // Tablets get more columns and a capped reading column; a phone render is
  // untouched (columnPad reduces to the plain inset below the wide threshold).
  const { isWide, width: winWidth, columnPad } = useLayout();
  const twoCol = isWide && winWidth >= TWO_COL_MIN_DP;
  // A half-width column is phone-sized, so the shelf grid keeps 3 across there.
  const gridColumns = isWide && !twoCol ? 4 : 3;
  const colPad = twoCol ? { paddingLeft: 16, paddingRight: 16 } : columnPad(16);

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Selection | null>(null);
  // The landing grid needs COUNTS, not rows; the drilled-in list needs one
  // category. The whole catalog (562 rows) used to be pulled into memory and
  // re-sorted in JS on mount and after every log write to answer both.
  const [catCounts, setCatCounts] = useState<Record<string, number>>({});
  const [customFoods, setCustomFoods] = useState<Food[]>([]);
  const [categoryFoods, setCategoryFoods] = useState<Food[]>([]);
  // The drilled-in list arrives from SQL now, and the search waits out a debounce
  // before it runs, so the "no results" state has to wait for a real answer
  // instead of claiming it for the gap in between.
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [searchPending, setSearchPending] = useState(false);
  const [favs, setFavs] = useState<Food[]>([]);
  const [searchResults, setSearchResults] = useState<Food[]>([]);
  const [favIds, setFavIds] = useState<Set<string>>(new Set());
  const [recent, setRecent] = useState<RecentMeal[]>([]);
  // Stored order (sort_order), which is what "move up" writes. Display order is a
  // separate, clock-dependent question - see rankedTemplates below.
  const [templates, setTemplates] = useState<TemplateWithItems[]>([]);
  const [todayMeals, setTodayMeals] = useState<MealEntry[]>([]);
  const [feedReadings, setFeedReadings] = useState<GlucoseEntry[]>([]);
  const [showAllToday, setShowAllToday] = useState(false);
  const [showAllTemplates, setShowAllTemplates] = useState(false);
  // "Never fetched yet" vs. "fetched and genuinely empty" - the same distinction
  // categoryLoading/searchPending already make for the drilled list/search. Set
  // once on the first successful load and never cleared again, so a background
  // refresh (focus, dataVersion bump) can't flash the empty-state placeholder
  // back over rows that are simply being replaced with an identical-looking list.
  const [todayLoaded, setTodayLoaded] = useState(false);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  const [recentLoaded, setRecentLoaded] = useState(false);

  // Every loader below sets its "loaded" flag in a `finally`. A rejected read
  // (locked or half-migrated DB) used to leave the flag false forever, so the
  // section stayed in its skeleton with no message and no way out; it now falls
  // back to the ordinary empty state and the failure is reported once.
  const loadCatalogSummary = useCallback(async () => {
    try {
      const [counts, customs] = await Promise.all([
        countFoodsByCategory(),
        listCustomFoods(lang),
      ]);
      setCatCounts(counts);
      setCustomFoods(customs);
    } catch (err) {
      logCrash(err, { screen: "food", load: "catalog" });
    }
  }, [lang]);

  const loadFavorites = useCallback(async () => {
    if (!activeProfile) return;
    try {
      const list = await listFavoriteFoods(activeProfile.id);
      setFavs((prev) => (sameList(prev, list) ? prev : list));
      setFavIds((prev) => {
        const ids = new Set(list.map((f) => f.id));
        if (prev.size === ids.size && [...ids].every((id) => prev.has(id))) return prev;
        return ids;
      });
    } catch (err) {
      logCrash(err, { screen: "food", load: "favorites" });
    }
  }, [activeProfile]);
  const loadRecent = useCallback(async () => {
    if (!activeProfile) return;
    try {
      const list = await getRecentMeals(activeProfile.id, 8);
      setRecent((prev) => (sameList(prev, list) ? prev : list));
    } catch (err) {
      logCrash(err, { screen: "food", load: "recent" });
    } finally {
      setRecentLoaded(true);
    }
  }, [activeProfile]);
  const loadTemplates = useCallback(async () => {
    if (!activeProfile) return;
    try {
      const list = await listTemplatesWithItems(activeProfile.id, lang);
      setTemplates((prev) => (sameList(prev, list) ? prev : list));
    } catch (err) {
      logCrash(err, { screen: "food", load: "templates" });
    } finally {
      setTemplatesLoaded(true);
    }
  }, [activeProfile, lang]);

  // Today's meals drive the hero: this tab is a meal journal first and a food
  // catalogue second, which is the order the mockup puts them in.
  const loadToday = useCallback(async () => {
    if (!activeProfile) return;
    try {
      const feed = await getJournal(activeProfile.id, lang, 120);
      const todayKey = formatDateKey(new Date().toISOString());
      const meals = feed.filter(
        (e): e is MealEntry =>
          e.kind === "meal" && formatDateKey(e.logged_at) === todayKey
      );
      const readings = feed.filter((e): e is GlucoseEntry => e.kind === "glucose");
      setTodayMeals((prev) => (sameList(prev, meals) ? prev : meals));
      setFeedReadings((prev) => (sameList(prev, readings) ? prev : readings));
    } catch (err) {
      logCrash(err, { screen: "food", load: "today" });
    } finally {
      setTodayLoaded(true);
    }
  }, [activeProfile, lang]);

  // Today's meals with a computable response (lib/mealResponse.ts) get a small
  // additive chevron on their row, opening the response instead of the edit flow.
  // One pass (see lib/mealResponse.ts): the full builder used to re-filter and
  // re-parse every reading once per meal.
  const mealResponseIds = useMemo(() => {
    if (!activeProfile) return new Set<string>();
    return mealIdsWithResponse(todayMeals, feedReadings);
  }, [todayMeals, feedReadings, activeProfile]);

  useEffect(() => {
    loadCatalogSummary();
  }, [loadCatalogSummary, dataVersion]);

  useEffect(() => {
    loadToday();
  }, [loadToday, dataVersion]);

  // Logging a template moves its use counters, which moves it in the list, so the
  // section follows every write and not only a focus change.
  useEffect(() => {
    loadTemplates();
  }, [loadTemplates, dataVersion]);

  useFocusEffect(
    useCallback(() => {
      loadFavorites();
      loadRecent();
      loadToday();
      loadTemplates();
    }, [loadFavorites, loadRecent, loadToday, loadTemplates])
  );

  // Search is DEBOUNCED: it used to fire a query on every keystroke, so typing
  // "makarna" ran seven FTS searches and threw six of them away (each one
  // re-ranking a 200-row candidate pool in JS).
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setSearchResults([]);
      setSearchPending(false);
      return;
    }
    let active = true;
    setSearchPending(true);
    const handle = setTimeout(() => {
      void (async () => {
        try {
          const found = await searchFoods(trimmed, lang);
          if (active) setSearchResults(found);
        } catch (err) {
          logCrash(err, { screen: "food", load: "search" });
          if (active) setSearchResults([]);
        } finally {
          // In `finally`, so a failed query lands on the "no results" state
          // instead of leaving the pending line up for good.
          if (active) setSearchPending(false);
        }
      })();
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [query, dataVersion, lang]);

  // What the list shows: search > drilled category > nothing (grid landing).
  const mode: "search" | "list" | "grid" = query.trim()
    ? "search"
    : selected
    ? "list"
    : "grid";

  // Only the drilled-in category is fetched, and only while it is open.
  const drilledCategory =
    mode === "list" && selected !== "favorites" && selected !== "custom"
      ? selected
      : null;
  useEffect(() => {
    if (!drilledCategory) {
      setCategoryFoods([]);
      setCategoryLoading(false);
      return;
    }
    let active = true;
    setCategoryLoading(true);
    void (async () => {
      try {
        const rows = await listFoodsByCategory(drilledCategory, lang);
        if (active) setCategoryFoods(rows);
      } catch (err) {
        logCrash(err, { screen: "food", load: "category" });
        if (active) setCategoryFoods([]);
      } finally {
        if (active) setCategoryLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [drilledCategory, lang, dataVersion]);

  const listData: Food[] = useMemo(() => {
    if (mode === "search") return searchResults;
    if (mode === "list") {
      if (selected === "favorites") return favs;
      if (selected === "custom") return customFoods;
      return categoryFoods;
    }
    return [];
  }, [mode, searchResults, selected, favs, customFoods, categoryFoods]);

  // The local catalog's FTS only knows what the app ships or the user has
  // typed before; a search that comes up short (or empty) is exactly where
  // the one-tap Open Food Facts lookup belongs, under the local results.
  const showOffSearch =
    mode === "search" && !searchPending && listData.length < OFF_SEARCH_MAX_RESULTS;

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
    const meal = await addMealLog({
      profile_id: activeProfile.id,
      food_id: null,
      custom_food_name: r.name,
      portion_g: r.portion_g,
      calculated_carbs_g: r.carbs_g,
      insulin_dose_units: 0,
    });
    // Same side effects as every other one-tap meal write (template relog,
    // calculator save): the post-meal reminder and the journal-activity signal
    // used to fire for every path except this one.
    logEvent("log_added", { kind: "meal" });
    void noteFirstLog("meal");
    hapticSuccess();
    await schedulePostMealReminder();
    void noteJournalActivity();
    bumpData();
    // One tap wrote a real journal entry with no confirmation and no way back; it
    // now carries the same undo as every other write (the calculator's save toast).
    toast(t("calculator.savedRecord"), "success", {
      label: t("common.undo"),
      onPress: () => {
        void (async () => {
          await deleteMealRecord(meal.id);
          // The countdown this very save armed (schedulePostMealReminder
          // above) has to go with the record: the same shared post-delete
          // cleanup every other delete path runs (lib/afterDelete.ts).
          await applyAfterDelete([
            {
              id: meal.id,
              profileId: meal.profile_id,
              loggedAtMs: new Date(meal.logged_at).getTime(),
              templateId: meal.meal_template_id,
            },
          ]);
          bumpData();
          toast(t("calculator.undone"), "info");
        })();
      },
    });
  }

  // Display order: the current slot first, then the slotless ones, then the rest -
  // clock and the user's own arrangement only (rankTemplates). Re-derived whenever
  // the list is reloaded, which every focus and every write does.
  const rankedTemplates = useMemo(() => {
    const byId = new Map(templates.map((entry) => [entry.template.id, entry]));
    return rankTemplates(templates.map((entry) => entry.template))
      .map((template) => byId.get(template.id))
      .filter((entry): entry is TemplateWithItems => entry != null);
  }, [templates]);

  const showsDose = insulinModeShowsBolus(insulinModeOf(activeProfile));

  // A tap on a saved template no longer logs it outright (Bulgu 3b): it opens
  // this confirm sheet instead, so a stray tap on the list can no longer write
  // a meal with nobody having looked at what it contains or when it happened.
  const [confirmEntry, setConfirmEntry] = useState<TemplateWithItems | null>(null);
  const [confirmSaving, setConfirmSaving] = useState(false);

  function openTemplate(templateId: string, mode?: "log" | "rename") {
    router.push({
      pathname: "/meal-template",
      params: mode ? { templateId, mode } : { templateId },
    });
  }

  /**
   * ONE TAP (through the confirm sheet) = one meal row, and NO insulin. This
   * never writes an injection: an invisible bolus would keep active-insulin
   * tracking wrong for hours, walk straight past the checkDose plausibility
   * gate, and amount to an applied dose the user never approved. The dose
   * route is the separate calculator action.
   *
   * The carbs are read live at this moment (logTemplate → resolveItemCarbs), so a
   * corrected food value reaches the row instead of a frozen copy.
   */
  async function confirmLogTemplate(entry: TemplateWithItems, when: Date) {
    // The sheet's own Save button is disabled while confirmSaving, so this is
    // a second guard against a double-fire rather than the only one.
    if (!activeProfile || confirmSaving) return;
    setConfirmSaving(true);
    try {
      const { id, name, use_count: priorUse, last_used_at: priorAt } = entry.template;
      const meal = await logTemplate(activeProfile.id, id, {
        insulin_dose_units: 0,
        logged_at: when.toISOString(),
      });
      logEvent("log_added", { kind: "meal" });
      void noteFirstLog("meal");
      hapticSuccess();
      // `when` carries the sheet's own time pick straight through: a running
      // timer is left untouched and a backdated pick does not start a fresh one
      // (see decidePostMealAutoStart, lib/postMealTimer.ts).
      await schedulePostMealReminder(when);
      void noteJournalActivity();
      bumpData();
      setConfirmEntry(null);
      toast(t("templates.logged", { name }), "success", {
        label: t("common.undo"),
        onPress: () => {
          void (async () => {
            // The counters are restored rather than decremented: touchTemplate only
            // moves last_used_at forward, so nothing can undo it by calling it again.
            await deleteMealRecord(meal.id);
            // Same for the countdown this save armed: it goes with the record
            // (lib/afterDelete.ts, shared by every delete path).
            await applyAfterDelete(
              [
                {
                  id: meal.id,
                  profileId: meal.profile_id,
                  loggedAtMs: new Date(meal.logged_at).getTime(),
                  templateId: meal.meal_template_id,
                },
              ],
              // The counters are put back verbatim just below; correcting them
              // here as well would be a write with no surviving effect.
              { settleTemplates: false }
            );
            await setTemplateUsage(id, priorUse, priorAt);
            bumpData();
            toast(t("calculator.undone"), "info");
          })();
        },
      });
    } finally {
      setConfirmSaving(false);
    }
  }

  async function moveTemplate(index: number, delta: number) {
    if (!activeProfile) return;
    const order = templates.map((entry) => entry.template.id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    await reorderTemplates(activeProfile.id, order);
    await loadTemplates();
  }

  // Deleting a recipe is a configuration loss, not a record: there is nothing to
  // reconstruct from a toast, so it asks first. The message says out loud that the
  // meals already logged from it stay in the journal.
  async function confirmDeleteTemplate(entry: TemplateWithItems) {
    const ok = await confirm({
      title: entry.template.name,
      message: t("templates.deleteConfirm"),
      confirmLabel: t("common.delete"),
      destructive: true,
    });
    if (!ok) return;
    await deleteTemplate(entry.template.id);
    await loadTemplates();
    bumpData();
    toast(t("templates.deleted"), "info");
  }

  function onTemplateLongPress(entry: TemplateWithItems) {
    const id = entry.template.id;
    const index = templates.findIndex((other) => other.template.id === id);
    const actions: SheetAction[] = [
      {
        label: t("templates.adjustAndLog"),
        icon: "options-outline",
        onPress: () => openTemplate(id, "log"),
      },
      {
        label: t("common.edit"),
        icon: "create-outline",
        onPress: () => openTemplate(id),
      },
    ];
    if (index > 0) {
      actions.push({
        label: t("templates.moveUp"),
        icon: "arrow-up-outline",
        onPress: () => {
          void moveTemplate(index, -1);
        },
      });
    }
    if (index >= 0 && index < templates.length - 1) {
      actions.push({
        label: t("templates.moveDown"),
        icon: "arrow-down-outline",
        onPress: () => {
          void moveTemplate(index, 1);
        },
      });
    }
    actions.push({
      label: t("common.delete"),
      icon: "trash-outline",
      destructive: true,
      onPress: () => {
        void confirmDeleteTemplate(entry);
      },
    });
    actionSheet({ title: entry.template.name, actions });
  }

  /** Long press on a logged meal: turn that day's whole slot into a template. */
  function onTodayMealLongPress(meal: MealEntry) {
    if (mealEditMode(meal) === "carbOnly") return;
    actionSheet({
      title: meal.display_name,
      actions: [
        {
          label: t("templates.fromMeal"),
          icon: "bookmark-outline",
          onPress: () =>
            router.push({
              pathname: "/meal-template",
              params: {
                fromDay: formatDateKey(meal.logged_at),
                fromSlot: mealSlotForHour(new Date(meal.logged_at).getHours()),
              },
            }),
        },
      ],
    });
  }

  // Stable identity (useCallback): passed straight through to FoodRow's
  // memoized onToggleFavorite prop, which only pays off if this reference does
  // not change on every unrelated re-render (search typing, focus reloads).
  const onToggleFav = useCallback(
    async (food: Food) => {
      if (!activeProfile) return;
      await dbToggleFav(activeProfile.id, food.id);
      await loadFavorites();
    },
    [activeProfile, loadFavorites]
  );

  // Delete immediately + accumulating 6-second undo (shared useUndoBatch). The
  // row is re-read first (not trusted from list state) so undo re-inserts it
  // verbatim; lib/db/undo's captureFoodDeletion only ever snapshotted
  // is_custom=1 rows, which would silently restore nothing for a barcode
  // result (source "off"), so the snapshot is built here instead.
  async function onDeleteCustom(food: Food) {
    if (!isEditableFood(food)) return;
    const fresh = (await getFood(food.id)) ?? food;
    const snap: DeletionSnapshot = {
      foods: [fresh as unknown as Record<string, string | number | null>],
    };
    await deleteWithUndo(snap, () => deleteFood(food.id));
  }

  // Long press on a custom food or a cached barcode result (source "off") =
  // edit/delete menu; the seeded catalog stays read-only and gets no menu.
  function onCustomLongPress(food: Food) {
    if (!isEditableFood(food)) return;
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

  // Row actions behind a ref (same technique as the dashboard's journal list):
  // onCustomLongPress closes over onDeleteCustom, which closes over
  // useUndoBatch's return value - a new function identity every render. The ref
  // absorbs that churn so the wrapper handed to FoodRow's renderItem below keeps
  // ONE identity, which is what its React.memo needs to actually skip re-renders.
  const onCustomLongPressRef = useRef(onCustomLongPress);
  onCustomLongPressRef.current = onCustomLongPress;
  const onFoodLongPress = useCallback(
    (food: Food) => onCustomLongPressRef.current(food),
    []
  );

  const onFoodPress = useCallback(
    (food: Food) => router.push({ pathname: "/calculator", params: { foodId: food.id } }),
    [router]
  );

  // Multi-select path (an extra route; a row tap still opens the calculator).
  const [composeItems, setComposeItems] = useState<ComposeItem[]>([]);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeSaving, setComposeSaving] = useState(false);
  const composeKeys = useMemo(
    () => new Set(composeItems.map((item) => item.key)),
    [composeItems]
  );
  const composeTotal = useMemo(() => composeTotals(composeItems), [composeItems]);

  const onAddToMeal = useCallback(
    (food: Food) => {
      hapticSelect();
      setComposeItems((prev) =>
        prev.some((item) => item.key === food.id)
          ? removeComposeItem(prev, food.id)
          : addComposeItem(prev, composeItemFromFood(food, foodName(food, lang)))
      );
    },
    [lang]
  );

  function closeCompose() {
    setComposeOpen(false);
  }

  // An empty list keeps the sheet open: foods are added inside it now.
  function onComposeChange(next: ComposeItem[]) {
    setComposeItems(next);
  }

  async function saveCompose() {
    if (!activeProfile || composeSaving || !composeCanSave(composeItems)) return;
    setComposeSaving(true);
    try {
      const input = composeMealInput(composeItems);
      const meal = await addMealLog({
        profile_id: activeProfile.id,
        food_id: null,
        custom_food_name: input.custom_food_name,
        portion_g: input.portion_g,
        calculated_carbs_g: input.calculated_carbs_g,
        insulin_dose_units: 0,
      });
      logEvent("log_added", { kind: "meal" });
      void noteFirstLog("meal");
      hapticSuccess();
      await schedulePostMealReminder();
      void noteJournalActivity();
      setComposeItems([]);
      setComposeOpen(false);
      bumpData();
      toast(t("calculator.savedRecord"), "success", {
        label: t("common.undo"),
        onPress: () => {
          void (async () => {
            await deleteMealRecord(meal.id);
            await applyAfterDelete([
              {
                id: meal.id,
                profileId: meal.profile_id,
                loggedAtMs: new Date(meal.logged_at).getTime(),
                templateId: meal.meal_template_id,
              },
            ]);
            bumpData();
            toast(t("calculator.undone"), "info");
          })();
        },
      });
    } catch (err) {
      logCrash(err, { screen: "food", save: "compose" });
    } finally {
      setComposeSaving(false);
    }
  }

  async function saveComposeTemplate(name: string) {
    if (!activeProfile || composeSaving || !composeCanSaveTemplate(composeItems)) return;
    setComposeSaving(true);
    try {
      await createTemplate({
        profile_id: activeProfile.id,
        name,
        items: composeTemplateItems(composeItems),
      });
      hapticSuccess();
      bumpData();
      toast(t("mealCompose.templateSaved"), "success");
    } catch (err) {
      logCrash(err, { screen: "food", save: "composeTemplate" });
    } finally {
      setComposeSaving(false);
    }
  }

  const [estimateSource, setEstimateSource] = useState<CarbEstimateSource | null>(null);
  const { scScene } = useLocalSearchParams<{ scScene?: string }>();
  const scCarbs = isScreenshotMode() && __DEV__ && scScene === "carbs";
  const scEstimate = isScreenshotMode() && __DEV__ && scScene === "estimate";
  useEffect(() => {
    if (scEstimate) {
      setComposeOpen(false);
      setComposeItems([]);
      setEstimateSource("food_tab");
      return;
    }
    if (!scCarbs) return;
    setEstimateSource(null);
    let alive = true;
    void (async () => {
      const picks = sceneFoods(lang);
      const foods = await Promise.all(picks.map((pick) => getCatalogFoodByEnglishName(pick.en)));
      if (!alive) return;
      setComposeItems(
        foods.flatMap((food, i) =>
          food
            ? [{ ...composeItemFromFood(food, foodName(food, lang)), portion_g: picks[i].grams }]
            : []
        )
      );
      setComposeOpen(true);
    })();
    return () => {
      alive = false;
    };
  }, [scCarbs, scEstimate, lang]);

  // Empty-sheet starters: the locale's breakfast foods, by exact English name.
  const [starterFoods, setStarterFoods] = useState<Food[]>([]);
  useEffect(() => {
    if (!composeOpen) return;
    let alive = true;
    void (async () => {
      try {
        const foods = await Promise.all(
          sceneStarters(lang).map((name) => getCatalogFoodByEnglishName(name))
        );
        if (alive) setStarterFoods(foods.filter((f): f is Food => f != null));
      } catch (err) {
        logCrash(err, { screen: "food", load: "starters" });
      }
    })();
    return () => {
      alive = false;
    };
  }, [composeOpen, lang]);
  const recentFoods = useMemo(
    () => recent.flatMap((r) => (r.food ? [r.food] : [])),
    [recent]
  );

  function titleFor(sel: Selection): string {
    if (sel === "favorites") return t("food.favorites");
    if (sel === "custom") return t("food.custom");
    return t(`category.${sel}`);
  }
  /** One plate renderer for every shelf, so a category and the foods on it
   *  always carry the same picture (categories go through FoodPlate; the two
   *  personal shelves are not categories and bring their own plate). */
  function plateFor(sel: Selection, size: number) {
    if (sel === "favorites") {
      return <IconTile emoji={EMOJI_RENDERS ? "⭐" : undefined} icon="star-outline" hero size={size} radius={12} />;
    }
    if (sel === "custom") {
      return <IconTile emoji={EMOJI_RENDERS ? "✏️" : undefined} icon="create-outline" hero size={size} radius={12} />;
    }
    return <FoodPlate category={sel} size={size} radius={12} />;
  }

  // Category grid tiles: Favorites, (Custom if any), then all categories.
  const tiles: { sel: Selection; count: number }[] = [
    { sel: "favorites", count: favs.length },
    ...(customFoods.length
      ? [{ sel: "custom" as Selection, count: customFoods.length }]
      : []),
    ...CATEGORIES.map((c) => ({ sel: c as Selection, count: catCounts[c] ?? 0 })),
  ];

  // Search row with the scan action inline, as the mockup's B04 search bar. It is
  // the one control present in EVERY mode, so it sits directly under the title
  // instead of below the journal, where it used to be easy to miss.
  const SearchBar = (
    <View
      className="flex-row items-center rounded-2xl bg-glass border border-hair px-3 mb-3"
      style={{ minHeight: 52 }}
    >
      <Ionicons name="search" size={18} color={THEME.textMuted} />
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder={t("food.searchPlaceholder")}
        placeholderTextColor={THEME.textMuted}
        className="flex-1 py-3 px-2.5"
        style={[INPUT_TEXT, { color: THEME.text, fontSize: 15 }]}
        returnKeyType="search"
        accessibilityLabel={t("food.searchPlaceholder")}
      />
      {query ? (
        <Pressable
          hitSlop={10}
          onPress={() => setQuery("")}
          accessibilityRole="button"
          accessibilityLabel={t("common.close")}
          style={{
            minWidth: 32,
            minHeight: HIT_TARGET,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="close-circle" size={19} color={THEME.textMuted} />
        </Pressable>
      ) : null}
      <Pressable
        onPress={() => router.push("/scan")}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t("food.scan")}
        style={{
          minWidth: HIT_TARGET,
          minHeight: HIT_TARGET,
          alignItems: "flex-end",
          justifyContent: "center",
        }}
      >
        <View
          className="w-8 h-8 rounded-xl items-center justify-center"
          style={{ backgroundColor: THEME.accentFill }}
        >
          <Ionicons name="barcode-outline" size={17} color={THEME.accentOnFill} />
        </View>
      </Pressable>
    </View>
  );

  const carbMax = activeProfile?.daily_carb_target_g ?? 200;
  const carbMin = activeProfile?.daily_carb_target_min_g ?? Math.round(carbMax * 0.8);
  const todayCarbs = Math.round(
    todayMeals.reduce((sum, m) => sum + (m.calculated_carbs_g || 0), 0)
  );

  const visibleToday = showAllToday ? todayMeals : todayMeals.slice(0, TODAY_PREVIEW);
  const visibleTemplates = showAllTemplates
    ? rankedTemplates
    : rankedTemplates.slice(0, TEMPLATE_PREVIEW);

  const HeroCard = (
    <GlassCard
      glow
      style={{ alignItems: "center", paddingVertical: 16, marginBottom: 14 }}
    >
      <Text
        style={{
          color: THEME.textMuted,
          fontSize: 11,
          letterSpacing: 1.3,
          fontWeight: "800",
          textAlign: "center",
        }}
        numberOfLines={2}
      >
        {upper(t("dashboard.dailyCarbs"))}
      </Text>
      <View
        className="flex-row items-baseline flex-wrap justify-center mt-1"
        style={{ columnGap: 6 }}
      >
        <Text
          style={[TABULAR, { color: THEME.accent, fontSize: 36, fontWeight: "800" }]}
          numberOfLines={1}
        >
          {todayCarbs}
        </Text>
        <Text style={[TABULAR, { color: THEME.textMuted, fontSize: 13 }]}>
          / {carbMin}-{carbMax} {t("common.grams")}
        </Text>
      </View>
      <NeonProgressBar
        value={todayCarbs}
        max={carbMax}
        style={{ alignSelf: "stretch", marginTop: 12 }}
      />
    </GlassCard>
  );

  // The ONE ListHeaderComponent, identical in every mode: title row, the hero
  // card (grid only), the search field and the pending/back line. Nothing here
  // grows with the data - the catalogue bands that used to live in this ~440-line
  // block are FlatList rows now, so a focus reload can no longer change the
  // header's height while the list is scrolled.
  const HeaderTop = (
    <View style={[{ paddingTop: 4 }, colPad]}>
      {/* Title row: the screen's name and its one add action, in every mode -
          a search that finds nothing is exactly where "add it yourself" belongs. */}
      <View className="flex-row items-center justify-between mb-3">
        <Text
          style={{ color: THEME.text, fontSize: 24, fontWeight: "800", flexShrink: 1 }}
          numberOfLines={1}
        >
          {t("food.title")}
        </Text>
        <Pressable
          onPress={() => router.push("/add-food")}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t("food.addCustom")}
          style={{
            minWidth: HIT_TARGET,
            minHeight: HIT_TARGET,
            alignItems: "flex-end",
            justifyContent: "center",
          }}
        >
          <IconTile icon="add" size={34} radius={11} />
        </Pressable>
      </View>

      <GradientCTA
        label={t("mealCompose.create")}
        onPress={() => {
          hapticSelect();
          setComposeOpen(true);
        }}
        icon={<Ionicons name="restaurant-outline" size={18} color={THEME.accentOnFill} />}
        style={{ marginBottom: 12 }}
      />

      {/* Hero: today's carbohydrate total against the user's own range */}
      {mode === "grid" && !twoCol ? HeroCard : null}

      {mode === "grid" && !twoCol ? <CarbRatioLine /> : null}

      {SearchBar}

      {/* The debounce gap used to look like "no results"; it now says so. */}
      {mode === "search" && searchPending ? (
        <Text style={{ color: THEME.textMuted, fontSize: 12, marginBottom: 10 }}>
          {t("common.loading")}
        </Text>
      ) : null}

      {mode === "list" && selected ? (
        <Pressable
          onPress={() => setSelected(null)}
          accessibilityRole="button"
          accessibilityLabel={`${t("common.back")}, ${titleFor(selected)}`}
          className="flex-row items-center mb-3 active:opacity-80"
          style={{ minHeight: HIT_TARGET }}
        >
          <DirIcon name="chevron-back" size={20} color={THEME.accent} />
          {plateFor(selected, 30)}
          <Text
            style={{
              color: THEME.text,
              fontWeight: "800",
              fontSize: 16,
              marginLeft: 10,
              flexShrink: 1,
            }}
            numberOfLines={1}
          >
            {titleFor(selected)}
          </Text>
          <Text style={[TABULAR, { color: THEME.textMuted, fontSize: 12, marginLeft: 8 }]}>
            {listData.length}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );

  // Grid mode's four bands, one FlatList row each. Built on demand (called from
  // renderItem rather than assembled up front) so list/search mode never walks
  // today's meals or the templates for content it will not show.
  function renderGridBand(band: GridBand): React.ReactNode {
    // Today's meals, as the mockup's illustrated rows
    if (band === "today") {
      return (
        <View className="mb-5">
          <SectionHeading
            label={upper(t("common.today"))}
            right={
              todayMeals.length > 0 ? (
                <Text style={[TABULAR, { color: THEME.textMuted, fontSize: 11 }]}>
                  {todayMeals.length}
                </Text>
              ) : null
            }
          />
          {!todayLoaded ? (
            // Same box the real empty state uses (identical padding/border), so
            // the one legitimate outcome that reuses this shape - "really no
            // meals today" - lands with zero size change. Only a real list
            // below resizes the section, which is new content arriving, not a
            // wrong shell being corrected.
            <View className="rounded-2xl bg-glass border border-hair px-3.5 py-3.5">
              <Skeleton width="55%" height={12} />
            </View>
          ) : todayMeals.length === 0 ? (
            <View className="rounded-2xl bg-glass border border-hair px-3.5 py-3.5">
              <Text style={{ color: THEME.textMuted, fontSize: 12, lineHeight: 17 }}>
                {t("food.noMealsToday")}
              </Text>
            </View>
          ) : (
            <>
              {visibleToday.map((meal) => {
                const slot = mealSlotForHour(new Date(meal.logged_at).getHours());
                return (
                  <Pressable
                    key={meal.id}
                    onPress={() => router.push(mealEditRoute(meal))}
                    onLongPress={() => onTodayMealLongPress(meal)}
                    accessibilityRole="button"
                    accessibilityLabel={`${t(`slot.${slot}`)}, ${meal.display_name}`}
                    className="flex-row items-center rounded-2xl bg-glass border border-hair px-3 py-2.5 mb-2 active:opacity-80"
                    style={{ minHeight: HIT_TARGET + 12 }}
                  >
                    <IconTile
                      emoji={EMOJI_RENDERS ? SLOT_EMOJI[slot] : undefined}
                      icon={SLOT_ICON[slot]}
                      hero
                      size={40}
                      radius={14}
                      style={{ marginRight: 12 }}
                    />
                    <View className="flex-1 pr-2">
                      <Text
                        style={{ color: THEME.text, fontSize: 14, fontWeight: "700" }}
                        numberOfLines={1}
                      >
                        {t(`slot.${slot}`)}
                        <Text style={{ color: THEME.textMuted, fontWeight: "500" }}>
                          {"  "}
                          {formatTime(meal.logged_at)}
                        </Text>
                      </Text>
                      <Text
                        style={{ color: THEME.textMuted, fontSize: 11, marginTop: 2 }}
                        numberOfLines={2}
                      >
                        {meal.display_name}
                      </Text>
                    </View>
                    <Text
                      style={[
                        TABULAR,
                        { color: THEME.text, fontSize: 15, fontWeight: "800" },
                      ]}
                    >
                      {Math.round(meal.calculated_carbs_g)}
                      <Text
                        style={{ color: THEME.textMuted, fontSize: 11, fontWeight: "600" }}
                      >
                        {t("common.grams")}
                      </Text>
                    </Text>
                    {mealResponseIds.has(meal.id) ? (
                      <Pressable
                        onPress={() =>
                          router.push({
                            pathname: "/meal-response",
                            params: { mealId: meal.id },
                          })
                        }
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={t("mealResponse.title")}
                        style={{
                          marginLeft: 4,
                          minWidth: 32,
                          minHeight: HIT_TARGET,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Ionicons name="pulse-outline" size={17} color={THEME.accent} />
                      </Pressable>
                    ) : null}
                  </Pressable>
                );
              })}
              {todayMeals.length > TODAY_PREVIEW ? (
                <ShowMoreButton
                  label={showAllToday ? t("common.showLess") : t("common.showMore")}
                  onPress={() => setShowAllToday((v) => !v)}
                />
              ) : null}
            </>
          )}
        </View>
      );
    }

    // Meal templates: the recipes the user wrote down. A row rather than a chip,
    // because it carries a name, an item count, a figure and two tap targets.
    if (band === "templates") {
      return (
        <View className="mb-5">
          <SectionHeading
            label={upper(t("templates.title"))}
            right={
              <Pressable
                onPress={() => router.push("/meal-template")}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t("templates.create")}
                style={{
                  minWidth: 32,
                  minHeight: 32,
                  alignItems: "flex-end",
                  justifyContent: "center",
                }}
              >
                <Ionicons name="add" size={20} color={THEME.accent} />
              </Pressable>
            }
          />

          {!templatesLoaded ? (
            // Matches the real empty state's shape (text line + pill button)
            // rather than the list rows, since a brand-new profile lands here
            // most often - see the Today section above for the size rationale.
            <View className="rounded-2xl bg-glass border border-hair px-3.5 py-3.5">
              <Skeleton width="50%" height={12} />
              <Skeleton width={96} height={36} radius={18} style={{ marginTop: 10 }} />
            </View>
          ) : rankedTemplates.length === 0 ? (
            <View className="rounded-2xl bg-glass border border-hair px-3.5 py-3.5">
              <Text style={{ color: THEME.textMuted, fontSize: 12, lineHeight: 17 }}>
                {t("templates.empty")}
              </Text>
              <Pressable
                onPress={() => router.push("/meal-template")}
                accessibilityRole="button"
                accessibilityLabel={t("templates.create")}
                className="self-start rounded-full px-3.5 mt-2.5 items-center justify-center active:opacity-80"
                style={{
                  minHeight: 36,
                  backgroundColor: withAlpha(THEME.accent, 0.15),
                }}
              >
                <Text style={{ color: THEME.accent, fontSize: 13, fontWeight: "700" }}>
                  {t("templates.create")}
                </Text>
              </Pressable>
            </View>
          ) : (
            <>
              {visibleTemplates.map((entry) => (
                <Pressable
                  key={entry.template.id}
                  onPress={() => {
                    hapticSelect();
                    setConfirmEntry(entry);
                  }}
                  onLongPress={() => onTemplateLongPress(entry)}
                  accessibilityRole="button"
                  accessibilityLabel={`${entry.template.name}, ${t("templates.logNow")}`}
                  className="flex-row items-center rounded-2xl bg-glass border border-hair px-3 py-2.5 mb-2 active:opacity-80"
                  style={{ minHeight: HIT_TARGET + 12 }}
                >
                  <IconTile
                    emoji={EMOJI_RENDERS ? (entry.template.slot ? SLOT_EMOJI[entry.template.slot] : "🍽️") : undefined}
                    icon={
                      entry.template.slot
                        ? SLOT_ICON[entry.template.slot]
                        : "restaurant-outline"
                    }
                    hero
                    size={40}
                    radius={14}
                    style={{ marginRight: 12 }}
                  />
                  <View className="flex-1 pr-2">
                    <Text
                      style={{ color: THEME.text, fontSize: 14, fontWeight: "700" }}
                      numberOfLines={1}
                    >
                      {entry.template.name}
                    </Text>
                    <Text
                      style={{ color: THEME.textMuted, fontSize: 11, marginTop: 2 }}
                      numberOfLines={1}
                    >
                      {t("templates.itemCount", { count: entry.items.length })}
                    </Text>
                  </View>
                  <Text
                    style={[
                      TABULAR,
                      { color: THEME.text, fontSize: 15, fontWeight: "800" },
                    ]}
                  >
                    {Math.round(entry.carbs_g)}
                    <Text
                      style={{ color: THEME.textMuted, fontSize: 11, fontWeight: "600" }}
                    >
                      {t("common.grams")}
                    </Text>
                  </Text>
                  {/* The dose route, deliberately its own target: the body tap must
                      never be able to write insulin. */}
                  {showsDose ? (
                    <Pressable
                      onPress={() =>
                        router.push({
                          pathname: "/calculator",
                          params: { templateId: entry.template.id },
                        })
                      }
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={t("templates.calcDose")}
                      style={{
                        marginLeft: 4,
                        minWidth: 32,
                        minHeight: HIT_TARGET,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Ionicons
                        name="calculator-outline"
                        size={18}
                        color={THEME.accent}
                      />
                    </Pressable>
                  ) : null}
                </Pressable>
              ))}
              {rankedTemplates.length > TEMPLATE_PREVIEW ? (
                <ShowMoreButton
                  label={showAllTemplates ? t("common.showLess") : t("common.showMore")}
                  onPress={() => setShowAllTemplates((v) => !v)}
                />
              ) : null}
            </>
          )}
        </View>
      );
    }

    // Unlike Today/Templates, "no recent meals" has no empty-state copy of its
    // own - the band is simply absent. Without recentLoaded that absence during
    // the fetch was indistinguishable from a real empty result, so the whole
    // band (with the categories grid below it) popped into existence the instant
    // the query returned. A same-shaped skeleton row holds its place instead.
    if (band === "recent") {
      if (!recentLoaded) {
        return (
          <View className="mb-5">
            <SectionHeading label={upper(t("food.recent"))} />
            <View className="flex-row flex-wrap" style={{ gap: 8 }}>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} width={112} height={40} radius={20} />
              ))}
            </View>
          </View>
        );
      }
      if (recent.length === 0) return null;
      return (
        <View className="mb-5">
          <SectionHeading label={upper(t("food.recent"))} />
          <View className="flex-row flex-wrap" style={{ gap: 8 }}>
            {recent.map((r, i) => (
              <Pressable
                key={r.food ? r.food.id : `custom-${i}-${r.name}`}
                onPress={() => reLog(r)}
                accessibilityRole="button"
                accessibilityLabel={r.food ? foodName(r.food, lang) : r.name}
                className="flex-row items-center rounded-full bg-glass border border-hair px-2.5 active:opacity-80"
                style={{ minHeight: 40 }}
              >
                <FoodPlate
                  category={r.food ? r.food.category : null}
                  size={24}
                  radius={9}
                />
                <Text
                  style={{ color: THEME.text, fontSize: 13, marginLeft: 8, maxWidth: 150 }}
                  numberOfLines={1}
                >
                  {r.food ? foodName(r.food, lang) : r.name}
                </Text>
                <Text
                  style={[TABULAR, { color: THEME.textMuted, fontSize: 11, marginLeft: 8 }]}
                >
                  {Math.round(r.carbs_g)}
                  {t("common.grams")}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      );
    }

    // The catalogue itself: one dense grid of shelves, each with its own plate,
    // its own name and how many foods are on it.
    if (band === "categories") {
      return (
        <View className="mb-1">
          <SectionHeading label={upper(t("food.categories"))} />
          <View
            className="flex-row flex-wrap"
            style={{ marginHorizontal: -GRID_GUTTER }}
          >
            {tiles.map((tile) => (
              <View
                key={tile.sel}
                style={{ width: `${100 / gridColumns}%`, padding: GRID_GUTTER }}
              >
                <Pressable
                  onPress={() => setSelected(tile.sel)}
                  accessibilityRole="button"
                  accessibilityLabel={`${titleFor(tile.sel)}, ${tile.count}`}
                  className="flex-1 rounded-2xl bg-glass border border-hair active:opacity-80"
                  style={{ padding: 10, minHeight: 112 }}
                >
                  {plateFor(tile.sel, 34)}
                  <Text
                    style={{
                      color: THEME.text,
                      fontSize: 12,
                      fontWeight: "700",
                      marginTop: 8,
                    }}
                    numberOfLines={2}
                  >
                    {titleFor(tile.sel)}
                  </Text>
                  <Text
                    style={[TABULAR, { color: THEME.textMuted, fontSize: 11, marginTop: 2 }]}
                  >
                    {tile.count}
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>
        </View>
      );
    }
    return null;
  }

  // ONE container for every mode. The rows change; the FlatList, its header and
  // the search field's position in the tree do not - and there is deliberately
  // no `key` here, since a key on `mode` would bring back exactly the remount
  // (and the lost keyboard focus) this shape exists to avoid.
  const rows: readonly ListRow[] =
    mode === "grid" ? (twoCol ? GRID_BANDS_LEFT : GRID_BANDS) : listData;

  // The drilled-in custom shelf, genuinely empty: not a search with nothing
  // found, so it gets its own (favorites-like) empty state instead of "no
  // results found".
  const customShelfEmpty = mode === "list" && selected === "custom";

  const catalogList = (
    <FlatList
      {...keyboardAwareScrollProps}
      data={rows}
      keyExtractor={rowKeyExtractor}
      ListHeaderComponent={HeaderTop}
      initialNumToRender={12}
      // Android's default (true) recycles offscreen rows against a header whose
      // size still changes between list and search (back row vs. pending text);
      // false trades a little memory for never handing back a blank recycled cell.
      removeClippedSubviews={false}
      renderItem={({ item }) => (
        <View style={colPad}>
          {typeof item === "string" ? (
            renderGridBand(item)
          ) : (
            <FoodRow
              food={item}
              lang={lang}
              favorite={favIds.has(item.id)}
              onPress={onFoodPress}
              onToggleFavorite={onToggleFav}
              onLongPress={onFoodLongPress}
              onAddToMeal={onAddToMeal}
              inMeal={composeKeys.has(item.id)}
            />
          )}
        </View>
      )}
      // Grid mode always carries its four bands, so this only ever speaks for
      // an empty category/favourites shelf or a search that found nothing.
      ListEmptyComponent={
        !categoryLoading && !searchPending ? (
          <View style={colPad}>
            <EmptyState
              compact
              icon={
                selected === "favorites"
                  ? "star-outline"
                  : customShelfEmpty
                    ? "create-outline"
                    : "search-outline"
              }
              title={
                selected === "favorites"
                  ? t("food.noFavorites")
                  : customShelfEmpty
                    ? t("food.noCustomFoods")
                    : t("food.noResults")
              }
              // Only under the "no results" title, and only in the four
              // languages the catalogue carries no names in.
              subtitle={
                selected !== "favorites" &&
                mode === "search" &&
                ENGLISH_SEARCH_LANGS.includes(lang)
                  ? t("food.searchEnglishHint")
                  : undefined
              }
              actionLabel={
                mode === "search" || customShelfEmpty
                  ? t("food.addCustom")
                  : undefined
              }
              onAction={
                mode === "search" || customShelfEmpty
                  ? () => router.push("/add-food")
                  : undefined
              }
            />
          </View>
        ) : null
      }
      // Rendered whether the local search came up empty (below
      // ListEmptyComponent, VirtualizedList draws both) or just short - the
      // one difference from every row above is that this one is not local
      // catalogue data, so it lives outside `rows`/renderItem entirely.
      ListFooterComponent={
        showOffSearch ? (
          <View style={colPad}>
            <OffSearchResults query={query.trim()} lang={lang} onPicked={onFoodPress} />
          </View>
        ) : null
      }
      // The tab bar takes its own layout space (and its own safe-area inset),
      // so adding insets.bottom here again only left a dead dark band under
      // the last row.
      contentContainerStyle={{ paddingBottom: 28 }}
      showsVerticalScrollIndicator={false}
    />
  );

  const composeBarShown = composeItems.length > 0 && !composeOpen && !confirmEntry;
  const composeBar = (
    <>
      {composeBarShown ? (
        <Pressable
          onPress={() => setComposeOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`${t("mealCompose.title")}: ${composeItems.length}, ${t("mealCompose.total")} ${composeTotal.carbs_g} ${t("common.grams")}`}
          className="flex-row items-center justify-between rounded-2xl border border-hair"
          style={{
            position: "absolute",
            left: 16,
            right: 16,
            bottom: 12,
            minHeight: HIT_TARGET,
            paddingHorizontal: 14,
            backgroundColor: THEME.bg.g1,
            zIndex: 100,
          }}
        >
          <Text style={{ color: THEME.text, fontSize: 14, fontWeight: "700", flexShrink: 1 }}>
            {t("mealCompose.bar", { count: composeItems.length })}
          </Text>
          <Text style={[TABULAR, { color: THEME.accent, fontSize: 15, fontWeight: "800", marginLeft: 10 }]}>
            {num(composeTotal.carbs_g)}
            {t("common.grams")}
          </Text>
        </Pressable>
      ) : null}
    </>
  );

  return (
    <AppBackground style={{ paddingTop: insets.top }}>
      {twoCol ? (
        <View style={{ flex: 1, flexDirection: "row", justifyContent: "center" }}>
          <View style={{ flex: 1, maxWidth: COL_MAX_WIDTH }}>{catalogList}</View>
          <View style={{ flex: 1, maxWidth: COL_MAX_WIDTH }}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: composeBarShown ? 92 : 28 }}
            >
              <View style={[{ paddingTop: 4 }, colPad]}>
                {HeroCard}
                <CarbRatioLine />
                {renderGridBand("today")}
                {renderGridBand("templates")}
              </View>
            </ScrollView>
            {composeBar}
          </View>
        </View>
      ) : (
        <>
          {catalogList}
          {composeBar}
        </>
      )}

      {composeOpen ? (
        <MealComposeSheet
          items={composeItems}
          onChange={onComposeChange}
          saving={composeSaving}
          templateNameTaken={(name) =>
            templateNameTaken(name, templates.map((entry) => entry.template))
          }
          onClose={closeCompose}
          onSave={() => void saveCompose()}
          onSaveTemplate={(name) => void saveComposeTemplate(name)}
          onEstimate={carbEstimateConfigured ? () => setEstimateSource("meal_sheet") : undefined}
          targetG={scCarbs ? carbMax : activeProfile?.daily_carb_target_g ?? null}
          todayG={todayCarbs}
          recents={recentFoods}
          favorites={favs}
          starters={starterFoods}
          lang={lang}
        />
      ) : null}

      {estimateSource ? (
        <CarbEstimateSheet
          source={estimateSource}
          isPro={isProUser}
          locale={i18n.language}
          screenshotResult={scEstimate}
          onClose={() => setEstimateSource(null)}
          onAdd={(lines) => {
            setComposeItems((prev) => addEstimateLines(prev, lines));
            setComposeOpen(true);
          }}
        />
      ) : null}

      {confirmEntry ? (
        <TemplateConfirmSheet
          entry={confirmEntry}
          saving={confirmSaving}
          onClose={() => setConfirmEntry(null)}
          onConfirm={(when) => {
            void confirmLogTemplate(confirmEntry, when);
          }}
        />
      ) : null}
    </AppBackground>
  );
}
