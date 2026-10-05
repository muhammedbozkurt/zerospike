import React, { useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { useApp } from "../lib/store/AppContext";
import { countFoodsByCategory, listFoodsByCategory, searchFoods } from "../lib/db/foods";
import { listFavoriteFoods } from "../lib/db/favorites";
import { getJournal, type MealEntry } from "../lib/db/journal";
import type { DateRange } from "../lib/insights";
import { addMealLog, deleteMealRecord, getRecentMeals } from "../lib/db/logs";
import {
  createTemplate,
  getTemplateWithItems,
  listTemplates,
  replaceTemplateItems,
  setTemplateUsage,
  touchTemplate,
  updateTemplate,
  type NewTemplateItemInput,
} from "../lib/db/mealTemplates";
import {
  applyItemPortion,
  formatPortions,
  groupMealsBySlot,
  parsePortions,
  resolvedTotals,
  templateItemsFromMeals,
  templateNameTaken,
  type ResolvedTemplateItem,
} from "../lib/mealTemplates";
import type { Food, MealSlot, MealTemplate } from "../lib/db/types";
import { foodName } from "../lib/db/types";
import { CATEGORIES, type Category } from "../lib/db/categories";
import { insulinModeOf, insulinModeShowsBolus } from "../lib/insulinMode";
import { Field, Segmented } from "../components/ui";
import { DirIcon } from "../components/DirIcon";
import { Stepper, useStepperValidity } from "../components/Stepper";
import { PortionPresetChips } from "../components/PortionPresetChips";
import { FoodRow } from "../components/FoodRow";
import { FoodPlate } from "../components/FoodPlate";
import { EmptyState } from "../components/EmptyState";
import { ScreenHeader } from "../components/ScreenHeader";
import { FeedbackHost, useFeedback } from "../components/Feedback";
import {
  AppBackground,
  AppBackgroundFill,
  GlassCard,
  GradientCTA,
  withAlpha,
} from "../components/rich";
import { keyboardAwareScrollProps } from "../lib/keyboard";
import { useLayout } from "../lib/useLayout";
import { hapticSelect, hapticSuccess } from "../lib/haptics";
import { logCrash, logEvent } from "../lib/analytics";
import {
  schedulePostMealReminder,
  noteJournalActivity,
} from "../lib/services/notifications";
import { applyAfterDelete } from "../lib/afterDelete";
import { num } from "../lib/format";
import { uuid } from "../lib/uuid";
import { HIT_TARGET, INPUT_TEXT, MODAL_TOP_PAD, TABULAR, THEME } from "../lib/theme/tokens";
import { upper } from "../lib/upper";

const SLOTS: MealSlot[] = ["breakfast", "lunch", "dinner"];

/** The sentinel for "no slot": MealTemplate.slot is nullable and Segmented needs
 *  a string value, so the null is carried as "any" while the screen is open. */
type SlotChoice = MealSlot | "any";

/** Keystroke quiet period before the catalog is searched (as on the food tab). */
const SEARCH_DEBOUNCE_MS = 250;

function isSlot(value: string | undefined): value is MealSlot {
  return value === "breakfast" || value === "lunch" || value === "dinner";
}

/** A `YYYY-MM-DD` key (formatDateKey) as that whole LOCAL day, for the journal
 *  read. Null when the key is not one, so a hand-edited link reads as no day at
 *  all rather than as some arbitrary one. */
function localDayRange(key: string | undefined): DateRange | null {
  if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const [year, month, day] = key.split("-").map(Number);
  const start = new Date(year, month - 1, day, 0, 0, 0, 0);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(year, month - 1, day, 23, 59, 59, 999);
  return { start: start.getTime(), end: end.getTime() };
}

/**
 * The meal-template editor: name a meal you repeat, list what is in it, and keep
 * it. Four ways in, one screen:
 *
 *   - nothing              a blank template
 *   - templateId           edit it
 *   - templateId + rename  its name only
 *   - templateId + log     adjust today's portions and log it
 *   - fromDay + fromSlot   prefilled from one day's one slot of logged meals
 *
 * It DESCRIBES: it stores what the user wrote, and it never generates a name,
 * proposes an item or says anything about what is in the meal. The name field of
 * the "from a past meal" path opens EMPTY on purpose - a name assembled out of
 * food names would be the app deciding what someone's meal is called.
 *
 * There is deliberately no progress bar on the total. Drawing a template's carbs
 * against the daily target would rate the meal, and rating a meal is exactly the
 * comment this app does not make.
 */
function MealTemplateScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { templateId, fromDay, fromSlot, mode, portions } = useLocalSearchParams<{
    templateId?: string;
    fromDay?: string;
    fromSlot?: string;
    mode?: string;
    portions?: string;
  }>();
  const { activeProfile, lang, bumpData } = useApp();
  const { toast } = useFeedback();
  const { columnPad } = useLayout();

  const isEdit = typeof templateId === "string" && templateId.length > 0;
  const isLog = isEdit && mode === "log";
  const isRename = isEdit && mode === "rename";
  const showsDose = insulinModeShowsBolus(insulinModeOf(activeProfile));

  const [template, setTemplate] = useState<MealTemplate | null>(null);
  const [siblings, setSiblings] = useState<MealTemplate[]>([]);
  const [name, setName] = useState("");
  const [slot, setSlot] = useState<SlotChoice>("any");
  const [items, setItems] = useState<ResolvedTemplateItem[]>([]);
  // isEdit is known synchronously from the route params, so this starts true
  // right away for that path: "genuinely empty template" and "not fetched
  // yet" both start as items=[], and only this flag tells them apart.
  const [templateLoading, setTemplateLoading] = useState(isEdit);
  const [prefilled, setPrefilled] = useState(false);
  // OFF by default: one day's larger helping must not quietly move the recipe.
  const [savePortions, setSavePortions] = useState(false);
  const [saving, setSaving] = useState(false);
  const stepperFields = useStepperValidity();

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Food[]>([]);

  // Bulgu 4: the picker no longer opens blank. Favorites, recently-used foods
  // and the category shelves (the same accessors the food tab's own landing
  // grid reads from) give it something to tap on before a single letter is
  // typed; the search path below is untouched.
  const [pickerFavs, setPickerFavs] = useState<Food[]>([]);
  const [pickerRecent, setPickerRecent] = useState<Food[]>([]);
  const [pickerCatCounts, setPickerCatCounts] = useState<Record<string, number>>({});
  const [pickerCategory, setPickerCategory] = useState<Category | null>(null);
  const [pickerCategoryFoods, setPickerCategoryFoods] = useState<Food[]>([]);
  const [pickerCategoryLoading, setPickerCategoryLoading] = useState(false);

  useEffect(() => {
    if (!activeProfile) return;
    let active = true;
    void (async () => {
      try {
        const all = await listTemplates(activeProfile.id);
        if (!active) return;
        setSiblings(all);

        if (isEdit && templateId) {
          const loaded = await getTemplateWithItems(templateId, lang);
          if (!active) return;
          if (loaded) {
            setTemplate(loaded.template);
            setName(loaded.template.name);
            setSlot(loaded.template.slot ?? "any");
            // A link may carry one day's portions (the calculator's "adjust the
            // portions" route back). They only parse when the whole list still
            // matches, so a stale link falls back to the template as stored.
            const carried = parsePortions(portions, loaded.items.length);
            setItems(
              carried
                ? loaded.items.map((item, i) => applyItemPortion(item, carried[i]))
                : loaded.items
            );
          }
          return;
        }

        const dayRange = localDayRange(fromDay);
        if (isSlot(fromSlot) && dayRange) {
          // Read that ONE local day, not the newest N entries. A day+slot bucket never
          // crosses a calendar day (see groupMealsBySlot: 23:00 and 01:00 are two
          // different days), so this window is both complete and exact - a fixed
          // look-back would come back empty for a meal deep in the history.
          const feed = await getJournal(activeProfile.id, lang, 300, dayRange);
          if (!active) return;
          const meals = feed.filter((e): e is MealEntry => e.kind === "meal");
          const group = groupMealsBySlot(meals).find(
            (g) => g.dateKey === fromDay && g.slot === fromSlot
          );
          if (!group) return;
          setItems(templateItemsFromMeals(group.meals));
          setSlot(group.slot);
          setPrefilled(true);
        }
      } catch (err) {
        logCrash(err, { screen: "meal-template", load: isEdit ? "edit" : "prefill" });
      } finally {
        // Always clears, loaded, missing, or errored - a failed read must not
        // leave the screen stuck on its loading skeleton forever.
        if (active) setTemplateLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [activeProfile, lang, isEdit, templateId, fromDay, fromSlot, portions]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      return;
    }
    let active = true;
    const handle = setTimeout(() => {
      void (async () => {
        const found = await searchFoods(trimmed, lang);
        if (active) setResults(found);
      })();
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [query, lang]);

  // The picker's default browse content, fetched once when it opens rather
  // than on every keystroke - favorites and recents are small, and the
  // category counts only change with the catalog itself.
  useEffect(() => {
    if (!searchOpen || !activeProfile) return;
    let active = true;
    void (async () => {
      try {
        const [favs, recentMeals, counts] = await Promise.all([
          listFavoriteFoods(activeProfile.id),
          getRecentMeals(activeProfile.id, 20),
          countFoodsByCategory(),
        ]);
        if (!active) return;
        setPickerFavs(favs);
        const seen = new Set<string>();
        const recentFoods: Food[] = [];
        for (const r of recentMeals) {
          if (r.food && !seen.has(r.food.id)) {
            seen.add(r.food.id);
            recentFoods.push(r.food);
            if (recentFoods.length >= 8) break;
          }
        }
        setPickerRecent(recentFoods);
        setPickerCatCounts(counts);
      } catch (err) {
        logCrash(err, { screen: "meal-template", load: "picker" });
      }
    })();
    return () => {
      active = false;
    };
  }, [searchOpen, activeProfile]);

  // One category's shelf, fetched only while it is open (drilled into from the
  // picker's default category grid) - listFoodsByCategory is the same accessor
  // the food tab's own drilled-in list reads from.
  useEffect(() => {
    if (!pickerCategory) {
      setPickerCategoryFoods([]);
      setPickerCategoryLoading(false);
      return;
    }
    let active = true;
    setPickerCategoryLoading(true);
    void (async () => {
      try {
        const rows = await listFoodsByCategory(pickerCategory, lang);
        if (active) setPickerCategoryFoods(rows);
      } catch (err) {
        logCrash(err, { screen: "meal-template", load: "pickerCategory" });
        if (active) setPickerCategoryFoods([]);
      } finally {
        if (active) setPickerCategoryLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [pickerCategory, lang]);

  const totals = useMemo(() => resolvedTotals(items), [items]);

  const trimmedName = name.trim();
  // A WARNING, not a block: the schema carries no unique index on purpose (SQLite's
  // NOCASE does not fold the Turkish dotted/dotless I), and two people can legitimately
  // want two recipes that read alike. The check is the same fold on both sides.
  const nameTaken = useMemo(
    () => templateNameTaken(trimmedName, siblings, templateId ?? null),
    [trimmedName, siblings, templateId]
  );

  const namePlaceholder =
    prefilled && isSlot(fromSlot)
      ? t(`slot.${fromSlot}`)
      : t("templates.namePlaceholder");

  const title = isLog
    ? t("templates.adjustAndLog")
    : isRename
      ? t("templates.rename")
      : isEdit
        ? t("templates.editTitle")
        : t("templates.create");

  function setItemPortion(id: string, portionG: number) {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? applyItemPortion(item, portionG) : item))
    );
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }

  function addFoodItem(food: Food) {
    const portion = food.portion_size_g > 0 ? food.portion_size_g : 100;
    setItems((prev) => [
      ...prev,
      applyItemPortion(
        {
          id: uuid(),
          food_id: food.id,
          name: foodName(food, lang),
          missingFood: false,
          carb_100g: food.carb_100g,
          carbs_g_fixed: null,
          category: food.category,
          portion_g: portion,
          carbs_g: 0,
          sort_order: prev.length,
        },
        portion
      ),
    ]);
    closeSearch();
  }

  function closeSearch() {
    setSearchOpen(false);
    setQuery("");
    setResults([]);
    setPickerCategory(null);
  }

  // What the picker's list shows: a real search, a drilled-in category shelf,
  // or the default browse (favorites + recents + category grid, in the header).
  const pickerMode: "search" | "category" | "browse" = query.trim()
    ? "search"
    : pickerCategory
      ? "category"
      : "browse";
  const pickerRows: Food[] =
    pickerMode === "search"
      ? results
      : pickerMode === "category"
        ? pickerCategoryFoods
        : [];

  function toInputs(list: readonly ResolvedTemplateItem[]): NewTemplateItemInput[] {
    return list.map((item) => ({
      food_id: item.food_id,
      name_snapshot: item.name,
      carb_100g_snapshot: item.carb_100g,
      portion_g: item.portion_g,
      carbs_g_fixed: item.carbs_g_fixed,
    }));
  }

  async function save() {
    if (!activeProfile || !trimmedName || saving || !stepperFields.allValid) return;
    setSaving(true);
    try {
      const slotValue = slot === "any" ? null : slot;
      if (isEdit && templateId) {
        await updateTemplate(templateId, { name: trimmedName, slot: slotValue });
        // Rename mode never touched the item list, so it must not write one back.
        if (!isRename) await replaceTemplateItems(templateId, toInputs(items));
      } else {
        await createTemplate({
          profile_id: activeProfile.id,
          name: trimmedName,
          slot: slotValue,
          items: toInputs(items),
        });
      }
      hapticSuccess();
      bumpData();
      toast(t("templates.saved"), "success");
      router.back();
    } finally {
      setSaving(false);
    }
  }

  /**
   * Logs the template at the portions on screen. NOT logTemplate: that one reads
   * the STORED items, which would file the portions the user just adjusted away
   * and record numbers they can see are wrong on the screen they are looking at.
   *
   * insulin_dose_units is 0 and no injection row is written. A dose has to be
   * taken deliberately, through the calculator's own gates.
   */
  async function logNow() {
    if (!activeProfile || !templateId || !template || saving || !stepperFields.allValid) return;
    setSaving(true);
    try {
      const meal = await addMealLog({
        profile_id: activeProfile.id,
        food_id: null,
        custom_food_name: template.name,
        portion_g: totals.portion_g,
        calculated_carbs_g: totals.carbs_g,
        insulin_dose_units: 0,
        meal_template_id: templateId,
      });
      await touchTemplate(templateId);
      // Only after the record is safely written, and only when it was asked for:
      // the meal is the thing that matters, and a failed recipe rewrite must not
      // take today's entry down with it.
      if (savePortions) await replaceTemplateItems(templateId, toInputs(items));
      logEvent("log_added", { source: "template" });
      hapticSuccess();
      await schedulePostMealReminder();
      void noteJournalActivity();
      bumpData();

      // Undo puts the usage counters back as they were: touchTemplate only moves
      // last_used_at forward, so there is no second call that could reverse it.
      const priorUse = template.use_count;
      const priorAt = template.last_used_at;
      toast(t("templates.logged", { name: template.name }), "success", {
        label: t("common.undo"),
        onPress: () => {
          void (async () => {
            await deleteMealRecord(meal.id);
            // The countdown this very save armed (schedulePostMealReminder
            // above) has to go with the record: the same shared post-delete
            // cleanup every other delete path runs (lib/afterDelete.ts).
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
            await setTemplateUsage(templateId, priorUse, priorAt);
            bumpData();
            toast(t("calculator.undone"), "info");
          })();
        },
      });
      router.back();
    } finally {
      setSaving(false);
    }
  }

  // A plain function and NOT a component: an inline component is a new type on
  // every render, so React would unmount each row (and the portion Stepper's own
  // draft text with it) on every keystroke.
  const itemRow = (item: ResolvedTemplateItem) => (
    <View
      key={item.id}
      className="rounded-2xl bg-glass border border-hair px-3 py-3 mb-2"
    >
      <View className="flex-row items-center">
        <FoodPlate
          category={item.category}
          size={36}
          radius={13}
          style={{ marginRight: 11 }}
        />
        <View className="flex-1 pr-2">
          <Text
            style={{ color: THEME.ink, fontSize: 14, fontWeight: "700" }}
            numberOfLines={1}
          >
            {item.name}
          </Text>
          {item.missingFood ? (
            <Text
              style={{ color: THEME.muted, fontSize: 11, marginTop: 2 }}
              numberOfLines={2}
            >
              {t("templates.missingFood")}
            </Text>
          ) : null}
        </View>
        <Text style={[TABULAR, { color: THEME.ink, fontSize: 15, fontWeight: "800" }]}>
          {num(item.carbs_g)}
          <Text style={{ color: THEME.muted, fontSize: 11, fontWeight: "600" }}>
            {t("common.grams")}
          </Text>
        </Text>
        {isLog ? null : (
          <Pressable
            onPress={() => removeItem(item.id)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`${t("templates.removeItem")}, ${item.name}`}
            style={{
              marginLeft: 4,
              minWidth: 32,
              minHeight: HIT_TARGET,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="close-circle-outline" size={19} color={THEME.muted} />
          </Pressable>
        )}
      </View>

      {/* An item stored with a carb total outright has no per-100 value under it,
          so there is no portion to step - the recorded grams are shown as they are. */}
      {item.carbs_g_fixed != null ? (
        <Text style={{ color: THEME.muted, fontSize: 11, marginTop: 6 }}>
          {t("templates.fixedCarbs")}: {num(item.carbs_g)} {t("common.grams")}
        </Text>
      ) : (
        <>
          <Stepper
            value={item.portion_g}
            onChange={(v) => setItemPortion(item.id, v)}
            onValidityChange={stepperFields.reporter(`portion:${item.id}`)}
            step={5}
            longStep={25}
            min={0}
            max={2000}
            decimals={0}
            suffix={t("common.grams")}
            accessibilityLabel={`${t("calculator.portion")}, ${item.name}`}
            style={{ marginTop: 8 }}
          />
          {/* No presets for a typed-name item (no food_id to look them up by). */}
          {item.food_id ? (
            <PortionPresetChips
              foodId={item.food_id}
              value={item.portion_g}
              onPick={(g) => setItemPortion(item.id, g)}
              style={{ marginTop: 8 }}
            />
          ) : null}
        </>
      )}
    </View>
  );

  return (
    <AppBackground>
      <View
        className="flex-1"
        style={{
          paddingTop: Math.max(insets.top, MODAL_TOP_PAD),
        }}
      >
        <View style={columnPad()}>
          <ScreenHeader
            title={title}
            onBack={() => router.back()}
            backIcon="close"
            accessibilityLabel={t("common.close")}
          />
        </View>

        <ScrollView
          {...keyboardAwareScrollProps}
          contentContainerStyle={
            isRename
              ? { flexGrow: 1, justifyContent: "center", paddingBottom: insets.bottom + 32 }
              : { paddingBottom: insets.bottom + 32 }
          }
          showsVerticalScrollIndicator={false}
        >
          <View style={columnPad(16)}>
            {prefilled ? (
              <View
                className="flex-row items-start rounded-2xl px-3.5 py-3 mb-3"
                style={{
                  borderWidth: 1,
                  borderColor: withAlpha(THEME.accent, 0.3),
                  backgroundColor: withAlpha(THEME.accent, 0.1),
                }}
              >
                <Ionicons
                  name="information-circle-outline"
                  size={15}
                  color={THEME.accent}
                  style={{ marginTop: 1 }}
                />
                <Text
                  style={{
                    color: THEME.ink,
                    fontSize: 12,
                    lineHeight: 17,
                    opacity: 0.85,
                    marginLeft: 10,
                    flex: 1,
                  }}
                >
                  {t("templates.prefilledNote")}
                </Text>
              </View>
            ) : null}

            {isLog ? (
              templateLoading ? (
                <View
                  style={{
                    width: "60%",
                    height: 20,
                    borderRadius: 6,
                    backgroundColor: THEME.track,
                    marginBottom: 12,
                    opacity: 0.5,
                  }}
                />
              ) : (
                <Text
                  style={{
                    color: THEME.ink,
                    fontSize: 17,
                    fontWeight: "800",
                    marginBottom: 12,
                  }}
                  numberOfLines={2}
                >
                  {template?.name ?? ""}
                </Text>
              )
            ) : (
              <>
                <Field
                  label={t("templates.name")}
                  value={name}
                  onChangeText={setName}
                  placeholder={namePlaceholder}
                  autoFocus
                  returnKeyType="done"
                />
                {nameTaken ? (
                  <Text
                    style={{ color: THEME.muted, fontSize: 11, marginTop: -6, marginBottom: 10 }}
                  >
                    {t("templates.nameExists")}
                  </Text>
                ) : null}
              </>
            )}

            {isLog || isRename ? null : (
              <>
                <Text className="text-sm font-medium text-mut mb-1.5">
                  {t("templates.slotLabel")}
                </Text>
                <Segmented<SlotChoice>
                  options={[
                    ...SLOTS.map((s) => ({ value: s as SlotChoice, label: t(`slot.${s}`) })),
                    { value: "any", label: t("templates.slotAny") },
                  ]}
                  value={slot}
                  onChange={setSlot}
                />
                <Text style={{ color: THEME.muted, fontSize: 11, marginTop: 8, marginBottom: 14 }}>
                  {t("templates.slotHint")}
                </Text>
              </>
            )}

            {isRename ? null : (
              <>
                <GlassCard style={{ marginBottom: 14 }}>
                  <View className="flex-row items-center justify-between">
                    <Text
                      style={{
                        color: THEME.muted,
                        fontSize: 11,
                        letterSpacing: 1.3,
                        fontWeight: "800",
                        flex: 1,
                      }}
                    >
                      {upper(t("templates.total"))}
                    </Text>
                    <View className="flex-row items-baseline" style={{ gap: 4 }}>
                      {templateLoading ? (
                        <View
                          style={{ width: 40, height: 22, borderRadius: 6, backgroundColor: THEME.track }}
                        />
                      ) : (
                        <Text
                          style={[
                            TABULAR,
                            { color: THEME.accent, fontSize: 26, fontWeight: "800" },
                          ]}
                        >
                          {num(totals.carbs_g)}
                        </Text>
                      )}
                      <Text style={{ color: THEME.muted, fontSize: 12 }}>
                        {t("common.grams")}
                      </Text>
                    </View>
                  </View>
                </GlassCard>

                <View className="flex-row items-center justify-between mb-2">
                  <Text className="text-xs font-semibold tracking-wider text-mut">
                    {upper(t("templates.items"))}
                  </Text>
                  {templateLoading ? null : (
                    <Text style={{ color: THEME.muted, fontSize: 11 }}>
                      {t("templates.itemCount", { count: items.length })}
                    </Text>
                  )}
                </View>

                {templateLoading ? (
                  // Editing an existing template: the real item count isn't known
                  // yet, so this stands in for it instead of drawing "0 g" /
                  // "no ingredients" - both would be wrong for a non-empty template.
                  <>
                    {[0, 1].map((i) => (
                      <View
                        key={i}
                        className="rounded-2xl bg-glass border border-hair px-3 py-3 mb-2"
                        style={{ opacity: 0.5 }}
                      >
                        <View className="flex-row items-center">
                          <View
                            style={{ width: 36, height: 36, borderRadius: 13, backgroundColor: THEME.track, marginRight: 11 }}
                          />
                          <View
                            style={{ flex: 1, height: 14, borderRadius: 7, backgroundColor: THEME.track }}
                          />
                        </View>
                      </View>
                    ))}
                  </>
                ) : items.length === 0 ? (
                  <View className="rounded-2xl bg-glass border border-hair px-3.5 py-3.5 mb-3">
                    <Text style={{ color: THEME.muted, fontSize: 12, lineHeight: 17 }}>
                      {/* isLog hides the add-item button below (see the isLog
                          check further down), so its empty state must not
                          point at a control that isn't on screen. */}
                      {isLog ? t("templates.emptyItemsLog") : t("templates.emptyItems")}
                    </Text>
                  </View>
                ) : (
                  items.map(itemRow)
                )}

                {isLog ? null : (
                  <Pressable
                    onPress={() => setSearchOpen(true)}
                    accessibilityRole="button"
                    accessibilityLabel={t("templates.addItem")}
                    className="flex-row items-center justify-center rounded-2xl py-3.5 mb-5 active:opacity-80"
                    style={{
                      borderWidth: 1,
                      borderStyle: "dashed",
                      borderColor: THEME.border,
                      minHeight: HIT_TARGET + 8,
                    }}
                  >
                    <Ionicons name="add" size={18} color={THEME.accent} />
                    <Text style={{ color: THEME.accent, marginLeft: 8, fontSize: 13, fontWeight: "700" }}>
                      {t("templates.addItem")}
                    </Text>
                  </Pressable>
                )}
              </>
            )}

            {isLog ? (
              <>
                <Pressable
                  onPress={() => {
                    hapticSelect();
                    setSavePortions((v) => !v);
                  }}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: savePortions }}
                  accessibilityLabel={t("templates.saveToTemplate")}
                  className="flex-row items-center rounded-2xl bg-glass border border-hair px-3.5 py-3 mb-4 active:opacity-80"
                  style={{ minHeight: HIT_TARGET }}
                >
                  <Ionicons
                    name={savePortions ? "checkbox" : "square-outline"}
                    size={20}
                    color={savePortions ? THEME.accent : THEME.muted}
                  />
                  <Text style={{ color: THEME.ink, fontSize: 13, marginLeft: 10, flex: 1 }}>
                    {t("templates.saveToTemplate")}
                  </Text>
                </Pressable>

                <GradientCTA
                  label={t("templates.logNow")}
                  disabled={saving || items.length === 0 || !stepperFields.allValid}
                  onPress={logNow}
                />

                {/* The dose route for the portions on screen: they travel in the link,
                    so the calculator estimates from what is here and the template
                    itself stays as it is. */}
                {showsDose ? (
                  <Pressable
                    onPress={() =>
                      router.replace({
                        pathname: "/calculator",
                        params: {
                          templateId: String(templateId),
                          portions: formatPortions(items),
                        },
                      })
                    }
                    disabled={!stepperFields.allValid}
                    hitSlop={8}
                    accessibilityRole="button"
                    className="flex-row items-center justify-center mt-3"
                    style={{ minHeight: HIT_TARGET, opacity: stepperFields.allValid ? 1 : 0.5 }}
                  >
                    <Ionicons name="calculator-outline" size={15} color={THEME.accent} />
                    <Text style={{ color: THEME.accent, fontSize: 13, marginLeft: 6 }}>
                      {t("templates.calcDose")}
                    </Text>
                  </Pressable>
                ) : null}
              </>
            ) : (
              <GradientCTA
                label={t("templates.save")}
                disabled={saving || !trimmedName || !stepperFields.allValid}
                onPress={save}
              />
            )}
          </View>
        </ScrollView>
      </View>

      {/* The item picker opens IN this screen: a modal presented over a modal is
          the presentation iOS silently refuses (see components/Feedback). */}
      {searchOpen ? (
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              paddingTop:
                Math.max(insets.top, MODAL_TOP_PAD),
            },
          ]}
        >
          <AppBackgroundFill />
          <View style={columnPad()}>
            <ScreenHeader
              title={t("templates.addItem")}
              onBack={closeSearch}
              backIcon="close"
              accessibilityLabel={t("common.close")}
            />
          </View>
          <View style={columnPad(16)}>
            <View
              className="flex-row items-center rounded-2xl bg-glass border border-hair px-3 mb-3"
              style={{ minHeight: 52 }}
            >
              <Ionicons name="search" size={18} color={THEME.muted} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={t("food.searchPlaceholder")}
                placeholderTextColor="rgba(137,163,176,0.7)"
                className="flex-1 py-3 px-2.5"
                style={[INPUT_TEXT, { color: THEME.ink, fontSize: 15 }]}
                accessibilityLabel={t("food.searchPlaceholder")}
                autoFocus
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
                  <Ionicons name="close-circle" size={19} color={THEME.muted} />
                </Pressable>
              ) : null}
            </View>
          </View>
          <FlatList
            {...keyboardAwareScrollProps}
            data={pickerRows}
            keyExtractor={(f) => f.id}
            initialNumToRender={12}
            ListHeaderComponent={
              pickerMode === "category" ? (
                <View style={columnPad(16)}>
                  <Pressable
                    onPress={() => setPickerCategory(null)}
                    accessibilityRole="button"
                    accessibilityLabel={`${t("common.back")}, ${t(`category.${pickerCategory}`)}`}
                    className="flex-row items-center mb-3 active:opacity-80"
                    style={{ minHeight: HIT_TARGET }}
                  >
                    <DirIcon name="chevron-back" size={20} color={THEME.accent} />
                    <FoodPlate category={pickerCategory} size={28} radius={10} style={{ marginLeft: 6 }} />
                    <Text
                      style={{ color: THEME.ink, fontWeight: "800", fontSize: 15, marginLeft: 10 }}
                      numberOfLines={1}
                    >
                      {t(`category.${pickerCategory}`)}
                    </Text>
                  </Pressable>
                  {pickerCategoryLoading ? (
                    <Text style={{ color: THEME.muted, fontSize: 12, marginBottom: 10 }}>
                      {t("common.loading")}
                    </Text>
                  ) : null}
                </View>
              ) : pickerMode === "browse" ? (
                <View style={columnPad(16)}>
                  {pickerFavs.length > 0 ? (
                    <View style={{ marginBottom: 14 }}>
                      <Text
                        style={{
                          color: THEME.muted,
                          fontSize: 11,
                          letterSpacing: 1.2,
                          fontWeight: "800",
                          marginBottom: 8,
                        }}
                      >
                        {upper(t("food.favorites"))}
                      </Text>
                      {pickerFavs.map((food) => (
                        <FoodRow key={food.id} food={food} lang={lang} onPress={addFoodItem} />
                      ))}
                    </View>
                  ) : null}

                  {pickerRecent.length > 0 ? (
                    <View style={{ marginBottom: 14 }}>
                      <Text
                        style={{
                          color: THEME.muted,
                          fontSize: 11,
                          letterSpacing: 1.2,
                          fontWeight: "800",
                          marginBottom: 8,
                        }}
                      >
                        {upper(t("food.recent"))}
                      </Text>
                      {pickerRecent.map((food) => (
                        <FoodRow key={food.id} food={food} lang={lang} onPress={addFoodItem} />
                      ))}
                    </View>
                  ) : null}

                  <View style={{ marginBottom: 8 }}>
                    <Text
                      style={{
                        color: THEME.muted,
                        fontSize: 11,
                        letterSpacing: 1.2,
                        fontWeight: "800",
                        marginBottom: 8,
                      }}
                    >
                      {upper(t("food.categories"))}
                    </Text>
                    <View className="flex-row flex-wrap" style={{ marginHorizontal: -5 }}>
                      {CATEGORIES.map((c) => (
                        <View key={c} style={{ width: "33.333%", padding: 5 }}>
                          <Pressable
                            onPress={() => setPickerCategory(c)}
                            accessibilityRole="button"
                            accessibilityLabel={`${t(`category.${c}`)}, ${pickerCatCounts[c] ?? 0}`}
                            className="rounded-2xl bg-glass border border-hair active:opacity-80"
                            style={{ padding: 10, minHeight: 96 }}
                          >
                            <FoodPlate category={c} size={30} radius={11} />
                            <Text
                              style={{ color: THEME.ink, fontSize: 11, fontWeight: "700", marginTop: 8 }}
                              numberOfLines={2}
                            >
                              {t(`category.${c}`)}
                            </Text>
                            <Text style={[TABULAR, { color: THEME.muted, fontSize: 10, marginTop: 2 }]}>
                              {pickerCatCounts[c] ?? 0}
                            </Text>
                          </Pressable>
                        </View>
                      ))}
                    </View>
                  </View>
                </View>
              ) : null
            }
            renderItem={({ item }) => (
              <View style={columnPad(16)}>
                <FoodRow food={item} lang={lang} onPress={addFoodItem} />
              </View>
            )}
            ListEmptyComponent={
              pickerMode === "search" ? (
                <View style={columnPad(16)}>
                  <EmptyState compact icon="search-outline" title={t("food.noResults")} />
                </View>
              ) : null
            }
            contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
            showsVerticalScrollIndicator={false}
          />
        </View>
      ) : null}

      <FeedbackHost />
    </AppBackground>
  );
}

export default function MealTemplateRoute() {
  return (
    <SafeAreaProvider>
      <MealTemplateScreen />
    </SafeAreaProvider>
  );
}
