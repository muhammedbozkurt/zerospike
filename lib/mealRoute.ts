import { hasMealWeight } from "./mealPrefill";

export type MealEditMode = "calculator" | "carbOnly";

/**
 * Which screen a saved meal opens in. A meal that came from a carb estimate has
 * no catalogue food and no weight: the calculator would turn its carb total into
 * a 100 g food and show an insulin figure for it, so it opens carb-only. The name
 * is not consulted: a calculator save always writes a food_id or a weight, so a row
 * with neither (blank or "-" name included, 0 g of carbs included) can only come
 * from the estimate path.
 */
export function mealEditMode(meal: {
  food_id: string | null;
  portion_g: number;
  custom_food_name?: string | null;
  display_name?: string | null;
  calculated_carbs_g?: number | null;
}): MealEditMode {
  if (meal.food_id) return "calculator";
  if (hasMealWeight(meal.portion_g)) return "calculator";
  return "carbOnly";
}

export function mealEditRoute(meal: Parameters<typeof mealEditMode>[0] & { id: string }): {
  pathname: "/calculator";
  params: { mealLogId: string };
} {
  return { pathname: "/calculator", params: { mealLogId: meal.id } };
}

export function parseCarbGrams(value: number | null): number | null {
  if (value == null || !Number.isFinite(value) || value < 0 || value > 1500) return null;
  return Math.round(value * 10) / 10;
}

/** What a carb-only save writes: the weight stays 0 and the stored dose is left alone. */
export function carbOnlyPatch(input: {
  carbs: number;
  name: string;
  note: string;
  loggedAtIso: string | null;
}): {
  portion_g: 0;
  calculated_carbs_g: number;
  custom_food_name: string;
  personal_note: string | null;
  logged_at?: string;
} {
  return {
    portion_g: 0,
    calculated_carbs_g: input.carbs,
    custom_food_name: input.name.trim(),
    personal_note: input.note.trim() || null,
    ...(input.loggedAtIso ? { logged_at: input.loggedAtIso } : {}),
  };
}
