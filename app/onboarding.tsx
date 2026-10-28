import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Switch,
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
import type { GlucoseUnit, InsulinMode } from "../lib/db/types";
import {
  BASE_STEPS,
  DEFAULT_MEASURE,
  DIABETES_OPTIONS,
  TREATMENT_OPTIONS,
  basalReminderOnAtFinish,
  buildOnboardingSteps,
  diabetesTypeOf,
  measureAfterPermission,
  measureModeToWrite,
  measureNeedsPro,
  measureOptionsFor,
  nightscoutHandoff,
  onboardingDoneEvent,
  onboardingFlags,
  onboardingStepEvent,
  planSetupDecision,
  skipsMeasurementReminders,
  type DiabetesOption,
  type MeasureOption,
  type OnboardingStepId,
  type TreatmentOption,
} from "../lib/onboardingSteps";
import { setCgmBrand, type CgmBrand } from "../lib/cgm/brand";
import { setCgmMode } from "../lib/cgm/state";
import { healthStoreLabelKey } from "../lib/cgm/sourceLabel";
import { hasHealthProvider, requestHealthPermissions } from "../lib/services/health";
import {
  PERMISSION_TIMEOUT_MS,
  createHealthFlow,
  realClock,
  type HealthFlow,
} from "../lib/healthConnectFlow";
import { nightscoutAllowed } from "../lib/cgm/pro";
import { nightscoutAvailable } from "../lib/cgm/sourceAvailability";
import { secureStoreAvailable } from "../lib/secureStore";
import {
  clampHypoThreshold,
  clampTarget,
  glucoseToDisplay,
  glucoseFromDisplay,
  glucoseUnitLabel,
  TARGET_RANGE_BOUNDS,
} from "../lib/glucose";
import { TARGET_DEFAULTS_MGDL, CARB_TARGET_DEFAULTS_G } from "../lib/diabetesDefaults";
import { getLocales } from "expo-localization";
import { initialOnboardingUnit } from "../lib/unitByRegion";
import { RangeInput } from "../components/RangeInput";
import { useStepperValidity } from "../components/Stepper";
import { NumericField } from "../components/NumericField";
import { BASAL_DAILY_BOUNDS } from "../lib/numericField";
import { InsulinProductPicker } from "../components/InsulinProductPicker";
import { OTHER_PRODUCT_ID, isMixSelection } from "../lib/insulinCatalog";
import { logCrash, logEvent } from "../lib/analytics";
import { createOnceGate } from "../lib/analytics/once";
import {
  getAnalyticsConsent,
  markAnalyticsConsentPrompted,
  setAnalyticsConsent,
} from "../lib/analytics/optOut";
import { useFeedback } from "../components/Feedback";
import { hapticLight, hapticSelect } from "../lib/haptics";
import { Button, Card, SectionLabel, Txt } from "../components/ui";
import { TextLink } from "../components/onboarding/TextLink";
import { RIPPLE_ALPHA, ROW_PLATE } from "../lib/theme/uiPrimitives";
import { AcceptCheck } from "../components/form";
import { BigInput } from "../components/onboarding/BigInput";
import { InlineTimePicker } from "../components/InlineTimePicker";
import { DisclaimerBanner } from "../components/Disclaimer";
import { LanguageChip } from "../components/onboarding/LanguageChip";
import { Welcome } from "../components/onboarding/Welcome";
import { QuizStep } from "../components/onboarding/QuizStep";
import { CgmBrandNote } from "../components/CgmBrandNote";
import { OptionCard } from "../components/onboarding/OptionCard";
import { Reveal } from "../components/onboarding/Reveal";
import { FadeSlideIn, ENTRANCE_STAGGER_MS } from "../components/onboarding/motion";
import { AppBackground, GradientCTA, withAlpha } from "../components/rich";
import { RADIUS, SPACE, THEME, switchColors } from "../lib/theme/tokens";
import { parseDecimalText } from "../lib/numberInput";
import { useLayout } from "../lib/useLayout";

// The ADA-shaped starting ranges, prefilled so nobody has to invent a number.
// Also the generic mg/dL fallback used while parsing typed text, before any
// diabetes answer has picked a matrix-specific default (see TARGET_DEFAULTS_MGDL).
const DEFAULT_FASTING_RANGE = { min: 80, max: 130 };
const DEFAULT_POSTMEAL_RANGE = { min: 80, max: 180 };

type IconName = keyof typeof Ionicons.glyphMap;

const UNIT_ICONS: Record<GlucoseUnit, IconName> = {
  mgdl: "speedometer-outline",
  mmol: "flask-outline",
};

