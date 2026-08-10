/**
 * Meal-template math and ordering: the pure half of the feature.
 *
 * No React and no expo-sqlite here (the same arrangement as lib/insulin.ts), so
 * scripts/mealTemplates.test.ts runs these functions as-is under node. The
 * database half lives in lib/db/mealTemplates.ts and calls straight into this.
 *
 * A template is descriptive: it repeats what the user wrote down. Nothing here
 * generates, ranks by "quality", or comments on what is in a meal - ordering uses
 * the clock and how often the user reaches for it, nothing else.
 */

import type { Food, Lang, MealSlot, MealTemplate, MealTemplateItem } from "./db/types";
import { foodName } from "./db/types";
import { formatDateKey } from "./format";
import { activeMealSlot, mealSlotForHour } from "./insulin";

/** Carbs and portions are carried to ONE decimal, like every other carb figure
 *  in the app (see estimateInsulin). */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function finite(n: number | null | undefined): number {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/** The stored item columns the carb rule reads. */
export type TemplateItemCore = Pick<
  MealTemplateItem,
  "food_id" | "name_snapshot" | "carb_100g_snapshot" | "portion_g" | "carbs_g_fixed"
>;

/** The live catalogue row an item's food_id resolves to (null when it is gone).
 *  `category` is optional because it only feeds the row's plate emoji: a caller
 *  that has no use for it (the carb rule never reads it) may leave it out. */
export type ItemFood = Pick<
  Food,
  "carb_100g" | "name_tr" | "name_en" | "name_de" | "name_es" | "name_fr"
> & { category?: string | null };

/** A stored item together with whatever its food_id resolves to right now. */
export interface TemplateItemWithFood extends TemplateItemCore {
  food: ItemFood | null;
}

/**
 * THE carb rule for a template item, in one place so no screen can invent a
 * second one:
 *
 *   1. carbs_g_fixed, when it is set. An item built out of a typed-name meal has
 *      no carb_100g and may have a portion of 0, so there is nothing to derive.
 *   2. otherwise the LIVE foods.carb_100g, when the food_id still resolves.
 *   3. otherwise carb_100g_snapshot.
 *
 *   carbs = carb_100g × portion_g / 100
 *
 * The live value comes FIRST on purpose: when a user fixes the carb value of
 * their own food, that is a correction of a wrong number, and going on using the
 * value stored at the time would keep producing the wrong dose. The snapshot is
 * insurance against the catalogue row disappearing, not a preference for history.
 *
 * Rounded here rather than only on the total, so the figure on a row and the
 * total underneath it are the same arithmetic (see templateCarbs).
 */
export function resolveItemCarbs(
  item: TemplateItemCore,
  food: Pick<Food, "carb_100g"> | null | undefined
): number {
  if (item.carbs_g_fixed != null && Number.isFinite(item.carbs_g_fixed)) {
    return round1(Math.max(0, item.carbs_g_fixed));
  }
  const per100 = finite(food ? food.carb_100g : item.carb_100g_snapshot);
  const carbs = (per100 * finite(item.portion_g)) / 100;
  return round1(Math.max(0, carbs));
}

/**
 * The template's total carbs (g) - the value a one-tap log writes to
 * meal_logs.calculated_carbs_g, and what the dose is then estimated from.
 *
 * The sum is over the ROUNDED item figures, so the total is exactly what the
 * listed rows add up to. A total rounded independently could sit 0.1 g away from
 * its own items, which reads as an error in a number the user is about to dose on.
 */
export function templateCarbs(items: readonly TemplateItemWithFood[]): number {
  let total = 0;
  for (const item of items) total += resolveItemCarbs(item, item.food);
  return round1(total);
}

/**
 * The template's total portion (g). meal_logs holds ONE portion figure, so the
 * item portions are summed into it - the honest reading of "this is how much of
 * this meal was eaten".
 */
export function templatePortionG(
  items: readonly Pick<MealTemplateItem, "portion_g">[]
): number {
  let total = 0;
  for (const item of items) total += Math.max(0, finite(item.portion_g));
  return round1(total);
}

/** An item ready to be shown: name resolved, carbs resolved, gap flagged. */
export interface ResolvedTemplateItem {
  id: string;
  food_id: string | null;
  /** The live catalogue name in the active language, else name_snapshot. */
  name: string;
  /** The item points at a catalogue food that no longer exists, so both the name
   *  and the carb value are the stored snapshot. The row says so
   *  (templates.missingFood) rather than looking like a live item. */
  missingFood: boolean;
  /** The per-100 g value `carbs_g` was derived from: the LIVE catalogue one while
   *  food_id resolves, else the snapshot. Carried so an editor can re-derive a
   *  changed portion through the same rule instead of reaching for the row again. */
  carb_100g: number;
  /** As stored: a carb total that wins over the derivation (see resolveItemCarbs). */
  carbs_g_fixed: number | null;
  /** The live catalogue category, for the row's plate. Null once the food is gone. */
  category: string | null;
  portion_g: number;
  carbs_g: number;
  sort_order: number;
}

/**
 * Display name + carbs for one stored item. The name follows the catalogue while
 * it can (so switching the app language switches the item's name), and falls back
 * to the snapshot when it cannot - the snapshot itself is never re-translated,
 * because it is a record of what was typed, not a translatable term.
 */
export function resolveTemplateItem(
  item: MealTemplateItem & { food: ItemFood | null },
  lang: Lang
): ResolvedTemplateItem {
  const missingFood = item.food_id != null && item.food == null;
  return {
    id: item.id,
    food_id: item.food_id,
    name: item.food
      ? foodName(item.food as Food, lang)
      : item.name_snapshot,
    missingFood,
    carb_100g: finite(item.food ? item.food.carb_100g : item.carb_100g_snapshot),
    carbs_g_fixed: item.carbs_g_fixed,
    category: item.food?.category ?? null,
    portion_g: round1(Math.max(0, finite(item.portion_g))),
    carbs_g: resolveItemCarbs(item, item.food),
    sort_order: item.sort_order,
  };
}

/**
 * The same item at a different portion, its carbs re-derived through
 * resolveItemCarbs so an editor cannot drift into a second carb rule. `carb_100g`
 * is already the resolved live-or-snapshot value, so it is handed over as the
 * snapshot with no food beside it.
 *
 * An item with carbs_g_fixed keeps its total: there is no per-100 value under it
 * to scale, and inventing one from a gram figure the user never gave would turn a
 * recorded number into a derived one.
 */
export function applyItemPortion(
  item: ResolvedTemplateItem,
  portionG: number
): ResolvedTemplateItem {
  const portion = round1(Math.max(0, finite(portionG)));
  return {
    ...item,
    portion_g: portion,
    carbs_g: resolveItemCarbs(
      {
        food_id: item.food_id,
        name_snapshot: item.name,
        carb_100g_snapshot: item.carb_100g,
        portion_g: portion,
        carbs_g_fixed: item.carbs_g_fixed,
      },
      null
    ),
  };
}

/** The totals of an already-resolved list, summed over the ROUNDED item figures
 *  exactly like templateCarbs / templatePortionG do for stored rows. */
export function resolvedTotals(items: readonly ResolvedTemplateItem[]): {
  carbs_g: number;
  portion_g: number;
} {
  let carbs = 0;
  let portion = 0;
  for (const item of items) {
    carbs += finite(item.carbs_g);
    portion += Math.max(0, finite(item.portion_g));
  }
  return { carbs_g: round1(carbs), portion_g: round1(portion) };
}

/**
 * `"50,200,30"` → the portions to use in place of the stored ones, for a link
 * that carries one day's portions without changing the template.
 *
 * All or nothing: a list that does not parse cleanly, or that no longer matches
 * the item count, returns null and the caller falls back to the template as
 * stored. A partially-read set of portions would silently under- or over-state the
 * carbs a dose is then estimated from.
 */
export function parsePortions(
  csv: string | null | undefined,
  count: number
): number[] | null {
  if (!csv) return null;
  const parts = csv.split(",");
  if (parts.length !== count) return null;
  const out: number[] = [];
  for (const part of parts) {
    const value = Number(part.trim());
    if (!Number.isFinite(value) || value < 0) return null;
    out.push(round1(value));
  }
  return out;
}

/** The reverse of parsePortions, for building that link. */
export function formatPortions(
  items: readonly Pick<ResolvedTemplateItem, "portion_g">[]
): string {
  return items.map((item) => String(round1(Math.max(0, finite(item.portion_g))))).join(",");
}

/**
 * The comparison key behind "you already have one called that".
 *
 * Folded here and NOT by SQLite: COLLATE NOCASE only folds A-Z, so it reads
 * "İSKENDER" and "iskender" as two different names - and the dotted/dotless I is
 * exactly where a Turkish duplicate hides. Every member of that family folds to a
 * plain "i", which over-matches a little on purpose: this drives a WARNING, and
 * warning about a near-duplicate costs less than keeping two rows the user reads
 * as one word. `"İ".toLowerCase()` is also two code points, so the family is
 * replaced BEFORE the lowercase.
 */
export function normalizeTemplateName(name: string): string {
  return name
    .replace(/[İIıi]/g, "i")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Whether another template of the same profile already carries this name. */
export function templateNameTaken(
  name: string,
  existing: readonly Pick<MealTemplate, "id" | "name">[],
  exceptId?: string | null
): boolean {
  const key = normalizeTemplateName(name);
  if (!key) return false;
  return existing.some(
    (other) => other.id !== exceptId && normalizeTemplateName(other.name) === key
  );
}

/** The meal columns the "make a template out of this meal" path reads. */
export interface TemplateSourceMeal {
  food_id: string | null;
  display_name: string;
  category: string | null;
  portion_g: number;
  calculated_carbs_g: number;
}

/**
 * One day's one slot worth of logged meals, turned into template items in the
 * order they were eaten. Names are NOT touched: the template itself is left
 * unnamed for the user to write, because a name assembled out of food names would
 * be the app deciding what their meal is called.
 *
 * A catalogue meal keeps its food_id (so a later carb correction reaches the
 * template) and its per-100 value is back-derived from what was recorded, which
 * reproduces the recorded carbs exactly at the recorded portion. With no portion
 * there is nothing to derive from, so the recorded total is stored outright rather
 * than collapsing to 0 - the same reason carbs_g_fixed exists.
 */
export function templateItemsFromMeals(
  meals: readonly TemplateSourceMeal[]
): ResolvedTemplateItem[] {
  return meals.map((meal, index) => {
    const portion = round1(Math.max(0, finite(meal.portion_g)));
    const carbs = round1(Math.max(0, finite(meal.calculated_carbs_g)));
    const derivable = meal.food_id != null && portion > 0;
    return {
      id: `meal-${index}`,
      food_id: meal.food_id,
      name: meal.display_name,
      missingFood: false,
      carb_100g: derivable ? (carbs * 100) / portion : 0,
      carbs_g_fixed: derivable ? null : carbs,
      category: meal.category,
      portion_g: portion,
      carbs_g: carbs,
      sort_order: index,
    };
  });
}

/** The template columns the ordering reads. */
export type RankableTemplate = Pick<
  MealTemplate,
  "slot" | "sort_order" | "last_used_at" | "created_at"
>;

/**
 * Template order for the list, by TIME and by the user's own arrangement only:
 *
 *   1. templates whose slot matches the current one (07:00 → the breakfast ones)
 *   2. templates with no slot (a snack template fits any hour)
 *   3. everything else
 *
 * and inside each group: the user's own sort_order, then most recently used
 * (never-used last, they have nothing to say yet), then oldest first. Stable: two
 * templates that tie on every key keep the order they came in.
 *
 * The active slot is read from the clock (activeMealSlot), the same source the
 * carb ratio uses, but this is ORDERING ONLY - it never reaches a dose.
 */
export function rankTemplates<T extends RankableTemplate>(
  templates: readonly T[],
  now: Date = new Date()
): T[] {
  const active = activeMealSlot(now);
  const group = (t: T): number => (t.slot === active ? 0 : t.slot == null ? 1 : 2);

  return templates
    .map((template, index) => ({ template, index }))
    .sort((a, b) => {
      const ga = group(a.template);
      const gb = group(b.template);
      if (ga !== gb) return ga - gb;

      const sa = finite(a.template.sort_order);
      const sb = finite(b.template.sort_order);
      if (sa !== sb) return sa - sb;

      const ua = a.template.last_used_at;
      const ub = b.template.last_used_at;
      if (ua !== ub) {
        if (ua == null) return 1;
        if (ub == null) return -1;
        return ua < ub ? 1 : -1;
      }

      if (a.template.created_at !== b.template.created_at) {
        return a.template.created_at < b.template.created_at ? -1 : 1;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.template);
}

/** Anything with a timestamp: a MealLog, a journal meal entry, an export row. */
export interface DatedMeal {
  logged_at: string;
}

/** One day's one slot worth of meals - the unit "make a template out of this" works on. */
export interface MealSlotGroup<T extends DatedMeal> {
  /** `${dateKey}|${slot}`: stable and non-localized (see formatDateKey). */
  key: string;
  dateKey: string;
  slot: MealSlot;
  /** Oldest first: the order they were eaten is the order they become items. */
  meals: T[];
  /** The newest timestamp in the group (what the groups are ordered by). */
  lastAt: string;
}

/**
 * Buckets meals into "the same day, the same slot", which is what a user means by
 * one meal made of several entries - the input to building a template out of what
 * they already logged.
 *
 * Both halves of the key are the app's existing definitions, not new ones:
 * formatDateKey for the local calendar day and mealSlotForHour for the slot. The
 * dinner slot runs past midnight, so 23:00 and 01:00 are two different groups:
 * they are two different days on the user's calendar, and merging them would put
 * yesterday's dinner into today's.
 *
 * Groups come back newest first. An unparseable timestamp is skipped - there is
 * no day or slot to file it under, and inventing one would misdate a record.
 */
export function groupMealsBySlot<T extends DatedMeal>(
  meals: readonly T[]
): MealSlotGroup<T>[] {
  const groups = new Map<string, MealSlotGroup<T>>();

  for (const meal of meals) {
    const at = new Date(meal.logged_at);
    if (Number.isNaN(at.getTime())) continue;
    const dateKey = formatDateKey(meal.logged_at);
    const slot = mealSlotForHour(at.getHours());
    const key = `${dateKey}|${slot}`;
    const existing = groups.get(key);
    if (existing) {
      existing.meals.push(meal);
      if (meal.logged_at > existing.lastAt) existing.lastAt = meal.logged_at;
    } else {
      groups.set(key, {
        key,
        dateKey,
        slot,
        meals: [meal],
        lastAt: meal.logged_at,
      });
    }
  }

  for (const group of groups.values()) {
    group.meals.sort((a, b) => (a.logged_at < b.logged_at ? -1 : a.logged_at > b.logged_at ? 1 : 0));
  }

  return [...groups.values()].sort((a, b) => {
    if (a.lastAt !== b.lastAt) return a.lastAt < b.lastAt ? 1 : -1;
    return a.key < b.key ? -1 : 1;
  });
}
