import { getDb } from "./index";
import { uuid } from "../uuid";
import type { Food, MealLog, PeriodTag, SugarLog } from "./types";
import { parseTags, serializeTags } from "./types";

// Raw rows carry `tags` as the stored JSON string; mappers parse it to LogTag[].
type SugarRow = Omit<SugarLog, "tags"> & { tags: string | null };
const mapSugar = (r: SugarRow): SugarLog => ({ ...r, tags: parseTags(r.tags) });
type MealRow = Omit<MealLog, "tags"> & { tags: string | null };
const mapMeal = (r: MealRow): MealLog => ({ ...r, tags: parseTags(r.tags) });

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

export type SugarLogUpdate = Partial<
  Pick<SugarLog, "glucose_level_mgdl" | "period_tag" | "logged_at" | "tags">
>;

/** Partial update of a sugar log. Returns the fresh row, or null if the id is gone. */
export async function updateSugarLog(
  id: string,
  patch: SugarLogUpdate
): Promise<SugarLog | null> {
  const db = await getDb();
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  if (patch.glucose_level_mgdl !== undefined) {
    fields.push("glucose_level_mgdl = ?");
    values.push(Math.round(patch.glucose_level_mgdl));
  }
  if (patch.period_tag !== undefined) {
    fields.push("period_tag = ?");
    values.push(patch.period_tag);
  }
  if (patch.logged_at !== undefined) {
    fields.push("logged_at = ?");
    values.push(patch.logged_at);
  }
  if (patch.tags !== undefined) {
    fields.push("tags = ?");
    values.push(serializeTags(patch.tags));
  }
  if (fields.length > 0) {
    values.push(id);
    await db.runAsync(
      `UPDATE sugar_logs SET ${fields.join(", ")} WHERE id = ?;`,
      values
    );
  }
  const row = await db.getFirstAsync<SugarRow>(
    "SELECT * FROM sugar_logs WHERE id = ?;",
    [id]
  );
  return row ? mapSugar(row) : null;
}

export async function getSugarLog(id: string): Promise<SugarLog | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<SugarRow>(
    "SELECT * FROM sugar_logs WHERE id = ?;",
    [id]
  );
  return row ? mapSugar(row) : null;
}

/**
 * Avoids duplicating the same Health/CGM sample on re-import — but is
 * value-aware: two readings at the same (snapped) timestamp with DIFFERENT
 * values are kept (e.g. a 42 mg/dL confirming fingerstick is not dropped as a
 * "duplicate" of a 95 mg/dL CGM sample). The caller snaps `loggedAt` to a fixed
 * grain (see lib/services/healthMath.ts) so ms-drift re-reads still collapse.
 */
export async function sugarLogExistsAt(
  profileId: string,
  loggedAt: string,
  source: string,
  glucoseMgdl: number
): Promise<boolean> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ c: number }>(
    "SELECT COUNT(*) AS c FROM sugar_logs WHERE profile_id = ? AND logged_at = ? AND source = ? AND glucose_level_mgdl = ?;",
    [profileId, loggedAt, source, Math.round(glucoseMgdl)]
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

export type MealLogUpdate = Partial<
  Pick<
    MealLog,
    | "food_id"
    | "custom_food_name"
    | "portion_g"
    | "calculated_carbs_g"
    | "insulin_dose_units"
    | "photo_uri_local"
    | "personal_note"
    | "logged_at"
    | "tags"
  >
>;

/** Partial update of a meal log. Returns the fresh row, or null if the id is gone. */
export async function updateMealLog(
  id: string,
  patch: MealLogUpdate
): Promise<MealLog | null> {
  const db = await getDb();
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (key === "tags") {
      fields.push("tags = ?");
      values.push(serializeTags(value as string[]));
    } else {
      fields.push(`${key} = ?`);
      values.push(value as string | number | null);
    }
  }
  if (fields.length > 0) {
    values.push(id);
    await db.runAsync(
      `UPDATE meal_logs SET ${fields.join(", ")} WHERE id = ?;`,
      values
    );
  }
  const row = await db.getFirstAsync<MealRow>(
    "SELECT * FROM meal_logs WHERE id = ?;",
    [id]
  );
  return row ? mapMeal(row) : null;
}

export async function getMealLog(id: string): Promise<MealLog | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<MealRow>(
    "SELECT * FROM meal_logs WHERE id = ?;",
    [id]
  );
  return row ? mapMeal(row) : null;
}

/** A previously-logged food + the portion used the last time, for one-tap re-log. */
export interface RecentMeal {
  food: Food;
  portion_g: number;
}

/**
 * Distinct seeded/custom foods the profile logged most recently, with the
 * portion from the latest time — powers the food tab's one-tap "recent meals".
 * Custom-name-only meals (no food_id) are skipped since they can't be reopened
 * in the calculator. SQLite returns the bare columns from the MAX(logged_at)
 * row, so portion_g is the most recent one for each food.
 */
export async function getRecentMeals(
  profileId: string,
  limit = 8
): Promise<RecentMeal[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Food & { _portion: number }>(
    `SELECT f.*, m.portion_g AS _portion, MAX(m.logged_at) AS _lastAt
       FROM meal_logs m JOIN foods f ON f.id = m.food_id
      WHERE m.profile_id = ? AND m.food_id IS NOT NULL
      GROUP BY m.food_id
      ORDER BY _lastAt DESC
      LIMIT ?;`,
    [profileId, limit]
  );
  return rows.map((r) => {
    const { _portion, ...food } = r as Food & { _portion: number; _lastAt?: string };
    return { food: food as Food, portion_g: _portion };
  });
}