const MEASURE_ICONS: Record<MeasureOption, IconName> = {
  finger: "hand-left-outline",
  cgm: "pulse-outline",
  nightscout: "cloud-outline",
};

const MEASURE_HINT_SUFFIX: Record<MeasureOption, string> = {
  finger: "Finger",
  cgm: "Cgm",
  nightscout: "Nightscout",
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
type StepId = OnboardingStepId;

/**
 * The anchor glyph per step. Ionicons throughout - the app's icon language does
 * not change for one screen - picking the nearest glyph to each approved mark.
 * A step missing from this map draws none on purpose: its own content (the six
 * diabetes options, the two range editors, the insulin form, the reminder
 * layout) already fills the frame, and a plate above it would only push the CTA
 * off a short phone.
 */
const STEP_GLYPHS: Partial<Record<StepId, IconName>> = {
  name: "person-outline",
  unit: "speedometer-outline",
  insulin: "medical-outline",
  pillsOnly: "medkit-outline",
  medReminder: "medkit-outline",
};

// Hoisted so the screenshot hook below can point at the diabetes question by
// name instead of hard-coding an index that would drift if a step is inserted.
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
      android_ripple={{ color: withAlpha(THEME.text, RIPPLE_ALPHA), foreground: true }}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: SPACE.md,
        minHeight: 64,
        paddingHorizontal: SPACE.lg,
        paddingVertical: SPACE.lg,
        borderRadius: RADIUS.lg,
        borderWidth: 1,
        borderColor: THEME.border,
        backgroundColor: THEME.surface,
      }}
    >
      <View
        style={{
          width: ROW_PLATE,
          height: ROW_PLATE,
          borderRadius: RADIUS.md,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: withAlpha(THEME.accent, 0.1),
        }}
      >
        <Ionicons name={icon} size={20} color={THEME.accent} />
      </View>
      <Txt kind="body" style={{ flex: 1 }}>
        {label}
      </Txt>
      <Txt kind="subtitle" tabular>
        {value}
      </Txt>
    </Pressable>
  );
}

/**
 * The basal reminder inside the plan step. Unpicked it is one "add" line; once
 * picked it is a row like the preview's own, whose time is the thing the user
 * is asked for, so the picker opens the moment it is added. Module level so
 * toggling the picker under it never remounts the row.
 */
function BasalPlanRow({
  selected,
  label,
  addLabel,
  removeLabel,
  time,
  onAdd,
  onToggleTime,
  onRemove,
}: {
  selected: boolean;
  label: string;
  addLabel: string;
  removeLabel: string;
  time: string;
  onAdd: () => void;
  onToggleTime: () => void;
  onRemove: () => void;
}) {
  if (!selected) {
    return (
      <Pressable
        onPress={onAdd}
        accessibilityRole="button"
        accessibilityLabel={addLabel}
        className="active:opacity-80"
        android_ripple={{ color: withAlpha(THEME.accent, RIPPLE_ALPHA), foreground: true }}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: SPACE.md,
          minHeight: 58,
          paddingHorizontal: SPACE.lg,
          paddingVertical: SPACE.md,
          marginBottom: SPACE.md,
          borderRadius: RADIUS.lg,
          borderWidth: 1,
          borderStyle: "dashed",
          borderColor: THEME.border,
        }}
      >
        <Ionicons name="add-circle-outline" size={22} color={THEME.accent} />
        <Txt kind="body" tone="accent" style={{ fontWeight: "600", flex: 1 }}>
          {addLabel}
        </Txt>
      </Pressable>
    );
  }
  return (
    <Card
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: SPACE.md,
        minHeight: 58,
        marginBottom: SPACE.md,
      }}
    >
      <View
        style={{
          width: ROW_PLATE,
          height: ROW_PLATE,
          borderRadius: RADIUS.md,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: withAlpha(THEME.accent, 0.1),
        }}
      >
        <Ionicons name="moon-outline" size={20} color={THEME.accent} />
      </View>
      <Pressable
        onPress={onToggleTime}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={{ text: time }}
        className="active:opacity-80"
        android_ripple={{ color: withAlpha(THEME.text, RIPPLE_ALPHA), foreground: true }}
        style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: SPACE.md, minHeight: 44 }}
      >
        <Txt kind="body" style={{ flex: 1 }} numberOfLines={2}>
          {label}
        </Txt>
        <Txt kind="body" tabular style={{ fontWeight: "700" }}>
          {time}
        </Txt>
      </Pressable>
      <Pressable
        onPress={onRemove}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel={removeLabel}
        style={{
          width: 28,
          height: 28,
          borderRadius: RADIUS.full,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: THEME.surfaceInset,
        }}
      >
        <Ionicons name="close" size={14} color={THEME.textMuted} />
      </Pressable>
    </Card>
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
    <Card style={[{ flexDirection: "row", alignItems: "flex-start", gap: SPACE.md }, style]}>
      <Ionicons name={icon} size={20} color={tint} />
      <View style={{ flex: 1 }}>{children}</View>
    </Card>
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
function SecondaryLink({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Button label={label} onPress={onPress} disabled={disabled} variant="tertiary" />
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
    <Txt kind="body" tone={tone === "ink" ? "text" : "muted"}>
      {children}
    </Txt>
  );
}

