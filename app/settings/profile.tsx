import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

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
import { insulinModeOf, insulinModeShowsBolus } from "../../lib/insulinMode";
import { parseDecimalText } from "../../lib/numberInput";
import { Segmented } from "../../components/ui";
import { FormCard, InputRow } from "../../components/form";
import { RangeInput } from "../../components/RangeInput";
import { Stepper } from "../../components/Stepper";
import { SettingsScaffold } from "../../components/settingsUi";
import { SectionLabel } from "../../components/ui";
import { useLayout } from "../../lib/useLayout";

/**
 * Settings > Profile & Targets. Moved verbatim from the old single-scroll
 * settings screen (R7.3 hub split); behaviour is unchanged. E.7: ISF and the
 * carb ratios are now Steppers (also keyboard-editable) instead of text rows.
 */
export default function ProfileSettings() {
  const { t } = useTranslation();
  const { activeProfile, bumpData } = useApp();
  const { contentColumn } = useLayout();

  const [name, setName] = useState("");
  const [isf, setIsf] = useState(0);
  const [crB, setCrB] = useState(0);
  const [crL, setCrL] = useState(0);
  const [crD, setCrD] = useState(0);
  const [fastingMin, setFastingMin] = useState("");
  const [fastingMax, setFastingMax] = useState("");
  const [postmealMin, setPostmealMin] = useState("");
  const [postmealMax, setPostmealMax] = useState("");
  const [carbMin, setCarbMin] = useState("");
  const [carbMax, setCarbMax] = useState("");

  const unit: GlucoseUnit = activeProfile?.glucose_unit ?? "mgdl";
  const glucoseBounds = {
    min: glucoseToDisplay(TARGET_RANGE_BOUNDS.min, unit),
    max: glucoseToDisplay(TARGET_RANGE_BOUNDS.max, unit),
  };
  const insulinMode = insulinModeOf(activeProfile);
  const showsBolus = insulinModeShowsBolus(insulinMode);

  useEffect(() => {
    if (!activeProfile) return;
    const u = activeProfile.glucose_unit ?? "mgdl";
    setName(activeProfile.name);
    setIsf(glucoseToDisplay(activeProfile.insulin_sensitivity_factor, u));
    setCrB(activeProfile.carb_ratio_breakfast);
    setCrL(activeProfile.carb_ratio_lunch);
    setCrD(activeProfile.carb_ratio_dinner);
    setFastingMin(String(glucoseToDisplay(activeProfile.target_fasting_min, u)));
    setFastingMax(String(glucoseToDisplay(activeProfile.target_fasting_max, u)));
    setPostmealMin(String(glucoseToDisplay(activeProfile.target_postmeal_min, u)));
    setPostmealMax(String(glucoseToDisplay(activeProfile.target_postmeal_max, u)));
    setCarbMin(String(activeProfile.daily_carb_target_min_g));
    setCarbMax(String(activeProfile.daily_carb_target_g));
  }, [activeProfile?.id, activeProfile?.glucose_unit]);

  function n(v: string, fallback: number): number {
    const x = (parseDecimalText(v) ?? NaN);
    return Number.isFinite(x) && x > 0 ? x : fallback;
  }

  async function persist(patch: Record<string, string | number>) {
    if (!activeProfile) return;
    await updateProfile(activeProfile.id, patch);
    bumpData();
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

  return (
    <SettingsScaffold title={t("onboarding.secProfile")}>
      <View style={contentColumn}>
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

      <FormCard icon="layers-outline" title={t("settings.insulinMode")}>
        <View className="px-4 py-3.5">
          <Segmented
            options={(["none", "basal", "bolus", "both"] as InsulinMode[]).map((m) => ({
              value: m,
              label: t(`onboarding.insulin_${m}`),
            }))}
            value={insulinMode}
            onChange={(m: InsulinMode) => persist({ insulin_mode: m })}
          />
        </View>
      </FormCard>

      <FormCard icon="medkit-outline" title={t("settings.diabetesType")}>
        <View className="px-4 py-3.5">
          <Segmented
            options={(
              ["type1", "type2", "gestational", "prediabetes", "unknown"] as DiabetesType[]
            ).map((d) => ({
              value: d,
              label: d === "unknown" ? t("onboarding.diabetes_other") : t(`onboarding.diabetes_${d}`),
            }))}
            value={activeProfile?.diabetes_type ?? "unknown"}
            onChange={(d: DiabetesType) => persist({ diabetes_type: d })}
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
              label: String(glucoseToDisplay(mgdl, unit)),
            }))}
            value={String(activeProfile?.hypo_threshold_mgdl ?? 70)}
            onChange={(v) => void persist({ hypo_threshold_mgdl: clampHypoThreshold(Number(v)) })}
          />
          <Text className="text-mut text-xs mt-2 leading-4">{t("settings.hypoThresholdHint")}</Text>
        </View>
      </FormCard>

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
      </View>
    </SettingsScaffold>
  );
}
