import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  BackHandler,
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
import type { DiabetesType, GlucoseUnit, InsulinMode } from "../lib/db/types";
import {
  clampHypoThreshold,
  clampTarget,
  glucoseToDisplay,
  glucoseFromDisplay,
  glucoseUnitLabel,
  TARGET_RANGE_BOUNDS,
} from "../lib/glucose";
import { RangeInput } from "../components/RangeInput";
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
import { AppBackground } from "../components/rich";
import { THEME } from "../lib/theme/tokens";

// Sensible defaults used by the "I'm not sure" path (never blocks a new user).
// Taking this path leaves ratios_confirmed at 0, so the calculator can say out
// loud that it is running on a default rather than on the user's own number.
const DEFAULT_CARB_RATIO = 10;
const DEFAULT_ISF_MGDL = 40;

// The ADA-shaped starting ranges, prefilled so nobody has to invent a number.
const DEFAULT_FASTING_RANGE = { min: 80, max: 130 };
const DEFAULT_POSTMEAL_RANGE = { min: 80, max: 180 };

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
  const [fastingMin, setFastingMin] = useState(
    String(glucoseToDisplay(activeProfile?.target_fasting_min ?? DEFAULT_FASTING_RANGE.min, unit))
  );
  const [fastingMax, setFastingMax] = useState(
    String(glucoseToDisplay(activeProfile?.target_fasting_max ?? DEFAULT_FASTING_RANGE.max, unit))
  );
  const [postmealMin, setPostmealMin] = useState(
    String(glucoseToDisplay(activeProfile?.target_postmeal_min ?? DEFAULT_POSTMEAL_RANGE.min, unit))
  );
  const [postmealMax, setPostmealMax] = useState(
    String(glucoseToDisplay(activeProfile?.target_postmeal_max ?? DEFAULT_POSTMEAL_RANGE.max, unit))
  );
  // Set only by the explicit "I'm not sure" shortcut on the ratio steps.
  const [usedDefaultRatios, setUsedDefaultRatios] = useState(false);
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
    const convert = (text: string, fallbackMgdl: number) =>
      String(
        glucoseToDisplay(
          glucoseFromDisplay(num(text, glucoseToDisplay(fallbackMgdl, unit)), unit),
          next
        )
      );
    setFastingMin(convert(fastingMin, DEFAULT_FASTING_RANGE.min));
    setFastingMax(convert(fastingMax, DEFAULT_FASTING_RANGE.max));
    setPostmealMin(convert(postmealMin, DEFAULT_POSTMEAL_RANGE.min));
    setPostmealMax(convert(postmealMax, DEFAULT_POSTMEAL_RANGE.max));
    setIsf(convert(isf, DEFAULT_ISF_MGDL));
    setUnit(next);
  }

  const next = () => setStepIdx((i) => Math.min(steps.length - 1, i + 1));
  const back = () => setStepIdx((i) => Math.max(0, i - 1));

  // Android hardware back mirrors the in-UI arrow during the quiz: step 0
  // returns to the welcome phase, later steps go back one step. Welcome and
  // reveal keep the system default.
  useEffect(() => {
    if (Platform.OS !== "android" || phase !== "quiz") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (stepIdxClamped === 0) setPhase("welcome");
      else back();
      return true;
    });
    return () => sub.remove();
  }, [phase, stepIdxClamped]);

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

  const toMgdl = (text: string, fallbackMgdl: number) =>
    clampTarget(
      glucoseFromDisplay(num(text, glucoseToDisplay(fallbackMgdl, unit)), unit)
    );
  const fastingMinMgdl = toMgdl(fastingMin, DEFAULT_FASTING_RANGE.min);
  const fastingMgdl = toMgdl(fastingMax, DEFAULT_FASTING_RANGE.max);
  const postmealMinMgdl = toMgdl(postmealMin, DEFAULT_POSTMEAL_RANGE.min);
  const postmealMgdl = toMgdl(postmealMax, DEFAULT_POSTMEAL_RANGE.max);

  // The accepted band in the unit being typed, so a mmol user is judged in mmol.
  const glucoseBounds = {
    min: glucoseToDisplay(TARGET_RANGE_BOUNDS.min, unit),
    max: glucoseToDisplay(TARGET_RANGE_BOUNDS.max, unit),
  };
  const withinBounds = (text: string) => {
    const v = parseFloat(text.replace(",", "."));
    return (
      Number.isFinite(v) && v >= glucoseBounds.min && v <= glucoseBounds.max
    );
  };
  // Both checks gate Continue. clampTarget still guards the value that reaches
  // the database, but it is no longer the only thing standing between a typo and
  // a stored target: an out-of-band entry is now shown as an error rather than
  // quietly turning into a different number behind the user's back.
  const fastingOk =
    fastingMinMgdl < fastingMgdl &&
    withinBounds(fastingMin) &&
    withinBounds(fastingMax);
  const postmealOk =
    postmealMinMgdl < postmealMgdl &&
    withinBounds(postmealMin) &&
    withinBounds(postmealMax);
  const rangesOk = fastingOk && postmealOk;

  // Save the profile + reminder plan, mark onboarding complete (so a kill on the
  // upcoming paywall never re-runs the quiz), then show the reveal.
  async function finishToReveal() {
    if (!activeProfile || saving) return;
    setSaving(true);
    try {
      // The quiz answers stop being dead data here: diabetes type and insulin
      // mode go onto the profile, which is what the rest of the app reads.
      const patch: ProfileUpdate = {
        name: name.trim() || t("profiles.defaultName"),
        target_fasting_min: fastingMinMgdl,
        target_fasting_max: fastingMgdl,
        target_postmeal_min: postmealMinMgdl,
        target_postmeal_max: postmealMgdl,
        glucose_unit: unit,
        diabetes_type: (diabetes === "other" || diabetes == null
          ? "unknown"
          : diabetes) as DiabetesType,
        insulin_mode: (insulin ?? "none") as InsulinMode,
        // Not asked during onboarding (it has a safe default and the flow must
        // not grow a step), but it is written through the same clamp settings
        // uses so no path can seed an out-of-band threshold.
        hypo_threshold_mgdl: clampHypoThreshold(
          activeProfile.hypo_threshold_mgdl ?? 70
        ),
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
        // A number the user typed is theirs; one they skipped past is not, and
        // the calculator has to be able to tell those apart.
        patch.ratios_confirmed = usedDefaultRatios ? 0 : 1;
      }
      await updateProfile(activeProfile.id, patch);

      // Reminder relevance follows insulin use (the basal reminder only applies
      // to insulin users); post-meal tracking stays on for everyone.
      await setNotificationPrefs({
        ...DEFAULT_PREFS,
        basal: hasInsulin,
        basalTime,
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
    <AppBackground style={{ paddingTop: insets.top }}>
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      className="flex-1"
    >
      {/* Shared header: back (quiz only) + always-present language chip */}
      <View className="px-6 pt-2 pb-2 flex-row items-center justify-between">
        {onBack ? (
          <Pressable onPress={onBack} hitSlop={10} className="pr-3 py-1">
            <Ionicons name="chevron-back" size={24} color={THEME.muted} />
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
            fastingMinMgdl={fastingMinMgdl}
            fastingMgdl={fastingMgdl}
            postmealMinMgdl={postmealMinMgdl}
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
    </AppBackground>
  );

  // ── Per-step content ───────────────────────────────────────────────────────
  function renderContent() {
    switch (step) {
      case "name":
        return (
          <FadeSlideIn delay={optDelay(0)}>
            <View className="rounded-2xl bg-glass border border-hair overflow-hidden">
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

      // Targets are RANGES. The same band control the settings screen uses, so
      // the two never drift apart, prefilled with the standard starting ranges.
      // The low threshold is deliberately NOT asked here: it has a safe default
      // and the flow must not grow another step.
      case "targets":
        return (
          <FadeSlideIn delay={optDelay(0)}>
            <RangeInput
              label={t("period.fasting")}
              hint={t("onboarding.qFastingHint")}
              unit={glucoseUnitLabel(unit)}
              minText={fastingMin}
              maxText={fastingMax}
              onChangeMin={setFastingMin}
              onChangeMax={setFastingMax}
              axisMin={glucoseToDisplay(50, unit)}
              axisMax={glucoseToDisplay(250, unit)}
              minLabel={t("common.rangeMin")}
              maxLabel={t("common.rangeMax")}
              invalid={fastingMinMgdl >= fastingMgdl}
              invalidMessage={t("settings.rangeInvalid")}
              bounds={glucoseBounds}
              outOfBoundsMessage={t("settings.rangeOutOfBounds", {
                min: glucoseBounds.min,
                max: glucoseBounds.max,
              })}
              decimals={unit === "mmol"}
            />
            <RangeInput
              label={t("period.post_meal_2h")}
              hint={t("onboarding.qPostmealHint")}
              unit={glucoseUnitLabel(unit)}
              minText={postmealMin}
              maxText={postmealMax}
              onChangeMin={setPostmealMin}
              onChangeMax={setPostmealMax}
              axisMin={glucoseToDisplay(50, unit)}
              axisMax={glucoseToDisplay(300, unit)}
              minLabel={t("common.rangeMin")}
              maxLabel={t("common.rangeMax")}
              invalid={postmealMinMgdl >= postmealMgdl}
              invalidMessage={t("settings.rangeInvalid")}
              bounds={glucoseBounds}
              outOfBoundsMessage={t("settings.rangeOutOfBounds", {
                min: glucoseBounds.min,
                max: glucoseBounds.max,
              })}
              decimals={unit === "mmol"}
            />
          </FadeSlideIn>
        );

      case "carbRatio":
        return (
          <FadeSlideIn delay={optDelay(0)}>
            <View className="rounded-2xl bg-glass border border-hair overflow-hidden">
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
            <View className="rounded-2xl bg-glass border border-hair overflow-hidden">
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
              className="flex-row items-center justify-between rounded-2xl bg-glass border border-hair px-4 active:opacity-80"
            >
              <View className="flex-row items-center">
                <Ionicons name="moon-outline" size={20} color={THEME.accent} />
                <Text className="text-ink text-base ml-3">
                  {t("onboarding.basalTime")}
                </Text>
              </View>
              <Text className="text-ink text-lg font-semibold">{basalTime}</Text>
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
            <View className="flex-row items-start rounded-2xl border border-hair bg-glass p-4">
              <Ionicons name="notifications-outline" size={18} color={THEME.accent} />
              <Text className="text-mut text-sm leading-6 ml-3 flex-1">
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
            setUsedDefaultRatios(true);
            next();
          }}
          hitSlop={8}
          className="py-3.5 items-center"
        >
          <Text className="text-mut font-medium">{t("onboarding.notSure")}</Text>
        </Pressable>
      ) : null;

    const label = step === "diabetes" ? t("onboarding.continue") : t("onboarding.next");
    return (
      <View>
        <Button
          label={label}
          size="lg"
          disabled={step === "targets" && !rangesOk}
          onPress={next}
        />
        {notSure}
      </View>
    );
  }
}
