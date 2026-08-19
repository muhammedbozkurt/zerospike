import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View, Platform } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { AppBackground, GradientCTA, IconTile } from "../components/rich";
import { withAlpha } from "../components/rich/GlassCard";
import { ScreenHeader } from "../components/ScreenHeader";
import { GLUCOSE_RICH, HIT_TARGET, MODAL_TOP_PAD, TABULAR, THEME } from "../lib/theme/tokens";
import { useTranslation } from "react-i18next";

import { useApp } from "../lib/store/AppContext";
import { addCustomFood, getFood, updateFood } from "../lib/db/foods";
import {
  DEFAULT_FOOD_CATEGORY,
  FOOD_CATEGORIES,
  categoryEmoji,
  isFoodCategory,
  type FoodCategory,
} from "../lib/db/categories";
import { categoryTileIcon } from "../components/FoodPlate";
import { canAddCustomFood } from "../lib/guardrails";
import { logCrash } from "../lib/analytics";
import { Field } from "../components/ui";
import { Stepper } from "../components/Stepper";
import { FeedbackHost, useFeedback } from "../components/Feedback";
import { keyboardAwareScrollProps } from "../lib/keyboard";
import { hapticSelect } from "../lib/haptics";
import { useLayout } from "../lib/useLayout";
import { sanitizeIntegerText } from "../lib/numberInput";

/** Glycemic index clamp (UX#23): 0-110 covers the standard GI scale (pure
 *  glucose = 100) with headroom, and keeps a mistyped value from reaching the
 *  dose estimate as a wildly implausible number. */
const GI_MIN = 0;
const GI_MAX = 110;

function AddFoodScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { barcode, foodId } = useLocalSearchParams<{
    barcode?: string;
    foodId?: string;
  }>();
  const { isProUser, bumpData } = useApp();
  const { toast } = useFeedback();
  const { columnPad } = useLayout();

  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  // Carbs (per 100 g) and portion are stepper-driven numbers (also typeable).
  const [carb, setCarb] = useState(0);
  const [gi, setGi] = useState("");
  const [portion, setPortion] = useState(100);
  const [notes, setNotes] = useState("");
  // The shelf this food is filed on. It decides the plate the food is drawn
  // with everywhere, which is why it is asked for here: every hand-typed and
  // scanned food used to land on the unclassified shelf and so every one of
  // them showed the same picture.
  const [category, setCategory] = useState<FoodCategory>(DEFAULT_FOOD_CATEGORY);
  // null = not checked yet. Starting at true (or false) draws a guess before
  // the DB has answered; a user over the free limit would see the form with no
  // banner for a frame, then have it shove the fields down once it appears.
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [loadedBarcode, setLoadedBarcode] = useState<string | null>(null);
  // Mirrors `allowed === null` on the add path: the edit path's fields come
  // from an async getFood, so the form must not commit to its final shape
  // (risking a prefill landing on top of what the user already typed) until
  // that read has settled - success, "not found", or error alike.
  const [foodLoaded, setFoodLoaded] = useState(false);

  // Return-key focus chain across the text fields (E.8): name -> brand -> gi ->
  // notes. Carbs/portion are steppers and sit outside the keyboard chain.
  const brandRef = useRef<TextInput>(null);
  const giRef = useRef<TextInput>(null);
  const notesRef = useRef<TextInput>(null);

  // Editing an existing custom food. The free-tier cap gates ADDING only;
  // correcting a food the user already owns is always allowed, so edit mode
  // never needs the limit check and is never held back by it.
  const isEdit = typeof foodId === "string" && foodId.length > 0;

  useEffect(() => {
    if (isEdit) return;
    let alive = true;
    (async () => {
      try {
        const ok = await canAddCustomFood(isProUser);
        if (alive) setAllowed(ok);
      } catch (err) {
        logCrash(err, { screen: "add-food", load: "limit" });
        // Fail closed: worst case a rare DB error sends save() to the
        // paywall instead of through, which is recoverable - the alternative
        // (stuck on null forever) never resolves this screen at all.
        if (alive) setAllowed(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [isProUser, isEdit]);

  // Edit mode: prefill from the stored food. Custom rows and cached barcode
  // results (source "off") are editable; the seeded catalog never reaches
  // here (guarded again in updateFood). Both write every language column to
  // the same typed name on save (mirrors addCustomFood), so name_tr is read
  // as the starting value either way.
  useEffect(() => {
    if (!isEdit || !foodId) {
      setFoodLoaded(true);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const f = await getFood(foodId);
        if (!alive || !f || (f.is_custom !== 1 && f.source !== "off")) return;
        setName(f.name_tr);
        setBrand(f.brand_name ?? "");
        setCarb(f.carb_100g);
        setGi(f.glycemic_index > 0 ? String(f.glycemic_index) : "");
        setPortion(f.portion_size_g);
        setNotes(f.custom_notes ?? "");
        setLoadedBarcode(f.barcode);
        // A row written before this field existed (or by a migration's backfill)
        // can hold anything at all, so it is narrowed rather than trusted.
        setCategory(isFoodCategory(f.category) ? f.category : DEFAULT_FOOD_CATEGORY);
      } catch (err) {
        logCrash(err, { screen: "add-food", load: "edit" });
      } finally {
        // Always clears, loaded, missing, or errored - a failed read must not
        // leave the screen stuck on its loading spinner forever.
        if (alive) setFoodLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [isEdit, foodId]);

  const valid = name.trim().length > 0;
  // Both paths hold the form off screen until their async answer is in: the
  // add path waits on the free-tier count (a false banner is worse than a
  // brief spinner), the edit path waits on foodLoaded so the prefill from
  // getFood always lands before the form - and any typing in it - exists.
  const checkingLimit = isEdit ? !foodLoaded : allowed === null;

  /**
   * router.back() is a no-op when this modal is the only route on the stack
   * (reached by a replace() from a screen that was itself the entry point),
   * which strands the user in a modal that saved successfully and then refused
   * to close. Falling back to the food tab both closes it and lands on the
   * screen where the new entry is visible.
   */
  function closeAfterSave() {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/food");
  }

  /** Clamps GI to [0, 110] as the user types, instead of only at save - a
   *  typed 999 used to sail straight through to parseInt with no ceiling. */
  function onGiChange(text: string) {
    const cleaned = sanitizeIntegerText(text);
    if (cleaned === "") {
      setGi("");
      return;
    }
    const clamped = Math.min(GI_MAX, Math.max(GI_MIN, parseInt(cleaned, 10)));
    setGi(String(clamped));
  }

  async function save() {
    if (!valid) return;

    if (isEdit && foodId) {
      // Barcode stays as stored; everything else follows the form. portion is
      // written as entered - the Stepper's own min (1) is what keeps it off
      // zero, not a silent `|| 100` here that used to also overwrite a real 0.
      await updateFood(foodId, {
        name: name.trim(),
        brand_name: brand.trim() || null,
        carb_100g: carb || 0,
        glycemic_index: parseInt(gi, 10) || 0,
        portion_size_g: portion,
        custom_notes: notes.trim() || null,
        category,
      });
      bumpData();
      toast(t("food.saved"), "success");
      closeAfterSave();
      return;
    }

    if (!allowed) {
      // push, not replace: the banner above already offers this same route,
      // and a push here (defense in depth - the CTA below is disabled at the
      // limit) keeps the typed form on the stack instead of destroying it.
      router.push({ pathname: "/paywall", params: { reason: "foods" } });
      return;
    }
    await addCustomFood({
      name: name.trim(),
      brand_name: brand.trim() || null,
      carb_100g: carb || 0,
      glycemic_index: parseInt(gi, 10) || 0,
      portion_size_g: portion,
      barcode: barcode ?? null,
      custom_notes: notes.trim() || null,
      category,
    });
    bumpData();
    toast(t("food.saved"), "success");
    closeAfterSave();
  }

  return (
    <AppBackground>
      <View className="flex-1" style={{ paddingTop: Math.max(insets.top, MODAL_TOP_PAD) }}>
        {/* Header (mockup 04: close, centred title, balancing spacer) */}
        <View style={columnPad()}>
          <ScreenHeader
            title={isEdit ? t("food.editCustom") : t("food.addCustom")}
            onBack={() => router.back()}
            backIcon="close"
            accessibilityLabel={t("common.close")}
          />
        </View>

        <ScrollView
          {...keyboardAwareScrollProps}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}
          showsVerticalScrollIndicator={false}
        >
          {checkingLimit ? (
            <View style={[columnPad(), { paddingTop: 60, alignItems: "center" }]}>
              <ActivityIndicator color={THEME.accent} />
            </View>
          ) : (
          <View style={columnPad()}>
            {allowed === false && !isEdit ? (
              <Pressable
                onPress={() => router.push({ pathname: "/paywall", params: { reason: "foods" } })}
                className="rounded-2xl p-4 mb-4 flex-row items-center active:opacity-80"
                style={{
                  borderWidth: 1,
                  borderColor: withAlpha(GLUCOSE_RICH.high, 0.3),
                  backgroundColor: withAlpha(GLUCOSE_RICH.high, 0.1),
                }}
              >
                <Ionicons name="lock-closed-outline" size={18} color={GLUCOSE_RICH.high} />
                <Text style={{ color: THEME.ink, fontSize: 13, marginLeft: 12, flex: 1 }}>
                  {t("paywall.limitTitleFoods")}
                </Text>
              </Pressable>
            ) : null}

            {barcode || loadedBarcode ? (
              <View className="rounded-2xl bg-glass border border-hair p-3.5 mb-4 flex-row items-center">
                <Ionicons name="barcode-outline" size={18} color={THEME.accent} />
                <Text style={[TABULAR, { color: THEME.ink, marginLeft: 12, fontSize: 13 }]}>
                  {barcode ?? loadedBarcode}
                </Text>
              </View>
            ) : null}

            <Field
              label={t("food.name")}
              value={name}
              onChangeText={setName}
              placeholder="-"
              autoFocus
              returnKeyType="next"
              blurOnSubmit={false}
              onSubmitEditing={() => brandRef.current?.focus()}
            />
            <Field
              ref={brandRef}
              label={t("food.brand")}
              value={brand}
              onChangeText={setBrand}
              placeholder="-"
              returnKeyType="next"
              blurOnSubmit={false}
              onSubmitEditing={() => giRef.current?.focus()}
            />

            {/* Category: a plate + a name per shelf, so the choice is made on the
                picture the food will actually carry, not on a word alone. */}
            <View className="mb-4">
              <Text className="text-sm font-medium text-mut mb-2">
                {t("food.category")}
              </Text>
              <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                {FOOD_CATEGORIES.map((c) => {
                  const active = c === category;
                  return (
                    <Pressable
                      key={c}
                      onPress={() => {
                        if (!active) hapticSelect();
                        setCategory(c);
                      }}
                      hitSlop={4}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={t(`category.${c}`)}
                      className="flex-row items-center rounded-full px-2.5 active:opacity-80"
                      style={{
                        minHeight: HIT_TARGET,
                        borderWidth: 1,
                        borderColor: active ? THEME.accent : THEME.border,
                        backgroundColor: active
                          ? withAlpha(THEME.accent, 0.16)
                          : THEME.glass,
                      }}
                    >
                      <IconTile
                        emoji={categoryEmoji(c)}
                        icon={categoryTileIcon(c)}
                        size={24}
                        radius={9}
                        hero={active}
                        tint={active ? THEME.accent : THEME.muted}
                      />
                      <Text
                        numberOfLines={1}
                        style={{
                          color: active ? THEME.accent : THEME.ink,
                          fontSize: 13,
                          fontWeight: active ? "700" : "500",
                          marginLeft: 7,
                          maxWidth: 150,
                        }}
                      >
                        {t(`category.${c}`)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View className="mb-3">
              <Text className="text-sm font-medium text-mut mb-1.5">{t("food.carbs")}</Text>
              <Stepper
                value={carb}
                onChange={setCarb}
                step={1}
                longStep={5}
                min={0}
                max={100}
                decimals={1}
                suffix={t("common.grams")}
                accessibilityLabel={t("food.carbs")}
              />
            </View>
            <Field
              ref={giRef}
              label={t("food.gi")}
              value={gi}
              onChangeText={onGiChange}
              keyboardType="number-pad"
              placeholder="0"
              returnKeyType="next"
              blurOnSubmit={false}
              onSubmitEditing={() => notesRef.current?.focus()}
            />
            <View className="mb-3">
              <Text className="text-sm font-medium text-mut mb-1.5">{t("food.portionSize")}</Text>
              <Stepper
                value={portion}
                onChange={setPortion}
                step={5}
                longStep={25}
                min={1}
                max={2000}
                decimals={0}
                suffix={t("common.grams")}
                accessibilityLabel={t("food.portionSize")}
              />
            </View>
            <Field
              ref={notesRef}
              label={t("food.notes")}
              value={notes}
              onChangeText={setNotes}
              placeholder="-"
              returnKeyType="done"
            />

            <View style={{ height: 12 }} />
            <GradientCTA
              label={isEdit ? t("common.save") : t("food.addFood")}
              // At the free-tier limit, the banner above is the one route to
              // the paywall; Save goes inert instead of also silently routing
              // there itself (which used to blindside a filled-in form).
              disabled={!valid || (!isEdit && allowed === false)}
              onPress={save}
            />
          </View>
          )}
        </ScrollView>
      </View>
      <FeedbackHost />
    </AppBackground>
  );
}

export default function AddFoodRoute() {
  return (
    <SafeAreaProvider>
      <AddFoodScreen />
    </SafeAreaProvider>
  );
}
