/**
 * Locale-aware wording of the meal-card portion chips: ounces and fluid ounces
 * for US English, millilitres for the rest of English, nothing new for every
 * other language. Pure (no React, no database) so scripts/portionUnits.test.ts
 * runs it under node.
 *
 * This is display only. A chip still stands for a gram figure and the meal row
 * still stores portion_g; the ounce, fl oz and ml figures are derived from that
 * gram figure, never the other way round (the one exception is the "oz..."
 * input, which converts what was typed to grams on the way in).
 *
 * The unit words are English on purpose: the "us" and "uk" systems exist for
 * English only (portionUnitSystem), every other language keeps the existing
 * translated "1 x Slice" chips.
 */

import type { PortionLabelKey } from "./db/types";
import { statedFor, type PortionState } from "./db/seedPortionState";

/** Grams in one avoirdupois ounce. */
export const OZ_G = 28.3495;
/** Millilitres in one US fluid ounce. */
export const FL_OZ_ML = 29.5735;
/** Millilitres in one US cup (8 fl oz). */
export const CUP_ML = 236.588;

/** us: oz, fl oz, cup. uk: grams and millilitres. metric: the chips as they were. */
export type PortionUnitSystem = "us" | "uk" | "metric";

/** Regions whose English is the US one. */
const US_REGIONS: ReadonlySet<string> = new Set(["US", "PR", "GU", "VI", "AS", "MP", "UM"]);

/**
 * Which wording a device gets. Only the English app language switches system:
 * a region-less English device (or a US one) is "us", any other English region
 * is "uk", every other language is "metric" and renders exactly as before.
 */
