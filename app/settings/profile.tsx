import React, { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { getLocales } from "expo-localization";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";

import { useApp } from "../../lib/store/AppContext";
import { updateProfile } from "../../lib/db/profiles";
import type { GlucoseUnit, DiabetesType, InsulinMode } from "../../lib/db/types";
import {
  clampHypoThreshold,
  clampTarget,
  glucoseToDisplay,
  glucoseFromDisplay,
  glucoseUnitLabel,
  TARGET_RANGE_BOUNDS,
} from "../../lib/glucose";
import { CARB_TARGET_BOUNDS, clampCarbTarget } from "../../lib/insulin";
import { num } from "../../lib/format";
import { insulinModeOf, insulinModeShowsBasal, insulinModeShowsBolus } from "../../lib/insulinMode";
import { TARGET_DEFAULTS_MGDL, CARB_TARGET_DEFAULTS_G, isNoInsulinDiabetesType } from "../../lib/diabetesDefaults";
import {
  applyNotificationPrefs,
  cancelBasalReminder,
  cancelMedReminder,
  hasNotificationPermission,
} from "../../lib/services/notifications";
import { OTHER_PRODUCT_ID, isMixSelection } from "../../lib/insulinCatalog";
import { parseDecimalText } from "../../lib/numberInput";
import { Button, Segmented } from "../../components/ui";
import { FormCard, InputRow } from "../../components/form";
import { RangeInput } from "../../components/RangeInput";
import { NumericField } from "../../components/NumericField";
import { CarbRatioInput, IsfInput } from "../../components/RatioInput";
import { ConfirmCheckbox } from "../../components/ConfirmCheckbox";
import {
  ratioFieldsComplete,
  ratioFieldsInitial,
  ratioSetMatchesStored,
  type RatioFields,
} from "../../lib/calcSetup";
import { useRatioWriter } from "../../lib/useRatioWriter";
import { createConfirmGate } from "../../lib/ratioWriter";
import { BASAL_DAILY_BOUNDS } from "../../lib/numericField";
import { InsulinProductPicker } from "../../components/InsulinProductPicker";
import { InsulinModeSection } from "../../components/InsulinModeSection";
import { SettingsScaffold } from "../../components/settingsUi";
import { SectionLabel } from "../../components/ui";
import { useFeedback } from "../../components/Feedback";
import { useLayout } from "../../lib/useLayout";
import { THEME } from "../../lib/theme/tokens";
import { carbRegionNote, type CarbDisplayMode } from "../../lib/carbDisplay";
import { setCarbDisplayMode, useCarbDisplayMode } from "../../lib/carbDisplayPref";
import { getReportName, setReportName, REPORT_NAME_MAX } from "../../lib/reportName";

/**
 * Settings > Profile & Targets. Moved verbatim from the old single-scroll
 * settings screen (R7.3 hub split); behaviour is unchanged. E.7: ISF and the
 * carb ratios are now Steppers (also keyboard-editable) instead of text rows.
 */
export default function ProfileSettings() {
  const { t, i18n } = useTranslation();
  const { activeProfile, bumpData } = useApp();
  const router = useRouter();
  // Set by the calculator's "Enter your ratios" line: ticking the box here
  // takes the user back to that open record, with the total showing.
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const carbMode = useCarbDisplayMode();
  const regionNote = carbRegionNote(i18n.language, getLocales()[0]?.regionCode);
  const { columnPad } = useLayout();
  const { confirm, actionSheet, toast } = useFeedback();

  // activeProfile is already in context by the time this screen mounts (see
  // profile-setup.tsx for the same pattern), so every field is seeded straight
  // from it via a lazy initializer instead of starting blank/zero and jumping
  // to the real value after an effect - a zero ISF or an empty name is a wrong
  // value on screen, not just a loading state.
  const unit: GlucoseUnit = activeProfile?.glucose_unit ?? "mgdl";
  const [name, setName] = useState(() => activeProfile?.name ?? "");
  const [reportName, setReportNameText] = useState("");
  // The four calculator numbers are a draft set: empty until the user types
  // them, saved together once all four are filled (lib/calcSetup.ts ratioSetPatch).
  const [ratioDraft, setRatioDraft] = useState<RatioFields>(() =>
    ratioFieldsInitial(activeProfile)
  );
  const [fastingMin, setFastingMin] = useState(() =>
    activeProfile ? num(glucoseToDisplay(activeProfile.target_fasting_min, unit)) : ""
  );
  const [fastingMax, setFastingMax] = useState(() =>
    activeProfile ? num(glucoseToDisplay(activeProfile.target_fasting_max, unit)) : ""
  );
  const [postmealMin, setPostmealMin] = useState(() =>
    activeProfile ? num(glucoseToDisplay(activeProfile.target_postmeal_min, unit)) : ""
  );
  const [postmealMax, setPostmealMax] = useState(() =>
    activeProfile ? num(glucoseToDisplay(activeProfile.target_postmeal_max, unit)) : ""
  );
  const [carbMin, setCarbMin] = useState(() =>
    activeProfile ? String(activeProfile.daily_carb_target_min_g) : ""
  );
  const [carbMax, setCarbMax] = useState(() =>
    activeProfile ? String(activeProfile.daily_carb_target_g) : ""
  );
  const [basalUnits, setBasalUnits] = useState(() => activeProfile?.basal_daily_units ?? 0);
  // Premix UI toggle (P9), same reasoning as onboarding: the two layouts below
  // are derived from isMixSelection(basal_insulin_id, bolus_insulin_id), which
  // only turns true once a premix product is actually saved. This local flag
  // only bridges the instant between tapping "mixUse" and picking one - before
  // that the profile's own two ids are unchanged, so the derivation alone
  // cannot yet tell "premix, nothing picked" apart from "separate mode".
  const [mixModeUi, setMixModeUi] = useState(false);

  const glucoseBounds = {
    min: glucoseToDisplay(TARGET_RANGE_BOUNDS.min, unit),
    max: glucoseToDisplay(TARGET_RANGE_BOUNDS.max, unit),
  };
  const insulinMode = insulinModeOf(activeProfile);
  const showsBolus = insulinModeShowsBolus(insulinMode);
  const showsBasal = insulinModeShowsBasal(insulinMode);
  // Premix needs BOTH fields (it fills basal_insulin_id and bolus_insulin_id
  // together), so the toggle only ever appears when both gates are open; a
  // mode showing just one of the two insulin fields keeps its plain picker.
  const mixEligible = showsBasal && showsBolus;
  const mixMode = mixEligible && (mixModeUi || isMixSelection(
    activeProfile?.basal_insulin_id ?? null,
    activeProfile?.bolus_insulin_id ?? null
  ));
  const oralMeds = activeProfile?.oral_meds_enabled === 1;
  const diabetesType: DiabetesType = activeProfile?.diabetes_type ?? "unknown";

  useEffect(() => {
    if (!activeProfile) return;
    let live = true;
    void getReportName(activeProfile.id).then((v) => {
      if (live) setReportNameText(v);
    });
    return () => {
      live = false;
    };
  }, [activeProfile?.id]);

  useEffect(() => {
    if (!activeProfile) return;
    const u = activeProfile.glucose_unit ?? "mgdl";
    setName(activeProfile.name);
    setRatioDraft(ratioFieldsInitial(activeProfile));
    setFastingMin(num(glucoseToDisplay(activeProfile.target_fasting_min, u)));
    setFastingMax(num(glucoseToDisplay(activeProfile.target_fasting_max, u)));
    setPostmealMin(num(glucoseToDisplay(activeProfile.target_postmeal_min, u)));
    setPostmealMax(num(glucoseToDisplay(activeProfile.target_postmeal_max, u)));
    setCarbMin(String(activeProfile.daily_carb_target_min_g));
    setCarbMax(String(activeProfile.daily_carb_target_g));
    setBasalUnits(activeProfile.basal_daily_units ?? 0);
  }, [activeProfile?.id, activeProfile?.glucose_unit]);

  // The long-acting daily dose is written ONLY when the field is left (or the
  // screen is), and only if it is a valid number: a pause in the middle of
  // typing "160" must not store 16, and refused text returns to what is stored.
  const basalInvalidRef = useRef(false);
  const basalPendingRef = useRef<number | null | undefined>(undefined);
  const [basalKey, setBasalKey] = useState(0);
  const persistRef = useRef<typeof persist | null>(null);

  function flushBasal() {
    const v = basalPendingRef.current;
    basalPendingRef.current = undefined;
    if (v === undefined || basalInvalidRef.current) return;
    void persistRef.current?.({ basal_daily_units: v != null && v > 0 ? v : null });
  }

  function onBasalChange(v: number | null) {
    setBasalUnits(v ?? 0);
    basalPendingRef.current = v;
  }

  function onBasalBlur() {
    if (basalInvalidRef.current) {
      basalPendingRef.current = undefined;
      basalInvalidRef.current = false;
      setBasalUnits(activeProfile?.basal_daily_units ?? 0);
      setBasalKey((k) => k + 1);
      return;
    }
    flushBasal();
  }

  useEffect(
    () => () => {
      flushBasal();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  function n(v: string, fallback: number): number {
    const x = (parseDecimalText(v) ?? NaN);
    return Number.isFinite(x) && x > 0 ? x : fallback;
  }

  async function persist(patch: Record<string, string | number | null>) {
    if (!activeProfile) return;
    await updateProfile(activeProfile.id, patch);
    bumpData();
  }
  persistRef.current = persist;

  /**
   * The nightly basal reminder belongs to the insulin mode, not only to the
   * notification preference: leaving one armed after a switch to a mode without
   * long-acting insulin keeps an insulin nudge on a screen that no longer shows
   * insulin anywhere. Switching back re-arms it from the saved preferences.
   *
   * Non-prompting: changing a profile setting must not raise an OS dialog, so
   * the re-apply only runs once permission is already granted.
   */
  async function persistInsulinMode(m: InsulinMode) {
    if (m === insulinMode) return;
    await persist({ insulin_mode: m });
    if (!insulinModeShowsBasal(m)) {
      await cancelBasalReminder();
      // Belt-and-suspenders with the cancel call above: applyNotificationPrefs
      // re-derives the schedule from the now-persisted mode and sweeps any
      // basal alarm too (see applyReminders), so this can never leave one
      // ringing on an insulin mode that no longer shows basal at all.
      await applyNotificationPrefs();
    } else {
      // K3-2: unconditional. The delivery decision belongs to applyReminders
      // (per row, per mechanism), so gating this on the NOTIFICATION permission
      // meant a user who granted only the alarm permission never got their
      // basal/med reminders re-armed when they turned the mode back on.
      await applyNotificationPrefs();
    }
  }

  /**
   * Turning oral-medication tracking OFF also takes down its daily reminder,
   * for the same reason the basal one follows the insulin mode: the surface it
   * belongs to is gone. Turning it back ON re-applies the saved preferences, so
   * a reminder the user had already set up comes back with it - exactly what the
   * insulin-mode branch above does. It never arms a NEW one: the med reminder is
   * off by default and its time lives in notification settings.
   *
   * Non-prompting, same as above.
   */
  async function persistOralMeds(on: boolean) {
    await persist({ oral_meds_enabled: on ? 1 : 0 });
    if (!on) {
      await cancelMedReminder();
      // Same belt-and-suspenders as persistInsulinMode above: re-apply so the
      // now-persisted oral_meds_enabled=0 also sweeps a med alarm, not only
      // the notification half.
      await applyNotificationPrefs();
    } else {
      // K3-2: unconditional. The delivery decision belongs to applyReminders
      // (per row, per mechanism), so gating this on the NOTIFICATION permission
      // meant a user who granted only the alarm permission never got their
      // basal/med reminders re-armed when they turned the mode back on.
      await applyNotificationPrefs();
    }
  }

  // Typing only records a draft. The write waits for a pause or a blur and goes
  // through one queue (lib/ratioWriter.ts), shared with the calculator's ratios
  // sheet, comparing against what it last sent rather than the profile in
  // context, which lags behind a write. Every value typed is kept, even with the
  // others still empty; a changed set withdraws the confirmation.
  // A failed write is said out loud; the writer keeps the draft and the next
  // blur or tick tries it again.
  const ratioWriters = useRatioWriter(() => toast(t("common.saveFailed"), "error"));
  const ratioTouchedRef = useRef(false);

  // The sheet on the calculator may have written the numbers a moment before this
  // screen mounted; until the user edits here, follow the stored set.
  const storedRatiosKey = JSON.stringify(ratioFieldsInitial(activeProfile));
  useEffect(() => {
    if (!activeProfile || ratioTouchedRef.current) return;
    setRatioDraft(ratioFieldsInitial(activeProfile));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedRatiosKey]);

  function onRatioDraft(next: RatioFields) {
    ratioTouchedRef.current = true;
    setRatioDraft(next);
    ratioWriters.get()?.update(next);
  }

  function onRatioBlur() {
    void ratioWriters.get()?.flush();
  }

  // One press at a time, and one trip back: a double tap used to run the
  // confirmation twice (the second UNticked the box) and pop two screens, taking
  // the calculator's open record with it.
  const [confirming, setConfirming] = useState(false);
  const navigation = useNavigation();
  const latestRef = useRef({ returnTo, router, navigation });
  latestRef.current = { returnTo, router, navigation };
  const leftRef = useRef(false);
  useEffect(
    () => () => {
      leftRef.current = true;
    },
    []
  );
  const confirmGateRef = useRef<ReturnType<typeof createConfirmGate> | null>(null);
  if (!confirmGateRef.current) {
    confirmGateRef.current = createConfirmGate({
      confirm: async (checked) => (await ratioWriters.get()?.confirm(checked)) ?? false,
      // Only while this screen is still the one on top: a user who already went
      // back during the write must not pop the calculator under it as well.
      canNavigate: () => !leftRef.current && latestRef.current.navigation.isFocused(),
      onConfirmed: () => {
        const { returnTo: to, router: r } = latestRef.current;
        if (to === "calculator" && r.canGoBack()) r.back();
      },
      onBusy: setConfirming,
    });
  }
  function onRatioConfirm(checked: boolean) {
    void confirmGateRef.current?.press(checked);
  }

  const ratioDraftIsStored = ratioSetMatchesStored(
    activeProfile,
    ratioDraft,
    activeProfile?.glucose_unit ?? "mgdl"
  );

  function rangeOk(minText: string, maxText: string): boolean {
    const lo = (parseDecimalText(minText) ?? NaN);
    const hi = (parseDecimalText(maxText) ?? NaN);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return false;
    return lo < hi;
  }

  function withinBounds(
    minText: string,
    maxText: string,
    bounds: { min: number; max: number }
  ): boolean {
    const lo = (parseDecimalText(minText) ?? NaN);
    const hi = (parseDecimalText(maxText) ?? NaN);
    return lo >= bounds.min && lo <= bounds.max && hi >= bounds.min && hi <= bounds.max;
  }

  async function persistRange(which: "fasting" | "postmeal") {
    const minText = which === "fasting" ? fastingMin : postmealMin;
    const maxText = which === "fasting" ? fastingMax : postmealMax;
    if (!rangeOk(minText, maxText)) return;
    if (!withinBounds(minText, maxText, glucoseBounds)) return;
    const lo = clampTarget(glucoseFromDisplay(n(minText, 80), unit));
    const hi = clampTarget(glucoseFromDisplay(n(maxText, 140), unit));
    if (lo >= hi) return;
    await persist(
      which === "fasting"
        ? { target_fasting_min: lo, target_fasting_max: hi }
        : { target_postmeal_min: lo, target_postmeal_max: hi }
    );
  }

  async function persistCarbRange() {
    if (!rangeOk(carbMin, carbMax)) return;
    if (!withinBounds(carbMin, carbMax, CARB_TARGET_BOUNDS)) return;
    const lo = clampCarbTarget(n(carbMin, 160));
    const hi = clampCarbTarget(n(carbMax, 200));
    if (lo >= hi) return;
    await persist({ daily_carb_target_min_g: lo, daily_carb_target_g: hi });
  }

  /**
   * Changing diabetes type is a three-step flow (Wave 2a, +treatment question
   * in 2.2.0 B7): first that visible sections will follow the new type
   * (records are never touched), then a separate offer to reset the
   * target-range defaults for it, then - for every type that can show
   * insulin controls - the same insulin/pills question onboarding asks, so
   * insulin_mode/oral_meds_enabled are never left stale after a type switch.
   * Switching into prediabetes/none skips that third step entirely and
   * instead switches off insulin_mode itself, the same way the insulin
   * segment does, since those two types never show insulin controls; that
   * side effect is called out in the first dialog's body rather than
   * happening silently.
   */
  async function handleDiabetesTypeChange(next: DiabetesType) {
    if (next === diabetesType) return;
    const willCancelInsulin = isNoInsulinDiabetesType(next) && insulinMode !== "none";

    const confirmed = await confirm({
      title: t("settings.typeChangeTitle"),
      message: willCancelInsulin
        ? `${t("settings.typeChangeBody")}\n\n${t("settings.typeChangeInsulinNote")}`
        : t("settings.typeChangeBody"),
    });
    if (!confirmed) return;

    await persist({ diabetes_type: next });
    if (willCancelInsulin) await persistInsulinMode("none");

    const wantsDefaults = await confirm({
      title: t("settings.typeDefaultsTitle"),
      message: t("settings.typeDefaultsBody"),
      confirmLabel: t("settings.useDefaults"),
      cancelLabel: t("settings.keepValues"),
    });
    if (wantsDefaults) {
      const { fasting, postmeal } = TARGET_DEFAULTS_MGDL[next];
      const patch: Record<string, number> = {
        target_fasting_min: fasting.min,
        target_fasting_max: fasting.max,
        target_postmeal_min: postmeal.min,
        target_postmeal_max: postmeal.max,
      };
      setFastingMin(num(glucoseToDisplay(fasting.min, unit)));
      setFastingMax(num(glucoseToDisplay(fasting.max, unit)));
      setPostmealMin(num(glucoseToDisplay(postmeal.min, unit)));
      setPostmealMax(num(glucoseToDisplay(postmeal.max, unit)));
      if (next === "gestational") {
        const carb = CARB_TARGET_DEFAULTS_G.gestational;
        patch.daily_carb_target_min_g = carb.min;
        patch.daily_carb_target_g = carb.max;
        setCarbMin(String(carb.min));
        setCarbMax(String(carb.max));
      }
      await persist(patch);
    }

    // Third step: type1/type2/gestational/unknown can all show insulin
    // controls, so - unlike the two no-insulin types above - the switch must
    // not leave insulin_mode/oral_meds_enabled sitting on whatever the
    // PREVIOUS type happened to leave behind. Asking here, right at the type
    // change, is also why InsulinModeSection's own "choose one" hint now
    // rarely shows: it only surfaces if this question is left unanswered.
    if (!isNoInsulinDiabetesType(next)) askTreatmentQuestion();
  }

  /**
   * Same four-way question onboarding asks (icons + copy reused verbatim, see
   * TREATMENT_OPTIONS in app/onboarding.tsx), presented as an action sheet so
   * it matches the app's other single-pick modals. Dismissing it without an
   * answer (backdrop tap, Android back) leaves insulin_mode/oral_meds_enabled
   * exactly as they were - the same "no answer, no change" rule the two
   * confirms above follow.
   */
  function askTreatmentQuestion() {
    actionSheet({
      title: t("onboarding.qInsulin"),
      actions: [
        {
          label: t("onboarding.treatment_insulin"),
          icon: "water-outline",
          onPress: () => void applyTreatmentAnswer(true, false),
        },
        {
          label: t("onboarding.treatment_pills"),
          icon: "medkit-outline",
          onPress: () => void applyTreatmentAnswer(false, true),
        },
        {
          label: t("onboarding.treatment_both"),
          icon: "swap-horizontal-outline",
          onPress: () => void applyTreatmentAnswer(true, true),
        },
        {
          label: t("onboarding.treatment_none"),
          icon: "remove-circle-outline",
          onPress: () => void applyTreatmentAnswer(false, false),
        },
      ],
    });
  }

  /**
   * Maps the answer to insulin_mode + oral_meds_enabled through the existing
   * persist paths (persistInsulinMode keeps the basal-reminder-cancel logic;
   * oral gets the same reminder-cancel treatment via persistOralMeds).
   * Coarse on purpose: any insulin answer becomes insulin_mode "both", the
   * same mapping onboarding uses - the basal/bolus split stays a
   * Settings-only refinement via the segmented control below. Either half is
   * skipped when the answer already matches what is saved.
   */
  async function applyTreatmentAnswer(hasInsulinAnswer: boolean, hasOralAnswer: boolean) {
    await persistInsulinMode(hasInsulinAnswer ? "both" : "none");
    if (hasOralAnswer !== oralMeds) await persistOralMeds(hasOralAnswer);
  }

  return (
    <SettingsScaffold scrollHintId="profile" title={t("onboarding.secProfile")}>
      <View style={columnPad()}>
      <FormCard icon="person-outline" title={t("onboarding.secProfile")}>
        <InputRow
          icon="text-outline"
          label={t("settings.name")}
          value={name}
          onChangeText={setName}
          placeholder={t("profiles.defaultName")}
          onEndEditing={() =>
            persist({ name: name.trim() })
          }
        />
        <InputRow
          icon="document-text-outline"
          label={t("settings.reportName")}
          hint={t("settings.reportNameHint")}
          value={reportName}
          onChangeText={setReportNameText}
          maxLength={REPORT_NAME_MAX}
          onEndEditing={() => {
            if (activeProfile) void setReportName(activeProfile.id, reportName);
          }}
          last
        />
      </FormCard>

      <FormCard icon="options-outline" title={t("settings.glucoseUnit")}>
        <View className="px-4 py-3.5">
          <Segmented
            options={[
              { value: "mgdl", label: "mg/dL" },
              { value: "mmol", label: "mmol/L" },
            ]}
            value={unit}
            onChange={(u: GlucoseUnit) => persist({ glucose_unit: u })}
          />
        </View>
      </FormCard>

      <FormCard icon="nutrition-outline" title={t("carbDisplay.title")}>
        <View className="px-4 py-3.5">
          <Segmented
            options={[
              { value: "gram", label: t("carbDisplay.gram") },
              { value: "choice15", label: t("carbDisplay.choice15") },
              { value: "portion10", label: t("carbDisplay.portion10") },
            ]}
            value={carbMode}
            onChange={(m: CarbDisplayMode) => void setCarbDisplayMode(m)}
          />
          <Text className="text-mut text-xs mt-2 leading-4">{t("carbDisplay.hint")}</Text>
          {regionNote ? (
            <Text className="text-mut text-xs mt-1 leading-4">
              {regionNote === "us" ? t("carbDisplay.regionUs") : t("carbDisplay.regionGb")}
            </Text>
          ) : null}
        </View>
      </FormCard>

      <InsulinModeSection
        diabetesType={diabetesType}
        insulinMode={insulinMode}
        onChangeInsulinMode={(m) => void persistInsulinMode(m)}
        oralMeds={oralMeds}
        onChangeOralMeds={(v) => void persistOralMeds(v)}
      />

      <FormCard icon="medkit-outline" title={t("settings.diabetesType")}>
        <View className="px-4 py-3.5">
          <Segmented
            options={(
              ["type1", "type2", "gestational", "prediabetes", "none", "unknown"] as DiabetesType[]
            ).map((d) => ({
              value: d,
              label: d === "unknown" ? t("onboarding.diabetes_other") : t(`onboarding.diabetes_${d}`),
            }))}
            value={diabetesType}
            onChange={(d: DiabetesType) => void handleDiabetesTypeChange(d)}
          />
          <Text className="text-mut text-xs mt-2 leading-4">{t("settings.diabetesTypeHint")}</Text>
        </View>
      </FormCard>

      <SectionLabel>{t("settings.targetsSection")}</SectionLabel>
      <RangeInput
        label={t("settings.fastingRange")}
        unit={glucoseUnitLabel(unit)}
        minText={fastingMin}
        maxText={fastingMax}
        onChangeMin={setFastingMin}
        onChangeMax={setFastingMax}
        onBlur={() => persistRange("fasting")}
        axisMin={glucoseToDisplay(50, unit)}
        axisMax={glucoseToDisplay(250, unit)}
        minLabel={t("common.rangeMin")}
        maxLabel={t("common.rangeMax")}
        invalid={!rangeOk(fastingMin, fastingMax)}
        invalidMessage={t("settings.rangeInvalid")}
        bounds={glucoseBounds}
        outOfBoundsMessage={t("settings.rangeOutOfBounds", { min: glucoseBounds.min, max: glucoseBounds.max })}
        decimals={unit === "mmol"}
      />
      <RangeInput
        label={t("settings.postmealRange")}
        unit={glucoseUnitLabel(unit)}
        minText={postmealMin}
        maxText={postmealMax}
        onChangeMin={setPostmealMin}
        onChangeMax={setPostmealMax}
        onBlur={() => persistRange("postmeal")}
        axisMin={glucoseToDisplay(50, unit)}
        axisMax={glucoseToDisplay(300, unit)}
        minLabel={t("common.rangeMin")}
        maxLabel={t("common.rangeMax")}
        invalid={!rangeOk(postmealMin, postmealMax)}
        invalidMessage={t("settings.rangeInvalid")}
        bounds={glucoseBounds}
        outOfBoundsMessage={t("settings.rangeOutOfBounds", { min: glucoseBounds.min, max: glucoseBounds.max })}
        decimals={unit === "mmol"}
      />
      <RangeInput
        label={t("settings.carbRange")}
        unit={t("common.grams")}
        minText={carbMin}
        maxText={carbMax}
        onChangeMin={setCarbMin}
        onChangeMax={setCarbMax}
        onBlur={persistCarbRange}
        axisMin={0}
        axisMax={400}
        minLabel={t("common.rangeMin")}
        maxLabel={t("common.rangeMax")}
        invalid={!rangeOk(carbMin, carbMax)}
        invalidMessage={t("settings.rangeInvalid")}
        bounds={CARB_TARGET_BOUNDS}
        outOfBoundsMessage={t("settings.rangeOutOfBounds", { min: CARB_TARGET_BOUNDS.min, max: CARB_TARGET_BOUNDS.max })}
      />

      <FormCard icon="warning-outline" title={`${t("settings.hypoThreshold")} (${glucoseUnitLabel(unit)})`}>
        <View className="px-4 py-3.5">
          <Segmented
            options={[54, 60, 65, 70, 75, 80].map((mgdl) => ({
              value: String(mgdl),
              label: num(glucoseToDisplay(mgdl, unit)),
            }))}
            value={String(activeProfile?.hypo_threshold_mgdl ?? 70)}
            onChange={(v) => void persist({ hypo_threshold_mgdl: clampHypoThreshold(Number(v)) })}
          />
          <Text className="text-mut text-xs mt-2 leading-4">{t("settings.hypoThresholdHint")}</Text>
        </View>
      </FormCard>

      {/* Basal dose + product: long-acting-insulin users only (WP4). Grouped with
          ISF/carb ratios below since all five cards are dosing-detail config,
          kept apart from the general profile cards above (name, mode, targets). */}
      {showsBasal ? (
        <FormCard icon="moon-outline" title={t("settings.basalDailyUnits")}>
          <View className="px-4 py-3">
            <Text className="text-mut text-xs mb-2">{t("settings.basalDailyUnitsHint")}</Text>
<NumericField
              key={basalKey}
              value={basalUnits > 0 ? basalUnits : null}
              onChange={onBasalChange}
              onValidityChange={(valid) => {
                basalInvalidRef.current = !valid;
              }}
              onBlur={onBasalBlur}
              step={BASAL_DAILY_BOUNDS.step}
              longStep={1}
              min={BASAL_DAILY_BOUNDS.min}
              max={BASAL_DAILY_BOUNDS.max}
              decimals={BASAL_DAILY_BOUNDS.decimals}
              suffix={t("common.units")}
              accessibilityLabel={t("settings.basalDailyUnits")}
            />
          </View>
        </FormCard>
      ) : null}

      {/* A premix product covers both slots in one injection (see
          isMixSelection), so it is offered as its own third card - basal and
          bolus, below, only ever show a plain picker once this is off. */}
      {mixMode ? (
        <FormCard icon="battery-charging-outline" title={t("insulinPicker.groupMix")}>
          <View className="px-4 py-3.5">
            <InsulinProductPicker
              label={t("insulinPicker.groupMix")}
              value={activeProfile?.basal_insulin_id ?? null}
              otherValue={activeProfile?.basal_insulin_other ?? null}
              slot="mix"
              onChange={(id) =>
                void persist({
                  basal_insulin_id: id,
                  bolus_insulin_id: id,
                  basal_insulin_other: id === OTHER_PRODUCT_ID ? activeProfile?.basal_insulin_other ?? null : null,
                  bolus_insulin_other: id === OTHER_PRODUCT_ID ? activeProfile?.bolus_insulin_other ?? null : null,
                })
              }
              onOtherChange={(text) =>
                void persist({ basal_insulin_other: text, bolus_insulin_other: text })
              }
            />
            <Button
              variant="tertiary"
              onPress={() => {
                setMixModeUi(false);
                void persist({
                  basal_insulin_id: null,
                  bolus_insulin_id: null,
                  basal_insulin_other: null,
                  bolus_insulin_other: null,
                });
              }}
              label={t("insulinPicker.mixOff")}
              className="mt-1.5"
            />
          </View>
        </FormCard>
      ) : null}

      {showsBasal && !mixMode ? (
        <FormCard icon="battery-charging-outline" title={t("settings.basalInsulin")}>
          <View className="px-4 py-3.5">
            <InsulinProductPicker
              label={t("settings.basalInsulin")}
              value={activeProfile?.basal_insulin_id ?? null}
              otherValue={activeProfile?.basal_insulin_other ?? null}
              slot="basal"
              onChange={(id) =>
                void persist({
                  basal_insulin_id: id,
                  basal_insulin_other: id === OTHER_PRODUCT_ID ? activeProfile?.basal_insulin_other ?? null : null,
                })
              }
              onOtherChange={(text) => void persist({ basal_insulin_other: text })}
              notSetLabel={t("settings.insulinProductNotSet")}
            />
            {mixEligible ? (
              <Button
                variant="tertiary"
                onPress={() => setMixModeUi(true)}
                label={t("insulinPicker.mixUse")}
                className="mt-1.5"
              />
            ) : null}
          </View>
        </FormCard>
      ) : null}

      {/* ISF + carb ratios, mealtime-insulin users only. Every field starts
          empty: the calculator shows no unit figure until the user has typed
          their own numbers and ticked the box below. */}
      {showsBolus ? (
        <FormCard icon="pulse-outline" title={t("settings.isf")}>
          <View className="px-4 py-3">
            <Text className="text-mut text-xs mb-2">{t("settings.isfHint")}</Text>
<IsfInput
              valueMgdl={ratioDraft.isfMgdl}
              onChangeMgdl={(v) => onRatioDraft({ ...ratioDraft, isfMgdl: v })}
              unit={unit}
              accessibilityLabel={t("settings.isf")}
              onBlur={onRatioBlur}
            />
          </View>
        </FormCard>
      ) : null}

      {showsBolus ? (
        <FormCard icon="restaurant-outline" title={t("settings.carbRatios")}>
          {(["breakfast", "lunch", "dinner"] as const).map((slot, i, arr) => (
            <View
              key={slot}
              className="px-4 py-3"
              style={i < arr.length - 1 ? { borderBottomWidth: 1, borderBottomColor: THEME.border } : undefined}
            >
              <Text className="text-mut text-xs mb-2">{t(`slot.${slot}`)}</Text>
<CarbRatioInput
                value={ratioDraft[slot]}
                onChange={(v) => onRatioDraft({ ...ratioDraft, [slot]: v })}
                accessibilityLabel={t(`slot.${slot}`)}
                onBlur={onRatioBlur}
              />
            </View>
          ))}
        </FormCard>
      ) : null}

      {showsBolus ? (
        <FormCard icon="checkmark-circle-outline" title={t("calculator.setup.title")}>
          <View className="px-4 py-3">
            <Text className="text-mut text-xs mb-1">{t("calculator.setup.teamNote")}</Text>
            <ConfirmCheckbox
              checked={activeProfile?.ratios_confirmed === 1 && ratioDraftIsStored}
              onToggle={onRatioConfirm}
              label={t("calculator.setup.confirm")}
              hint={t("calculator.setup.hint")}
              disabled={!ratioFieldsComplete(ratioDraft) || confirming}
            />
            <Text className="text-mut text-xs mt-1">{t("settings.ratiosReconfirmHint")}</Text>
          </View>
        </FormCard>
      ) : null}

      {showsBolus && !mixMode ? (
        <FormCard icon="flash-outline" title={t("settings.bolusInsulin")}>
          <View className="px-4 py-3.5">
            <InsulinProductPicker
              label={t("settings.bolusInsulin")}
              value={activeProfile?.bolus_insulin_id ?? null}
              otherValue={activeProfile?.bolus_insulin_other ?? null}
              slot="bolus"
              onChange={(id) =>
                void persist({
                  bolus_insulin_id: id,
                  bolus_insulin_other: id === OTHER_PRODUCT_ID ? activeProfile?.bolus_insulin_other ?? null : null,
                })
              }
              onOtherChange={(text) => void persist({ bolus_insulin_other: text })}
              notSetLabel={t("settings.insulinProductNotSet")}
              hint={t("settings.bolusInsulinHint")}
            />
          </View>
        </FormCard>
      ) : null}
      </View>
    </SettingsScaffold>
  );
}