/**
 * The optional usage-data switch on the analytics step. It starts off, and
 * leaving it off asks nothing more of the user; a never-answered choice stays
 * unanswered and Settings > Data can still turn it on later. Module
 * level so toggling it never remounts the card.
 */
function ConsentSwitchRow({
  title,
  body,
  value,
  disabled,
  onValueChange,
}: {
  title: string;
  body?: string;
  value: boolean;
  disabled?: boolean;
  onValueChange: (next: boolean) => void;
}) {
  return (
    <Card
      style={{
        borderColor: value ? THEME.accent : THEME.border,
        backgroundColor: value ? withAlpha(THEME.accent, 0.1) : THEME.surface,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.md }}>
        <Txt kind="body" style={{ flex: 1, fontWeight: "600" }}>
          {title}
        </Txt>
        <Switch
          value={value}
          disabled={disabled}
          onValueChange={onValueChange}
          {...(THEME.scheme === "light"
            ? switchColors()
            : {
                trackColor: { true: THEME.accentFill, false: THEME.borderStrong },
                thumbColor: THEME.text,
              })}
          accessibilityLabel={title}
        />
      </View>
      {body ? (
        <Txt kind="caption" tone="muted" style={{ marginTop: SPACE.sm }}>
          {body}
        </Txt>
      ) : null}
    </Card>
  );
}

