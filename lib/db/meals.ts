import { getDb } from "./index";
import type { GlucoseEntry, MealEntry } from "./journal";
import { foodName, parseTags } from "./types";
import type { Food, Lang, PeriodTag } from "./types";
import { BASELINE_LOOKBACK_MINUTES, MEAL_RESPONSE_HOURS } from "../mealResponse";

interface MealRow {
  id: string;
  logged_at: string;
  food_id: string | null;
  sugar_log_id: string | null;
  custom_food_name: string | null;
  portion_g: number | null;
  calculated_carbs_g: number | null;
  insulin_dose_units: number | null;
  photo_uri_local: string | null;
  personal_note: string | null;
  tags: string | null;
  name_tr: string | null;
  name_en: string | null;
  name_de: string | null;
  name_es: string | null;
  name_fr: string | null;
  name_it: string | null;
  name_pt: string | null;
  name_ar: string | null;
  name_ja: string | null;
  category: string | null;
}

interface ReadingRow {
  id: string;
  logged_at: string;
  glucose_level_mgdl: number | null;
  period_tag: PeriodTag | null;
  source: string | null;
  tags: string | null;
  healthkit_uuid: string | null;
}

const MINUTE_MS = 60_000;

/**
 * The local calendar day of `now`, as the ISO bounds the log tables store.
 * Readings reach back far enough for a meal's baseline and forward far enough
 * for its response window, so the chevron on a meal near midnight still works.
 */
function todayBounds(now: Date) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  return {
    mealFrom: new Date(start).toISOString(),
    mealTo: new Date(next - 1).toISOString(),
    readingFrom: new Date(start - BASELINE_LOOKBACK_MINUTES * MINUTE_MS).toISOString(),
    readingTo: new Date(next + MEAL_RESPONSE_HOURS * 60 * MINUTE_MS).toISOString(),
  };
}

/**
 * What the Food tab's "Today" band needs: today's meals and the readings around
 * them, each filtered by kind in SQL. The band used to take the newest 120 rows
 * of the mixed journal and filter in JS, so a day with a few hundred imported
 * readings pushed the morning meals out of the list and out of the carb total.
 */
export async function getTodayFoodFeed(
  profileId: string,
  lang: Lang,
  now: Date = new Date(),
  readingLimit = 2000
): Promise<{ meals: MealEntry[]; readings: GlucoseEntry[] }> {
  const db = await getDb();
  const b = todayBounds(now);
  const mealRows = await db.getAllAsync<MealRow>(
    `SELECT m.id, m.logged_at, m.food_id, m.sugar_log_id, m.custom_food_name,
            m.portion_g, m.calculated_carbs_g, m.insulin_dose_units,
            m.photo_uri_local, m.personal_note, m.tags,
            f.name_tr, f.name_en, f.name_de, f.name_es, f.name_fr,
            f.name_it, f.name_pt, f.name_ar, f.name_ja, f.category
       FROM meal_logs m LEFT JOIN foods f ON f.id = m.food_id
      WHERE m.profile_id = ? AND m.logged_at BETWEEN ? AND ?
      ORDER BY m.logged_at DESC;`,
    [profileId, b.mealFrom, b.mealTo]
  );
  const readingRows = await db.getAllAsync<ReadingRow>(
    `SELECT s.id, s.logged_at, s.glucose_level_mgdl, s.period_tag, s.source, s.tags,
            s.healthkit_uuid
       FROM sugar_logs s
      WHERE s.profile_id = ? AND s.logged_at BETWEEN ? AND ?
      ORDER BY s.logged_at DESC
      LIMIT ?;`,
    [profileId, b.readingFrom, b.readingTo, readingLimit]
  );

  const meals = mealRows.map((r): MealEntry => {
    let display = r.custom_food_name ?? "";
    if (!display && r.name_tr) {
      display = foodName(
        {
          name_tr: r.name_tr,
          name_en: r.name_en ?? "",
          name_de: r.name_de ?? "",
          name_es: r.name_es ?? "",
          name_fr: r.name_fr ?? "",
          name_it: r.name_it,
          name_pt: r.name_pt,
          name_ar: r.name_ar,
          name_ja: r.name_ja,
        } as Food,
        lang
      );
    }
    return {
      kind: "meal",
      id: r.id,
      logged_at: r.logged_at,
      food_id: r.food_id,
      sugar_log_id: r.sugar_log_id,
      display_name: display || "-",
      category: r.category,
      portion_g: r.portion_g ?? 0,
      calculated_carbs_g: r.calculated_carbs_g ?? 0,
      insulin_dose_units: r.insulin_dose_units ?? 0,
      photo_uri_local: r.photo_uri_local,
      personal_note: r.personal_note,
      tags: parseTags(r.tags),
    };
  });
  const readings = readingRows.map(
    (r): GlucoseEntry => ({
      kind: "glucose",
      id: r.id,
      logged_at: r.logged_at,
      glucose_level_mgdl: r.glucose_level_mgdl ?? 0,
      period_tag: r.period_tag ?? "manual",
      source: r.source ?? "manual",
      tags: parseTags(r.tags),
      healthkit_uuid: r.healthkit_uuid,
    })
  );
  return { meals, readings };
}
