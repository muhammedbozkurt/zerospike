import { isolateLtr, num } from "./format";

/**
 * "Carbohydrate display" preference: a display-only layer over grams. Grams are
 * what is stored, calculated with and exported (PDF, CSV, dose maths); the other
 * two modes only add a "≈ 4 × 15 g" line next to a gram figure on screen.
 */
export type CarbDisplayMode = "gram" | "choice15" | "portion10";

export const CARB_DISPLAY_MODES: readonly CarbDisplayMode[] = ["gram", "choice15", "portion10"];

export function isCarbDisplayMode(v: unknown): v is CarbDisplayMode {
  return v === "gram" || v === "choice15" || v === "portion10";
}

/** Grams in one choice/portion of the mode; null for plain grams. */
export function carbUnitGrams(mode: CarbDisplayMode): number | null {
  if (mode === "choice15") return 15;
  if (mode === "portion10") return 10;
  return null;
}

/** Raw (unrounded) number of choices/portions; null in gram mode or for a value
 *  that is not a finite non-negative number. */
export function carbChoices(grams: number, mode: CarbDisplayMode): number | null {
  const unit = carbUnitGrams(mode);
  if (unit === null) return null;
  if (!Number.isFinite(grams) || grams < 0) return null;
  return grams / unit;
}

export type CarbChoiceDisplay =
  | { kind: "none" }
  | { kind: "less"; value: number; unitG: number }
  | { kind: "approx"; value: number; unitG: number };

/**
 * Display rounding: nearest half choice. 0 g shows nothing ("≈ 0" adds no
 * information), anything under a quarter of a choice reads "< 0,5" instead of
 * rounding down to a misleading zero.
 */
export function carbChoiceDisplay(grams: number, mode: CarbDisplayMode): CarbChoiceDisplay {
  const unitG = carbUnitGrams(mode);
  const raw = carbChoices(grams, mode);
  if (unitG === null || raw === null || raw === 0) return { kind: "none" };
  if (raw < 0.25) return { kind: "less", value: 0.5, unitG };
  return { kind: "approx", value: Math.round(raw * 2) / 2, unitG };
}

export interface CarbChoiceStrings {
  /** "≈ {{n}} × {{size}} {{unit}}" */
  approx: (vars: { n: string; size: string; unit: string }) => string;
  /** "< {{n}} × {{size}} {{unit}}" */
  less: (vars: { n: string; size: string; unit: string }) => string;
  /** The gram unit label (common.grams). */
  unit: string;
}

/** "≈ 4 × 15 g" for a gram figure, or null when nothing should be shown. The
 *  result is one LTR block so Arabic never reorders the number, sign and unit. */
export function carbChoiceText(
  grams: number,
  mode: CarbDisplayMode,
  strings: CarbChoiceStrings
): string | null {
  const d = carbChoiceDisplay(grams, mode);
  if (d.kind === "none") return null;
  const vars = { n: num(d.value), size: num(d.unitG), unit: strings.unit };
  return isolateLtr(d.kind === "less" ? strings.less(vars) : strings.approx(vars));
}

/** Region note shown under the setting: information only, never an automatic pick. */
export function carbRegionNote(lang: string, region: string | null | undefined): "us" | "gb" | null {
  if (lang.slice(0, 2) !== "en" || !region) return null;
  const r = region.toUpperCase();
  if (r === "US") return "us";
  if (r === "GB") return "gb";
  return null;
}
