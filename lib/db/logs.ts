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

/** How far apart two readings of the same value can be and still be the same
 *  measurement typed twice. */
export const SUGAR_DEDUP_WINDOW_MINUTES = 15;

/**
 * Finds a reading the profile already has that is almost certainly the SAME
 * measurement: identical value, within a few minutes.
 *
 * The calculator asks for the current glucose, and a user who just logged that
 * reading on the dashboard will type the same number again. Inserting it twice
 * doubles it in the journal, the averages and the export. This lets the caller
 * reuse the existing row instead of opening a second one.
 *
 * Value-aware on purpose: two DIFFERENT values minutes apart are two real
 * readings (a low and its recheck), and both must survive.
 */
export async function findMatchingSugarLog(
  profileId: string,
  glucoseMgdl: number,
  at: Date = new Date(),
  windowMinutes: number = SUGAR_DEDUP_WINDOW_MINUTES
): Promise<SugarLog | null> {
  const db = await getDb();
  const half = windowMinutes * 60_000;
  const from = new Date(at.getTime() - half).toISOString();
  const to = new Date(at.getTime() + half).toISOString();
  const row = await db.getFirstAsync<SugarRow>(
    `SELECT * FROM sugar_logs
      WHERE profile_id = ? AND glucose_level_mgdl = ?
        AND logged_at BETWEEN ? AND ?
      ORDER BY logged_at DESC LIMIT 1;`,
    [profileId, Math.round(glucoseMgdl), from, to]
  );
  return row ? mapSugar(row) : null;
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

/**
 * Deletes a meal AND the bolus row the calculator wrote for it.
 *
 * injection_logs.meal_log_id is ON DELETE SET NULL, so a plain delete left the
 * auto-written bolus alive with a null meal reference - still counted by
 * activeInsulin(), still inflating IOB for hours, with no way for the user to
 * connect it to the meal they just removed. Only rows this app created itself
 * (source = 'calculator') are removed; anything the user entered by hand on the
 * Injection tab is their own record and is never touched.
 */
export async function deleteMealLog(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "DELETE FROM injection_logs WHERE meal_log_id = ? AND source = 'calculator';",
    [id]
  );
  await db.runAsync("DELETE FROM meal_logs WHERE id = ?;", [id]);
}

/**
 * Deletes a meal together with EVERYTHING that one save created: the meal, its
 * calculator-written bolus, and the glucose reading it opened. Used by undo.
 *
 * `createdSugarLogId` is passed explicitly rather than read off the meal,
 * because a meal can be LINKED to a reading the user had already logged (see
 * findMatchingSugarLog). Undoing the meal must not erase a measurement that
 * existed before it.
 */
export async function deleteMealRecord(
  id: string,
  createdSugarLogId?: string | null
): Promise<void> {
  await deleteMealLog(id);
  if (createdSugarLogId) await deleteSugarLog(createdSugarLogId);
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

/**
 * A previously-logged meal + the portion used the last time, for one-tap re-log.
 * `food` is null for a meal that was only ever a typed name, which still has a
 * carb figure worth repeating.
 */
export interface RecentMeal {
  food: Food | null;
  /** What to show in the list (the food's name, or the typed one). */
  name: string;
  portion_g: number;
  /** Carbs from the most recent time this meal was logged. */
  carbs_g: number;
}

/**
 * The profile's most recently logged distinct meals, newest first, with the
 * portion and carbs from the latest time - the food tab's one-tap re-log.
 *
 * Custom-name-only meals (no food_id) are INCLUDED. They used to be dropped
 * because they cannot be reopened in the calculator, which quietly punished the
 * fastest way to log something: type a name and a carb figure. They now re-log
 * directly from their stored values, and only catalogue foods route through the
 * calculator. SQLite returns the bare columns from the MAX(logged_at) row, so
 * portion_g and calculated_carbs_g are the most recent ones for each meal.
 */
export async function getRecentMeals(
  profileId: string,
  limit = 8
): Promise<RecentMeal[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<
    Partial<Food> & {
      _portion: number;
      _carbs: number;
      _customName: string | null;
      _foodId: string | null;
    }
  >(
    `SELECT f.*, m.food_id AS _foodId, m.custom_food_name AS _customName,
            m.portion_g AS _portion, m.calculated_carbs_g AS _carbs,
            MAX(m.logged_at) AS _lastAt
       FROM meal_logs m LEFT JOIN foods f ON f.id = m.food_id
      WHERE m.profile_id = ?
        AND (m.food_id IS NOT NULL OR TRIM(COALESCE(m.custom_food_name, '')) <> '')
      GROUP BY COALESCE(m.food_id, LOWER(TRIM(m.custom_food_name)))
      ORDER BY _lastAt DESC
      LIMIT ?;`,
    [profileId, limit]
  );

  return rows.map((r) => {
    const { _portion, _carbs, _customName, _foodId, ...rest } = r as typeof r & {
      _lastAt?: string;
    };
    const food = _foodId ? (rest as unknown as Food) : null;
    return {
      food,
      name: _customName?.trim() || "",
      portion_g: _portion,
      carbs_g: _carbs,
    };
  });
}

