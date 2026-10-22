import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  BackHandler,
  Easing,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardEvent as RNKeyboardEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import type { EditableItem } from "../lib/ai/carbEstimateClient";
import { searchFoods } from "../lib/db/foods";
import { foodName, type Food, type Lang } from "../lib/db/types";
import { decimalInputText, num } from "../lib/format";
import { logEvent } from "../lib/analytics";
import { keyboardAwareScrollProps } from "../lib/keyboard";
import {
  addComposeItem,
  chipGrams,
  composeCanSave,
  composeCanSaveTemplate,
  composeHasEstimate,
  composeItemFromFood,
  composeTotals,
  initialPortionGrams,
  parseGramsInput,
  pruneDrafts,
  removeComposeItem,
  setComposePortion,
  updateEstimateLine,
  type ComposeItem,
  type PortionChip,
} from "../lib/mealCompose";
import { DIALOG_CLEARANCE, dialogHeights, sheetLayout } from "../lib/sheetLayout";
import { HIT_TARGET, INPUT_TEXT, THEME } from "../lib/theme/tokens";
import { useLayout } from "../lib/useLayout";
import { TABLET_SHEET_MAX_HEIGHT, dialogCardStyle, sheetBoxStyle } from "../lib/tabletLayout";
import {
  EstimateResultCard,
  FoodCard,
  FoodSearchBlock,
  LiveTotalHeader,
  entryUnitAfterChip,
  gramOpenAfterChip,
  loadFoodPortions,
  rememberPortion,
  useFoodPortionsMap,
  usePortionUnitSystem,
} from "./meal";
import { SCRIM } from "./SheetShell";
import { ScrollHint } from "./ScrollHint";
import { useScrollHint } from "../lib/useScrollHint";
import { hintBottomOffset } from "../lib/scrollHint";
import { Button } from "./ui";

const SEARCH_DEBOUNCE_MS = 180;
/** Share of the container the sheet takes: tall enough to be a form, short
 *  enough that the scrim above it stays tappable. With the keyboard up the
 *  sheet uses nearly all the room left above it. */
const SHEET_RATIO = 0.92;
const SHEET_RATIO_KEYBOARD = 0.98;

const NO_FOODS: readonly Food[] = [];

function estimateToEditable(item: ComposeItem): EditableItem {
  const quantity = item.quantity ?? 0;
  return {
    key: item.key,
    name: item.name === "-" ? "" : item.name,
    quantityText: quantity > 0 ? decimalInputText(quantity) : "",
    unit: item.unit ?? "",
    gramsText: decimalInputText(item.carbs_g_fixed ?? 0),
  };
}

/**
 * The meal sheet, one flow top to bottom: the running total, a food search
 * (recent, favourite and starter foods when the field is empty), one card per
 * food with serving chips (grams only after the "grams..." chip), one card per
 * text-estimate line, the secondary "Estimate from text" button, the optional
 * template name, and the primary save button pinned at the bottom.
 *
 * Presentational: the caller writes the meal (food.tsx) so the post-save
 * effects stay in one place. Estimate lines (Spike) arrive through the same
 * `items` list (lib/mealCompose addEstimateLines); a meal that holds one saves
 * carb-only and cannot become a template.
 *
 * It stays an absolute overlay (zIndex 200) and not a Modal: CarbEstimateSheet
 * is an overlay too (zIndex 300) and has to open ABOVE this sheet, which a
 * Modal would not allow. The height rule is SheetShell's "full" mode: a fixed
 * share of the container, the content scrolls, the footer is pinned, and the
 * sheet lifts by the part of the keyboard that covers it.
 */
