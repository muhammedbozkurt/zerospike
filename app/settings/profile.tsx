import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";

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
import { productsByCategory } from "../../lib/insulinCatalog";
import { parseDecimalText } from "../../lib/numberInput";
import { Segmented } from "../../components/ui";
import { FormCard, InputRow } from "../../components/form";
import { RangeInput } from "../../components/RangeInput";
import { Stepper } from "../../components/Stepper";
import { InsulinProductPicker } from "../../components/InsulinProductPicker";
import { InsulinModeSection } from "../../components/InsulinModeSection";
import { Row, SettingsScaffold } from "../../components/settingsUi";
import { SectionLabel } from "../../components/ui";
import { useFeedback } from "../../components/Feedback";
import { useLayout } from "../../lib/useLayout";

/**
 * Settings > Profile & Targets. Moved verbatim from the old single-scroll
 * settings screen (R7.3 hub split); behaviour is unchanged. E.7: ISF and the
 * carb ratios are now Steppers (also keyboard-editable) instead of text rows.
 */
export default function ProfileSettings() {
  const { t } = useTranslation();
  const { activeProfile, bumpData } = useApp();
  const { columnPad } = useLayout();
  const { confirm } = useFeedback();
  const router = useRouter();

  // activeProfile is already in context by the time this screen mounts (see
  // profile-setup.tsx for the same pattern), so every field is seeded straight
  // from it via a lazy initializer instead of starting blank/zero and jumping
  // to the real value after an effect - a zero ISF or an empty name is a wrong
  // value on screen, not just a loading state.
  const unit: GlucoseUnit = activeProfile?.glucose_unit ?? "mgdl";
  const [name, setName] = useState(() => activeProfile?.name ?? "");
  const [isf, setIsf] = useState(() =>
    activeProfile ? glucoseToDisplay(activeProfile.insulin_sensitivity_factor, unit) : 0
  );
  const [crB, setCrB] = useState(() => activeProfile?.carb_ratio_breakfast ?? 0);
  const [crL, setCrL] = useState(() => activeProfile?.carb_ratio_lunch ?? 0);
  const [crD, setCrD] = useState(() => activeProfile?.carb_ratio_dinner ?? 0);
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

  const glucoseBounds = {
    min: glucoseToDisplay(TARGET_RANGE_BOUNDS.min, unit),
    max: glucoseToDisplay(TARGET_RANGE_BOUNDS.max, unit),
  };
  const insulinMode = insulinModeOf(activeProfile);
  const showsBolus = insulinModeShowsBolus(insulinMode);
  const showsBasal = insulinModeShowsBasal(insulinMode);
  const oralMeds = activeProfile?.oral_meds_enabled === 1;
  const diabetesType: DiabetesType = activeProfile?.diabetes_type ?? "unknown";

  useEffect(() => {
    if (!activeProfile) return;
    const u = activeProfile.glucose_unit ?? "mgdl";
    setName(activeProfile.name);
    setIsf(glucoseToDisplay(activeProfile.insulin_sensitivity_factor, u));
    setCrB(activeProfile.carb_ratio_breakfast);
    setCrL(activeProfile.carb_ratio_lunch);
    setCrD(activeProfile.carb_ratio_dinner);
    setFastingMin(num(glucoseToDisplay(activeProfile.target_fasting_min, u)));
    setFastingMax(num(glucoseToDisplay(activeProfile.target_fasting_max, u)));
    setPostmealMin(num(glucoseToDisplay(activeProfile.target_postmeal_min, u)));
    setPostmealMax(num(glucoseToDisplay(activeProfile.target_postmeal_max, u)));
    setCarbMin(String(activeProfile.daily_carb_target_min_g));
    setCarbMax(String(activeProfile.daily_carb_target_g));
    setBasalUnits(activeProfile.basal_daily_units ?? 0);
  }, [activeProfile?.id, activeProfile?.glucose_unit]);

  function n(v: string, fallback: number): number {
    const x = (parseDecimalText(v) ?? NaN);
    return Number.isFinite(x) && x > 0 ? x : fallback;
  }

  async function persist(patch: Record<string, string | number | null>) {
    if (!activeProfile) return;
    await updateProfile(activeProfile.id, patch);
    bumpData();
  }

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
    if (!insulinModeShowsBasal(m)) await cancelBasalReminder();
    else if (await hasNotificationPermission()) await applyNotificationPrefs();
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
    if (!on) await cancelMedReminder();
    else if (await hasNotificationPermission()) await applyNotificationPrefs();
  }

  // Saving a ratio is the user telling us this IS their number, so it clears the
  // "running on defaults" state the calculator surfaces.
  async function persistRatio(patch: Record<string, number>) {
    await persist({ ...patch, ratios_confirmed: 1 });
  }

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
   * Changing diabetes type is a two-step confirm (Wave 2a): first that visible
   * sections will follow the new type (records are never touched), then a
   * separate offer to reset the target-range defaults for it. Switching into
   * prediabetes/none also switches off insulin_mode, the same way the insulin
   * segment itself does, since those two types never show insulin controls;
   * that side effect is called out in the first dialog's body rather than
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
    if (!wantsDefaults) return;

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

  return (
    <SettingsScaffold title={t("onboarding.secProfile")}>
      <View style={columnPad()}>
      <FormCard icon="person-outline" title={t("onboarding.secProfile")}>
        <InputRow
          icon="text-outline"
          label={t("settings.name")}
          value={name}
          onChangeText={setName}
          onEndEditing={() =>
            persist({ name: name.trim() || t("profiles.defaultName") })
          }
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

      <InsulinModeSection
        diabetesType={diabetesType}
        insulinMode={insulinMode}
        onChangeInsulinMode={(m) => void persistInsulinMode(m)}
        oralMeds={oralMeds}
        onChangeOralMeds={(v) => void persistOralMeds(v)}
      />

      {/* Shortcut into the reminders hub, visible only while pill tracking is
          on - it is where the med reminder this links to actually lives. */}
      {oralMeds ? (
        <Row
          icon="alarm-outline"
          label={t("meds.setupReminderLink")}
          onPress={() => router.push("/settings/reminders")}
        />
      ) : null}

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
            <Stepper
              value={basalUnits}
              onChange={(v) => {
                setBasalUnits(v);
                void persist({ basal_daily_units: v > 0 ? v : null });
              }}
              step={0.5}
              longStep={1}
              min={0}
              max={150}
              decimals={1}
              suffix={t("common.units")}
              accessibilityLabel={t("settings.basalDailyUnits")}
            />
          </View>
        </FormCard>
      ) : null}

      {showsBasal ? (
        <FormCard icon="battery-charging-outline" title={t("settings.basalInsulin")}>
          <View className="px-4 py-3.5">
            <InsulinProductPicker
              title={t("settings.basalInsulin")}
              value={activeProfile?.basal_insulin_id ?? null}
              products={productsByCategory("basal")}
              onChange={(id) => void persist({ basal_insulin_id: id })}
              notSetLabel={t("settings.insulinProductNotSet")}
              durationLabel={t("settings.insulinDurationLabel")}
            />
          </View>
        </FormCard>
      ) : null}

      {/* ISF + carb ratios: steppers (E.7), mealtime-insulin users only. */}
      {showsBolus ? (
        <FormCard icon="pulse-outline" title={t("settings.isf")}>
          <View className="px-4 py-3">
            <Text className="text-mut text-xs mb-2">{t("settings.isfHint")}</Text>
            <Stepper
              value={isf}
              onChange={(v) => {
                setIsf(v);
                void persistRatio({
                  insulin_sensitivity_factor: glucoseFromDisplay(v, unit),
                });
              }}
              step={unit === "mmol" ? 0.1 : 1}
              longStep={unit === "mmol" ? 0.5 : 5}
              min={unit === "mmol" ? 0.5 : 5}
              max={unit === "mmol" ? 30 : 500}
              decimals={unit === "mmol" ? 1 : 0}
              suffix={glucoseUnitLabel(unit)}
              accessibilityLabel={t("settings.isf")}
            />
          </View>
        </FormCard>
      ) : null}

      {showsBolus ? (
        <FormCard icon="restaurant-outline" title={t("settings.carbRatios")}>
          {(
            [
              ["breakfast", crB, setCrB, "carb_ratio_breakfast"],
              ["lunch", crL, setCrL, "carb_ratio_lunch"],
              ["dinner", crD, setCrD, "carb_ratio_dinner"],
            ] as const
          ).map(([slot, value, setter, col], i, arr) => (
            <View
              key={slot}
              className="px-4 py-3"
              style={i < arr.length - 1 ? { borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.06)" } : undefined}
            >
              <Text className="text-mut text-xs mb-2">{t(`slot.${slot}`)}</Text>
              <Stepper
                value={value}
                onChange={(v) => {
                  setter(v);
                  void persistRatio({ [col]: v });
                }}
                step={0.5}
                longStep={1}
                min={1}
                max={50}
                decimals={1}
                suffix={t("common.carbRatioUnit")}
                accessibilityLabel={t(`slot.${slot}`)}
              />
            </View>
          ))}
        </FormCard>
      ) : null}

      {showsBolus ? (
        <FormCard icon="flash-outline" title={t("settings.bolusInsulin")}>
          <View className="px-4 py-3.5">
            <Text className="text-mut text-xs mb-2">{t("settings.bolusInsulinHint")}</Text>
            <InsulinProductPicker
              title={t("settings.bolusInsulin")}
              value={activeProfile?.bolus_insulin_id ?? null}
              products={productsByCategory("bolus")}
              onChange={(id) => void persist({ bolus_insulin_id: id })}
              notSetLabel={t("settings.insulinProductNotSet")}
              durationLabel={t("settings.insulinDurationLabel")}
            />
          </View>
        </FormCard>
      ) : null}
      </View>
    </SettingsScaffold>
  );
}
