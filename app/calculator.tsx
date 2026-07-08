import React, { useEffect, useMemo, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Slider from "@react-native-community/slider";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { useApp } from "../lib/store/AppContext";
import { getFood } from "../lib/db/foods";
import { addMealLog } from "../lib/db/logs";
import { canAddLog } from "../lib/guardrails";
import { logEvent } from "../lib/analytics";
import {
  estimateInsulin,
  activeMealSlot,
  type InsulinWarning,
} from "../lib/insulin";
import { activeInsulin } from "../lib/iob";
import { getInjections } from "../lib/db/injections";
import { glucoseFromDisplay, glucoseUnitLabel } from "../lib/glucose";
import { schedulePostMealReminder } from "../lib/services/notifications";
import type { Food, LogTag, MealSlot } from "../lib/db/types";
import { foodName } from "../lib/db/types";
import { Button, Segmented } from "../components/ui";
import { TagPicker } from "../components/TagPicker";
import { useFeedback } from "../components/Feedback";
import { num } from "../lib/format";
import { hapticSuccess, hapticWarning } from "../lib/haptics";

const SLOTS: MealSlot[] = ["breakfast", "lunch", "dinner"];

/** Maps an estimate warning to its calculator i18n key. */
const WARN_KEY: Record<InsulinWarning, string> = {
  high_dose: "warnHighDose",
  carb_ratio_out_of_range: "warnRatio",
  isf_out_of_range: "warnIsf",
};

export default function CalculatorScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { foodId, portion: portionParam } = useLocalSearchParams<{
    foodId?: string;
    portion?: string;
  }>();
  const { activeProfile, isProUser, lang, bumpData, dataVersion } = useApp();
  const { actionSheet } = useFeedback();

  const [food, setFood] = useState<Food | null>(null);
  const [portion, setPortion] = useState(100);
  const [slot, setSlot] = useState<MealSlot>(activeMealSlot());
  const [glucose, setGlucose] = useState("");
  const [doseText, setDoseText] = useState("");
  const [doseTouched, setDoseTouched] = useState(false);
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [tags, setTags] = useState<LogTag[]>([]);
  const [iob, setIob] = useState(0);

  useEffect(() => {
    (async () => {
      if (!foodId) return;
      const f = await getFood(foodId);
      if (f) {
        setFood(f);
        // Prefill the portion from a one-tap "recent meal" re-log, else default.
        const p = Number(portionParam);
        setPortion(Number.isFinite(p) && p > 0 ? p : f.portion_size_g || 100);
      }
    })();
  }, [foodId, portionParam]);

  // Active insulin (IOB) from recent bolus doses — used to trim the correction
  // so a fresh dose doesn't stack on top of insulin that is still working.
  useEffect(() => {
    (async () => {
      if (!activeProfile) return;
      const injections = await getInjections(activeProfile.id, 100);
      setIob(activeInsulin(injections));
    })();
  }, [activeProfile, dataVersion]);

  const unit = activeProfile?.glucose_unit ?? "mgdl";

  const estimate = useMemo(() => {
    if (!food || !activeProfile) return null;
    const g = parseFloat(glucose);
    return estimateInsulin(food, portion, activeProfile, {
      slot,
      currentGlucose: Number.isFinite(g) ? glucoseFromDisplay(g, unit) : null,
      currentIOB: iob,
    });
  }, [food, activeProfile, portion, slot, glucose, unit, iob]);

  // Keep the manual dose synced to the estimate until the user edits it.
  useEffect(() => {
    if (estimate && !doseTouched) setDoseText(num(estimate.totalDose));
  }, [estimate, doseTouched]);

  async function pickPhoto(fromCamera: boolean) {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;

    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.5 })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.5 });

    if (result.canceled || !result.assets?.[0]) return;
    const src = result.assets[0].uri;
    // Copy into the app sandbox for fully-offline persistence.
    try {
      const dest = `${FileSystem.documentDirectory}meal_${Date.now()}.jpg`;
      await FileSystem.copyAsync({ from: src, to: dest });
      setPhoto(dest);
    } catch {
      setPhoto(src);
    }
  }

  function choosePhoto() {
    actionSheet({
      title: t("calculator.addPhoto"),
      actions: [
        {
          label: t("calculator.takePhoto"),
          icon: "camera-outline",
          onPress: () => pickPhoto(true),
        },
        {
          label: t("calculator.choosePhoto"),
          icon: "images-outline",
          onPress: () => pickPhoto(false),
        },
      ],
    });
  }

  async function logMeal() {
    if (!food || !activeProfile || !estimate) return;
    const allowed = await canAddLog(activeProfile.id, isProUser);
    if (!allowed) {
      hapticWarning();
      router.replace({ pathname: "/paywall", params: { reason: "logs" } });
      return;
    }
    const dose = parseFloat(doseText.replace(",", ".")) || estimate.totalDose;
    await addMealLog({
      profile_id: activeProfile.id,
      food_id: food.id,
      custom_food_name: null,
      portion_g: portion,
      calculated_carbs_g: estimate.carbs,
      insulin_dose_units: dose,
      photo_uri_local: photo,
      personal_note: note.trim() || null,
      tags,
    });
    logEvent("log_added", { kind: "meal", source: "manual" });
    hapticSuccess();
    // Logging a meal schedules the 2-hour post-meal glucose check reminder.
    await schedulePostMealReminder();
    bumpData();
    router.back();
  }

  if (!food || !estimate) {
    return (
      <View className="flex-1 bg-black items-center justify-center">
        <Text className="text-zinc-500">{t("common.loading")}</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      className="flex-1 bg-zinc-950"
      style={{ paddingTop: insets.top }}
    >
      {/* Header */}
      <View className="flex-row items-center justify-between px-4 py-3 border-b border-zinc-900">
        <Text className="text-zinc-50 text-lg font-bold flex-1" numberOfLines={1}>
          {t("calculator.title")}
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
        {/* Food summary */}
        <View className="rounded-2xl bg-zinc-900 border border-zinc-800 p-4 mb-4">
          <Text className="text-zinc-50 text-xl font-bold">
            {foodName(food, lang)}
          </Text>
          <Text className="text-zinc-400 text-sm mt-0.5">
            {num(food.carb_100g)} {t("common.grams")}/100g · {t("food.gi")}{" "}
            {food.glycemic_index} · {t("food.gl")} {food.glycemic_load}
          </Text>
        </View>

        {/* Active meal slot */}
        <Text className="text-sm font-medium text-zinc-400 mb-2">
          {t("calculator.activeSlot")}
        </Text>
        <Segmented
          options={SLOTS.map((s) => ({ value: s, label: t(`slot.${s}`) }))}
          value={slot}
          onChange={setSlot}
          className="mb-5"
        />

        {/* Portion slider */}
        <View className="flex-row items-center justify-between mb-1">
          <Text className="text-sm font-medium text-zinc-400">
            {t("calculator.portion")}
          </Text>
          <Text className="text-zinc-50 font-bold text-lg">
            {Math.round(portion)} {t("common.grams")}
          </Text>
        </View>
        <Slider
          minimumValue={0}
          maximumValue={500}
          step={5}
          value={portion}
          onValueChange={setPortion}
          minimumTrackTintColor="#22d3ee"
          maximumTrackTintColor="#3f3f46"
          thumbTintColor="#22d3ee"
        />

        {/* Optional current glucose for correction */}
        <View className="mt-4">
          <Text className="text-sm font-medium text-zinc-400 mb-1.5">
            {t("calculator.currentGlucose")} ({glucoseUnitLabel(unit)})
          </Text>
          <TextInput
            value={glucose}
            onChangeText={(s) =>
              setGlucose(
                unit === "mmol"
                  ? s.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1")
                  : s.replace(/[^0-9]/g, "")
              )
            }
            keyboardType={unit === "mmol" ? "decimal-pad" : "number-pad"}
            placeholder="-"
            placeholderTextColor="#52525b"
            maxLength={unit === "mmol" ? 4 : 3}
            className="rounded-xl bg-zinc-800/80 border border-zinc-700 px-4 py-3 text-zinc-50"
          />
        </View>

        {/* Estimated dose card */}
        <View className="rounded-2xl bg-brand/10 border border-brand/30 p-4 my-5">
          <Text className="text-brand text-xs font-semibold uppercase tracking-wider">
            {t("calculator.estimatedDose")}
          </Text>

          <View className="flex-row justify-between mt-3">
            <Text className="text-zinc-400 text-sm">
              {t("calculator.estCarbs")}
            </Text>
            <Text className="text-zinc-100 font-medium">
              {num(estimate.carbs)} {t("common.grams")}
            </Text>
          </View>
          <View className="flex-row justify-between mt-1.5">
            <Text className="text-zinc-400 text-sm">
              {t("calculator.mealDose")}
            </Text>
            <Text className="text-zinc-100 font-medium">
              {num(estimate.mealDose)} {t("common.units")}
            </Text>
          </View>
          {estimate.correctionDose > 0 ? (
            <View className="flex-row justify-between mt-1.5">
              <Text className="text-zinc-400 text-sm">
                {t("calculator.correctionDose")}
              </Text>
              <Text className="text-zinc-100 font-medium">
                {num(estimate.correctionDose)} {t("common.units")}
              </Text>
            </View>
          ) : null}
          {iob > 0 ? (
            <View className="flex-row justify-between mt-1.5">
              <Text className="text-zinc-400 text-sm">
                {t("calculator.activeInsulin")}
              </Text>
              <Text className="text-zinc-100 font-medium">
                {num(iob)} {t("common.units")}
              </Text>
            </View>
          ) : null}
          {estimate.iobReduction > 0 ? (
            <View className="flex-row justify-between mt-1.5">
              <Text className="text-emerald-300/90 text-sm">
                {t("calculator.iobReduction")}
              </Text>
              <Text className="text-emerald-300 font-medium">
                -{num(estimate.iobReduction)} {t("common.units")}
              </Text>
            </View>
          ) : null}

          <View className="h-px bg-brand/20 my-3" />
          <View className="flex-row justify-between items-center">
            <Text className="text-zinc-300 font-semibold flex-1 pr-3">
              {t("calculator.totalDose")}
            </Text>
            <View className="flex-row items-baseline">
              {/* Explicit lineHeight so the bold 30px glyphs aren't clipped at the top */}
              <Text
                className="text-brand font-bold"
                style={{ fontSize: 30, lineHeight: 40 }}
              >
                {estimate.totalDose === 0 &&
                (estimate.mealDose > 0 || estimate.correctionDose > 0)
                  ? "< 0.5"
                  : num(estimate.totalDose)}
              </Text>
              <Text className="text-brand text-base font-medium">
                {" "}
                {t("common.units")}
              </Text>
            </View>
          </View>
          <Text className="text-brand/60 text-xs mt-2">
            {t("calculator.overrideHint")}
          </Text>
          <Pressable
            onPress={() => router.push("/sources")}
            hitSlop={8}
            className="flex-row items-center mt-3"
          >
            <Ionicons name="information-circle-outline" size={14} color="#22d3ee" />
            <Text className="text-brand text-xs underline ml-1">
              {t("sources.calcLink")}
            </Text>
          </Pressable>
        </View>

        {/* Plausibility warnings — non-blocking; the dose stays editable */}
        {estimate.warnings.length > 0 ? (
          <View className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3.5 mb-4">
            {estimate.warnings.map((w, i) => (
              <View
                key={w}
                className={`flex-row items-start ${i > 0 ? "mt-2" : ""}`}
              >
                <Ionicons name="warning-outline" size={15} color="#fb7185" />
                <Text className="text-rose-200/90 text-xs leading-4 ml-2.5 flex-1">
                  {t(`calculator.${WARN_KEY[w]}`)}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* Manual dose override */}
        <Text className="text-sm font-medium text-zinc-400 mb-1.5">
          {t("calculator.manualDose")}
        </Text>
        <TextInput
          value={doseText}
          onChangeText={(s) => {
            setDoseTouched(true);
            setDoseText(s.replace(/[^0-9.,]/g, ""));
          }}
          keyboardType="decimal-pad"
          className="rounded-xl bg-zinc-800/80 border border-zinc-700 px-4 py-3 text-zinc-50 mb-4"
        />

        {/* Photo */}
        {photo ? (
          <View className="mb-4">
            <Image source={{ uri: photo }} className="w-full h-44 rounded-2xl" />
            <Pressable
              onPress={() => setPhoto(null)}
              className="absolute top-2 right-2 bg-black/70 rounded-full p-1.5"
            >
              <Ionicons name="trash-outline" size={16} color="#fda4af" />
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPress={choosePhoto}
            className="flex-row items-center justify-center rounded-2xl border border-dashed border-zinc-700 py-4 mb-4"
          >
            <Ionicons name="camera-outline" size={18} color="#a1a1aa" />
            <Text className="text-zinc-400 ml-2">{t("calculator.addPhoto")}</Text>
          </Pressable>
        )}

        {/* Personal note */}
        <Text className="text-sm font-medium text-zinc-400 mb-1.5">
          {t("calculator.personalNote")}
        </Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder={t("calculator.notePlaceholder")}
          placeholderTextColor="#52525b"
          multiline
          className="rounded-xl bg-zinc-800/80 border border-zinc-700 px-4 py-3 text-zinc-50 mb-4 min-h-[72px]"
          textAlignVertical="top"
        />

        <TagPicker value={tags} onChange={setTags} className="mb-6" />

        {/* Medical disclaimer at the decision point */}
        <View className="flex-row items-start rounded-xl border border-amber-500/25 bg-amber-500/10 px-3.5 py-3 mb-4">
          <Ionicons name="medical-outline" size={15} color="#f59e0b" />
          <Text className="text-amber-200/80 text-xs leading-4 ml-2.5 flex-1">
            {t("disclaimer.short")}
          </Text>
        </View>

        <Button label={t("calculator.logMeal")} size="lg" onPress={logMeal} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
