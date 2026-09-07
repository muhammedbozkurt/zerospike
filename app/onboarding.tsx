import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  BackHandler,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { useApp } from "../lib/store/AppContext";
import { isScreenshotMode } from "../lib/screenshotMode";
import { updateProfile, type ProfileUpdate } from "../lib/db/profiles";
import {
  createReminder,
  listReminders,
  syncBasalReminderRow,
  updateReminder,
} from "../lib/db/reminders";
import {
  applyNotificationPrefs,
  requestNotificationPermission,
  type NotificationPermission,
} from "../lib/services/notifications";
import {
  DEFAULT_PREFS,
  setNotificationPrefs,
} from "../lib/services/notificationPrefs";
import {
  getAlarmAuthorizationStatus,
  isAlarmKitAvailable,
} from "../modules/zerospike-alarmkit";
import {
  ensureAlarmAuthorizationOnce,
  setUpReminderPlan,
} from "../lib/services/reminderPlan";
import { presetFor, type ReminderPreset } from "../lib/reminderPresets";
import {
  ReminderPlanPreview,
  usePresetLabel,
} from "../components/ReminderPlanPreview";
import { buildRevealPlan, type RevealPlanItem } from "../lib/revealPlan";
import { POST_MEAL_WINDOW_MIN } from "../lib/postMealTimer";
import type { DiabetesType, GlucoseUnit, InsulinMode } from "../lib/db/types";
import {
  clampHypoThreshold,
  clampTarget,
  formatGlucose,
  glucoseToDisplay,
  glucoseFromDisplay,
  glucoseUnitLabel,
  TARGET_RANGE_BOUNDS,
} from "../lib/glucose";
import { TARGET_DEFAULTS_MGDL, CARB_TARGET_DEFAULTS_G } from "../lib/diabetesDefaults";
import { RangeInput } from "../components/RangeInput";
import { Stepper } from "../components/Stepper";
import { InsulinProductPicker } from "../components/InsulinProductPicker";
import { OTHER_PRODUCT_ID, isMixSelection } from "../lib/insulinCatalog";
import { logEvent } from "../lib/analytics";
import { HEALTH_NAME } from "../lib/services/health";
import { hapticSelect } from "../lib/haptics";
import { SectionLabel } from "../components/ui";
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
import { AppBackground, GradientCTA, withAlpha } from "../components/rich";
import { RADIUS, TABULAR, THEME, GLUCOSE_RICH } from "../lib/theme/tokens";
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

/** Ink on top of the accent fill (check discs) - never pure black. */
const ON_ACCENT = "#062126";

type Phase = "welcome" | "quiz" | "reveal";
type StepId =
  | "name"
  | "unit"
  | "diabetes"
  | "insulin"
  | "pillsOnly"
  | "targets"
  | "insulinProducts"
  | "carbRatio"
  | "isf"
  | "basal"
  | "widget"
  | "notify"
  | "medReminder"
  | "reminderPlan"
  | "disclaimer";

/**
 * The anchor glyph per step. Ionicons throughout - the app's icon language does
 * not change for one screen - picking the nearest glyph to each approved mark.
 * A step missing from this map draws none on purpose: its own content (the six
 * diabetes options, the two range editors, the insulin form, the widget band,
 * the reminder layout) already fills the frame, and a plate above it would only
 * push the CTA off a short phone.
 */
const STEP_GLYPHS: Partial<Record<StepId, IconName>> = {
  name: "person-outline",
  unit: "speedometer-outline",
  insulin: "medical-outline",
  pillsOnly: "medkit-outline",
  carbRatio: "water-outline",
  isf: "locate-outline",
  basal: "moon-outline",
  medReminder: "medkit-outline",
  notify: "notifications-outline",
  disclaimer: "shield-outline",
};

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

/**
 * A "the app will do this at HH:MM" row: an icon plate, what it is, and the
 * time. Module level so toggling the picker under it never remounts the row.
 */
function TimeRow({
  icon,
  label,
  value,
  onPress,
}: {
  icon: IconName;
  label: string;
  value: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityValue={{ text: value }}
      className="active:opacity-80"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        minHeight: 64,
        paddingHorizontal: 18,
        paddingVertical: 16,
        borderRadius: RADIUS.lg,
        borderWidth: 1,
        borderColor: THEME.border,
        backgroundColor: THEME.glass,
      }}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: RADIUS.md,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: withAlpha(THEME.accent, 0.1),
        }}
      >
        <Ionicons name={icon} size={22} color={THEME.accent} />
      </View>
      <Text style={{ color: THEME.ink, fontSize: 16, lineHeight: 22, flex: 1 }}>
        {label}
      </Text>
      <Text style={[TABULAR, { color: THEME.ink, fontSize: 19, fontWeight: "700" }]}>
        {value}
      </Text>
    </Pressable>
  );
}