export function portionUnitSystem(
  regionCode: string | null | undefined,
  lang: string | null | undefined
): PortionUnitSystem {
  if (String(lang ?? "").slice(0, 2).toLowerCase() !== "en") return "metric";
  const region = String(regionCode ?? "").trim().toUpperCase();
  if (!region || US_REGIONS.has(region)) return "us";
  return "uk";
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function finite(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/** Ounces typed in the "oz..." field -> grams, one decimal. Comma or dot
 *  decimal; empty, NaN and negative -> 0. Capped like the gram field. */
export function gramsFromOz(oz: number, maxGrams = 9999): number {
  const value = finite(oz);
  if (value <= 0) return 0;
  return round1(Math.min(value * OZ_G, maxGrams));
}

/** Typed ounce text -> grams. */
export function parseOzInput(text: string, maxGrams = 9999): number {
  const value = Number(String(text).replace(",", ".").trim());
  return gramsFromOz(value, maxGrams);
}

/** Grams -> ounces, one decimal, for pre-filling the "oz..." field. */
export function ozFromGrams(grams: number): number {
  return round1(Math.max(0, finite(grams)) / OZ_G);
}

/**
 * The figure a chip prints for an amount of ounces or fluid ounces: one
 * decimal, except that a value within 0.1 of a whole number prints as that
 * whole number (a 30 g slice is "1 oz", not "1.1 oz"; the exact grams sit
 * right under the chip).
 */
export function displayOunces(value: number): number {
  const n = Math.max(0, finite(value));
  const whole = Math.round(n);
  if (whole >= 1 && Math.abs(n - whole) <= 0.1) return whole;
  return round1(n);
}

/** Fluid ounces in `grams` of a liquid that weighs `gPerFlOz` per fl oz. */
export function flOzFromGrams(grams: number, gPerFlOz: number): number {
  const density = finite(gPerFlOz);
  if (density <= 0) return 0;
  return Math.max(0, finite(grams)) / density;
}

/** Whole millilitres in `grams` of a liquid that weighs `gPerFlOz` per fl oz. */
export function mlFromGrams(grams: number, gPerFlOz: number): number {
  return Math.round(flOzFromGrams(grams, gPerFlOz) * FL_OZ_ML);
}

const UNIT_WORDS: Readonly<Record<PortionLabelKey, readonly [string, string]>> = {
  slice: ["slice", "slices"],
  piece: ["piece", "pieces"],
  bowl: ["bowl", "bowls"],
  plate: ["plate", "plates"],
  cup: ["cup", "cups"],
  glass: ["glass", "glasses"],
  tbsp: ["tbsp", "tbsp"],
  tsp: ["tsp", "tsp"],
  small: ["small", "small"],
  medium: ["medium", "medium"],
  large: ["large", "large"],
  portion: ["portion", "portions"],
};

/** Measures that name a volume when the food is a liquid. */
const VOLUME_LABELS: ReadonlySet<PortionLabelKey> = new Set([
  "glass",
  "cup",
  "bowl",
  "small",
  "medium",
  "large",
  "portion",
]);

/** Measures that read as an amount of a solid food ("1 slice (1 oz)"). */
const WEIGHT_LABELS: ReadonlySet<PortionLabelKey> = new Set([
  "slice",
  "piece",
  "bowl",
  "plate",
  "small",
  "medium",
  "large",
  "portion",
]);

/** Below this a piece is too light for an ounce figure to say anything. */
const MIN_OZ_SHOWN = 0.5;

export interface PortionChipInput {
  label_key: PortionLabelKey;
  multiplier: number;
  /** Grams of ONE measure. */
  unit_g: number;
  /** "cooked" / "dry": a stated cup reads "1 cup, cooked" (the USDA wording). */
  state?: PortionState | null;
}

export interface PortionChipText {
  /** "1 slice (1 oz)", "1 cup, cooked", "2 glasses (473 ml)". */
  text: string;
  /** The gram equivalent shown small under the text: "28 g". */
  caption: string;
}

type FormatNumber = (n: number) => string;

/**
 * The text of one measure chip for the us / uk systems, or null for "metric"
 * (the caller keeps the translated "1 x Slice"). `gPerFlOz` is the USDA weight
 * of one fluid ounce of this food (lib/db/seedFlOz), null for solids; only a
 * liquid gets a volume in brackets, a solid never gets millilitres.
 *
 *   us  slice/piece/...: "<n> <unit> (<oz> oz)"   liquid: "<n> <unit> (<fl oz> fl oz)"
 *       cup, tbsp, tsp:  "<n> <unit>"              (the gram caption carries the weight)
 *       a stated cup:    "<n> cup, cooked" / "<n> cups, dry" (us and uk)
 *   uk  liquid:          "<n> <unit> (<ml> ml)"    anything else: "<n> <unit>"
 *
 * The ounce figure of n measures is n times the displayed ounces of ONE
 * measure, so "1 slice (1 oz)" and "2 slices (2 oz)" always agree.
 */
export function formatPortionChip(
  chip: PortionChipInput,
  system: PortionUnitSystem,
  gPerFlOz: number | null | undefined,
  fmt: FormatNumber = String
): PortionChipText | null {
  if (system === "metric") return null;
  const multiplier = Math.max(0, finite(chip.multiplier)) || 1;
  const unitG = Math.max(0, finite(chip.unit_g));
  const totalG = unitG * multiplier;
  const words = UNIT_WORDS[chip.label_key];
  if (!words) return null;
  let text = `${fmt(multiplier)} ${multiplier === 1 ? words[0] : words[1]}`;
  const state = statedFor(chip.label_key, chip.state);
  if (state) text += `, ${state}`;

  const density = finite(gPerFlOz);
  const liquid = density > 0 && VOLUME_LABELS.has(chip.label_key);
  if (liquid) {
    if (system === "us") {
      const flOz = round1(multiplier * displayOunces(flOzFromGrams(unitG, density)));
      text += ` (${fmt(flOz)} fl oz)`;
    } else {
      text += ` (${fmt(mlFromGrams(totalG, density))} ml)`;
    }
  } else if (system === "us" && WEIGHT_LABELS.has(chip.label_key)) {
    const unitOz = unitG / OZ_G;
    if (unitOz >= MIN_OZ_SHOWN) {
      text += ` (${fmt(round1(multiplier * displayOunces(unitOz)))} oz)`;
    }
  }
  return { text, caption: `${fmt(Math.max(1, Math.round(totalG)))} g` };
}
