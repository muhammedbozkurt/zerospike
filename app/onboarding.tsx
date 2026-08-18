import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  BackHandler,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { useApp } from "../lib/store/AppContext";
import { isScreenshotMode } from "../lib/screenshotMode";
import { updateProfile, type ProfileUpdate } from "../lib/db/profiles";
import { syncBasalReminderRow } from "../lib/db/reminders";
import {
  applyNotificationPrefs,
  requestNotificationPermission,
  type NotificationPermission,
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
import { TARGET_DEFAULTS_MGDL, CARB_TARGET_DEFAULTS_G } from "../lib/diabetesDefaults";
import { RangeInput } from "../components/RangeInput";
import { Stepper } from "../components/Stepper";
import { logEvent } from "../lib/analytics";
import { hapticSelect } from "../lib/haptics";
import { Button } from "../components/ui";
import { AcceptCheck } from "../components/form";
import { BigInput } from "../components/onboarding/BigInput";
import { InlineTimePicker } from "../components/InlineTimePicker";
import { DisclaimerBanner } from "../components/Disclaimer";
import { LanguageChip } from "../components/onboarding/LanguageChip";
import { Welcome } from "../components/onboarding/Welcome";
import { QuizStep } from "../components/onboarding/QuizStep";
import { OptionCard } from "../components/onboarding/OptionCard";
import { Reveal } from "../components/onboarding/Reveal";
import { FadeSlideIn, ENTRANCE_STAGGER_MS } from "../components/onboarding/motion";
import { AppBackground } from "../components/rich";
import { THEME, GLUCOSE_RICH } from "../lib/theme/tokens";
import { upper } from "../lib/upper";
import { parseDecimalText } from "../lib/numberInput";
import { useLayout } from "../lib/useLayout";

// Sensible defaults used by the "I'm not sure" path (never blocks a new user).
// Taking this path leaves ratios_confirmed at 0, so the calculator can say out
// loud that it is running on a default rather than on the user's own number.
const DEFAULT_CARB_RATIO = 10;
const DEFAULT_ISF_MGDL = 40;

// The ADA-shaped starting ranges, prefilled so nobody has to invent a number.
// Also the generic mg/dL fallback used while parsing typed text, before any
// diabetes answer has picked a matrix-specific default (see TARGET_DEFAULTS_MGDL).
const DEFAULT_FASTING_RANGE = { min: 80, max: 130 };
const DEFAULT_POSTMEAL_RANGE = { min: 80, max: 180 };

const DIABETES_OPTIONS = ["type1", "type2", "gestational", "prediabetes", "none", "other"] as const;
type DiabetesOption = (typeof DIABETES_OPTIONS)[number];

// Post-meal check timer, asked on its own step (Wave 2a). 60 is the default only
// for gestational, since a 1-hour post-meal check is the common gestational
// pattern; every other answer defaults to 120.
const POSTMEAL_MINUTE_OPTIONS = [60, 90, 120, 150] as const;
type PostMealMinutes = (typeof POSTMEAL_MINUTE_OPTIONS)[number];

// What the user tracks, asked as one question. Insulin and oral medication are
// two independent flags on the profile, so the four answers below are just the
// four combinations of them (see effectiveTreatment / hasInsulin / hasOralMeds).
const TREATMENT_OPTIONS = ["insulin", "pills", "both", "none"] as const;
type TreatmentOption = (typeof TREATMENT_OPTIONS)[number];

type IconName = keyof typeof Ionicons.glyphMap;

const UNIT_ICONS: Record<GlucoseUnit, IconName> = {
  mgdl: "speedometer-outline",
  mmol: "flask-outline",
};

const TREATMENT_ICONS: Record<TreatmentOption, IconName> = {
  insulin: "water-outline",
  pills: "medkit-outline",
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
  | "pillsOnly"
  | "targets"
  | "carbRatio"
  | "isf"
  | "basal"
  | "postMeal"
  | "widget"
  | "notify"
  | "disclaimer";

// The fixed head of the quiz (everything after it branches on the answers).
// Hoisted so the screenshot hook below can point at the diabetes question by
// name instead of hard-coding an index that would drift if a step is inserted.
const BASE_STEPS: StepId[] = ["name", "unit", "diabetes"];
const DIABETES_STEP_IDX = BASE_STEPS.indexOf("diabetes");

/**
 * Store-screenshot ONLY: /onboarding?scOnboarding=<option> opens the quiz
 * straight on the DIABETES question with `<option>` already selected, which is
 * the 08 store panel. Purely a render shortcut - it seeds this screen's local
 * state (phase / step / answer) exactly as a real tap would leave it for the
 * instant before the auto-advance, and nothing else: Continue is never pressed,
 * so no profile or DB write ever happens. Double-locked behind isScreenshotMode()
 * (dev + env), so in a release build this returns null and the branch is dead.
 */
// "other" (prefer not to say) and a skipped question both land on the DB's
// "unknown" type - the one non-answer this screen can produce.
function diabetesTypeOf(opt: DiabetesOption | null): DiabetesType {
  return opt == null || opt === "other" ? "unknown" : opt;
}

function screenshotDiabetes(param?: string): DiabetesOption | null {
  if (!isScreenshotMode() || !param) return null;
  return (DIABETES_OPTIONS as readonly string[]).includes(param)
    ? (param as DiabetesOption)
    : null;
}

export default function OnboardingScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { contentColumn } = useLayout();
  const router = useRouter();
  const { activeProfile, bumpData, completeOnboarding } = useApp();
  const { scOnboarding } = useLocalSearchParams<{ scOnboarding?: string }>();
  // Read once, into the initial state below, so the capture opens on the right
  // step with no welcome frame in between (and a later re-render can never
  // re-arm it behind the user).
  const scDiabetes = screenshotDiabetes(scOnboarding);

  const [phase, setPhase] = useState<Phase>(scDiabetes ? "quiz" : "welcome");
  const [stepIdx, setStepIdx] = useState(scDiabetes ? DIABETES_STEP_IDX : 0);

  const [name, setName] = useState(
    activeProfile?.name ?? t("profiles.defaultName")
  );
  const [unit, setUnit] = useState<GlucoseUnit>(
    activeProfile?.glucose_unit ?? "mgdl"
  );
  const [diabetes, setDiabetes] = useState<DiabetesOption | null>(scDiabetes);
  const [treatment, setTreatment] = useState<TreatmentOption | null>(null);
  // The undiagnosed path's own answer (see the pillsOnly step): kept apart from
  // `treatment` so switching diabetes answers never mixes the two.
  const [pillsOnly, setPillsOnly] = useState<boolean | null>(null);
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
  // A prefilled ratio only becomes the user's own once they actually move the
  // control on its step. Walking past the default with Next is not a
  // confirmation, so these stay false and ratios_confirmed stays 0.
  const [carbRatioTouched, setCarbRatioTouched] = useState(false);
  const [isfTouched, setIsfTouched] = useState(false);
  // Same pattern for the target range: once the user edits a value by hand,
  // switching the diabetes answer must never overwrite it again.
  const [targetsTouched, setTargetsTouched] = useState(false);
  // Ratio + ISF are stepper-driven numbers (E.7); ISF is in the display unit.
  const [carbRatio, setCarbRatio] = useState(
    activeProfile?.carb_ratio_breakfast ?? DEFAULT_CARB_RATIO
  );
  const [isf, setIsf] = useState(
    glucoseToDisplay(activeProfile?.insulin_sensitivity_factor ?? DEFAULT_ISF_MGDL, unit)
  );
  const [basalTime, setBasalTime] = useState("22:00");
  const [showTime, setShowTime] = useState(false);
  // null until the user taps an option on the postMeal step, so the default
  // (60 for gestational, 120 otherwise) keeps following the diabetes answer
  // right up until it is actually touched - same pattern as targetsTouched.
  const [postMealMinutes, setPostMealMinutes] = useState<PostMealMinutes | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [saving, setSaving] = useState(false);
  // The real outcome of the notification prompt, shown on the notify step so the
  // flow never advances as if permission was granted when it was not.
  const [notifyResult, setNotifyResult] = useState<NotificationPermission | null>(null);

  // "none" and "prediabetes" (Wave 2a matrix) both force the tracking-only
  // path: any treatment answer picked before backing up and switching to one
  // of them must not leak into the profile, so the effective value is
  // re-derived every render instead of trusting the raw `treatment` state.
  const isTwoWayTreatment = diabetes === "none" || diabetes === "prediabetes";
  const effectiveTreatment: TreatmentOption | null =
    isTwoWayTreatment ? "none" : treatment;
  const hasInsulin =
    effectiveTreatment === "insulin" || effectiveTreatment === "both";
  const hasOralMeds = isTwoWayTreatment
    ? pillsOnly === true
    : effectiveTreatment === "pills" || effectiveTreatment === "both";
  // The default follows the diabetes answer until the user actually taps a
  // postMeal option; gestational's common post-meal check is 1 hour, everyone
  // else's is 2.
  const effectivePostMealMinutes: PostMealMinutes =
    postMealMinutes ?? (diabetes === "gestational" ? 60 : 120);

  // Branching flow: the "none" / "prediabetes" path swaps the four-way treatment
  // question for a two-option pill question and skips the carb-ratio / ISF /
  // basal-time trio (no insulin to compute for). Everyone answers the postMeal
  // timer question and gets the notification + disclaimer tail.
  const steps = useMemo<StepId[]>(() => {
    const treatmentStep: StepId[] = isTwoWayTreatment ? ["pillsOnly"] : ["insulin"];
    const branch: StepId[] = hasInsulin ? ["carbRatio", "isf", "basal"] : [];
    return [...BASE_STEPS, ...treatmentStep, "targets", ...branch, "postMeal", "widget", "notify", "disclaimer"];
  }, [isTwoWayTreatment, hasInsulin]);

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
    const x = (parseDecimalText(v) ?? NaN);
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
    // ISF is a number in the current display unit - convert it numerically.
    setIsf(glucoseToDisplay(glucoseFromDisplay(isf, unit), next));
    setUnit(next);
  }

  // Picking a diabetes answer also seeds the target-range defaults, per the
  // Wave 2a matrix (type1/type2, gestational, and prediabetes/none/unknown each
  // get their own band). Only while the user hasn't hand-edited a target value -
  // once touched, their own numbers are never overwritten.
  function selectDiabetes(opt: DiabetesOption) {
    setDiabetes(opt);
    if (targetsTouched) return;
    const { fasting, postmeal } = TARGET_DEFAULTS_MGDL[diabetesTypeOf(opt)];
    setFastingMin(String(glucoseToDisplay(fasting.min, unit)));
    setFastingMax(String(glucoseToDisplay(fasting.max, unit)));
    setPostmealMin(String(glucoseToDisplay(postmeal.min, unit)));
    setPostmealMax(String(glucoseToDisplay(postmeal.max, unit)));
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
  // fire the OS prompt here (contextual). We DON'T advance blindly: the step now
  // reflects the true outcome (on / off) and the user taps Continue to proceed,
  // so the flow never pretends permission was granted when it was not.
  async function nextFromNotify() {
    const result = await requestNotificationPermission();
    setNotifyResult(result);
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
    const v = (parseDecimalText(text) ?? NaN);
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
      const dbDiabetesType = diabetesTypeOf(diabetes);
      const carbDefaults = CARB_TARGET_DEFAULTS_G[dbDiabetesType];
      const patch: ProfileUpdate = {
        name: name.trim() || t("profiles.defaultName"),
        target_fasting_min: fastingMinMgdl,
        target_fasting_max: fastingMgdl,
        target_postmeal_min: postmealMinMgdl,
        target_postmeal_max: postmealMgdl,
        glucose_unit: unit,
        diabetes_type: dbDiabetesType,
        insulin_mode: (hasInsulin ? "both" : "none") as InsulinMode,
        // The pill surfaces (logging + the reminder row in Settings) stay hidden
        // until this is on. The reminder itself is NOT armed here: onboarding
        // never asks for a time, so it is opened from notification settings.
        oral_meds_enabled: hasOralMeds ? 1 : 0,
        // Not asked during onboarding (it has a safe default and the flow must
        // not grow a step), but it is written through the same clamp settings
        // uses so no path can seed an out-of-band threshold.
        hypo_threshold_mgdl: clampHypoThreshold(
          activeProfile.hypo_threshold_mgdl ?? 70
        ),
        // Daily carb-target default, per the type matrix (gestational's band is
        // wider; every other type keeps the app-wide 160-200g band).
        daily_carb_target_min_g: carbDefaults.min,
        daily_carb_target_g: carbDefaults.max,
      };
      // Insulin math is only relevant to insulin users; leave the profile's
      // defaults untouched otherwise.
      if (hasInsulin) {
        const cr = carbRatio;
        patch.carb_ratio_breakfast = cr;
        patch.carb_ratio_lunch = cr;
        patch.carb_ratio_dinner = cr;
        patch.insulin_sensitivity_factor = glucoseFromDisplay(isf, unit);
        // A number the user set is theirs; one they skipped past is not, and
        // the meal-log screen has to be able to tell those apart.
        patch.ratios_confirmed = carbRatioTouched && isfTouched ? 1 : 0;
      }
      await updateProfile(activeProfile.id, patch);

      // Reminder relevance follows insulin use (the basal reminder only applies
      // to insulin users); post-meal tracking stays on for everyone. The basal
      // row is written straight to the reminders registry, not left to the
      // one-time legacy-prefs bridge (lib/db/remindersBridge.ts): a process
      // killed right after an earlier, abandoned onboarding attempt already
      // consumed that one-time bridge, so a restarted onboarding choosing
      // differently would otherwise have no way left to change it.
      await setNotificationPrefs({
        ...DEFAULT_PREFS,
        basal: hasInsulin,
        basalTime,
        postMealMinutes: effectivePostMealMinutes,
      });
      await syncBasalReminderRow(hasInsulin, basalTime, true);
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

  // Optional subtitle per step (the title is derived from the step id). Steps
  // whose own controls already carry the explanation get no subtitle at all.
  function hintFor(s: StepId): string | undefined {
    switch (s) {
      case "unit":
        return t("onboarding.qUnitHint");
      case "diabetes":
        return t("onboarding.qDiabetesHint");
      case "targets":
        return diabetes === "none"
          ? t("onboarding.qTargetsHintTracking")
          : undefined;
      case "carbRatio":
        return t("onboarding.qCarbRatioHint");
      case "isf":
        return t("onboarding.qIsfHint");
      case "basal":
        return t("onboarding.qBasalHint");
      case "postMeal":
        return t("onboarding.qPostMealHint");
      default:
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
      {/* Shared header: back (quiz only) + always-present language chip. Shares
          the content column so the chip stays over the copy on a tablet instead
          of drifting to the far edge of the screen. */}
      <View
        className="px-6 pt-2 pb-2 flex-row items-center justify-between"
        style={contentColumn}
      >
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
        style={{ paddingBottom: insets.bottom + 16, ...contentColumn }}
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
            <BigInput
              value={name}
              onChangeText={setName}
              placeholder={t("onboarding.profileNamePlaceholder")}
              maxLength={40}
              accessibilityLabel={t("onboarding.profileName")}
            />
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
                  description={t(`onboarding.unitHint_${opt}`)}
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
                  onPress={() => selectAndAdvance(() => selectDiabetes(opt))}
                />
              </FadeSlideIn>
            ))}
          </View>
        );

      // One question, two flags: insulin answers map to insulin_mode "both" (the
      // carbRatio/isf/basal branch follows), pill answers to oral_meds_enabled.
      // The finer 4-way insulin distinction stays in Settings, which is its only
      // real consumer (tab visibility, IOB, calculator mode).
      case "insulin":
        return (
          <View>
            {TREATMENT_OPTIONS.map((opt, i) => (
              <FadeSlideIn key={opt} delay={optDelay(i)}>
                <OptionCard
                  icon={TREATMENT_ICONS[opt]}
                  label={t(`onboarding.treatment_${opt}`)}
                  selected={treatment === opt}
                  onPress={() => selectAndAdvance(() => setTreatment(opt))}
                />
              </FadeSlideIn>
            ))}
          </View>
        );

      // The undiagnosed path's own treatment question: only oral medication is
      // on the table here, so it is two options instead of four. Insulin stays
      // off entirely (insulin_mode "none" either way).
      case "pillsOnly":
        return (
          <View>
            {([true, false] as const).map((yes, i) => (
              <FadeSlideIn key={String(yes)} delay={optDelay(i)}>
                <OptionCard
                  icon={yes ? TREATMENT_ICONS.pills : TREATMENT_ICONS.none}
                  label={yes ? t("onboarding.treatment_pills") : t("onboarding.pillsNo")}
                  selected={pillsOnly === yes}
                  onPress={() => selectAndAdvance(() => setPillsOnly(yes))}
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
              unit={glucoseUnitLabel(unit)}
              minText={fastingMin}
              maxText={fastingMax}
              onChangeMin={(v) => {
                setFastingMin(v);
                setTargetsTouched(true);
              }}
              onChangeMax={(v) => {
                setFastingMax(v);
                setTargetsTouched(true);
              }}
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
              onChangeMin={(v) => {
                setPostmealMin(v);
                setTargetsTouched(true);
              }}
              onChangeMax={(v) => {
                setPostmealMax(v);
                setTargetsTouched(true);
              }}
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
            <Stepper
              value={carbRatio}
              onChange={(v) => {
                setCarbRatio(v);
                setCarbRatioTouched(true);
              }}
              step={0.5}
              longStep={1}
              min={1}
              max={50}
              decimals={1}
              suffix={t("common.carbRatioUnit")}
              accessibilityLabel={t("settings.carbRatios")}
            />
          </FadeSlideIn>
        );

      case "isf":
        return (
          <FadeSlideIn delay={optDelay(0)}>
            <Stepper
              value={isf}
              onChange={(v) => {
                setIsf(v);
                setIsfTouched(true);
              }}
              step={unit === "mmol" ? 0.1 : 1}
              longStep={unit === "mmol" ? 0.5 : 5}
              min={unit === "mmol" ? 0.5 : 5}
              max={unit === "mmol" ? 30 : 500}
              decimals={unit === "mmol" ? 1 : 0}
              suffix={glucoseUnitLabel(unit)}
              accessibilityLabel={t("settings.isf")}
            />
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

      // Select-then-continue, like "unit": a type-appropriate default is
      // already highlighted, so Continue works even if nothing is tapped.
      case "postMeal":
        return (
          <View>
            {POSTMEAL_MINUTE_OPTIONS.map((opt, i) => (
              <FadeSlideIn key={opt} delay={optDelay(i)}>
                <OptionCard
                  label={t("settings.minutes", { n: opt })}
                  selected={effectivePostMealMinutes === opt}
                  onPress={() => {
                    hapticSelect();
                    setPostMealMinutes(opt);
                  }}
                />
              </FadeSlideIn>
            ))}
          </View>
        );

      case "widget":
        return (
          <FadeSlideIn delay={optDelay(0)}>
            {/* The numbers below are drawn, not the user's own records, so they
                carry the same sample label the reveal preview uses. */}
            <Text
              style={{
                color: THEME.muted,
                fontSize: 11,
                letterSpacing: 1.3,
                fontWeight: "800",
                marginBottom: 8,
              }}
            >
              {upper(t("onboarding.sampleBadge"))}
            </Text>
            {/* Lock-screen Live Activity mock (in-app drawing, no OS permission). */}
            <View className="rounded-2xl border border-hair bg-glass p-4">
              <View className="flex-row items-center" style={{ gap: 12 }}>
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    backgroundColor: THEME.accent,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name="pulse" size={20} color="#00171c" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text className="text-mut text-[11px] font-bold">zerospike</Text>
                  <Text className="text-ink text-sm font-bold" numberOfLines={1}>
                    {t("dashboard.quickPostMealTitle")}{" "}
                    {t("dashboard.quickPostMealWindow", { n: 120 })}
                  </Text>
                </View>
                <Text style={{ color: THEME.accent, fontSize: 18, fontWeight: "800" }}>1:12</Text>
              </View>
              <View
                style={{ height: 5, borderRadius: 3, backgroundColor: THEME.track, overflow: "hidden", marginTop: 10 }}
              >
                <View style={{ height: "100%", width: "40%", backgroundColor: THEME.accent }} />
              </View>
            </View>
            {/* Home-screen widget mock */}
            <View className="flex-row mt-3" style={{ gap: 12 }}>
              <View
                style={{
                  width: 96,
                  height: 96,
                  borderRadius: 18,
                  borderWidth: 1,
                  borderColor: THEME.border,
                  backgroundColor: THEME.glass,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text className="text-mut text-[9px] font-bold">
                  {upper(t("widget.lastReading"))}
                </Text>
                <Text style={{ color: GLUCOSE_RICH.target, fontSize: 28, fontWeight: "800" }}>112</Text>
                <Text className="text-mut text-[10px]">mg/dL</Text>
              </View>
              <View style={{ flex: 1, justifyContent: "center" }}>
                <Text className="text-ink text-sm leading-6">{t("onboarding.widgetIntro")}</Text>
              </View>
            </View>
          </FadeSlideIn>
        );

      case "notify":
        return (
          <FadeSlideIn delay={optDelay(0)}>
            {notifyResult == null ? (
              <View className="flex-row items-start rounded-2xl border border-hair bg-glass p-4">
                <Ionicons name="notifications-outline" size={18} color={THEME.accent} />
                <Text className="text-mut text-sm leading-6 ml-3 flex-1">
                  {t("onboarding.notifRationale")}
                </Text>
              </View>
            ) : notifyResult === "granted" ? (
              <View className="flex-row items-center rounded-2xl border border-hair bg-glass p-4">
                <Ionicons name="checkmark-circle" size={20} color={GLUCOSE_RICH.target} />
                <Text className="text-ink text-sm leading-6 ml-3 flex-1">
                  {t("onboarding.notifGranted")}
                </Text>
              </View>
            ) : (
              <View className="rounded-2xl border border-hair bg-glass p-4">
                <View className="flex-row items-start">
                  <Ionicons name="notifications-off-outline" size={20} color={THEME.muted} />
                  <Text className="text-mut text-sm leading-6 ml-3 flex-1">
                    {t("onboarding.notifOff")}
                  </Text>
                </View>
                <Pressable
                  onPress={() => Linking.openSettings()}
                  className="mt-3 flex-row items-center justify-center rounded-xl border border-hair py-2.5 active:opacity-80"
                >
                  <Ionicons name="settings-outline" size={16} color={THEME.accent} />
                  <Text className="text-brand font-semibold ml-2">
                    {t("settings.openSystemSettings")}
                  </Text>
                </Pressable>
              </View>
            )}
            {/* Camera + Apple Health are only INTRODUCED here; the OS ask stays at
                the point of use (first barcode scan / when Health is opened). */}
            <View className="mt-3 flex-row items-start rounded-2xl border border-hair bg-glass p-4">
              <Ionicons name="barcode-outline" size={18} color={THEME.accent} />
              <Text className="text-mut text-sm leading-6 ml-3 flex-1">
                {t("onboarding.permCamera")}
              </Text>
            </View>
            <View className="mt-3 flex-row items-start rounded-2xl border border-hair bg-glass p-4">
              <Ionicons name="fitness-outline" size={18} color={THEME.accent} />
              <Text className="text-mut text-sm leading-6 ml-3 flex-1">
                {t("onboarding.permHealth")}
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
    if (step === "insulin" || step === "pillsOnly") return null;

    if (step === "notify") {
      // Before asking: the prompt trigger. After a result: a plain Continue, so
      // the flow advances only on an explicit tap and never fakes a grant.
      return notifyResult == null ? (
        <View>
          <Button label={t("onboarding.notifyCta")} size="lg" onPress={nextFromNotify} />
          <Pressable onPress={next} hitSlop={8} className="py-3.5 items-center">
            <Text className="text-mut font-medium">{t("onboarding.skipForNow")}</Text>
          </Pressable>
        </View>
      ) : (
        <Button label={t("onboarding.continue")} size="lg" onPress={next} />
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
            if (step === "carbRatio") {
              setCarbRatio(DEFAULT_CARB_RATIO);
              setCarbRatioTouched(false);
            } else {
              setIsf(glucoseToDisplay(DEFAULT_ISF_MGDL, unit));
              setIsfTouched(false);
            }
            next();
          }}
          hitSlop={8}
          className="py-3.5 items-center"
        >
          <Text className="text-mut font-medium">{t("onboarding.notSure")}</Text>
        </Pressable>
      ) : null;

    // The diabetes question is optional, but skipping it has to be a deliberate
    // tap: Continue stays inert until something is picked, and the skip sits
    // next to it as its own action instead of hiding inside Continue.
    const skipQuestion =
      step === "diabetes" ? (
        <Pressable onPress={next} hitSlop={8} className="py-3.5 items-center">
          <Text className="text-mut font-medium">{t("onboarding.skipQuestion")}</Text>
        </Pressable>
      ) : null;

    const label = step === "diabetes" ? t("onboarding.continue") : t("onboarding.next");
    return (
      <View>
        <Button
          label={label}
          size="lg"
          disabled={
            (step === "targets" && !rangesOk) ||
            (step === "diabetes" && diabetes == null)
          }
          onPress={next}
        />
        {notSure}
        {skipQuestion}
      </View>
    );
  }
}