/** A plain "why we are asking" card: one icon, one sentence, no action. */
function RationaleCard({
  icon,
  tint = THEME.accent,
  children,
  style,
}: {
  icon: IconName;
  tint?: string;
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  return (
    <View
      style={[
        {
          flexDirection: "row",
          alignItems: "flex-start",
          gap: 12,
          padding: 18,
          borderRadius: RADIUS.lg,
          borderWidth: 1,
          borderColor: THEME.border,
          backgroundColor: THEME.glass,
        },
        style,
      ]}
    >
      <Ionicons name={icon} size={20} color={tint} />
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  );
}

/**
 * The pinned primary action, identical on every step: the app's gradient CTA
 * as a full-width pill. One component, so a step can never grow a CTA of its
 * own size or shape.
 */
function PrimaryCta({
  label,
  onPress,
  disabled,
  loading,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <GradientCTA
      label={label}
      size="lg"
      style={{ borderRadius: RADIUS.full }}
      disabled={disabled}
      loading={loading}
      onPress={onPress}
    />
  );
}

/** The "skip / not now / I do not know" link under the CTA. The vertical
 *  padding is the touch target, and the gap the frame asks for comes out of it. */
function SecondaryLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="py-3.5 items-center"
    >
      <Text style={{ color: THEME.muted, fontSize: 15, fontWeight: "500" }}>{label}</Text>
    </Pressable>
  );
}

/** Body copy of a rationale card - one metric, used by all of them. */
function RationaleText({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "ink";
}) {
  return (
    <Text
      style={{
        color: tone === "ink" ? THEME.ink : THEME.muted,
        fontSize: 15,
        lineHeight: 22,
      }}
    >
      {children}
    </Text>
  );
}

