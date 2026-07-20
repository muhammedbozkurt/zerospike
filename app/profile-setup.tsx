import React, { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { AppBackgroundFill } from "../components/rich";
import { useTranslation } from "react-i18next";

import { useApp } from "../lib/store/AppContext";
import { updateProfile } from "../lib/db/profiles";
import { scheduleBasalReminder } from "../lib/services/notifications";
import {
  glucoseToDisplay,
  glucoseFromDisplay,
  glucoseUnitLabel,
} from "../lib/glucose";
import { Button } from "../components/ui";
import { FormCard, InputRow, ActionRow } from "../components/form";
import { InlineTimePicker } from "../components/InlineTimePicker";
import { keyboardAwareScrollProps } from "../lib/keyboard";
import { FeedbackHost } from "../components/Feedback";

/**
 * Configure a (usually freshly-created) profile's personal targets. Reuses the
 * onboarding card language so each profile gets its own values instead of
 * silently inheriting defaults.
 */
export default function ProfileSetupScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { activeProfile, bumpData } = useApp();
  // Glucose fields (targets, ISF) are stored in mg/dL but shown/entered in this
  // profile's unit, so a mmol household never sees mg/dL labels or writes mmol
  // numbers into mg/dL columns.
  const unit = activeProfile?.glucose_unit ?? "mgdl";

  const [name, setName] = useState(activeProfile?.name ?? "Profil");
  const [fasting, setFasting] = useState(
    String(glucoseToDisplay(activeProfile?.target_fasting_max ?? 100, unit))
  );
  const [postmeal, setPostmeal] = useState(
    String(glucoseToDisplay(activeProfile?.target_postmeal_max ?? 140, unit))
  );
  const [crB, setCrB] = useState(
    String(activeProfile?.carb_ratio_breakfast ?? 10)
  );
  const [crL, setCrL] = useState(String(activeProfile?.carb_ratio_lunch ?? 12));
  const [crD, setCrD] = useState(String(activeProfile?.carb_ratio_dinner ?? 12));
  const [isf, setIsf] = useState(
    String(glucoseToDisplay(activeProfile?.insulin_sensitivity_factor ?? 40, unit))
  );
  const [dailyCarb, setDailyCarb] = useState(
    String(activeProfile?.daily_carb_target_g ?? 200)
  );
  const [basalTime, setBasalTime] = useState("22:00");
  const [showTime, setShowTime] = useState(false);
  const [saving, setSaving] = useState(false);

  function n(v: string, fallback: number): number {
    const x = parseFloat(v.replace(",", "."));
    return Number.isFinite(x) && x > 0 ? x : fallback;
  }

  async function save() {
    if (!activeProfile) return;
    setSaving(true);
    await updateProfile(activeProfile.id, {
      name: name.trim() || "Profil",
      target_fasting_max: glucoseFromDisplay(
        n(fasting, glucoseToDisplay(100, unit)),
        unit
      ),
      target_postmeal_max: glucoseFromDisplay(
        n(postmeal, glucoseToDisplay(140, unit)),
        unit
      ),
      carb_ratio_breakfast: n(crB, 10),
      carb_ratio_lunch: n(crL, 12),
      carb_ratio_dinner: n(crD, 12),
      insulin_sensitivity_factor: glucoseFromDisplay(
        n(isf, glucoseToDisplay(40, unit)),
        unit
      ),
      daily_carb_target_g: Math.round(n(dailyCarb, 200)),
    });
    await scheduleBasalReminder(basalTime);
    bumpData();
    router.back();
  }

  return (
    <View className="flex-1">
      <AppBackgroundFill />
      <View className="flex-1" style={{ paddingTop: insets.top }}>
        <View className="flex-row items-center justify-between px-4 py-3 border-b border-zinc-900">
          <View className="flex-1">
            <Text className="text-zinc-50 text-lg font-bold">
              {t("profiles.add")}
            </Text>
            <Text className="text-zinc-500 text-xs">{name}</Text>
          </View>
          <Pressable onPress={() => router.back()} hitSlop={10} className="p-1">
            <Ionicons name="close" size={24} color="#a1a1aa" />
          </Pressable>
        </View>

        <ScrollView
          {...keyboardAwareScrollProps}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 28 }}
          showsVerticalScrollIndicator={false}
        >
          <View className="rounded-2xl bg-brand/10 border border-brand/25 p-3.5 mb-4 flex-row items-center">
            <Ionicons name="information-circle-outline" size={18} color="#2ee6ff" />
            <Text className="text-zinc-300 text-xs ml-2.5 flex-1 leading-4">
              {t("profiles.setupHint")}
            </Text>
          </View>

          <FormCard icon="person-outline" title={t("onboarding.secProfile")}>
            <InputRow
              icon="text-outline"
              label={t("onboarding.profileName")}
              value={name}
              onChangeText={setName}
              placeholder={t("profiles.newNamePlaceholder")}
              last
            />
          </FormCard>

          <FormCard icon="speedometer-outline" title={t("onboarding.secTargets")}>
            <InputRow
              icon="sunny-outline"
              label={t("period.fasting")}
              value={fasting}
              onChangeText={setFasting}
              keyboardType="decimal-pad"
              suffix={glucoseUnitLabel(unit)}
              maxLength={5}
            />
            <InputRow
              icon="time-outline"
              label={t("period.post_meal_2h")}
              value={postmeal}
              onChangeText={setPostmeal}
              keyboardType="decimal-pad"
              suffix={glucoseUnitLabel(unit)}
              maxLength={5}
            />
            <InputRow
              icon="pie-chart-outline"
              label={t("settings.dailyCarbTarget")}
              value={dailyCarb}
              onChangeText={setDailyCarb}
              keyboardType="number-pad"
              suffix={t("common.grams")}
              last
            />
          </FormCard>

          <FormCard icon="restaurant-outline" title={t("settings.carbRatios")}>
            <InputRow
              icon="cafe-outline"
              label={t("slot.breakfast")}
              value={crB}
              onChangeText={setCrB}
              keyboardType="decimal-pad"
              suffix={t("common.carbRatioUnit")}
            />
            <InputRow
              icon="partly-sunny-outline"
              label={t("slot.lunch")}
              value={crL}
              onChangeText={setCrL}
              keyboardType="decimal-pad"
              suffix={t("common.carbRatioUnit")}
            />
            <InputRow
              icon="moon-outline"
              label={t("slot.dinner")}
              value={crD}
              onChangeText={setCrD}
              keyboardType="decimal-pad"
              suffix={t("common.carbRatioUnit")}
              last
            />
          </FormCard>

          <FormCard icon="pulse-outline" title={t("onboarding.secReminder")}>
            <InputRow
              icon="pulse-outline"
              label={t("settings.isf")}
              hint={t("settings.isfHint")}
              value={isf}
              onChangeText={setIsf}
              keyboardType="decimal-pad"
              suffix={glucoseUnitLabel(unit)}
              maxLength={5}
            />
            <ActionRow
              icon="alarm-outline"
              label={t("settings.basalTime")}
              value={basalTime}
              onPress={() => setShowTime((s) => !s)}
              last
            />
          </FormCard>
          <InlineTimePicker
            visible={showTime}
            value={basalTime}
            onChange={setBasalTime}
            onClose={() => setShowTime(false)}
          />

          <View className="h-2" />
          <Button
            label={t("common.save")}
            size="lg"
            loading={saving}
            onPress={save}
          />
        </ScrollView>
      </View>
      <FeedbackHost />
    </View>
  );
}
