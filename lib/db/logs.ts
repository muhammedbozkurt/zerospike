import { getDb } from "./index";
import { uuid } from "../uuid";
import type { MealLog, PeriodTag, SugarLog } from "./types";
import { parseTags, serializeTags } from "./types";

// Raw rows carry `tags` as the stored JSON string; mappers parse it to LogTag[].
type SugarRow = Omit<SugarLog, "tags"> & { tags: string | null };
const mapSugar = (r: SugarRow): SugarLog => ({ ...r, tags: parseTags(r.tags) });
type MealRow = Omit<MealLog, "tags"> & { tags: string | null };
const mapMeal = (r: MealRow): MealLog => ({ ...r, tags: parseTags(r.tags) });

/**
 * Free-tier total log cap. Counts BOTH glucose and meal logs combined, matching
 * the product rule "5 glucose/meal logs".
 */
export const FREE_LOG_LIMIT = 5;

// ── Sugar logs ───────────────────────────────────────────────────────────

export interface NewSugarLogInput {
  profile_id: string;
  glucose_level_mgdl: number;
  period_tag: PeriodTag;
  source?: string; // 'manual' | 'health'
  logged_at?: string;
  tags?: string[];
}

export async function addSugarLog(input: NewSugarLogInput): Promise<SugarLog> {
  const db = await getDb();
  const id = uuid();
  const loggedAt = input.logged_at ?? new Date().toISOString();
  await db.runAsync(
    `INSERT INTO sugar_logs
       (id, profile_id, glucose_level_mgdl, period_tag, source, logged_at, tags)
     VALUES (?, ?, ?, ?, ?, ?, ?);`,
    [
      id,
      input.profile_id,
      Math.round(input.glucose_level_mgdl),
      input.period_tag,
      input.source ?? "manual",
      loggedAt,
      serializeTags(input.tags),
    ]
  );
  return mapSugar(
    (await db.getFirstAsync<SugarRow>(
      "SELECT * FROM sugar_logs WHERE id = ?;",
      [id]
    ))!
  );
}

export async function listSugarLogs(
  profileId: string,
  limit = 500
): Promise<SugarLog[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<SugarRow>(
    "SELECT * FROM sugar_logs WHERE profile_id = ? ORDER BY logged_at DESC LIMIT ?;",
    [profileId, limit]
  );
  return rows.map(mapSugar);
}

export async function deleteSugarLog(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM sugar_logs WHERE id = ?;", [id]);
}

/** Avoids duplicating the same Health/CGM sample on re-import. */
export async function sugarLogExistsAt(
  profileId: string,
  loggedAt: string,
  source: string
): Promise<boolean> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ c: number }>(
    "SELECT COUNT(*) AS c FROM sugar_logs WHERE profile_id = ? AND logged_at = ? AND source = ?;",
    [profileId, loggedAt, source]
  );
  return (row?.c ?? 0) > 0;
}

// ── Meal logs ────────────────────────────────────────────────────────────

export interface NewMealLogInput {
  profile_id: string;
  food_id?: string | null;
  custom_food_name?: string | null;
  portion_g: number;
  calculated_carbs_g: number;
  insulin_dose_units: number;
  sugar_log_id?: string | null;
  photo_uri_local?: string | null;
  personal_note?: string | null;
  logged_at?: string;
  tags?: string[];
}

export async function addMealLog(input: NewMealLogInput): Promise<MealLog> {
  const db = await getDb();
  const id = uuid();
  const loggedAt = input.logged_at ?? new Date().toISOString();
  await db.runAsync(
    `INSERT INTO meal_logs
       (id, profile_id, sugar_log_id, food_id, custom_food_name, portion_g,
        calculated_carbs_g, insulin_dose_units, photo_uri_local, personal_note, logged_at, tags)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      id,
      input.profile_id,
      input.sugar_log_id ?? null,
      input.food_id ?? null,
      input.custom_food_name ?? null,
      input.portion_g,
      input.calculated_carbs_g,
      input.insulin_dose_units,
      input.photo_uri_local ?? null,
      input.personal_note ?? null,
      loggedAt,
      serializeTags(input.tags),
    ]
  );
  return mapMeal(
    (await db.getFirstAsync<MealRow>(
      "SELECT * FROM meal_logs WHERE id = ?;",
      [id]
    ))!
  );
}

export async function listMealLogs(
  profileId: string,
  limit = 500
): Promise<MealLog[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<MealRow>(
    "SELECT * FROM meal_logs WHERE profile_id = ? ORDER BY logged_at DESC LIMIT ?;",
    [profileId, limit]
  );
  return rows.map(mapMeal);
}

export async function deleteMealLog(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM meal_logs WHERE id = ?;", [id]);
}

// ── Combined count (used for the free-tier guardrail) ──────────────────────

export async function countAllLogs(profileId: string): Promise<number> {
  const db = await getDb();
  const a = await db.getFirstAsync<{ c: number }>(
    "SELECT COUNT(*) AS c FROM sugar_logs WHERE profile_id = ?;",
    [profileId]
  );
  const b = await db.getFirstAsync<{ c: number }>(
    "SELECT COUNT(*) AS c FROM meal_logs WHERE profile_id = ?;",
    [profileId]
  );
  return (a?.c ?? 0) + (b?.c ?? 0);
}
