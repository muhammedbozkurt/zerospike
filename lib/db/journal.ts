import { getDb } from "./index";
import type { Lang, PeriodTag } from "./types";
import { foodName } from "./types";
import type { Food } from "./types";

export interface GlucoseEntry {
  kind: "glucose";
  id: string;
  logged_at: string;
  glucose_level_mgdl: number;
  period_tag: PeriodTag;
  source: string;
}

export interface MealEntry {
  kind: "meal";
  id: string;
  logged_at: string;
  food_id: string | null;
  display_name: string;
  portion_g: number;
  calculated_carbs_g: number;
  insulin_dose_units: number;
  photo_uri_local: string | null;
  personal_note: string | null;
}

export type JournalEntry = GlucoseEntry | MealEntry;

interface MealRow {
  id: string;
  logged_at: string;
  food_id: string | null;
  custom_food_name: string | null;
  portion_g: number;
  calculated_carbs_g: number;
  insulin_dose_units: number;
  photo_uri_local: string | null;
  personal_note: string | null;
  // joined food name columns (nullable)
  name_tr: string | null;
  name_en: string | null;
  name_de: string | null;
  name_es: string | null;
  name_fr: string | null;
}

/**
 * Unified chronological feed combining glucose readings and meal logs for a
 * profile. Meal names are resolved to the active language (or the custom name).
 */
export async function getJournal(
  profileId: string,
  lang: Lang,
  limit = 300
): Promise<JournalEntry[]> {
  const db = await getDb();

  const glucose = await db.getAllAsync<GlucoseEntry>(
    `SELECT 'glucose' AS kind, id, logged_at, glucose_level_mgdl, period_tag, source
       FROM sugar_logs WHERE profile_id = ? ORDER BY logged_at DESC LIMIT ?;`,
    [profileId, limit]
  );

  const mealRows = await db.getAllAsync<MealRow>(
    `SELECT m.id, m.logged_at, m.food_id, m.custom_food_name, m.portion_g,
            m.calculated_carbs_g, m.insulin_dose_units, m.photo_uri_local,
            m.personal_note,
            f.name_tr, f.name_en, f.name_de, f.name_es, f.name_fr
       FROM meal_logs m
       LEFT JOIN foods f ON f.id = m.food_id
     WHERE m.profile_id = ? ORDER BY m.logged_at DESC LIMIT ?;`,
    [profileId, limit]
  );

  const meals: MealEntry[] = mealRows.map((r) => {
    let display = r.custom_food_name ?? "";
    if (!display && r.name_tr) {
      display = foodName(
        {
          name_tr: r.name_tr,
          name_en: r.name_en ?? "",
          name_de: r.name_de ?? "",
          name_es: r.name_es ?? "",
          name_fr: r.name_fr ?? "",
        } as Food,
        lang
      );
    }
    return {
      kind: "meal",
      id: r.id,
      logged_at: r.logged_at,
      food_id: r.food_id,
      display_name: display || "—",
      portion_g: r.portion_g,
      calculated_carbs_g: r.calculated_carbs_g,
      insulin_dose_units: r.insulin_dose_units,
      photo_uri_local: r.photo_uri_local,
      personal_note: r.personal_note,
    };
  });

  return [...glucose.map((g) => ({ ...g, kind: "glucose" as const })), ...meals].sort(
    (a, b) => (a.logged_at < b.logged_at ? 1 : -1)
  );
}