export default function OnboardingScreen() {
  const { t } = useTranslation();
  // Android has no lock-screen widgets and no standalone injection widget
  // (see widget-guide.tsx's Android section): the "widget" step's preview
  // below drops both for Android instead of showing surfaces that do not
  // exist there.
  const ios = Platform.OS === "ios";
  const insets = useSafeAreaInsets();
  const { columnPad, height, isWide } = useLayout();
  const router = useRouter();
  const { activeProfile, bumpData, completeOnboarding } = useApp();
  const { scOnboarding } = useLocalSearchParams<{ scOnboarding?: string }>();
  // Read once, into the initial state below, so the capture opens on the right
  // step with no welcome frame in between (and a later re-render can never
  // re-arm it behind the user).
  const scDiabetes = screenshotDiabetes(scOnboarding);
  // The Play PHONE canvas frames only the top 57% of a 1080x2400 capture,
  // against 78% on the iPhone one, so the answer the panel is about ("no
  // diagnosis", the fifth of six) falls below the frame while the same shot is
  // fine on iOS and on both tablets (79%, and they render the wide dialog).
  // Scrolling cannot fix it: the six cards are SHORTER than the scroller, so
  // there is nothing to scroll. What fits instead is the app's own short-screen
  // rhythm plus a top-aligned list - the layout this screen already renders on
  // a phone under DENSE_HEIGHT, where the block fills the room and the centring
  // is a no-op. Nothing is hidden, resized or reordered.
  //
  // Locked to the capture route (scOnboarding, itself behind isScreenshotMode)
  // AND to a narrow Android window, so iOS captures stay byte-identical and the
  // two tablet profiles keep the wide dialog they already frame correctly.
  const scCompact = scDiabetes != null && Platform.OS === "android" && !isWide;

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
  // The insulinProducts step's own answers: which catalog product (or "other"
  // + a typed name) for each slot, and the self-reported daily basal amount.
  // Entirely optional - left at their profile/seed defaults, this step can be
  // walked past with no write of its own (finishToReveal only sends these
  // while hasInsulin, same gate as carbRatio/isf below).
  const [basalInsulinId, setBasalInsulinId] = useState<string | null>(
    activeProfile?.basal_insulin_id ?? null
  );
  const [bolusInsulinId, setBolusInsulinId] = useState<string | null>(
    activeProfile?.bolus_insulin_id ?? null
  );
  const [basalInsulinOther, setBasalInsulinOther] = useState<string | null>(
    activeProfile?.basal_insulin_other ?? null
  );
  const [bolusInsulinOther, setBolusInsulinOther] = useState<string | null>(
    activeProfile?.bolus_insulin_other ?? null
  );
  const [basalDailyUnits, setBasalDailyUnits] = useState(
    activeProfile?.basal_daily_units ?? 0
  );
  // Premix UI toggle (P9): the insulinProducts step's two layouts are derived
  // from isMixSelection(basalInsulinId, bolusInsulinId) - true once a premix
  // product has actually been picked. This extra flag only covers the instant
  // between tapping "mixUse" and picking one: with no product chosen yet the
  // two ids are still null/null, so the derivation alone cannot tell "premix,
  // nothing picked" apart from "separate mode". Reset to false by mixOff.
  const [mixModeUi, setMixModeUi] = useState(false);
  // The optional pill-reminder step (medReminder): a plain 08:00 default, its
  // own picker toggle, and the id of the row once "Kur" actually creates one -
  // kept so tapping "Kur" again after navigating back UPDATES that same row
  // instead of creating a second one (the exact duplicate-row shape this wave
  // also fixes for the basal reminder - see lib/db/reminders.ts).
  const [medReminderTime, setMedReminderTime] = useState("08:00");
  const [showMedTime, setShowMedTime] = useState(false);
  const [medReminderId, setMedReminderId] = useState<string | null>(null);
  const [savingMedReminder, setSavingMedReminder] = useState(false);
  // The ready-made measurement layout (reminderPlan, 2.3.0's K2-E), which
  // replaced the single-time glucoseReminder step. Only REMOVALS are stored, by
  // TIME, so the layout keeps following the diabetes answer if the user walks
  // back and changes it - the same "derived until touched" shape targetsTouched
  // uses. A removed time that also appears in the new answer's layout stays
  // removed, which is the reading that matches what the user actually did
  // ("not at 07:30") rather than "not that row".
  const [removedPlanTimes, setRemovedPlanTimes] = useState<string[]>([]);
  const [savingPlan, setSavingPlan] = useState(false);
  const planRows = useMemo<ReminderPreset[]>(
    () =>
      presetFor(diabetesTypeOf(diabetes)).filter(
        (r) => !removedPlanTimes.includes(r.time)
      ),
    [diabetes, removedPlanTimes]
  );
  // What the reveal card lists at the end, built from the rows that were
  // REALLY written (see lib/revealPlan.ts). Empty until finishToReveal fills it.
  const [revealPlan, setRevealPlan] = useState<RevealPlanItem[]>([]);
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
  // Branching flow: the "none" / "prediabetes" path swaps the four-way treatment
  // question for a two-option pill question and skips the carb-ratio / ISF /
  // basal-time trio (no insulin to compute for). Everyone gets the widget,
  // notification, reminder-layout and disclaimer tail.
  const steps = useMemo<StepId[]>(() => {
    const treatmentStep: StepId[] = isTwoWayTreatment ? ["pillsOnly"] : ["insulin"];
    const branch: StepId[] = hasInsulin
      ? ["insulinProducts", "carbRatio", "isf", "basal"]
      : [];
    // Offered only to whoever tracks pills (the "pills" or "both" answer):
    // insulin-only users have nothing to set up here, and it never blocks
    // finishing - "Simdi degil" always moves on with no reminder created.
    const medReminderStep: StepId[] = hasOralMeds ? ["medReminder"] : [];
    // The ready-made measurement layout (K2-E), offered on every path, unlike
    // medReminder above. Always AFTER notify: setting it up fires the OS
    // permission prompts right away (see setupReminderPlan), and that must
    // never happen before the notify step's own on-screen rationale has been
    // shown. After medReminder on the pill path too, so the two reminder setups
    // sit back to back.
    const reminderPlanStep: StepId[] = ["reminderPlan"];
    return [
      ...BASE_STEPS,
      ...treatmentStep,
      "targets",
      ...branch,
      "widget",
      "notify",
      ...medReminderStep,
      ...reminderPlanStep,
      "disclaimer",
    ];
  }, [isTwoWayTreatment, hasInsulin, hasOralMeds]);

  const stepIdxClamped = Math.min(stepIdx, steps.length - 1);
  const step = steps[stepIdxClamped];

  const advancingRef = useRef(false);
  useEffect(() => {
    advancingRef.current = false;
  }, [stepIdxClamped, phase]);

  // The alarm framing only appears where AlarmKit exists (iOS 26+); anywhere
  // else the reminder is a notification and saying otherwise would be a
  // promise the OS cannot keep. The prompt itself is asked at most once per
  // app run, from the device-level lock in lib/services/reminderPlan.ts -
  // shared with profile setup, which is the other place that writes reminders
  // on the user's behalf.
  const alarmKitAvailable = useMemo(() => isAlarmKitAvailable(), []);
  const presetLabel = usePresetLabel();

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
        // The insulinProducts step's own answers (schema v22, see
        // ../lib/insulinCatalog). All optional - a skipped step simply writes
        // the seed profile's defaults (null / null / 0 -> null), same as every
        // other "walked past it" field on this screen.
        patch.basal_insulin_id = basalInsulinId;
        patch.bolus_insulin_id = bolusInsulinId;
        patch.basal_insulin_other = basalInsulinOther;
        patch.bolus_insulin_other = bolusInsulinOther;
        patch.basal_daily_units = basalDailyUnits > 0 ? basalDailyUnits : null;
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
        // The weekly summary starts ON for a brand-new user, and only here: a
        // full blob written at the end of onboarding is the one moment the app
        // knows it is choosing for someone who has chosen nothing. Turning it
        // on in DEFAULT_PREFS instead would have flipped it on for every
        // existing install too, since that object also backfills fields absent
        // from an older stored blob (lib/services/notificationPrefs.ts).
        weekly: true,
      });
      await syncBasalReminderRow(hasInsulin, basalTime, true);
      await applyNotificationPrefs();

      // The closing card describes what was ACTUALLY set up, so it is built
      // here - after every row this flow can create exists - rather than from
      // the answers. A user who chose "Not now" simply has no measurement line.
      try {
        const alarmKit = isAlarmKitAvailable();
        setRevealPlan(
          buildRevealPlan({
            rows: await listReminders(),
            postMeal: DEFAULT_PREFS.postMeal,
            lowFollowup: DEFAULT_PREFS.lowFollowup,
            postMealMinutes: POST_MEAL_WINDOW_MIN,
            alarmKitAvailable: alarmKit,
            alarmAuthorized:
              alarmKit && getAlarmAuthorizationStatus() === "authorized",
          })
        );
      } catch {
        // best-effort: the card simply shows nothing rather than a wrong list
      }

      bumpData();
      await completeOnboarding();
      logEvent("onboarding_done", {});
      setPhase("reveal");
    } finally {
      setSaving(false);
    }
  }

  function goToDashboard() {
    // 2.3.4: onboarding no longer hands off to the paywall - the reveal's
    // "Continue" now lands straight on the dashboard. The paywall itself
    // opens later, once this profile's own log count first reaches 3 (see
    // lib/afterLogsPaywall.ts), not as a tax on finishing the quiz.
    router.replace("/(tabs)");
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
      case "insulinProducts":
        return t("onboarding.qInsulinProductsHint");
      case "carbRatio":
        return t("onboarding.qCarbRatioHint");
      case "isf":
        return t("onboarding.qIsfHint");
      case "basal":
        return t("onboarding.qBasalHint");
      case "medReminder":
        return t("onboarding.qMedReminderHint");
      case "reminderPlan":
        return t("onboarding.qReminderPlanHint");
      default:
        return undefined;
    }
  }

  // Title per step, derived from the step id itself (onboarding.q<Step>). The
  // reminder layout deliberately has ONE title for every path: its wording must
  // not vary with the diabetes answer, because that is exactly the kind of
  // type-specific framing K2-E keeps off this screen.
  function titleFor(s: StepId): string {
    return t(`onboarding.q${s[0].toUpperCase()}${s.slice(1)}`);
  }

  // "Kur": writes (or, on a second visit, updates) the single med reminder row
  // straight to the registry - the same direct-write pattern basal already
  // uses - then asks for notification permission (existing onboarding
  // pattern, see nextFromNotify above). Never blocks Continue: a failed write
  // (or a denied permission) still advances, since the reminder can always be
  // set up later from Settings > Reminders.
  async function setupMedReminder() {
    if (savingMedReminder) return;
    setSavingMedReminder(true);
    try {
      // A killed-and-restarted onboarding attempt loses medReminderId along
      // with every other component state, but the row an earlier "Kur" tap
      // already wrote to this profile is still there - update THAT one
      // instead of writing a second "med" row (the same singleton discipline
      // syncBasalReminderRow already applies to basal). Only the label-less/
      // generic row counts: a med reminder the user later names for a
      // specific medication in Settings must never be silently repurposed.
      const existingId =
        medReminderId ??
        (await listReminders()).find(
          (r) => r.type === "med" && !(r.label && r.label.trim())
        )?.id ??
        null;
      if (existingId) {
        await updateReminder(existingId, { time: medReminderTime, enabled: true });
        setMedReminderId(existingId);
      } else {
        const row = await createReminder({
          // Spelled out rather than left to the default: this is the app
          // setting a delivery on the user's behalf, and alarmUserSet is
          // deliberately NOT sent - they have not chosen anything yet.
          alarmEnabled: true,
          type: "med",
          time: medReminderTime,
          enabled: true,
        });
        setMedReminderId(row.id);
      }
      await requestNotificationPermission();
      await ensureAlarmAuthorizationOnce();
    } catch {
      // best-effort - Settings > Reminders is always there to try again
    } finally {
      setSavingMedReminder(false);
    }
    next();
  }

  /**
   * "Set up this plan" (2.3.0's K2-E). The write, the replace-not-merge rule
   * and the two permission prompts all live in setUpReminderPlan
   * (lib/services/reminderPlan.ts), shared with app/profile-setup.tsx so a
   * profile added later gets the exact same layout and the exact same asks.
   * "Not now" writes nothing and asks for nothing at all: it is plain `next()`
   * in the footer below.
   *
   * The profile is passed explicitly for the same reason profile setup does it,
   * even though onboarding cannot switch profiles: it is the one write here
   * that is also reachable from a screen that can, and a single call shape
   * keeps the two from drifting. The outcome is deliberately not surfaced -
   * finishing onboarding is never blocked by a reminder that did not land.
   */
  async function setupReminderPlan() {
    if (savingPlan) return;
    setSavingPlan(true);
    try {
      await setUpReminderPlan(planRows, presetLabel, activeProfile?.id);
    } finally {
      setSavingPlan(false);
    }
    next();
  }

  const optDelay = (i: number) => ENTRANCE_STAGGER_MS * 2 + i * 50;
  const progress = (stepIdxClamped + 1) / steps.length;

  const onBack =
    phase !== "quiz"
      ? undefined
      : stepIdxClamped === 0
        ? () => setPhase("welcome")
        : back;

  // Shared header + phase body. The quiz phase now pins its own scrolling
  // shell (QuizStep) with a footer that carries insets.bottom itself, so this
  // wrapper only adds the safe-area gap for the two phases that have no
  // footer of their own (welcome, reveal) - adding it here too would pad the
  // quiz phase twice.
  const shellBody = (
    <>
      {/* Shared header: back (quiz only) + always-present language chip. Shares
          the content column so the chip stays over the copy on a tablet instead
          of drifting to the far edge of the screen. */}
      <View
        className="pt-2 pb-2 flex-row items-center justify-between"
        style={columnPad(24)}
      >
        {onBack ? (
          <Pressable
            onPress={onBack}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t("common.back")}
            className="rounded-full border border-hair bg-glass items-center justify-center active:opacity-80"
            style={{ width: 36, height: 36 }}
          >
            <Ionicons name="chevron-back" size={18} color={THEME.ink} />
          </Pressable>
        ) : (
          <View style={{ width: 36 }} />
        )}
        <LanguageChip />
      </View>

      <View
        className="flex-1"
        style={{ paddingBottom: phase === "quiz" ? 16 : insets.bottom + 16, ...columnPad(24) }}
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
            plan={revealPlan}
            onContinue={goToDashboard}
          />
        ) : null}

        {phase === "quiz" ? (
          <QuizStep
            key={step}
            progress={progress}
            title={titleFor(step)}
            hint={hintFor(step)}
            glyph={STEP_GLYPHS[step]}
            // The disclaimer is the one step that is a notice, not a question.
            glyphTone={step === "disclaimer" ? "caution" : "accent"}
            footer={renderFooter()}
            insetsBottom={insets.bottom}
            compact={scCompact}
          >
            {renderContent()}
          </QuizStep>
        ) : null}
      </View>
    </>
  );

  return (
    <AppBackground style={{ paddingTop: insets.top }}>
      {/* Android: no KeyboardAvoidingView here - adjustResize plus QuizStep's
          own scrolling shell already lift the focused field above the
          keyboard, and stacking a second lift on top of that used to
          over-compensate (see the removed automaticallyAdjustKeyboardInsets
          note this replaced). iOS keeps the padding behavior: it has no
          resize-on-keyboard equivalent. */}
      {ios ? (
        <KeyboardAvoidingView behavior="padding" className="flex-1">
          {shellBody}
        </KeyboardAvoidingView>
      ) : (
        <View className="flex-1">{shellBody}</View>
      )}
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
            {/* The one question a user could read as "one profile per app":
                say up front that the others live in Settings. */}
            <View
              className="flex-row items-center justify-center"
              style={{ marginTop: 18, gap: 8 }}
            >
              <Ionicons name="information-circle-outline" size={15} color={THEME.muted} />
              <Text
                style={{ color: THEME.muted, fontSize: 13, lineHeight: 18, flexShrink: 1 }}
              >
                {t("onboarding.qNameHint")}
              </Text>
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
                  description={t(`onboarding.unitHint_${opt}`)}
                  spacing={14}
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
                  // Six options in one frame: the tightest gap of the three
                  // option lists, so the last one still clears the CTA. The
                  // Play phone capture takes it tighter still; see scCompact.
                  spacing={scCompact ? 4 : 10}
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

      // Optional, skippable (see the "gec" link in the footer): which product
      // for each slot the user actually uses, and the daily basal amount they
      // record themselves. Nothing here is a suggestion - both pickers store
      // exactly what the user picks/types, and a blank step writes nothing.
      case "insulinProducts": {
        const mixMode = mixModeUi || isMixSelection(basalInsulinId, bolusInsulinId);
        const basalUnitsField = (
          <View style={{ marginTop: 16 }}>
            <Text style={{ color: THEME.ink, fontSize: 14, marginBottom: 8 }}>
              {t("settings.basalDailyUnits")}
            </Text>
            <Stepper
              value={basalDailyUnits}
              onChange={setBasalDailyUnits}
              step={1}
              longStep={5}
              min={0}
              max={200}
              decimals={0}
              suffix={t("common.units")}
              // The one number entered on this step, so it gets the wider strip.
              size="lg"
              accessibilityLabel={t("settings.basalDailyUnits")}
            />
            <Text style={{ color: THEME.muted, fontSize: 13, lineHeight: 18, marginTop: 8 }}>
              {t("settings.basalDailyUnitsHint")}
            </Text>
          </View>
        );
        return mixMode ? (
          <FadeSlideIn delay={optDelay(0)}>
            <SectionLabel>{t("insulinPicker.groupMix")}</SectionLabel>
            <InsulinProductPicker
              label={t("insulinPicker.groupMix")}
              value={basalInsulinId}
              otherValue={basalInsulinOther}
              slot="mix"
              size="lg"
              onChange={(id) => {
                // A premix fills BOTH DB fields at once (see isMixSelection):
                // there is no separate "mix" column, the two ids being equal
                // and a mix-category product IS the mix state.
                setBasalInsulinId(id);
                setBolusInsulinId(id);
                if (id !== OTHER_PRODUCT_ID) {
                  setBasalInsulinOther(null);
                  setBolusInsulinOther(null);
                }
              }}
              onOtherChange={(text) => {
                setBasalInsulinOther(text);
                setBolusInsulinOther(text);
              }}
            />
            {basalUnitsField}
            <Pressable
              onPress={() => {
                setMixModeUi(false);
                setBasalInsulinId(null);
                setBolusInsulinId(null);
                setBasalInsulinOther(null);
                setBolusInsulinOther(null);
              }}
              hitSlop={8}
              className="py-3.5 items-center"
              style={{ marginTop: 10 }}
            >
              <Text style={{ color: THEME.accent, fontSize: 15, fontWeight: "500" }}>
                {t("insulinPicker.mixOff")}
              </Text>
            </Pressable>
          </FadeSlideIn>
        ) : (
          <FadeSlideIn delay={optDelay(0)}>
            <SectionLabel>{t("settings.basalInsulin")}</SectionLabel>
            <InsulinProductPicker
              label={t("settings.basalInsulin")}
              value={basalInsulinId}
              otherValue={basalInsulinOther}
              slot="basal"
              size="lg"
              onChange={(id) => {
                setBasalInsulinId(id);
                if (id !== OTHER_PRODUCT_ID) setBasalInsulinOther(null);
              }}
              onOtherChange={setBasalInsulinOther}
            />
            {basalUnitsField}

            <View style={{ marginTop: 24 }}>
              <SectionLabel>{t("settings.bolusInsulin")}</SectionLabel>
              <InsulinProductPicker
                label={t("settings.bolusInsulin")}
                value={bolusInsulinId}
                otherValue={bolusInsulinOther}
                slot="bolus"
                size="lg"
                onChange={(id) => {
                  setBolusInsulinId(id);
                  if (id !== OTHER_PRODUCT_ID) setBolusInsulinOther(null);
                }}
                onOtherChange={setBolusInsulinOther}
              />
            </View>

            <Pressable
              onPress={() => setMixModeUi(true)}
              hitSlop={8}
              className="py-3.5 items-center"
              style={{ marginTop: 10 }}
            >
              {/* Accent, not muted: this is a real alternative shape of the
                  step, not the "skip" link the footer already carries. */}
              <Text style={{ color: THEME.accent, fontSize: 15, fontWeight: "500" }}>
                {t("insulinPicker.mixUse")}
              </Text>
            </Pressable>
          </FadeSlideIn>
        );
      }

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
              variant="hero"
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
              variant="hero"
              accessibilityLabel={t("settings.isf")}
            />
          </FadeSlideIn>
        );

      case "basal":
        return (
          <FadeSlideIn delay={optDelay(0)}>
            <TimeRow
              icon="moon-outline"
              label={t("onboarding.basalTime")}
              value={basalTime}
              onPress={() => setShowTime((s) => !s)}
            />
            <InlineTimePicker
              visible={showTime}
              value={basalTime}
              onChange={setBasalTime}
              onClose={() => setShowTime(false)}
            />
            <Text style={{ color: THEME.muted, fontSize: 13, lineHeight: 18, marginTop: 8 }}>
              {t("onboarding.basalReminderTip")}
            </Text>
          </FadeSlideIn>
        );

      case "widget": {
        // The band has to clear the pinned footer on a short phone: the tiles
        // are drawn at the mock's 118dp and give up height proportionally
        // below that, so the row stays a band and never becomes a stack.
        const band = Math.min(118, height * 0.16);
        const s = band / 118;
        // Stylised drawings in this screen's own primitives, not the real
        // widget code: the extension cannot render here, and the point of the
        // step is "here is what you would be adding", not a pixel-accurate
        // preview. The numbers are invented, which is what the badge says.
        const tileStyle = (accent?: boolean): ViewStyle => ({
          flex: 1,
          maxWidth: 104,
          height: band,
          borderRadius: 18,
          borderWidth: 1,
          borderColor: accent ? withAlpha(THEME.accent, 0.35) : THEME.border,
          backgroundColor: THEME.glass,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: 6,
          gap: 6 * s,
        });
        const tileCaption = (text: string) => (
          <Text
            numberOfLines={2}
            style={{ color: THEME.muted, fontSize: 11, lineHeight: 14, textAlign: "center" }}
          >
            {text}
          </Text>
        );
        return (
          <FadeSlideIn delay={optDelay(0)}>
            <Text
              style={{
                color: THEME.muted,
                fontSize: 11,
                letterSpacing: 1.3,
                fontWeight: "800",
                marginBottom: 10,
                textAlign: "center",
              }}
            >
              {upper(t("onboarding.sampleBadge"))}
            </Text>
            <View className="flex-row justify-center" style={{ gap: 12 }}>
              {/* A reading - in the unit this user chose two steps ago, not a
                  hard-coded mg/dL. */}
              <View style={tileStyle()}>
                <Text
                  style={[
                    TABULAR,
                    { color: GLUCOSE_RICH.target, fontSize: 24 * s, fontWeight: "800" },
                  ]}
                >
                  {formatGlucose(112, unit)}
                </Text>
                {tileCaption(glucoseUnitLabel(unit))}
                <View
                  style={{
                    width: 56 * s,
                    height: 3,
                    borderRadius: RADIUS.full,
                    backgroundColor: withAlpha(GLUCOSE_RICH.target, 0.5),
                  }}
                />
              </View>
              {/* The average - the family the widget leads with, so it carries
                  the accent edge. */}
              <View style={tileStyle(true)}>
                <Text style={[TABULAR, { color: THEME.ink, fontSize: 20 * s, fontWeight: "800" }]}>
                  {formatGlucose(124, unit)}
                </Text>
                {tileCaption(t("widget.avgGlucose"))}
                <Ionicons name="bar-chart-outline" size={22 * s} color={THEME.accent} />
              </View>
              {/* The next reminder - the line the home families gained. */}
              <View style={tileStyle()}>
                <Ionicons name="notifications-outline" size={20 * s} color={THEME.accent} />
                <Text style={[TABULAR, { color: THEME.ink, fontSize: 12 }]}>20:00</Text>
                {tileCaption(t("widget.nextReminder"))}
              </View>
            </View>

            {/* The copy still branches: Android has no lock-screen widgets
                (see widget-guide.tsx's Android section), so it never promises
                one. */}
            <Text
              style={{
                color: THEME.muted,
                fontSize: 15,
                lineHeight: 22,
                textAlign: "center",
                marginTop: 14,
              }}
            >
              {ios ? t("onboarding.widgetIntro") : t("onboarding.widgetIntroAndroid")}
            </Text>
          </FadeSlideIn>
        );
      }

      case "notify":
        return (
          <FadeSlideIn delay={optDelay(0)}>
            {notifyResult == null ? (
              <RationaleCard icon="notifications-outline">
                <RationaleText>{t("onboarding.notifRationale")}</RationaleText>
              </RationaleCard>
            ) : notifyResult === "granted" ? (
              <RationaleCard icon="checkmark-circle" tint={GLUCOSE_RICH.target}>
                <RationaleText tone="ink">{t("onboarding.notifGranted")}</RationaleText>
              </RationaleCard>
            ) : (
              <RationaleCard icon="notifications-off-outline" tint={THEME.muted}>
                <RationaleText>{t("onboarding.notifOff")}</RationaleText>
                <Pressable
                  onPress={() => Linking.openSettings()}
                  className="mt-3 flex-row items-center justify-center rounded-xl border border-hair py-2.5 active:opacity-80"
                >
                  <Ionicons name="settings-outline" size={16} color={THEME.accent} />
                  <Text className="text-brand font-semibold ml-2">
                    {t("settings.openSystemSettings")}
                  </Text>
                </Pressable>
              </RationaleCard>
            )}
            {/* Camera + Apple Health are only INTRODUCED here; the OS ask stays at
                the point of use (first barcode scan / when Health is opened). */}
            <RationaleCard icon="barcode-outline" style={{ marginTop: 12 }}>
              <RationaleText>{t("onboarding.permCamera")}</RationaleText>
            </RationaleCard>
            <RationaleCard icon="fitness-outline" style={{ marginTop: 12 }}>
              <RationaleText>
                {t("onboarding.permHealth", { health: HEALTH_NAME })}
              </RationaleText>
            </RationaleCard>
          </FadeSlideIn>
        );

      // Optional, skippable: offered only to a pill-tracking answer (see
      // hasOralMeds in the steps list above). "Kur" writes the row directly
      // to the reminders registry (setupMedReminder), matching the pattern
      // the basal reminder already uses.
      case "medReminder":
        return (
          <FadeSlideIn delay={optDelay(0)}>
            <TimeRow
              icon="medkit-outline"
              label={t("onboarding.medReminderTime")}
              value={medReminderTime}
              onPress={() => setShowMedTime((s) => !s)}
            />
            <InlineTimePicker
              visible={showMedTime}
              value={medReminderTime}
              onChange={setMedReminderTime}
              onClose={() => setShowMedTime(false)}
            />
            {alarmKitAvailable ? (
              <Text style={{ color: THEME.muted, fontSize: 13, lineHeight: 18, marginTop: 12 }}>
                {t("onboarding.alarmNote")}
              </Text>
            ) : null}
          </FadeSlideIn>
        );

      // Optional, skippable, offered on every path (2.3.0's K2-E). A PREVIEW:
      // nothing is written until "Set up this plan", and any line can be
      // removed first. No diabetes type is ever named here, and no frequency is
      // ever framed as advice - see lib/reminderPresets.ts.
      case "reminderPlan":
        return (
          <FadeSlideIn delay={optDelay(0)}>
            <ReminderPlanPreview
              rows={planRows}
              onRemove={(time) => setRemovedPlanTimes((prev) => [...prev, time])}
              alarmKitAvailable={alarmKitAvailable}
            />
          </FadeSlideIn>
        );

      case "disclaimer":
        return (
          <FadeSlideIn delay={optDelay(0)}>
            {/* C9: the prediabetes/undiagnosed path gets a single neutral
                pointer to the in-app Sources screen, shown before the
                disclaimer banner itself. */}
            {isTwoWayTreatment ? (
              <RationaleCard icon="information-circle-outline" style={{ marginBottom: 16 }}>
                <RationaleText>{t("onboarding.sourcesHintTracking")}</RationaleText>
              </RationaleCard>
            ) : null}
            <DisclaimerBanner full />
            <View style={{ marginTop: 16 }}>
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
          <PrimaryCta label={t("onboarding.notifyCta")} onPress={nextFromNotify} />
          <SecondaryLink label={t("onboarding.skipForNow")} onPress={next} />
        </View>
      ) : (
        <PrimaryCta label={t("onboarding.continue")} onPress={next} />
      );
    }

    if (step === "disclaimer") {
      return (
        <PrimaryCta
          label={t("onboarding.continue")}
          disabled={!accepted}
          loading={saving}
          onPress={finishToReveal}
        />
      );
    }

    // Two explicit paths, neither of which blocks finishing onboarding: "Kur"
    // writes the reminder and moves on, "Simdi degil" just moves on.
    if (step === "medReminder") {
      return (
        <View>
          <PrimaryCta
            label={t("onboarding.medReminderSetup")}
            loading={savingMedReminder}
            onPress={setupMedReminder}
          />
          <SecondaryLink label={t("onboarding.medReminderSkip")} onPress={next} />
        </View>
      );
    }

    if (step === "reminderPlan") {
      return (
        <View>
          {/* Removing every line leaves nothing to set up, so the primary
              action steps aside rather than writing an empty plan. */}
          {planRows.length > 0 ? (
            <PrimaryCta
              label={t("onboarding.planSetup")}
              loading={savingPlan}
              onPress={setupReminderPlan}
            />
          ) : null}
          <SecondaryLink label={t("onboarding.planSkip")} onPress={next} />
        </View>
      );
    }

    const notSure =
      step === "carbRatio" || step === "isf" ? (
        <SecondaryLink
          label={t("onboarding.notSure")}
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
        />
      ) : null;

    // The diabetes question is optional, but skipping it has to be a deliberate
    // tap: Continue stays inert until something is picked, and the skip sits
    // next to it as its own action instead of hiding inside Continue.
    // insulinProducts never disables Continue (nothing here is required), but
    // gets the same explicit "gec" link since it is just as optional.
    const skipQuestion =
      step === "diabetes" || step === "insulinProducts" ? (
        <SecondaryLink label={t("onboarding.skipQuestion")} onPress={next} />
      ) : null;

    const label = step === "diabetes" ? t("onboarding.continue") : t("onboarding.next");
    return (
      <View>
        <PrimaryCta
          label={label}
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