export function MealComposeSheet({
  items,
  onChange,
  saving,
  templateNameTaken,
  onClose,
  onSave,
  onSaveTemplate,
  onEstimate,
  targetG,
  todayG,
  recents,
  favorites,
  starters = NO_FOODS,
  lang,
  onSearch,
}: {
  items: ComposeItem[];
  onChange: (items: ComposeItem[]) => void;
  saving: boolean;
  /** Whether a template already carries this name (checked by the caller). */
  templateNameTaken: (name: string) => boolean;
  onClose: () => void;
  onSave: () => void;
  onSaveTemplate: (name: string) => void;
  /** Opens the text estimate; the button shows only when the caller offers it. */
  onEstimate?: () => void;
  /** Daily carbohydrate target in grams (profile), null when none is set. */
  targetG: number | null;
  /** Carbohydrates already logged today (accepted for the header's prop shape). */
  todayG: number;
  /** Recently logged catalogue foods, newest first. */
  recents: readonly Food[];
  favorites: readonly Food[];
  /** The locale's three starter foods; shown only when recents and favorites
   *  are both empty. */
  starters?: readonly Food[];
  lang: Lang;
  /** Search override; defaults to searchFoods(query, lang). */
  onSearch?: (query: string) => Promise<Food[]>;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { isWide, isDialog, width: layoutWidth, height: layoutHeight } = useLayout();
  const anim = useRef(new Animated.Value(0)).current;
  const rootRef = useRef<View>(null);
  const scrollRef = useRef<ScrollView>(null);
  const scrollHint = useScrollHint("sheet.meal-compose");
  const [rootHeight, setRootHeight] = useState(0);
  const [lift, setLift] = useState(0);
  const keyboardTopRef = useRef<number | null>(null);

  const [namingTemplate, setNamingTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Food[]>([]);
  const [gramOpen, setGramOpen] = useState<Record<string, boolean>>({});
  const [entryUnit, setEntryUnit] = useState<Record<string, "g" | "oz">>({});
  const unitSystem = usePortionUnitSystem();
  const [drafts, setDrafts] = useState<Record<string, EditableItem>>({});

  const itemsRef = useRef(items);
  itemsRef.current = items;
  useEffect(() => {
    setDrafts((prev) => pruneDrafts(prev, items));
  }, [items]);
  const adding = useRef(new Set<string>());
  /** The portion a food entered the meal with: sizes the synthetic "portion"
   *  chip of a food that has no presets, and stays put while the user edits. */
  const typicalRef = useRef(new Map<string, number>());

  useEffect(() => {
    logEvent("meal_builder_opened", {});
  }, []);

  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [anim]);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);

  // How far the keyboard covers THIS container: measured, not the raw keyboard
  // height, because the container does not reach the screen bottom (tab bar)
  // and Android may already have resized the window.
  const recomputeLift = useCallback(() => {
    const top = keyboardTopRef.current;
    if (top === null) {
      setLift(0);
      return;
    }
    rootRef.current?.measureInWindow((_x, y, _w, h) => {
      setLift(Math.max(0, Math.round(y + h - top)));
    });
  }, []);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const subShow = Keyboard.addListener(showEvent, (e: RNKeyboardEvent) => {
      const { screenY, height } = e?.endCoordinates ?? { screenY: 0, height: 0 };
      if (!(height > 0)) return;
      keyboardTopRef.current = screenY > 0 ? screenY : null;
      recomputeLift();
    });
    const subHide = Keyboard.addListener(hideEvent, () => {
      keyboardTopRef.current = null;
      setLift(0);
    });
    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, [recomputeLift]);

  // Debounced search: one query per pause in typing, stale answers dropped.
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      return;
    }
    let active = true;
    const handle = setTimeout(() => {
      void (async () => {
        try {
          const found = onSearch ? await onSearch(trimmed) : await searchFoods(trimmed, lang);
          if (active) setResults(found);
        } catch {
          if (active) setResults([]);
        }
      })();
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [query, lang, onSearch]);

  const addFood = useCallback(
    async (food: Food) => {
      if (adding.current.has(food.id)) return;
      adding.current.add(food.id);
      try {
        const base = composeItemFromFood(food, foodName(food, lang));
        const view = await loadFoodPortions(food.id);
        const grams = initialPortionGrams(view.measures, view.remembered, food.portion_size_g);
        typicalRef.current.set(base.key, grams);
        onChange(addComposeItem(itemsRef.current, { ...base, portion_g: grams }));
        setQuery("");
      } finally {
        adding.current.delete(food.id);
      }
    },
    [lang, onChange]
  );

  const portionFoods = useMemo(
    () =>
      items
        .filter((item) => !item.estimate)
        .map((item) => ({
          id: item.food_id,
          typicalG: typicalRef.current.get(item.key) ?? (item.portion_g > 0 ? item.portion_g : 0),
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items.map((item) => `${item.key}:${item.estimate ? 1 : 0}`).join("|")]
  );
  const portionViews = useFoodPortionsMap(portionFoods, unitSystem === "us");

  const onChip = (item: ComposeItem, chip: PortionChip) => {
    const open = gramOpenAfterChip(chip);
    setGramOpen((prev) => ({ ...prev, [item.key]: open }));
    if (open) setEntryUnit((prev) => ({ ...prev, [item.key]: entryUnitAfterChip(chip) }));
    if (chip.kind === "measure" && chip.label_key) {
      rememberPortion(item.food_id, chip.label_key);
      onChange(setComposePortion(itemsRef.current, item.key, chipGrams(chip)));
    }
  };

  const onEstimateChange = (item: ComposeItem, next: EditableItem) => {
    setDrafts((prev) => ({ ...prev, [item.key]: next }));
    onChange(
      updateEstimateLine(itemsRef.current, item.key, {
        name: next.name,
        quantity: parseGramsInput(next.quantityText),
        unit: next.unit,
        grams_carb: parseGramsInput(next.gramsText),
      })
    );
  };

  const totals = composeTotals(items);
  const hasEstimate = composeHasEstimate(items);
  const canSave = composeCanSave(items) && !saving;
  const trimmedName = templateName.trim();
  const nameTaken = trimmedName.length > 0 && templateNameTaken(trimmedName);
  const canSaveTemplate =
    composeCanSaveTemplate(items) && !saving && trimmedName.length > 0 && !nameTaken;
  const showTemplate = items.length > 0 && !hasEstimate;
  const inMealIds = useMemo(() => new Set(items.map((item) => item.food_id)), [items]);
  const searching = query.trim().length > 0;

  const sheetHeight =
    rootHeight > 0
      ? Math.floor(
          sheetLayout({
            windowHeight: rootHeight,
            keyboardHeight: lift,
            insetBottom: 0,
            insetTop: insets.top,
            contentHeight: 0,
            maxHeightRatio: lift > 0 ? SHEET_RATIO_KEYBOARD : SHEET_RATIO,
          }).sheetMaxHeight
        )
      : undefined;
  // Tablet: the rest of the screen is no use to a 560-wide strip, so the sheet
  // stops at TABLET_SHEET_MAX_HEIGHT and scrolls inside (phone: unchanged).
  // Tablet dialog (>= 700 wide): 85% of the window, less what the keyboard and
  // the status bar take (lib/sheetLayout.ts dialogHeights); the list scrolls.
  const dialogRoom = rootHeight > 0 ? rootHeight - lift : undefined;
  const dialogClearance = Math.max(DIALOG_CLEARANCE, 2 * insets.top);
  const sheetHeightCapped =
    isDialog && rootHeight > 0
      ? dialogHeights(rootHeight, dialogRoom, dialogClearance).maxHeight
      : sheetHeight != null && isWide
        ? Math.min(sheetHeight, TABLET_SHEET_MAX_HEIGHT)
        : sheetHeight;

  return (
    <View
      ref={rootRef}
      style={[StyleSheet.absoluteFill, { zIndex: 200 }]}
      onLayout={(e) => {
        setRootHeight(e.nativeEvent.layout.height);
        if (keyboardTopRef.current !== null) recomputeLift();
      }}
      accessibilityViewIsModal
      importantForAccessibility="yes"
      onAccessibilityEscape={onClose}
    >
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: anim }]}>
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: SCRIM }]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t("common.cancel")}
        />
      </Animated.View>
      <View
        style={{ flex: 1, justifyContent: "flex-end", paddingBottom: lift }}
        pointerEvents="box-none"
      >
        <Animated.View
          style={[
            {
              height: sheetHeightCapped ?? "92%",
              transform: [
                { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) },
              ],
            },
            sheetBoxStyle(layoutWidth, isWide, layoutHeight, dialogRoom, false, { clearance: dialogClearance }),
          ]}
        >
          {/* flex 1 (grow AND shrink) keeps the pinned save button on screen
              when the content is taller than the sheet (095bb59). */}
          <Pressable
            className="rounded-t-3xl border-t border-x border-hair px-4 pt-3"
            style={[{ backgroundColor: THEME.bg.g1, flex: 1 }, isDialog ? dialogCardStyle : null]}
            onPress={(e) => e.stopPropagation()}
            accessible={false}
            focusable={false}
            importantForAccessibility="auto"
          >
            <View className="items-center mb-2">
              <View className="w-10 h-1 rounded-full bg-hair" />
            </View>

            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
              <Text
                accessibilityRole="header"
                numberOfLines={2}
                style={{ color: THEME.text, fontSize: 17, fontWeight: "800", flex: 1 }}
              >
                {t("mealCompose.title")}
              </Text>
              <Pressable
                onPress={onClose}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel={t("common.close")}
                style={{
                  minWidth: HIT_TARGET,
                  minHeight: HIT_TARGET,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons name="close" size={22} color={THEME.textMuted} />
              </Pressable>
            </View>

            <LiveTotalHeader totalG={totals.carbs_g} targetG={targetG} todayG={todayG} />

            <ScrollView
              ref={scrollRef}
              {...keyboardAwareScrollProps}
              // The sheet lifts itself above the keyboard (lift); iOS adjusting
              // the inset as well would compensate twice.
              automaticallyAdjustKeyboardInsets={false}
              style={{ flex: 1, marginTop: 12 }}
              contentContainerStyle={{ paddingBottom: 28 }}
              showsVerticalScrollIndicator={false}
              onScroll={scrollHint.onScroll}
              onContentSizeChange={scrollHint.onContentSizeChange}
              onLayout={scrollHint.onLayout}
              scrollEventThrottle={scrollHint.scrollEventThrottle}
            >
              <FoodSearchBlock
                query={query}
                onQueryChange={setQuery}
                results={results}
                recents={recents}
                favorites={favorites}
                starters={starters}
                lang={lang}
                onPick={(food) => void addFood(food)}
                inMealIds={inMealIds}
              />

              {items.length === 0 && !searching ? (
                <Text
                  style={{ color: THEME.textMuted, fontSize: 13, lineHeight: 18, marginTop: 14 }}
                >
                  {t("mealCompose.empty")}
                </Text>
              ) : null}

              {items.length > 0 ? (
                <View style={{ marginTop: 14 }}>
                  {items.map((item) =>
                    item.estimate ? (
                      <EstimateResultCard
                        key={item.key}
                        line={drafts[item.key] ?? estimateToEditable(item)}
                        onChange={(next) => onEstimateChange(item, next)}
                        onRemove={() => {
                          const next = removeComposeItem(itemsRef.current, item.key);
                          setDrafts((prev) => pruneDrafts(prev, next));
                          onChange(next);
                        }}
                      />
                    ) : (
                      <FoodCard
                        key={item.key}
                        item={item}
                        chips={portionViews[item.food_id]?.chips ?? []}
                        gramOpen={gramOpen[item.key] === true}
                        entryUnit={entryUnit[item.key] ?? "g"}
                        units={{ system: unitSystem, gPerFlOz: portionViews[item.food_id]?.gPerFlOz }}
                        onChip={(chip) => onChip(item, chip)}
                        onGrams={(grams) =>
                          onChange(setComposePortion(itemsRef.current, item.key, grams))
                        }
                        onGramsClose={() => setGramOpen((prev) => ({ ...prev, [item.key]: false }))}
                        onRemove={() => onChange(removeComposeItem(itemsRef.current, item.key))}
                      />
                    )
                  )}
                </View>
              ) : null}

              {onEstimate ? (
                <View style={{ marginTop: 4 }}>
                  <Button
                    variant="outlined"
                    label={t("carbEstimate.entryButton")}
                    onPress={onEstimate}
                    icon={<Ionicons name="sparkles-outline" size={18} color={THEME.accent} />}
                  />
                </View>
              ) : null}

              {showTemplate ? (
                namingTemplate ? (
                  <View style={{ marginTop: 12 }}>
                    <TextInput
                      value={templateName}
                      onChangeText={setTemplateName}
                      onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd(), 120)}
                      placeholder={t("mealCompose.templateName")}
                      placeholderTextColor={THEME.textMuted}
                      maxLength={60}
                      returnKeyType="done"
                      accessibilityLabel={t("mealCompose.templateName")}
                      style={[
                        INPUT_TEXT,
                        {
                          minHeight: HIT_TARGET,
                          color: THEME.text,
                          fontSize: 14,
                          borderRadius: 16,
                          borderWidth: 1,
                          borderColor: THEME.border,
                          backgroundColor: THEME.surface,
                          paddingHorizontal: 14,
                        },
                      ]}
                    />
                    {nameTaken ? (
                      <Text style={{ color: THEME.textMuted, fontSize: 11, marginTop: 6 }}>
                        {t("mealCompose.templateNameTaken")}
                      </Text>
                    ) : null}
                    <View style={{ marginTop: 8 }}>
                      <Button
                        variant="outlined"
                        label={t("mealCompose.saveTemplate")}
                        disabled={!canSaveTemplate}
                        onPress={() => canSaveTemplate && onSaveTemplate(trimmedName)}
                      />
                    </View>
                  </View>
                ) : (
                  <View style={{ marginTop: 4 }}>
                    <Button
                      variant="tertiary"
                      label={t("mealCompose.saveTemplate")}
                      disabled={!composeCanSaveTemplate(items) || saving}
                      onPress={() => setNamingTemplate(true)}
                    />
                  </View>
                )
              ) : null}
            </ScrollView>
            <ScrollHint visible={scrollHint.visible} bottomOffset={hintBottomOffset({})} />

            <View style={{ paddingTop: 10, paddingBottom: lift > 0 ? 12 : insets.bottom + 12 }}>
              <Button
                label={t("mealCompose.saveWithTotal", { value: num(totals.carbs_g) })}
                disabled={!canSave}
                loading={saving}
                onPress={onSave}
              />
            </View>
          </Pressable>
        </Animated.View>
      </View>
    </View>
  );
}
