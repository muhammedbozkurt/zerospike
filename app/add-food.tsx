import React, { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { useApp } from "../lib/store/AppContext";
import { addCustomFood } from "../lib/db/foods";
import { canAddCustomFood } from "../lib/guardrails";
import { Button, Field } from "../components/ui";

export default function AddFoodScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { barcode } = useLocalSearchParams<{ barcode?: string }>();
  const { isProUser, bumpData } = useApp();

  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [carb, setCarb] = useState("");
  const [gi, setGi] = useState("");
  const [portion, setPortion] = useState("100");
  const [notes, setNotes] = useState("");
  const [allowed, setAllowed] = useState(true);

  useEffect(() => {
    (async () => setAllowed(await canAddCustomFood(isProUser)))();
  }, [isProUser]);

  const valid =
    name.trim().length > 0 &&
    Number.isFinite(parseFloat(carb.replace(",", ".")));

  async function save() {
    if (!allowed) {
      router.replace({ pathname: "/paywall", params: { reason: "foods" } });
      return;
    }
    if (!valid) return;
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
    router.back();
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      className="flex-1 bg-zinc-950"
      style={{ paddingTop: insets.top }}
    >
      <View className="flex-row items-center justify-between px-4 py-3 border-b border-zinc-900">
        <Text className="text-zinc-50 text-lg font-bold flex-1">
          {t("food.addCustom")}
        </Text>
        <Pressable onPress={() => router.back()} hitSlop={10} className="p-1">
          <Ionicons name="close" size={24} color="#a1a1aa" />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {!allowed ? (
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

        {barcode ? (
          <View className="rounded-2xl bg-zinc-900 border border-zinc-800 p-3.5 mb-4 flex-row items-center">
            <Ionicons name="barcode-outline" size={18} color="#22d3ee" />
            <Text className="text-zinc-300 ml-3 font-mono">{barcode}</Text>
          </View>
        ) : null}

        <Field
          label={t("food.name")}
          value={name}
          onChangeText={setName}
          placeholder="—"
          autoFocus
        />
        <Field
          label={t("food.brand")}
          value={brand}
          onChangeText={setBrand}
          placeholder="—"
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
          placeholder="—"
        />

        <View className="h-2" />
        <Button
          label={t("food.addFood")}
          size="lg"
          disabled={!valid}
          onPress={save}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
