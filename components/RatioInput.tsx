import React from "react";
import { useTranslation } from "react-i18next";

import { NumericField } from "./NumericField";
import { CARB_RATIO_BOUNDS, ISF_BOUNDS } from "../lib/calcSetup";
import type { GlucoseUnit } from "../lib/db/types";
import { glucoseFromDisplay, glucoseToDisplay, glucoseUnitLabel } from "../lib/glucose";

/**
 * The calculator's two kinds of number, as NumericField presets. Both start
 * EMPTY (these are the user's own numbers, never a starting suggestion) and
 * are used by the calculator's ratios sheet, Profile and Targets and the
 * profile editor, so the bounds, steps and units are decided once.
 */

/** Grams of carbohydrate per unit of insulin: 1-100 g/U, steps of 0.5. */
export function CarbRatioInput({
  value,
  onChange,
  accessibilityLabel,
  onBlur,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  accessibilityLabel: string;
  onBlur?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <NumericField
      value={value}
      onChange={onChange}
      decimals={1}
      min={CARB_RATIO_BOUNDS.min}
      max={CARB_RATIO_BOUNDS.max}
      step={0.5}
      longStep={2}
      placeholder={t("numeric.carbRatioExample")}
      suffix={t("common.carbRatioUnit")}
      accessibilityLabel={accessibilityLabel}
      onBlur={onBlur}
    />
  );
}

/**
 * The correction factor. Stored in mg/dL, edited in the profile's display unit:
 * 1 mg/dL steps (1-500), or 0.1 mmol/L steps (0.1-27.8) on a mmol screen. One
 * 0.1 mmol/L step is about 1.8 mg/dL, so every tenth maps to its own stored
 * value and typing back what the field shows reads as unchanged
 * (lib/calcSetup.ts sameIsf).
 */
export function IsfInput({
  valueMgdl,
  onChangeMgdl,
  unit,
  accessibilityLabel,
  onBlur,
}: {
  valueMgdl: number | null;
  onChangeMgdl: (v: number | null) => void;
  unit: GlucoseUnit;
  accessibilityLabel: string;
  onBlur?: () => void;
}) {
  const { t } = useTranslation();
  const mmol = unit === "mmol";
  const bounds = ISF_BOUNDS[mmol ? "mmol" : "mgdl"];
  return (
    <NumericField
      value={valueMgdl == null ? null : glucoseToDisplay(valueMgdl, unit)}
      onChange={(v) => onChangeMgdl(v == null ? null : glucoseFromDisplay(v, unit))}
      decimals={mmol ? 1 : 0}
      min={bounds.min}
      max={bounds.max}
      step={mmol ? 0.1 : 1}
      longStep={mmol ? 0.5 : 5}
      placeholder={t(mmol ? "numeric.isfExampleMmol" : "numeric.isfExampleMgdl")}
      suffix={glucoseUnitLabel(unit)}
      accessibilityLabel={accessibilityLabel}
      onBlur={onBlur}
    />
  );
}
