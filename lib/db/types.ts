export type Lang = "tr" | "en" | "de" | "es" | "fr";

/** Time-of-day meal slots that drive the active carb ratio. */
export type MealSlot = "breakfast" | "lunch" | "dinner";

export type PeriodTag =
  | "fasting"
  | "pre_meal"
  | "post_meal_2h"
  | "bedtime"
  | "manual";

export interface UserProfile {
  id: string; // UUID
  name: string;
  insulin_sensitivity_factor: number; // mg/dL dropped per 1 unit (ISF)
  carb_ratio_breakfast: number; // g carb per 1 unit
  carb_ratio_lunch: number;
  carb_ratio_dinner: number;
  target_fasting_max: number; // default 100
  target_postmeal_max: number; // default 140
  daily_carb_target_g: number;
  created_at: string;
}

export interface Food {
  id: string; // UUID
  name_tr: string;
  name_en: string;
  name_de: string;
  name_es: string;
  name_fr: string;
  aliases_json: string; // JSON string[] of synonyms
  category: string; // see lib/db/categories.ts
  barcode: string | null;
  carb_100g: number;
  glycemic_index: number;
  glycemic_load: number;
  portion_size_g: number;
  brand_name: string | null;
  custom_notes: string | null;
  is_custom: number; // 0 | 1
  created_at: string;
}

export interface SugarLog {
  id: string;
  profile_id: string;
  glucose_level_mgdl: number;
  period_tag: PeriodTag;
  source: string; // 'manual' | 'health'
  logged_at: string;
}

export interface MealLog {
  id: string;
  profile_id: string;
  sugar_log_id: string | null;
  food_id: string | null;
  custom_food_name: string | null;
  portion_g: number;
  calculated_carbs_g: number;
  insulin_dose_units: number;
  photo_uri_local: string | null;
  personal_note: string | null;
  logged_at: string;
}

export interface Favorite {
  id: string;
  profile_id: string;
  food_id: string;
}

/** Returns the food name in the active language, with graceful fallback. */
export function foodName(food: Food, lang: Lang): string {
  switch (lang) {
    case "en":
      return food.name_en || food.name_tr;
    case "de":
      return food.name_de || food.name_en || food.name_tr;
    case "es":
      return food.name_es || food.name_en || food.name_tr;
    case "fr":
      return food.name_fr || food.name_en || food.name_tr;
    case "tr":
    default:
      return food.name_tr || food.name_en;
  }
}

export function parseAliases(food: Food): string[] {
  try {
    const arr = JSON.parse(food.aliases_json);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
