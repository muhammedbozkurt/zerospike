import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { useApp } from "../lib/store/AppContext";
import { updateProfile, type ProfileUpdate } from "../lib/db/profiles";
import {
  applyNotificationPrefs,
  requestNotificationPermission,
} from "../lib/services/notifications";
import {
  DEFAULT_PREFS,
  setNotificationPrefs,
} from "../lib/services/notificationPrefs";
import type { GlucoseUnit } from "../lib/db/types";
import {
  glucoseToDisplay,
  glucoseFromDisplay,
  glucoseUnitLabel,
} from "../lib/glucose";
import { logEvent } from "../lib/analytics";
import { hapticSelect } from "../lib/haptics";
import { Button } from "../components/ui";
import { InputRow, AcceptCheck } from "../components/form";
import { InlineTimePicker } from "../components/InlineTimePicker";
import { DisclaimerBanner } from "../components/Disclaimer";
import { LanguageChip } from "../components/onboarding/LanguageChip";
import { Welcome } from "../components/onboarding/Welcome";
import { QuizStep } from "../components/onboarding/QuizStep";
import { OptionCard } from "../components/onboarding/OptionCard";
import { Reveal } from "../components/onboarding/Reveal";
import { FadeSlideIn, ENTRANCE_STAGGER_MS } from "../components/onboarding/motion";

const DIABETES_KEY = "zerospike.diabetesContext";
const INSULIN_KEY = "zerospike.insulinContext";

// Sensible defaults used by the "I'm not sure" path (never blocks a new user).
const DEFAULT_CARB_RATIO = 10;
const DEFAULT_ISF_MGDL = 40;

const DIABETES_OPTIONS = ["type1", "type2", "gestational", "prediabetes", "other"] as const;
type DiabetesOption = (typeof DIABETES_OPTIONS)[number];

const INSULIN_OPTIONS = ["basal", "bolus", "both", "none"] as const;
type InsulinOption = (typeof INSULIN_OPTIONS)[number];

type IconName = keyof typeof Ionicons.glyphMap;

const UNIT_ICONS: Record<GlucoseUnit, IconName> = {
  mgdl: "speedometer-outline",
  mmol: "flask-outline",
};

const INSULIN_ICONS: Record<InsulinOption, IconName> = {
  basal: "moon-outline",
  bolus: "restaurant-outline",
  both: "swap-horizontal-outline",
  none: "remove-circle-outline",
};

/** Single-select steps settle, then advance. */
const AUTO_ADVANCE_MS = 150;

type Phase = "welcome" | "quiz" | "reveal";
type StepId =
  | "name"
  | "unit"
  | "diabetes"
  | "insulin"
  | "targets"
  | "carbRatio"
  | "isf"
  | "basal"
  | "notify"
  | "disclaimer";