export default function OnboardingScreen() {
  const { t } = useTranslation();
  const ios = Platform.OS === "ios";
  const insets = useSafeAreaInsets();
  const { columnPad, isWide } = useLayout();
  const router = useRouter();
  const { activeProfile, bumpData, completeOnboarding, isProUser } = useApp();
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
    activeProfile?.name ?? ""
  );
  const [unit, setUnit] = useState<GlucoseUnit>(() =>
    initialOnboardingUnit(activeProfile?.glucose_unit, getLocales()[0]?.regionCode)
  );
  const [diabetes, setDiabetes] = useState<DiabetesOption | null>(scDiabetes);
  const [treatment, setTreatment] = useState<TreatmentOption | null>(null);
  // The undiagnosed path's own answer (see the pillsOnly step): kept apart from
  // `treatment` so switching diabetes answers never mixes the two.
  const [pillsOnly, setPillsOnly] = useState<boolean | null>(null);
  const [measure, setMeasure] = useState<MeasureOption>(DEFAULT_MEASURE);
  const [cgmBrand, setCgmBrandChoice] = useState<CgmBrand | null>(null);
  const [askingHealth, setAskingHealth] = useState(false);
  const healthFlowRef = useRef<HealthFlow | null>(null);
  useEffect(() => () => healthFlowRef.current?.cancel(), []);
  const [measureDenied, setMeasureDenied] = useState(false);
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
  // Same pattern for the target range: once the user edits a value by hand,
  // switching the diabetes answer must never overwrite it again.
  const [targetsTouched, setTargetsTouched] = useState(false);
  // The insulinProducts step's own answers: which catalog product (or "other"
  // + a typed name) for each slot, and the self-reported daily basal amount.
  // Entirely optional - left at their profile/seed defaults, this step can be
  // walked past with no write of its own (finishToReveal only sends these
  // while hasInsulin).
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
  const stepperFields = useStepperValidity();
  const basalInvalidRef = useRef(false);
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
      skipsMeasurementReminders(measure)
        ? []
        : presetFor(diabetesTypeOf(diabetes)).filter(
            (r) => !removedPlanTimes.includes(r.time)
          ),
    [diabetes, removedPlanTimes, measure]
  );
  // The basal reminder lives inside the plan step: picked there, timed there,
  // and written only by "Set up this plan". `basalSelected` is what the row
  // shows; `basalInstalled` is what has really been written, so a user who
  // picks it and then taps "Not now" ends up with no basal reminder at all and
  // is never asked for a permission they did not choose to need.
  const [basalSelected, setBasalSelected] = useState(false);
  const [basalInstalled, setBasalInstalled] = useState(false);
  const basalInstalledRef = useRef(false);
  const doneRef = useRef(false);
  const [basalTime, setBasalTime] = useState("22:00");
  const [showBasalTime, setShowBasalTime] = useState(false);
  // What the reveal card lists at the end, built from the rows that were
  // REALLY written (see lib/revealPlan.ts). Empty until finishToReveal fills it.
  const [revealPlan, setRevealPlan] = useState<RevealPlanItem[]>([]);
  const [accepted, setAccepted] = useState(false);
  // The analytics step's optional usage-data switch. Off by default: only an
  // explicit "on" is written as a grant; turning it off later withdraws a
  // stored grant (see syncConsent).
  const [analyticsOptIn, setAnalyticsOptIn] = useState(false);
  const [analyticsDetailsOpen, setAnalyticsDetailsOpen] = useState(false);
  const [savingConsent, setSavingConsent] = useState(false);
  const [consentLoaded, setConsentLoaded] = useState(false);
  const consentBusy = useRef(false);
  const { toast } = useFeedback();
  const [saving, setSaving] = useState(false);

  // Re-derived every render instead of trusting the raw answers: a treatment
  // picked before backing up and switching to "none" or "prediabetes" must not
  // leak into the profile or the step list (see lib/onboardingSteps.ts).
  const flags = onboardingFlags({ diabetes, treatment, pillsOnly });
  const { isTwoWayTreatment, hasInsulin, hasOralMeds } = flags;
  const steps = useMemo<StepId[]>(
    () => buildOnboardingSteps({ isTwoWayTreatment, hasInsulin, hasOralMeds, measure }),
    [isTwoWayTreatment, hasInsulin, hasOralMeds, measure]
  );

  const stepIdxClamped = Math.min(stepIdx, steps.length - 1);
  const step = steps[stepIdxClamped];
  const planDecision = planSetupDecision({
    glucoseRows: planRows.length,
    hasInsulin,
    basalSelected,
    basalInstalled,
  });

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

  const stepEvent = onboardingStepEvent(phase, step, steps);
  const stepOnceRef = useRef<((key: string) => boolean) | null>(null);
  if (!stepOnceRef.current) stepOnceRef.current = createOnceGate();
  useEffect(() => {
    // Back to a step already seen (hardware back to the welcome page) is not a new funnel step.
    if (!stepOnceRef.current!(stepEvent.step)) return;
    logEvent("onboarding_step", stepEvent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepEvent.step, stepEvent.index]);

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

  // CGM asks for the Health permission right here, while the person has just
  // chosen it. A refusal puts them back on the finger prick and says so; it
  // never blocks the quiz. The mode itself is written once, in finishToReveal.
  async function pickMeasure(picked: MeasureOption) {
    if (askingHealth || picked === measure) return;
    hapticSelect();
    setMeasureDenied(false);
    if (measureNeedsPro(picked) && !nightscoutAllowed(isProUser)) {
      router.push({ pathname: "/paywall", params: { reason: "health" } });
      return;
    }
    if (picked !== "cgm") {
      setMeasure(picked);
      return;
    }
    setAskingHealth(true);
    let granted = false;
    // A request that never comes back must not keep the step on "asking" for good.
    const session = (healthFlowRef.current ??= createHealthFlow({
      isBlocked: () => false,
      clock: realClock,
    })).start();
    try {
      const step = await session.race(requestHealthPermissions(), PERMISSION_TIMEOUT_MS);
      granted = step.kind === "value" && step.value;
    } catch (err) {
      logCrash(err, { screen: "onboarding", op: "measureHealthPermission" });
    } finally {
      setAskingHealth(false);
    }
    const result = measureAfterPermission(picked, granted);
    setMeasure(result.measure);
    if (result.fellBack) setMeasureDenied(true);
  }

  // The last quiz step has nothing after it but the reveal, so "next" there
  // writes everything and opens it. One fewer step than before: the disclaimer
  // moved onto the reveal, which also moves onboarding_step's reveal index (and
  // the last quiz index) down by one on every path.
  const isLastStep = stepIdxClamped === steps.length - 1;
  const next = () => {
    if (isLastStep) void finishToReveal();
    else setStepIdx((i) => Math.min(steps.length - 1, i + 1));
  };
  const back = () => setStepIdx((i) => Math.max(0, i - 1));

  // Android hardware back mirrors the in-UI arrow during the quiz: step 0
  // returns to the welcome phase, later steps go back one step. Welcome keeps
  // the system default; the reveal swallows it so a back press cannot leave
  // onboarding unfinished.
  useEffect(() => {
    if (Platform.OS !== "android" || (phase !== "quiz" && phase !== "reveal")) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (phase === "reveal") return true;
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

  // Save the profile + reminder plan, then show the reveal. Onboarding is NOT
  // marked complete here: the disclaimer is accepted on the reveal, and
  // goToDashboard completes onboarding only once it is, so a kill before the
  // box is ticked re-runs the quiz exactly as a kill on the old disclaimer step
  // did. The accepted flag itself was never stored anywhere, so nothing else
  // changes about how acceptance persists.
  async function finishToReveal() {
    if (!activeProfile || saving) return;
    setSaving(true);
    try {
      // The quiz answers stop being dead data here: diabetes type and insulin
      // mode go onto the profile, which is what the rest of the app reads.
      const dbDiabetesType = diabetesTypeOf(diabetes);
      const carbDefaults = CARB_TARGET_DEFAULTS_G[dbDiabetesType];
      const patch: ProfileUpdate = {
        name: name.trim(),
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
      // The carb ratio and ISF are deliberately not written here: the
      // calculator asks for them the first time it opens (lib/calcSetup.ts),
      // so ratios_confirmed stays whatever the profile already says.
      if (hasInsulin) {
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

      // The finger prick is the profile's default and writes nothing; a sensor
      // choice is stored for the profile and reported once, with the same
      // event Settings > Data sources uses.
      const cgmMode = measureModeToWrite(measure);
      if (cgmMode !== null) {
        await setCgmMode(activeProfile.id, cgmMode);
        logEvent("cgm_mode_set", { mode: cgmMode });
        if (cgmMode === "cgm" && cgmBrand !== null) {
          try {
            await setCgmBrand(activeProfile.id, cgmBrand);
          } catch (err) {
            logCrash(err, { screen: "onboarding", op: "setBrand" });
          }
        }
      }

      // The basal reminder exists only if the user picked it in the plan step
      // and "Set up this plan" wrote it (see basalReminderOnAtFinish); post-meal
      // tracking stays on for everyone. The basal row is written straight to
      // the reminders registry, not left to the one-time legacy-prefs bridge
      // (lib/db/remindersBridge.ts): a process killed right after an earlier,
      // abandoned onboarding attempt already consumed that one-time bridge, so a
      // restarted onboarding choosing differently would otherwise have no way
      // left to change it. This pass is also what switches a row off that was
      // written and then un-picked.
      const basalOn = basalReminderOnAtFinish({
        hasInsulin,
        basalSelected,
        basalInstalled: basalInstalledRef.current,
      });
      await setNotificationPrefs({
        ...DEFAULT_PREFS,
        basal: basalOn,
        basalTime,
        // The weekly summary starts ON for a brand-new user, and only here: a
        // full blob written at the end of onboarding is the one moment the app
        // knows it is choosing for someone who has chosen nothing. Turning it
        // on in DEFAULT_PREFS instead would have flipped it on for every
        // existing install too, since that object also backfills fields absent
        // from an older stored blob (lib/services/notificationPrefs.ts).
        weekly: true,
      });
      await syncBasalReminderRow(basalOn, basalTime, true);
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
            cgmMode: cgmMode ?? "manual",
          })
        );
      } catch {
        // best-effort: the card simply shows nothing rather than a wrong list
      }

      bumpData();
      setPhase("reveal");
    } catch (err) {
      logCrash(err, { screen: "onboarding", op: "finishToReveal" });
      toast(t("common.saveFailed"), "error");
    } finally {
      setSaving(false);
    }
  }

  async function goToDashboard() {
    if (!accepted || saving || doneRef.current) return;
    doneRef.current = true;
    setSaving(true);
    try {
      await completeOnboarding();
    } catch (err) {
      logCrash(err, { screen: "onboarding", op: "completeOnboarding" });
      toast(t("common.saveFailed"), "error");
      doneRef.current = false;
      setSaving(false);
      return;
    }
    logEvent("onboarding_done", onboardingDoneEvent(steps));
    // 2.3.4: onboarding no longer hands off to the paywall - the reveal's
    // "Continue" now lands straight on the dashboard. The paywall itself
    // opens later, once this profile's own log count first reaches 3 (see
    // lib/afterLogsPaywall.ts), not as a tax on finishing the quiz.
    router.replace("/(tabs)");
  }

  useEffect(() => {
    let alive = true;
    getAnalyticsConsent()
      .then((state) => {
        if (!alive) return;
        setAnalyticsOptIn(state === "granted");
      })
      .catch((err) => logCrash(err, { screen: "onboarding", op: "analyticsConsentRead" }))
      .finally(() => {
        if (alive) setConsentLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  // The stored answer always follows the switch: a grant is written when it is
  // turned on and withdrawn when it is turned off, so leaving the step any way
  // (including the back arrow or a killed app) never leaves them out of step.
  // A switch that was never on writes nothing and the answer stays "unanswered".
  async function syncConsent(wantOn: boolean): Promise<boolean> {
    try {
      const stored = await getAnalyticsConsent();
      if (wantOn && stored !== "granted") {
        await setAnalyticsConsent("granted");
      } else if (!wantOn && stored === "granted") {
        await setAnalyticsConsent("declined");
      }
      return true;
    } catch (err) {
      logCrash(err, { screen: "onboarding", op: "analyticsConsent" });
      toast(t("common.saveFailed"), "error");
      return false;
    }
  }

  async function toggleAnalytics(next: boolean) {
    if (consentBusy.current) return;
    consentBusy.current = true;
    hapticSelect();
    setAnalyticsOptIn(next);
    setSavingConsent(true);
    try {
      if (!(await syncConsent(next))) setAnalyticsOptIn(!next);
    } finally {
      consentBusy.current = false;
      setSavingConsent(false);
    }
  }

  async function continueFromAnalytics() {
    if (consentBusy.current || !consentLoaded) return;
    hapticLight();
    consentBusy.current = true;
    setSavingConsent(true);
    try {
      if (!(await syncConsent(analyticsOptIn))) return;
      try {
        await markAnalyticsConsentPrompted();
      } catch (err) {
        logCrash(err, { screen: "onboarding", op: "analyticsConsentPrompted" });
      }
    } finally {
      consentBusy.current = false;
      setSavingConsent(false);
    }
    next();
  }

  // Optional subtitle per step (the title is derived from the step id). Steps
  // whose own controls already carry the explanation get no subtitle at all.
  function hintFor(s: StepId): string | undefined {
    switch (s) {
      case "unit":
        return t("onboarding.qUnitHint");
      case "diabetes":
        return t("onboarding.qDiabetesHint");
      case "measure":
        return t("onboarding.qMeasureHint");
      case "targets":
        return diabetes === "none"
          ? t("onboarding.qTargetsHintTracking")
          : undefined;
      case "insulinProducts":
        return t("onboarding.qInsulinProductsHint");
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
  // uses - then asks for notification permission, which is a contextual ask:
  // the user has just chosen to set a reminder up. Never blocks Continue: a
  // failed write (or a denied permission) still advances, since the reminder
  // can always be set up later from Settings > Reminders.
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
   * "Set up this plan" (2.3.0's K2-E). The glucose write, the replace-not-merge
   * rule and the two permission prompts all live in setUpReminderPlan
   * (lib/services/reminderPlan.ts), shared with app/profile-setup.tsx so a
   * profile added later gets the exact same layout and the exact same asks.
   * "Not now" writes nothing and asks for nothing at all: it is plain `next()`
   * in the footer below. This is the only place onboarding raises the OS
   * notification prompt for a plan, so a user who picks none never sees one.
   *
   * A picked basal row is written BEFORE the shared glucose write, so the single
   * permission chain that follows covers both. When no glucose line is left (or
   * none landed) nothing downstream asks, and this asks itself, once.
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
      const profileId = activeProfile?.id;
      let basalWritten = false;
      if (planDecision.basal !== "keep") {
        const wrote = await syncBasalReminderRow(planDecision.wantBasal, basalTime, true, profileId);
        basalWritten = planDecision.wantBasal && wrote;
        basalInstalledRef.current = basalWritten;
        setBasalInstalled(basalWritten);
      }
      const glucoseWritten =
        planRows.length > 0
          ? (await setUpReminderPlan(planRows, presetLabel, profileId)).written
          : 0;
      if (basalWritten && glucoseWritten === 0) {
        await requestNotificationPermission();
        await ensureAlarmAuthorizationOnce();
      }
    } catch {
      // best-effort: Settings > Reminders is always there to try again
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
            <Ionicons name="chevron-back" size={18} color={THEME.text} />
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
            onContinue={() => void goToDashboard()}
            saving={saving}
            accepted={accepted}
            onToggleAccepted={() => {
              hapticSelect();
              setAccepted((a) => !a);
            }}
            aboveDisclaimer={
              isTwoWayTreatment ? (
                // C9: the prediabetes/undiagnosed path gets a single neutral
                // pointer to the in-app Sources screen, ahead of the notice.
                <RationaleCard icon="information-circle-outline" style={{ marginBottom: 12 }}>
                  <RationaleText>{t("onboarding.sourcesHintTracking")}</RationaleText>
                </RationaleCard>
              ) : null
            }
          />
        ) : null}

        {phase === "quiz" ? (
          <QuizStep
            key={step}
            progress={progress}
            title={titleFor(step)}
            hint={hintFor(step)}
            glyph={STEP_GLYPHS[step]}
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
              <Ionicons name="information-circle-outline" size={15} color={THEME.textMuted} />
              <Txt kind="caption" tone="muted" style={{ flexShrink: 1 }}>
                {t("onboarding.qNameHint")}
              </Txt>
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
      // insulinProducts step follows), pill answers to oral_meds_enabled.
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
            <Txt kind="body" style={{ marginBottom: SPACE.sm }}>
              {t("settings.basalDailyUnits")}
            </Txt>
            <NumericField
              value={basalDailyUnits > 0 ? basalDailyUnits : null}
              onChange={(v) => {
                // Refused text (too big, not a number) keeps the last good value;
                // only an emptied box clears it.
                if (v == null && basalInvalidRef.current) return;
                setBasalDailyUnits(v ?? 0);
              }}
              onValidityChange={(valid) => {
                basalInvalidRef.current = !valid;
                stepperFields.reporter("basalUnits")(valid);
              }}
              step={BASAL_DAILY_BOUNDS.step}
              longStep={1}
              min={BASAL_DAILY_BOUNDS.min}
              max={BASAL_DAILY_BOUNDS.max}
              decimals={BASAL_DAILY_BOUNDS.decimals}
              suffix={t("common.units")}
              accessibilityLabel={t("settings.basalDailyUnits")}
            />
            <Txt kind="caption" tone="muted" style={{ marginTop: SPACE.sm }}>
              {t("settings.basalDailyUnitsHint")}
            </Txt>
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
            <TextLink
              label={t("insulinPicker.mixOff")}
              onPress={() => {
                setMixModeUi(false);
                setBasalInsulinId(null);
                setBolusInsulinId(null);
                setBasalInsulinOther(null);
                setBolusInsulinOther(null);
              }}
              style={{ marginTop: SPACE.md }}
            />
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

            {/* Accent, not muted: this is a real alternative shape of the
                step, not the "skip" link the footer already carries. */}
            <TextLink
              label={t("insulinPicker.mixUse")}
              onPress={() => setMixModeUi(true)}
              style={{ marginTop: SPACE.md }}
            />
          </FadeSlideIn>
        );
      }

      // Optional, skippable: offered only to a pill-tracking answer (see
      // hasOralMeds in lib/onboardingSteps.ts). "Kur" writes the row directly
      // to the reminders registry (setupMedReminder), matching the pattern
      // the basal reminder uses.
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
              <Txt kind="caption" tone="muted" style={{ marginTop: SPACE.md }}>
                {t("onboarding.alarmNote")}
              </Txt>
            ) : null}
          </FadeSlideIn>
        );

      // Optional, skippable, offered on every path (2.3.0's K2-E). A PREVIEW:
      // nothing is written until "Set up this plan", and any line can be
      // removed first. No diabetes type is ever named here, and no frequency is
      // ever framed as advice - see lib/reminderPresets.ts. On an insulin path
      // the basal reminder is one more line the user can add, and its time is
      // asked right there. The notes sit under the list, not inside the shared
      // preview, so they can follow the basal line and appear only while there
      // is something to set up: this step is where the OS prompt comes from, so
      // it is also where the reason for it is said.
      case "reminderPlan":
        return (
          <FadeSlideIn delay={optDelay(0)}>
            <ReminderPlanPreview
              rows={planRows}
              onRemove={(time) => setRemovedPlanTimes((prev) => [...prev, time])}
              alarmKitAvailable={false}
            />
            {hasInsulin ? (
              <>
                <BasalPlanRow
                  selected={basalSelected}
                  label={t("onboarding.qBasal")}
                  addLabel={t("onboarding.basalAdd")}
                  removeLabel={t("onboarding.planRemoveA11y")}
                  time={basalTime}
                  onAdd={() => {
                    hapticSelect();
                    setBasalSelected(true);
                    setShowBasalTime(true);
                  }}
                  onToggleTime={() => setShowBasalTime((s) => !s)}
                  onRemove={() => {
                    setBasalSelected(false);
                    setShowBasalTime(false);
                  }}
                />
                <InlineTimePicker
                  visible={basalSelected && showBasalTime}
                  value={basalTime}
                  onChange={setBasalTime}
                  onClose={() => setShowBasalTime(false)}
                />
                {basalSelected ? (
                  <Txt kind="caption" tone="muted" style={{ marginBottom: SPACE.xs }}>
                    {t("onboarding.basalReminderTip")}
                  </Txt>
                ) : null}
              </>
            ) : null}
            {planDecision.canSetUp ? (
              <Txt kind="caption" tone="muted" style={{ marginTop: SPACE.sm }}>
                {t("onboarding.planPermNote")}
              </Txt>
            ) : null}
            {alarmKitAvailable && planDecision.canSetUp ? (
              <Txt kind="caption" tone="muted" style={{ marginTop: SPACE.sm }}>
                {t("onboarding.alarmNote")}
              </Txt>
            ) : null}
          </FadeSlideIn>
        );

      case "measure": {
        const store = t(healthStoreLabelKey(Platform.OS));
        const options = measureOptionsFor({
          hasHealth: hasHealthProvider(),
          nightscout: nightscoutAvailable() && secureStoreAvailable(),
        });
        return (
          <View>
            {options.map((opt, i) => (
              <FadeSlideIn key={opt} delay={optDelay(i)}>
                <OptionCard
                  icon={MEASURE_ICONS[opt]}
                  label={t(`onboarding.measure_${opt}`, { store })}
                  description={t(`onboarding.measure${MEASURE_HINT_SUFFIX[opt]}Hint`, { store })}
                  spacing={14}
                  selected={measure === opt}
                  onPress={() => void pickMeasure(opt)}
                />
              </FadeSlideIn>
            ))}
            {measureDenied ? (
              <Txt kind="caption" tone="muted" style={{ marginTop: SPACE.xs }}>
                {t("onboarding.measureDenied", { store })}
              </Txt>
            ) : null}
            {measure === "cgm" ? (
              <CgmBrandNote
                brand={cgmBrand}
                onChange={setCgmBrandChoice}
                store={store}
                nightscout={nightscoutAvailable() && secureStoreAvailable()}
              />
            ) : null}
            {nightscoutHandoff(measure) ? (
              <Txt kind="caption" tone="muted" style={{ marginTop: SPACE.xs }}>
                {t("onboarding.measureNightscoutNote")}
              </Txt>
            ) : null}
          </View>
        );
      }

      case "analytics":
        return (
          <FadeSlideIn delay={optDelay(0)}>
            <RationaleCard icon="eye-outline" style={{ marginBottom: 12 }}>
              <RationaleText>{t("onboarding.analyticsShort1")}</RationaleText>
            </RationaleCard>
            <RationaleCard icon="lock-closed-outline" style={{ marginBottom: 12 }}>
              <RationaleText>{t("onboarding.analyticsShort2")}</RationaleText>
            </RationaleCard>
            <RationaleCard icon="toggle-outline" style={{ marginBottom: 12 }}>
              <RationaleText>{t("onboarding.analyticsShort3")}</RationaleText>
            </RationaleCard>
            {/* Above the details: opening them lengthens the scroller, and the switch must not slide below the fold. */}
            <ConsentSwitchRow
              title={t("onboarding.analyticsConsentTitle")}
              value={analyticsOptIn}
              disabled={!consentLoaded || savingConsent}
              onValueChange={(next) => void toggleAnalytics(next)}
            />
            {/* The three lines above summarise the full text, which stays whole behind this toggle. */}
            <TextLink
              label={t("onboarding.analyticsDetails")}
              onPress={() => {
                hapticSelect();
                setAnalyticsDetailsOpen((open) => !open);
              }}
              chevron
              expanded={analyticsDetailsOpen}
              align="start"
              style={{ marginBottom: SPACE.sm }}
            />
            {analyticsDetailsOpen ? (
              <View style={{ gap: 8, marginBottom: 16 }}>
                <RationaleText>{t("onboarding.analyticsHelpCollect")}</RationaleText>
                <RationaleText>{t("onboarding.analyticsHelpNever")}</RationaleText>
                <RationaleText>{t("onboarding.analyticsHelpOff")}</RationaleText>
              </View>
            ) : (
              <View style={{ height: 4 }} />
            )}
          </FadeSlideIn>
        );
    }
  }

  // ── Per-step footer ────────────────────────────────────────────────────────
  function renderFooter(): React.ReactNode {
    // Single-select steps auto-advance and have no footer.
    if (step === "insulin" || step === "pillsOnly") return null;

    if (step === "analytics") {
      return (
        <PrimaryCta
          label={t("onboarding.continue")}
          loading={savingConsent || !consentLoaded}
          onPress={continueFromAnalytics}
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
          {/* Removing every line (and not picking the basal one) leaves nothing
              to set up, so the primary action steps aside rather than writing
              an empty plan. */}
          {planDecision.canSetUp ? (
            <PrimaryCta
              label={t("onboarding.planSetup")}
              loading={savingPlan || saving}
              onPress={setupReminderPlan}
            />
          ) : null}
          <SecondaryLink
            label={t("onboarding.planSkip")}
            disabled={savingPlan || saving}
            onPress={next}
          />
        </View>
      );
    }

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
            (step === "measure" && askingHealth) ||
            (step === "diabetes" && diabetes == null) ||
            !stepperFields.allValid
          }
          onPress={() => {
            hapticLight();
            next();
          }}
        />
        {skipQuestion}
      </View>
    );
  }
}
