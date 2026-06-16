import React, { useRef, useState } from "react";
import {
  Dimensions,
  KeyboardAvoidingView,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import { useApp } from "../lib/store/AppContext";
import { updateProfile } from "../lib/db/profiles";
import { scheduleBasalReminder } from "../lib/services/notifications";
import type { GlucoseUnit } from "../lib/db/types";
import {
  glucoseToDisplay,
  glucoseFromDisplay,
  glucoseUnitLabel,
} from "../lib/glucose";
import { Button, Segmented } from "../components/ui";
import { FormCard, InputRow, ActionRow, AcceptCheck } from "../components/form";
import { InlineTimePicker } from "../components/InlineTimePicker";
import { Logo } from "../components/Logo";
import { DisclaimerBanner } from "../components/Disclaimer";

const { width } = Dimensions.get("window");

export default function OnboardingScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { activeProfile, bumpData, completeOnboarding } = useApp();

  const [phase, setPhase] = useState<"intro" | "setup">("intro");

  // ── Intro carousel ───────────────────────────────────────────────────────
  const scrollRef = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);

  const slides = [
    { logo: true, icon: "leaf-outline", title: t("onboarding.s1Title"), body: t("onboarding.s1Body") },
    { logo: false, icon: "pulse-outline", title: t("onboarding.s2Title"), body: t("onboarding.s2Body") },
    { logo: false, icon: "people-outline", title: t("onboarding.s3Title"), body: t("onboarding.s3Body") },
  ] as const;
  const lastSlide = page === slides.length - 1;

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) =>
    setPage(Math.round(e.nativeEvent.contentOffset.x / width));

  const nextSlide = () => {
    if (lastSlide) return setPhase("setup");
    const target = page + 1;
    scrollRef.current?.scrollTo({ x: target * width, animated: true });
    setPage(target);
  };

  // ── Setup form ───────────────────────────────────────────────────────────
  const [name, setName] = useState(
    activeProfile?.name ?? t("profiles.defaultName")
  );
  const [fasting, setFasting] = useState(
    String(activeProfile?.target_fasting_max ?? 100)
  );
  const [postmeal, setPostmeal] = useState(
    String(activeProfile?.target_postmeal_max ?? 140)
  );
  const [crBreakfast, setCrBreakfast] = useState(
    String(activeProfile?.carb_ratio_breakfast ?? 10)
  );
  const [crLunch, setCrLunch] = useState(
    String(activeProfile?.carb_ratio_lunch ?? 12)
  );
  const [crDinner, setCrDinner] = useState(
    String(activeProfile?.carb_ratio_dinner ?? 12)
  );
  const [isf, setIsf] = useState(
    String(
      glucoseToDisplay(
        activeProfile?.insulin_sensitivity_factor ?? 40,
        activeProfile?.glucose_unit ?? "mgdl"
      )
    )
  );
  const [unit, setUnit] = useState<GlucoseUnit>(
    activeProfile?.glucose_unit ?? "mgdl"
  );
  const [basalTime, setBasalTime] = useState("22:00");
  const [showTime, setShowTime] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [saving, setSaving] = useState(false);

  function n(v: string, fallback: number): number {
    const x = parseFloat(v.replace(",", "."));
    return Number.isFinite(x) && x > 0 ? x : fallback;
  }

  // Switching unit converts the currently-shown target values to the new unit.
  function changeUnit(next: GlucoseUnit) {
    if (next === unit) return;
    const fMgdl = glucoseFromDisplay(n(fasting, glucoseToDisplay(100, unit)), unit);
    const pMgdl = glucoseFromDisplay(n(postmeal, glucoseToDisplay(140, unit)), unit);
    const iMgdl = glucoseFromDisplay(n(isf, glucoseToDisplay(40, unit)), unit);
    setFasting(String(glucoseToDisplay(fMgdl, next)));
    setPostmeal(String(glucoseToDisplay(pMgdl, next)));
    setIsf(String(glucoseToDisplay(iMgdl, next)));
    setUnit(next);
  }

  async function finish() {
    if (!activeProfile || !accepted) return;
    setSaving(true);
    await updateProfile(activeProfile.id, {
      name: name.trim() || t("profiles.defaultName"),
      target_fasting_max: glucoseFromDisplay(
        n(fasting, glucoseToDisplay(100, unit)),
        unit
      ),
      target_postmeal_max: glucoseFromDisplay(
        n(postmeal, glucoseToDisplay(140, unit)),
        unit
      ),
      carb_ratio_breakfast: n(crBreakfast, 10),
      carb_ratio_lunch: n(crLunch, 12),
      carb_ratio_dinner: n(crDinner, 12),
      insulin_sensitivity_factor: glucoseFromDisplay(
        n(isf, glucoseToDisplay(40, unit)),
        unit
      ),
      glucose_unit: unit,
    });
    await scheduleBasalReminder(basalTime);
    bumpData();
    await completeOnboarding();
  }

  // ── Render: intro ────────────────────────────────────────────────────────
  if (phase === "intro") {
    return (
      <View
        className="flex-1 bg-black"
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      >
        <View className="h-12 flex-row justify-end px-5 items-center">
          <Pressable onPress={() => setPhase("setup")} hitSlop={10}>
            <Text className="text-zinc-500 text-base font-medium">
              {t("onboarding.skip")}
            </Text>
          </Pressable>
        </View>

        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onScroll}
        >
          {slides.map((s, i) => (
            <View
              key={i}
              style={{ width }}
              className="flex-1 items-center justify-center px-10"
            >
              <View className="w-28 h-28 rounded-3xl bg-brand/10 border border-brand/20 items-center justify-center mb-9">
                {s.logo ? (
                  <Logo size={72} />
                ) : (
                  <Ionicons name={s.icon} size={64} color="#22d3ee" />
                )}
              </View>
              <Text className="text-zinc-50 text-center text-2xl font-extrabold">
                {s.title}
              </Text>
              <Text className="text-zinc-400 mt-3 text-center text-base leading-6">
                {s.body}
              </Text>
            </View>
          ))}
        </ScrollView>

        {/* dots */}
        <View className="my-7 flex-row justify-center gap-2">
          {slides.map((_, i) => (
            <View
              key={i}
              className={`h-2 rounded-full ${
                i === page ? "w-6 bg-brand" : "w-2 bg-zinc-700"
              }`}
            />
          ))}
        </View>

        <View className="px-6">
          <Button
            label={lastSlide ? t("onboarding.continue") : t("onboarding.next")}
            size="lg"
            onPress={nextSlide}
          />
        </View>
      </View>
    );
  }

  // ── Render: setup ────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      className="flex-1 bg-black"
      style={{ paddingTop: insets.top }}
    >
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 28 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Compact header */}
        <View className="items-center mt-1 mb-6">
          <View className="w-16 h-16 rounded-2xl bg-brand/10 border border-brand/20 items-center justify-center mb-3">
            <Logo size={42} />
          </View>
          <Text className="text-zinc-50 text-xl font-bold">
            {t("onboarding.welcome")}
          </Text>
          <Text className="text-zinc-400 text-center mt-2 px-3 leading-5 text-sm">
            {t("onboarding.subtitle")}
          </Text>
        </View>

        {/* Profile */}
        <FormCard icon="person-outline" title={t("onboarding.secProfile")}>
          <InputRow
            icon="text-outline"
            label={t("onboarding.profileName")}
            value={name}
            onChangeText={setName}
            placeholder={t("onboarding.profileNamePlaceholder")}
            last
          />
        </FormCard>

        {/* Glucose unit */}
        <FormCard icon="options-outline" title={t("settings.glucoseUnit")}>
          <View className="px-4 py-3.5">
            <Segmented
              options={[
                { value: "mgdl", label: "mg/dL" },
                { value: "mmol", label: "mmol/L" },
              ]}
              value={unit}
              onChange={changeUnit}
            />
          </View>
        </FormCard>

        {/* Targets */}
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
            last
          />
        </FormCard>

        {/* Carb ratios */}
        <FormCard icon="restaurant-outline" title={t("settings.carbRatios")}>
          <InputRow
            icon="cafe-outline"
            label={t("slot.breakfast")}
            value={crBreakfast}
            onChangeText={setCrBreakfast}
            keyboardType="decimal-pad"
            suffix="g/ü"
          />
          <InputRow
            icon="partly-sunny-outline"
            label={t("slot.lunch")}
            value={crLunch}
            onChangeText={setCrLunch}
            keyboardType="decimal-pad"
            suffix="g/ü"
          />
          <InputRow
            icon="moon-outline"
            label={t("slot.dinner")}
            value={crDinner}
            onChangeText={setCrDinner}
            keyboardType="decimal-pad"
            suffix="g/ü"
            last
          />
        </FormCard>

        {/* Insulin & reminder */}
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
            label={t("onboarding.basalTime")}
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

        {/* Disclaimer + acceptance */}
        <View className="mt-1 mb-3">
          <DisclaimerBanner full />
        </View>
        <AcceptCheck
          checked={accepted}
          onToggle={() => setAccepted((a) => !a)}
          label={t("disclaimer.accept")}
        />

        <View className="h-5" />
        <Button
          label={t("onboarding.start")}
          size="lg"
          disabled={!accepted}
          loading={saving}
          onPress={finish}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
