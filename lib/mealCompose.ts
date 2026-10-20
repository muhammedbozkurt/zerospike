/**
 * Multi-food meal composition: the pure half of components/MealComposeSheet.
 *
 * No React and no expo-sqlite, so scripts/mealCompose.test.ts runs it under
 * node. The per-item carb figure goes through resolveItemCarbs, the one carb
 * rule templates already use, so a composed meal and a saved template of the
 * same items can never disagree by a rounding step.
 */

import { PORTION_LABEL_KEYS, type Food, type PortionLabelKey } from "./db/types";
import type { NewTemplateItemInput } from "./db/mealTemplates";
import { resolveItemCarbs } from "./mealTemplates";
import { pickRememberedPortion } from "./lastPortionMap";

export const COMPOSE_MAX_GRAMS = 9999;
export const COMPOSE_NAME_MAX = 120;

export interface ComposeItem {
  /** Stable list key (the food id: one row per food). */
  key: string;
  food_id: string;
  name: string;
  category: string;
  carb_100g: number;
  portion_g: number;
  /** A line that came from a text estimate (Spike): its carbs are a fixed
   *  figure, not grams of a catalogue food, so portion_g stays 0. */
  estimate?: boolean;
  carbs_g_fixed?: number | null;
  /** Estimate lines only: the amount as the estimate phrased it ("2 slices"). */
  quantity?: number;
  unit?: string;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function finite(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/** Typed text -> grams. Comma or dot decimal; empty, NaN, negative -> 0;
 *  capped so one stray keystroke cannot write an absurd total. */
export function parseGramsInput(text: string): number {
  const value = Number(text.replace(",", ".").trim());
  if (!Number.isFinite(value) || value <= 0) return 0;
  return round1(Math.min(value, COMPOSE_MAX_GRAMS));
}

export function composeItemFromFood(food: Food, name: string): ComposeItem {
  const typical = finite(food.portion_size_g);
  return {
    key: food.id,
    food_id: food.id,
    name,
    category: food.category,
    carb_100g: Math.max(0, finite(food.carb_100g)),
    portion_g: typical > 0 ? round1(Math.min(typical, COMPOSE_MAX_GRAMS)) : 100,
  };
}

/** Adds a food once; a food already in the meal leaves the list untouched. */
export function addComposeItem(
  items: readonly ComposeItem[],
  item: ComposeItem
): ComposeItem[] {
  if (items.some((existing) => existing.key === item.key)) return [...items];
  return [...items, item];
}

export function removeComposeItem(
  items: readonly ComposeItem[],
  key: string
): ComposeItem[] {
  return items.filter((item) => item.key !== key);
}

export function setComposePortion(
  items: readonly ComposeItem[],
  key: string,
  grams: number
): ComposeItem[] {
  const portion = round1(Math.min(Math.max(0, finite(grams)), COMPOSE_MAX_GRAMS));
  return items.map((item) =>
    item.key === key && !item.estimate ? { ...item, portion_g: portion } : item
  );
}

/** carbs = carb_100g x portion_g / 100, one decimal, never negative or NaN. */
export function composeItemCarbs(item: ComposeItem): number {
  return resolveItemCarbs(
    {
      food_id: item.food_id,
      name_snapshot: item.name,
      carb_100g_snapshot: item.carb_100g,
      portion_g: item.portion_g,
      carbs_g_fixed: item.estimate ? finite(item.carbs_g_fixed) : null,
    },
    null
  );
}

/** Totals over the ROUNDED row figures, so the total equals what the rows add up to. */
export function composeTotals(items: readonly ComposeItem[]): {
  carbs_g: number;
  portion_g: number;
  count: number;
} {
  let carbs = 0;
  let portion = 0;
  for (const item of items) {
    carbs += composeItemCarbs(item);
    portion += Math.max(0, finite(item.portion_g));
  }
  return { carbs_g: round1(carbs), portion_g: round1(portion), count: items.length };
}

/** True for a line that came from a text estimate. */
export function isEstimateLine(item: ComposeItem): boolean {
  return item.estimate === true;
}

/** A meal with at least one estimate line: it has no honest weight to dose from. */
export function composeHasEstimate(items: readonly ComposeItem[]): boolean {
  return items.some(isEstimateLine);
}

function hasLineName(item: ComposeItem): boolean {
  return !/^[\s\-‐-―]*$/.test(item.name);
}

/** At least one food and every amount above zero: a zero-gram row is an
 *  unfinished row, not a food that was eaten. An estimate line is finished
 *  once it has a name; its carbs may legitimately be 0 (black coffee). */
export function composeCanSave(items: readonly ComposeItem[]): boolean {
  return (
    items.length > 0 &&
    items.every((item) =>
      isEstimateLine(item) ? hasLineName(item) : finite(item.portion_g) > 0
    )
  );
}

/** Templates keep catalogue foods only: an estimate line has no food to point
 *  at and AI-derived text must not leak into a saved template. */
export function composeCanSaveTemplate(items: readonly ComposeItem[]): boolean {
  return composeCanSave(items) && !composeHasEstimate(items);
}

/** The text a line is logged under: estimate lines carry their amount. */
export function composeItemLabel(item: ComposeItem): string {
  if (!isEstimateLine(item)) return item.name;
  const quantity = finite(item.quantity);
  const amount = [quantity > 0 ? String(round1(quantity)) : "", (item.unit ?? "").trim()]
    .filter(Boolean)
    .join(" ");
  return amount ? `${item.name} (${amount})` : item.name;
}

export interface ComposeMealInput {
  custom_food_name: string;
  portion_g: number;
  calculated_carbs_g: number;
  /** Always null: a composed meal is one row over several foods. */
  food_id: null;
  /** Always 0: the sheet states carbs, never a dose. */
  insulin_dose_units: 0;
  /** portion_g is 0 and the meal reopens carb-only (lib/mealRoute). */
  carbOnly: boolean;
}

/** The single meal row a composed meal is written as (same shape logTemplate
 *  writes: one row, summed portion and carbs).
 *
 *  carbOnly (default: true when any line is an estimate) writes portion_g 0.
 *  A mixed meal's grams are not the weight of one food, and a positive portion
 *  would reopen it in the calculator as a 100 g food with a dose figure. */
export function composeMealInput(
  items: readonly ComposeItem[],
  opts?: { carbOnly?: boolean }
): ComposeMealInput {
  const totals = composeTotals(items);
  const carbOnly = opts?.carbOnly ?? composeHasEstimate(items);
  const name = items.map(composeItemLabel).join(" + ").slice(0, COMPOSE_NAME_MAX);
  return {
    custom_food_name: name,
    portion_g: carbOnly ? 0 : totals.portion_g,
    calculated_carbs_g: totals.carbs_g,
    food_id: null,
    insulin_dose_units: 0,
    carbOnly,
  };
}

/** Template rows for the foods; empty when any line is an estimate. */
export function composeTemplateItems(
  items: readonly ComposeItem[]
): NewTemplateItemInput[] {
  if (composeHasEstimate(items)) return [];
  return items.map((item) => ({
    food_id: item.food_id,
    name_snapshot: item.name,
    carb_100g_snapshot: item.carb_100g,
    portion_g: item.portion_g,
    carbs_g_fixed: null,
  }));
}

export interface EstimateLineInput {
  name: string;
  quantity: number;
  unit: string;
  grams_carb: number;
}

/** One estimate line as a compose row. The key must not collide with a food id
 *  (addEstimateLines numbers them "est:N"). */
export function estimateLineToCompose(line: EstimateLineInput, key: string): ComposeItem {
  return {
    key,
    food_id: key,
    name: line.name.trim() || "-",
    category: "",
    carb_100g: 0,
    portion_g: 0,
    estimate: true,
    carbs_g_fixed: round1(Math.max(0, finite(line.grams_carb))),
    quantity: Math.max(0, finite(line.quantity)),
    unit: line.unit.trim(),
  };
}

/** Appends estimate lines under fresh "est:N" keys; existing rows untouched. */
export function addEstimateLines(
  items: readonly ComposeItem[],
  lines: readonly EstimateLineInput[]
): ComposeItem[] {
  let next = items.reduce((max, item) => {
    const m = /^est:(\d+)$/.exec(item.key);
    return m ? Math.max(max, Number(m[1]) + 1) : max;
  }, 0);
  return [...items, ...lines.map((line) => estimateLineToCompose(line, `est:${next++}`))];
}

/** Drops the edit drafts of rows that are no longer in the list, so a reused
 *  "est:N" key never opens with a removed line's text. Same object when nothing goes. */
export function pruneDrafts<T>(
  drafts: Record<string, T>,
  items: readonly ComposeItem[]
): Record<string, T> {
  const keys = new Set(items.map((item) => item.key));
  const stale = Object.keys(drafts).filter((key) => !keys.has(key));
  if (stale.length === 0) return drafts;
  const next = { ...drafts };
  for (const key of stale) delete next[key];
  return next;
}

/** Edits an estimate line's carbs (the editable "about 12 g" field). */
export function setEstimateCarbs(
  items: readonly ComposeItem[],
  key: string,
  grams: number
): ComposeItem[] {
  const carbs = round1(Math.min(Math.max(0, finite(grams)), COMPOSE_MAX_GRAMS));
  return items.map((item) =>
    item.key === key && item.estimate ? { ...item, carbs_g_fixed: carbs } : item
  );
}

/** Edits an estimate line's name, amount, unit or carbs in place. A blank name
 *  becomes "-" (the unfinished-row marker composeCanSave refuses). */
export function updateEstimateLine(
  items: readonly ComposeItem[],
  key: string,
  patch: Partial<EstimateLineInput>
): ComposeItem[] {
  return items.map((item) => {
    if (item.key !== key || !item.estimate) return item;
    return {
      ...item,
      name: patch.name !== undefined ? patch.name.trim() || "-" : item.name,
      quantity:
        patch.quantity !== undefined ? Math.max(0, finite(patch.quantity)) : item.quantity,
      unit: patch.unit !== undefined ? patch.unit.trim() : item.unit,
      carbs_g_fixed:
        patch.grams_carb !== undefined
          ? round1(Math.min(Math.max(0, finite(patch.grams_carb)), COMPOSE_MAX_GRAMS))
          : item.carbs_g_fixed,
    };
  });
}

export interface PortionMeasure {
  label_key: PortionLabelKey;
  grams: number;
}

export const PORTION_MEASURES_MAX = 3;
export const PORTION_CHIPS_MAX = 5;

export interface PortionChip {
  /** "slice:1", "slice:2", "grams": the selection key. */
  id: string;
  kind: "measure" | "grams" | "oz";
  /** null for the grams and oz chips (their text is the generic "grams..." / "oz..."). */
  label_key: PortionLabelKey | null;
  multiplier: number;
  /** Grams of ONE measure; 0 for the grams and oz chips. */
  unit_g: number;
}

function cleanMeasures(measures: readonly PortionMeasure[], typicalG: number): PortionMeasure[] {
  const seen = new Set<string>();
  const out: PortionMeasure[] = [];
  for (const m of measures) {
    const grams = finite(m.grams);
    if (!(PORTION_LABEL_KEYS as readonly string[]).includes(m.label_key)) continue;
    if (grams <= 0 || seen.has(m.label_key)) continue;
    seen.add(m.label_key);
    out.push({ label_key: m.label_key, grams: round1(Math.min(grams, COMPOSE_MAX_GRAMS)) });
    if (out.length >= PORTION_MEASURES_MAX) break;
  }
  if (out.length === 0) {
    const typical = finite(typicalG);
    out.push({
      label_key: "portion",
      grams: typical > 0 ? round1(Math.min(typical, COMPOSE_MAX_GRAMS)) : 100,
    });
  }
  return out;
}

/** Chips for one food: the primary measure x1 and x2, the other measures x1
 *  (at most 3 measures in all), then "grams": 5 chips at most. A food without
 *  a measure gets a synthetic "portion" measure sized by its typical portion.
 *  `ozEntry` (US English) adds an "oz..." chip right before "grams...": a
 *  second free-entry chip, so a US row can hold 6 chips. */
export function buildPortionChips(
  measures: readonly PortionMeasure[],
  primaryKey?: PortionLabelKey | null,
  typicalG = 0,
  ozEntry = false
): PortionChip[] {
  const list = cleanMeasures(measures, typicalG);
  const primary = list.find((m) => m.label_key === primaryKey) ?? list[0];
  const chip = (m: PortionMeasure, multiplier: number): PortionChip => ({
    id: `${m.label_key}:${multiplier}`,
    kind: "measure",
    label_key: m.label_key,
    multiplier,
    unit_g: m.grams,
  });
  const chips: PortionChip[] = [chip(primary, 1)];
  if (primary.grams * 2 <= COMPOSE_MAX_GRAMS) chips.push(chip(primary, 2));
  for (const m of list) if (m !== primary) chips.push(chip(m, 1));
  if (ozEntry) chips.push({ id: "oz", kind: "oz", label_key: null, multiplier: 1, unit_g: 0 });
  chips.push({ id: "grams", kind: "grams", label_key: null, multiplier: 1, unit_g: 0 });
  return chips;
}

/** Grams a chip stands for. The grams and oz chips have no size of their own:
 *  they keep whatever was typed (currentGrams). */
export function chipGrams(chip: PortionChip, currentGrams = 0): number {
  const grams = chip.kind !== "measure" ? finite(currentGrams) : chip.unit_g * chip.multiplier;
  return round1(Math.min(Math.max(0, grams), COMPOSE_MAX_GRAMS));
}

/** Which chip a gram figure belongs to: the first measure chip that equals it,
 *  otherwise the grams chip (null if the list has none). */
export function chipFromGrams(
  chips: readonly PortionChip[],
  grams: number
): PortionChip | null {
  const g = finite(grams);
  const hit = chips.find((c) => c.kind === "measure" && Math.abs(chipGrams(c) - g) < 0.05);
  return hit ?? chips.find((c) => c.kind === "grams") ?? null;
}

/** Grams a food enters the meal with: the remembered measure, else the first
 *  measure, else the typical portion, else 100. */
export function initialPortionGrams(
  measures: readonly PortionMeasure[],
  remembered: PortionLabelKey | undefined,
  typicalG: number
): number {
  const usable = measures.filter((m) => finite(m.grams) > 0);
  const hit = pickRememberedPortion(usable, remembered) ?? usable[0];
  const grams = hit ? finite(hit.grams) : finite(typicalG) > 0 ? finite(typicalG) : 100;
  return round1(Math.min(grams, COMPOSE_MAX_GRAMS));
}
