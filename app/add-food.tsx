import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { AppBackgroundFill } from "../components/rich";
import { useTranslation } from "react-i18next";

import { useApp } from "../lib/store/AppContext";
import { addCustomFood, getFood, updateFood } from "../lib/db/foods";
import { canAddCustomFood } from "../lib/guardrails";
import { Button, Field } from "../components/ui";
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
  const [carb, setCarb] = useState("");
  const [gi, setGi] = useState("");
  const [portion, setPortion] = useState("100");
  const [notes, setNotes] = useState("");
  const [allowed, setAllowed] = useState(true);
  const [loadedBarcode, setLoadedBarcode] = useState<string | null>(null);

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
      setCarb(String(f.carb_100g));
      setGi(f.glycemic_index > 0 ? String(f.glycemic_index) : "");
      setPortion(String(f.portion_size_g));
      setNotes(f.custom_notes ?? "");
      setLoadedBarcode(f.barcode);
    })();
  }, [isEdit, foodId]);

  const valid =
    name.trim().length > 0 &&
    Number.isFinite(parseFloat(carb.replace(",", ".")));

  async function save() {
    if (!valid) return;

    if (isEdit && foodId) {
      // Barcode stays as stored; everything else follows the form.
      await updateFood(foodId, {
        name: name.trim(),
        brand_name: brand.trim() || null,
        carb_100g: parseFloat(carb.replace(",", ".")) || 0,
        glycemic_index: parseInt(gi, 10) || 0,
        portion_size_g: parseFloat(portion.replace(",", ".")) || 100,
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
      carb_100g: parseFloat(carb.replace(",", ".")) || 0,
      glycemic_index: parseInt(gi, 10) || 0,
      portion_size_g: parseFloat(portion.replace(",", ".")) || 100,
      barcode: barcode ?? null,
      custom_notes: notes.trim() || null,
    });
    bumpData();
    toast(t("food.saved"), "success");
    router.back();
  }

  return (
    <View className="flex-1">
      <AppBackgroundFill />
      <View className="flex-1" style={{ paddingTop: insets.top }}>
        <View className="flex-row items-center justify-between px-4 py-3 border-b border-zinc-900">
          <Text className="text-zinc-50 text-lg font-bold flex-1">
            {isEdit ? t("food.editCustom") : t("food.addCustom")}
          </Text>
          <Pressable onPress={() => router.back()} hitSlop={10} className="p-1">
            <Ionicons name="close" size={24} color="#a1a1aa" />
          </Pressable>
        </View>

        <ScrollView
          {...keyboardAwareScrollProps}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}
          showsVerticalScrollIndicator={false}
        >
          {!allowed && !isEdit ? (
            <Pressable
              onPress={() => router.replace({ pathname: "/paywall", params: { reason: "foods" } })}
              className="rounded-2xl bg-amber-500/10 border border-amber-500/30 p-4 mb-4 flex-row items-center"
            >
              <Ionicons name="lock-closed-outline" size={18} color="#f59e0b" />
              <Text className="text-amber-200 text-sm ml-3 flex-1">
                {t("paywall.limitTitleFoods")}
              </Text>
            </Pressable>
          ) : null}

          {barcode || loadedBarcode ? (
            <View className="rounded-2xl bg-glass border border-hair p-3.5 mb-4 flex-row items-center">
              <Ionicons name="barcode-outline" size={18} color="#2ee6ff" />
              <Text className="text-zinc-300 ml-3 font-mono">
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
          />
          <Field
            label={t("food.brand")}
            value={brand}
            onChangeText={setBrand}
            placeholder="-"
          />
          <Field
            label={t("food.carbs")}
            value={carb}
            onChangeText={setCarb}
            keyboardType="decimal-pad"
            placeholder="0"
          />
          <Field
            label={t("food.gi")}
            value={gi}
            onChangeText={setGi}
            keyboardType="number-pad"
            placeholder="0"
          />
          <Field
            label={t("food.portionSize")}
            value={portion}
            onChangeText={setPortion}
            keyboardType="decimal-pad"
            placeholder="100"
          />
          <Field
            label={t("food.notes")}
            value={notes}
            onChangeText={setNotes}
            placeholder="-"
          />

          <View className="h-2" />
          <Button
            label={isEdit ? t("common.save") : t("food.addFood")}
            size="lg"
            disabled={!valid}
            onPress={save}
          />
        </ScrollView>
      </View>
      <FeedbackHost />
    </View>
  );
}