export default function OnboardingScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { activeProfile, bumpData, completeOnboarding } = useApp();

  const [phase, setPhase] = useState<Phase>("welcome");
  const [stepIdx, setStepIdx] = useState(0);

  const [name, setName] = useState(
    activeProfile?.name ?? t("profiles.defaultName")
  );
  const [unit, setUnit] = useState<GlucoseUnit>(
    activeProfile?.glucose_unit ?? "mgdl"
  );
  const [diabetes, setDiabetes] = useState<DiabetesOption | null>(null);
  const [insulin, setInsulin] = useState<InsulinOption | null>(null);
  const [fasting, setFasting] = useState(
    String(glucoseToDisplay(activeProfile?.target_fasting_max ?? 100, unit))
  );
  const [postmeal, setPostmeal] = useState(
    String(glucoseToDisplay(activeProfile?.target_postmeal_max ?? 140, unit))
  );
  const [carbRatio, setCarbRatio] = useState(
    String(activeProfile?.carb_ratio_breakfast ?? DEFAULT_CARB_RATIO)
  );
  const [isf, setIsf] = useState(
    String(glucoseToDisplay(activeProfile?.insulin_sensitivity_factor ?? DEFAULT_ISF_MGDL, unit))
  );
  const [basalTime, setBasalTime] = useState("22:00");
  const [showTime, setShowTime] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [saving, setSaving] = useState(false);

  const hasInsulin =
    insulin === "basal" || insulin === "bolus" || insulin === "both";

  // Branching flow: the carb-ratio / ISF / basal-time trio is only for insulin
  // users. Everyone gets the notification + disclaimer tail.
  const steps = useMemo<StepId[]>(() => {
    const base: StepId[] = ["name", "unit", "diabetes", "insulin", "targets"];
    const branch: StepId[] = hasInsulin ? ["carbRatio", "isf", "basal"] : [];
    return [...base, ...branch, "notify", "disclaimer"];
  }, [hasInsulin]);

  const stepIdxClamped = Math.min(stepIdx, steps.length - 1);
  const step = steps[stepIdxClamped];

  const advancingRef = useRef(false);
  useEffect(() => {
    advancingRef.current = false;
  }, [stepIdxClamped, phase]);

  // Preserve the original analytics events. Log the current quiz step, or the
  // welcome / reveal phase name.
  useEffect(() => {
    logEvent("onboarding_step", { step: phase === "quiz" ? step : phase });
  }, [phase, step]);

  function num(v: string, fallback: number): number {
    const x = parseFloat(v.replace(",", "."));
    return Number.isFinite(x) && x > 0 ? x : fallback;
  }

  function changeUnit(next: GlucoseUnit) {
    if (next === unit) return;
    const fMgdl = glucoseFromDisplay(num(fasting, glucoseToDisplay(100, unit)), unit);
    const pMgdl = glucoseFromDisplay(num(postmeal, glucoseToDisplay(140, unit)), unit);
    const iMgdl = glucoseFromDisplay(num(isf, glucoseToDisplay(DEFAULT_ISF_MGDL, unit)), unit);
    setFasting(String(glucoseToDisplay(fMgdl, next)));
    setPostmeal(String(glucoseToDisplay(pMgdl, next)));
    setIsf(String(glucoseToDisplay(iMgdl, next)));
    setUnit(next);
  }

  const next = () => setStepIdx((i) => Math.min(steps.length - 1, i + 1));
  const back = () => setStepIdx((i) => Math.max(0, i - 1));

  // Single-select steps apply the answer then auto-advance (guarded so a fast
  // double-tap cannot skip two steps).
  function selectAndAdvance(apply: () => void) {
    hapticSelect();
    apply();
    if (advancingRef.current) return;
    advancingRef.current = true;
    setTimeout(next, AUTO_ADVANCE_MS);
  }

  // Leaving the notification step: the on-screen rationale has been shown, so
  // fire the OS prompt here (contextual), then advance.
  async function nextFromNotify() {
    await requestNotificationPermission().catch(() => {});
    next();
  }

  const fastingMgdl = glucoseFromDisplay(num(fasting, glucoseToDisplay(100, unit)), unit);
  const postmealMgdl = glucoseFromDisplay(num(postmeal, glucoseToDisplay(140, unit)), unit);

  // Save the profile + reminder plan, mark onboarding complete (so a kill on the
  // upcoming paywall never re-runs the quiz), then show the reveal.
  async function finishToReveal() {
    if (!activeProfile || saving) return;
    setSaving(true);
    try {
      const patch: ProfileUpdate = {
        name: name.trim() || t("profiles.defaultName"),
        target_fasting_max: fastingMgdl,
        target_postmeal_max: postmealMgdl,
        glucose_unit: unit,
      };
      // Insulin math is only relevant to insulin users; leave the profile's
      // defaults untouched otherwise.
      if (hasInsulin) {
        const cr = num(carbRatio, DEFAULT_CARB_RATIO);
        patch.carb_ratio_breakfast = cr;
        patch.carb_ratio_lunch = cr;
        patch.carb_ratio_dinner = cr;
        patch.insulin_sensitivity_factor = glucoseFromDisplay(
          num(isf, glucoseToDisplay(DEFAULT_ISF_MGDL, unit)),
          unit
        );
      }
      await updateProfile(activeProfile.id, patch);

      // Context flags are for text tone / visibility only, never calculations.
      if (diabetes) await AsyncStorage.setItem(DIABETES_KEY, diabetes).catch(() => {});
      await AsyncStorage.setItem(INSULIN_KEY, insulin ?? "none").catch(() => {});

      // Reminder relevance follows insulin use (basal + pen-low only apply to
      // insulin users); post-meal tracking stays on for everyone.
      await setNotificationPrefs({
        ...DEFAULT_PREFS,
        basal: hasInsulin,
        basalTime,
        penLow: hasInsulin,
      });
      await applyNotificationPrefs();

      bumpData();
      await completeOnboarding();
      logEvent("onboarding_done", {});
      setPhase("reveal");
    } finally {
      setSaving(false);
    }
  }

  function goToPaywall() {
    router.replace({ pathname: "/paywall", params: { context: "onboarding" } });
  }

  // Optional subtitle per step (the title is derived from the step id).
  function hintFor(s: StepId): string | undefined {
    switch (s) {
      case "name":
        return t("onboarding.qNameHint");
      case "unit":
        return t("onboarding.qUnitHint");
      case "diabetes":
        return t("onboarding.qDiabetesHint");
      case "insulin":
        return t("onboarding.qInsulinHint");
      case "targets":
        return t("onboarding.qTargetsHint");
      case "carbRatio":
        return t("onboarding.qCarbRatioHint");
      case "isf":
        return t("onboarding.qIsfHint");
      case "basal":
        return t("onboarding.qBasalHint");
      case "notify":
        return t("onboarding.qNotifyHint");
      case "disclaimer":
        return undefined;
    }
  }

  const optDelay = (i: number) => ENTRANCE_STAGGER_MS * 2 + i * 50;
  const progress = (stepIdxClamped + 1) / steps.length;

  const onBack =
    phase !== "quiz"
      ? undefined
      : stepIdxClamped === 0
        ? () => setPhase("welcome")
        : back;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      className="flex-1 bg-black"
      style={{ paddingTop: insets.top }}
    >
      {/* Shared header: back (quiz only) + always-present language chip */}
      <View className="px-6 pt-2 pb-2 flex-row items-center justify-between">
        {onBack ? (
          <Pressable onPress={onBack} hitSlop={10} className="pr-3 py-1">
            <Ionicons name="chevron-back" size={24} color="#a1a1aa" />
          </Pressable>
        ) : (
          <View className="w-6" />
        )}
        <LanguageChip />
      </View>

      <View
        className="flex-1 px-6"
        style={{ paddingBottom: insets.bottom + 16 }}
      >
        {phase === "welcome" ? (
          <Welcome
            onStart={() => {
              setStepIdx(0);
              setPhase("quiz");
            }}
          />
        ) : null}

        {phase === "reveal" ? (
          <Reveal
            unit={unit}
            fastingMgdl={fastingMgdl}
            postmealMgdl={postmealMgdl}
            hasInsulin={hasInsulin}
            basalTime={basalTime}
            onContinue={goToPaywall}
          />
        ) : null}

        {phase === "quiz" ? (
          <QuizStep
            key={step}
            progress={progress}
            title={t(`onboarding.q${step[0].toUpperCase()}${step.slice(1)}`)}
            hint={hintFor(step)}
            footer={renderFooter()}
          >
            {renderContent()}
          </QuizStep>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );

  // ── Per-step content ───────────────────────────────────────────────────────
  function renderContent() {
    switch (step) {
      case "name":
        return (
          <FadeSlideIn delay={optDelay(0)}>
            <View className="rounded-2xl bg-zinc-900 border border-zinc-800 overflow-hidden">
              <InputRow
                icon="text-outline"
                label={t("onboarding.profileName")}
                value={name}
                onChangeText={setName}
                placeholder={t("onboarding.profileNamePlaceholder")}
                large
                last
              />
            </View>
          </FadeSlideIn>
        );

      // Unit has a pre-selected default and converts the values behind it, so it
      // stays a select-then-continue step (no auto-advance), as before.
      case "unit":
        return (
          <View>
            {(["mgdl", "mmol"] as const).map((opt, i) => (
              <FadeSlideIn key={opt} delay={optDelay(i)}>
                <OptionCard
                  icon={UNIT_ICONS[opt]}
                  label={glucoseUnitLabel(opt)}
                  selected={unit === opt}
                  onPress={() => {
                    hapticSelect();
                    changeUnit(opt);
                  }}
                />
              </FadeSlideIn>
            ))}
          </View>
        );

      case "diabetes":
        return (
          <View>
            {DIABETES_OPTIONS.map((opt, i) => (
              <FadeSlideIn key={opt} delay={optDelay(i)}>
                <OptionCard
                  label={t(`onboarding.diabetes_${opt}`)}
                  selected={diabetes === opt}
                  onPress={() => selectAndAdvance(() => setDiabetes(opt))}
                />
              </FadeSlideIn>
            ))}
          </View>
        );

      case "insulin":
        return (
          <View>
            {INSULIN_OPTIONS.map((opt, i) => (
              <FadeSlideIn key={opt} delay={optDelay(i)}>
                <OptionCard
                  icon={INSULIN_ICONS[opt]}
                  label={t(`onboarding.insulin_${opt}`)}
                  selected={insulin === opt}
                  onPress={() => selectAndAdvance(() => setInsulin(opt))}
                />
              </FadeSlideIn>
            ))}
          </View>
        );

      case "targets":
        return (
          <FadeSlideIn delay={optDelay(0)}>
            <View className="rounded-2xl bg-zinc-900 border border-zinc-800 overflow-hidden">
              <InputRow
                icon="sunny-outline"
                label={t("period.fasting")}
                hint={t("onboarding.qFastingHint")}
                value={fasting}
                onChangeText={setFasting}
                keyboardType="decimal-pad"
                suffix={glucoseUnitLabel(unit)}
                maxLength={5}
                large
              />
              <InputRow
                icon="time-outline"
                label={t("period.post_meal_2h")}
                hint={t("onboarding.qPostmealHint")}
                value={postmeal}
                onChangeText={setPostmeal}
                keyboardType="decimal-pad"
                suffix={glucoseUnitLabel(unit)}
                maxLength={5}
                large
                last
              />
            </View>
          </FadeSlideIn>
        );

      case "carbRatio":
        return (
          <FadeSlideIn delay={optDelay(0)}>
            <View className="rounded-2xl bg-zinc-900 border border-zinc-800 overflow-hidden">
              <InputRow
                icon="restaurant-outline"
                label={t("settings.carbRatios")}
                value={carbRatio}
                onChangeText={setCarbRatio}
                keyboardType="decimal-pad"
                suffix={t("common.carbRatioUnit")}
                maxLength={4}
                large
                last
              />
            </View>
          </FadeSlideIn>
        );

      case "isf":
        return (
          <FadeSlideIn delay={optDelay(0)}>
            <View className="rounded-2xl bg-zinc-900 border border-zinc-800 overflow-hidden">
              <InputRow
                icon="pulse-outline"
                label={t("settings.isf")}
                value={isf}
                onChangeText={setIsf}
                keyboardType="decimal-pad"
                suffix={glucoseUnitLabel(unit)}
                maxLength={5}
                large
                last
              />
            </View>
          </FadeSlideIn>
        );

      case "basal":
        return (
          <FadeSlideIn delay={optDelay(0)}>
            <Pressable
              onPress={() => setShowTime((s) => !s)}
              style={{ minHeight: 60 }}
              className="flex-row items-center justify-between rounded-2xl bg-zinc-900 border border-zinc-800 px-4 active:bg-zinc-800"
            >
              <View className="flex-row items-center">
                <Ionicons name="moon-outline" size={20} color="#22d3ee" />
                <Text className="text-zinc-200 text-base ml-3">
                  {t("onboarding.basalTime")}
                </Text>
              </View>
              <Text className="text-zinc-50 text-lg font-semibold">{basalTime}</Text>
            </Pressable>
            <InlineTimePicker
              visible={showTime}
              value={basalTime}
              onChange={setBasalTime}
              onClose={() => setShowTime(false)}
            />
          </FadeSlideIn>
        );

      case "notify":
        return (
          <FadeSlideIn delay={optDelay(0)}>
            <View className="flex-row items-start rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
              <Ionicons name="notifications-outline" size={18} color="#22d3ee" />
              <Text className="text-zinc-300 text-sm leading-6 ml-3 flex-1">
                {t("onboarding.notifRationale")}
              </Text>
            </View>
          </FadeSlideIn>
        );

      case "disclaimer":
        return (
          <FadeSlideIn delay={optDelay(0)}>
            <DisclaimerBanner full />
            <View className="mt-4">
              <AcceptCheck
                checked={accepted}
                onToggle={() => setAccepted((a) => !a)}
                label={t("disclaimer.accept")}
              />
            </View>
          </FadeSlideIn>
        );
    }
  }

  // ── Per-step footer ────────────────────────────────────────────────────────
  function renderFooter(): React.ReactNode {
    // Single-select steps auto-advance and have no footer.
    if (step === "insulin") return null;

    if (step === "notify") {
      return (
        <Button label={t("onboarding.notifyCta")} size="lg" onPress={nextFromNotify} />
      );
    }

    if (step === "disclaimer") {
      return (
        <Button
          label={t("onboarding.continue")}
          size="lg"
          disabled={!accepted}
          loading={saving}
          onPress={finishToReveal}
        />
      );
    }

    const notSure =
      step === "carbRatio" || step === "isf" ? (
        <Pressable
          onPress={() => {
            if (step === "carbRatio") setCarbRatio(String(DEFAULT_CARB_RATIO));
            else setIsf(String(glucoseToDisplay(DEFAULT_ISF_MGDL, unit)));
            next();
          }}
          hitSlop={8}
          className="py-3.5 items-center"
        >
          <Text className="text-zinc-400 font-medium">{t("onboarding.notSure")}</Text>
        </Pressable>
      ) : null;

    const label = step === "diabetes" ? t("onboarding.continue") : t("onboarding.next");
    return (
      <View>
        <Button label={label} size="lg" onPress={next} />
        {notSure}
      </View>
    );
  }
}
