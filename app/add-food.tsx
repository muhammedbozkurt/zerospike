import React, { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { AppBackground, GradientCTA } from "../components/rich";
import { withAlpha } from "../components/rich/GlassCard";
import { ScreenHeader } from "../components/ScreenHeader";
import { GLUCOSE_RICH, TABULAR, THEME } from "../lib/theme/tokens";
import { useTranslation } from "react-i18next";

import { useApp } from "../lib/store/AppContext";
import { addCustomFood, getFood, updateFood } from "../lib/db/foods";
import { canAddCustomFood } from "../lib/guardrails";
import { Field } from "../components/ui";
import { Stepper } from "../components/Stepper";
import { FeedbackHost, useFeedback } from "../components/Feedback";
import { keyboardAwareScrollProps } from "../lib/keyboard";

export default function AddFoodScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { barcode, foodId } = useLocalSearchParams<{
    barcode?: string;
    foodId?: string;
  }>();
  const { isProUser, bumpData } = useApp();
  const { toast } = useFeedback();

  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  // Carbs (per 100 g) and portion are stepper-driven numbers (also typeable).
  const [carb, setCarb] = useState(0);
  const [gi, setGi] = useState("");
  const [portion, setPortion] = useState(100);
  const [notes, setNotes] = useState("");
  const [allowed, setAllowed] = useState(true);
  const [loadedBarcode, setLoadedBarcode] = useState<string | null>(null);

  // Return-key focus chain across the text fields (E.8): name -> brand -> gi ->
  // notes. Carbs/portion are steppers and sit outside the keyboard chain.
  const brandRef = useRef<TextInput>(null);
  const giRef = useRef<TextInput>(null);
  const notesRef = useRef<TextInput>(null);

  // Editing an existing custom food. The free-tier cap gates ADDING only;
  // correcting a food the user already owns is always allowed.
  const isEdit = typeof foodId === "string" && foodId.length > 0;

  useEffect(() => {
    (async () => setAllowed(await canAddCustomFood(isProUser)))();
  }, [isProUser]);

  // Edit mode: prefill from the stored food. Only custom rows are editable;
  // seeded catalog and cached barcode rows never reach here (guarded again in
  // updateFood). Custom foods carry the same name in every language column,
  // so name_tr is the canonical one.
  useEffect(() => {
    (async () => {
      if (!isEdit || !foodId) return;
      const f = await getFood(foodId);
      if (!f || f.is_custom !== 1) return;
      setName(f.name_tr);
      setBrand(f.brand_name ?? "");
      setCarb(f.carb_100g);
      setGi(f.glycemic_index > 0 ? String(f.glycemic_index) : "");
      setPortion(f.portion_size_g);
      setNotes(f.custom_notes ?? "");
      setLoadedBarcode(f.barcode);
    })();
  }, [isEdit, foodId]);

  const valid = name.trim().length > 0;

  async function save() {
    if (!valid) return;

    if (isEdit && foodId) {
      // Barcode stays as stored; everything else follows the form.
      await updateFood(foodId, {
        name: name.trim(),
        brand_name: brand.trim() || null,
        carb_100g: carb || 0,
        glycemic_index: parseInt(gi, 10) || 0,
        portion_size_g: portion || 100,
        custom_notes: notes.trim() || null,
      });
      bumpData();
      toast(t("food.saved"), "success");
      router.back();
      return;
    }

    if (!allowed) {
      router.replace({ pathname: "/paywall", params: { reason: "foods" } });
      return;
    }
    await addCustomFood({
      name: name.trim(),
      brand_name: brand.trim() || null,
      carb_100g: carb || 0,
      glycemic_index: parseInt(gi, 10) || 0,
      portion_size_g: portion || 100,
      barcode: barcode ?? null,
      custom_notes: notes.trim() || null,
    });
    bumpData();
    toast(t("food.saved"), "success");
    router.back();
  }

  return (
    <AppBackground>
      <View className="flex-1" style={{ paddingTop: Platform.OS === "ios" ? 8 : insets.top }}>
        {/* Header (mockup 04: close, centred title, balancing spacer) */}
        <ScreenHeader
          title={isEdit ? t("food.editCustom") : t("food.addCustom")}
          onBack={() => router.back()}
          backIcon="close"
          accessibilityLabel={t("common.close")}
        />

        <ScrollView
          {...keyboardAwareScrollProps}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}
          showsVerticalScrollIndicator={false}
        >
          {!allowed && !isEdit ? (
            <Pressable
              onPress={() => router.replace({ pathname: "/paywall", params: { reason: "foods" } })}
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
            onChangeText={setGi}
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
              min={0}
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

          <View className="h-2" />
          <GradientCTA
            label={isEdit ? t("common.save") : t("food.addFood")}
            disabled={!valid}
            onPress={save}
          />
        </ScrollView>
      </View>
      <FeedbackHost />
    </AppBackground>
  );
}
