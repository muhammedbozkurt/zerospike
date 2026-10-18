/**
 * Multi-food meal composition: the pure half of components/MealComposeSheet.
 *
 * No React and no expo-sqlite, so scripts/mealCompose.test.ts runs it under
 * node. The per-item carb figure goes through resolveItemCarbs, the one carb
 * rule templates already use, so a composed meal and a saved template of the
 * same items can never disagree by a rounding step.
 */

import type { Food } from "./db/types";
import type { NewTemplateItemInput } from "./db/mealTemplates";
import { resolveItemCarbs } from "./mealTemplates";

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
  return items.map((item) => (item.key === key ? { ...item, portion_g: portion } : item));
}

/** carbs = carb_100g x portion_g / 100, one decimal, never negative or NaN. */
export function composeItemCarbs(item: ComposeItem): number {
  return resolveItemCarbs(
    {
      food_id: item.food_id,
      name_snapshot: item.name,
      carb_100g_snapshot: item.carb_100g,
      portion_g: item.portion_g,
      carbs_g_fixed: null,
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

/** At least one food and every amount above zero: a zero-gram row is an
 *  unfinished row, not a food that was eaten. */
export function composeCanSave(items: readonly ComposeItem[]): boolean {
  return items.length > 0 && items.every((item) => finite(item.portion_g) > 0);
}

/** The single meal row a composed meal is written as (same shape logTemplate
 *  writes: one row, summed portion and carbs). */
export function composeMealInput(items: readonly ComposeItem[]): {
  custom_food_name: string;
  portion_g: number;
  calculated_carbs_g: number;
} {
  const totals = composeTotals(items);
  const name = items.map((item) => item.name).join(" + ").slice(0, COMPOSE_NAME_MAX);
  return {
    custom_food_name: name,
    portion_g: totals.portion_g,
    calculated_carbs_g: totals.carbs_g,
  };
}

export function composeTemplateItems(
  items: readonly ComposeItem[]
): NewTemplateItemInput[] {
  return items.map((item) => ({
    food_id: item.food_id,
    name_snapshot: item.name,
    carb_100g_snapshot: item.carb_100g,
    portion_g: item.portion_g,
    carbs_g_fixed: null,
  }));
}
