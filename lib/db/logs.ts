import { getDb } from "./index";
import { uuid } from "../uuid";
import type { Food, MealLog, PeriodTag, SugarLog } from "./types";
import { parseTags, serializeTags } from "./types";
import type { DateRange } from "../insights";
import {
  planHealthImport,
  SUGAR_DEDUP_WINDOW_MINUTES,
  type ExistingSugarReading,
  type HealthSugarSample,
} from "./healthImportSql";

export {
  planHealthImport,
  SUGAR_DEDUP_WINDOW_MINUTES,
  type ExistingSugarReading,
  type HealthSugarSample,
};

/**
 * SQL fragment + bound values for an optional date range. Reports and exports
 * ask for a SPAN, so the span belongs in the query: filtering the newest N rows
 * in JS silently dropped older entries once a profile outgrew N.
 */
function rangeClause(
  column: string,
  range?: DateRange
): { sql: string; values: string[] } {
  if (!range) return { sql: "", values: [] };
  return {
    sql: ` AND ${column} BETWEEN ? AND ?`,
    values: [
      new Date(range.start).toISOString(),
      new Date(range.end).toISOString(),
    ],
  };
}

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
  limit = 500,
  range?: DateRange
): Promise<SugarLog[]> {
  const db = await getDb();
  const { sql, values } = rangeClause("logged_at", range);
  const rows = await db.getAllAsync<SugarRow>(
    `SELECT * FROM sugar_logs WHERE profile_id = ?${sql} ORDER BY logged_at DESC LIMIT ?;`,
    [profileId, ...values, limit]
  );
  return rows.map(mapSugar);
}

/** The newest reading's value + time, or null when the profile has none. */
export interface LatestReading {
  glucose_level_mgdl: number;
  logged_at: string;
}

/**
 * The single newest reading. The live-surface snapshot only ever shows this one
 * value, and it used to arrive as `listSugarLogs(profileId, 1000)[0]` - a
 * thousand fully hydrated rows read and mapped to keep the first.
 */
export async function getLatestSugarLog(
  profileId: string
): Promise<LatestReading | null> {
  const db = await getDb();
  return db.getFirstAsync<LatestReading>(
    `SELECT glucose_level_mgdl, logged_at FROM sugar_logs
      WHERE profile_id = ? ORDER BY logged_at DESC LIMIT 1;`,
    [profileId]
  );
}

/**
 * Mean reading (and how many there were) since an ISO instant, computed by
 * SQLite. The widget's rolling average used to be a JS reduce over a thousand
 * rows pulled into memory for two numbers - and silently truncated to those
 * thousand once a profile logged more than that inside the window.
 *
 * logged_at is stored as a UTC ISO string, so the string comparison here is the
 * same chronological order as the parsed dates it replaces.
 */
export async function getSugarAverageSince(
  profileId: string,
  sinceIso: string
): Promise<{ avgMgdl: number | null; count: number }> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ avg: number | null; n: number }>(
    `SELECT AVG(glucose_level_mgdl) AS avg, COUNT(*) AS n FROM sugar_logs
      WHERE profile_id = ? AND logged_at >= ?;`,
    [profileId, sinceIso]
  );
  const count = row?.n ?? 0;
  return {
    avgMgdl: count > 0 && row?.avg != null ? row.avg : null,
    count,
  };
}

/** An inclusive [from, to] span of ISO instants to pull readings for. */
export interface SugarWindow {
  from: string;
  to: string;
}

/**
 * Readings inside ANY of a handful of time windows (plus, optionally, specific
 * ids). Meal-response screens care about a three-hour span around each of a few
 * meals, and getting there by reading the newest 2000 rows meant the query grew
 * with the profile's whole history instead of with the question being asked.
 *
 * `ids` exists for the baseline rule: a meal's linked reading counts as its
 * starting value even when it sits outside the lookback window, so it has to be
 * fetched by id or that baseline silently disappears.
 */
export async function listSugarLogsForWindows(
  profileId: string,
  windows: SugarWindow[],
  ids: string[] = []
): Promise<SugarLog[]> {
  if (windows.length === 0 && ids.length === 0) return [];
  const db = await getDb();
  const clauses: string[] = [];
  const values: string[] = [profileId];
  for (const w of windows) {
    clauses.push("logged_at BETWEEN ? AND ?");
    values.push(w.from, w.to);
  }
  if (ids.length > 0) {
    clauses.push(`id IN (${ids.map(() => "?").join(", ")})`);
    values.push(...ids);
  }
  const rows = await db.getAllAsync<SugarRow>(
    `SELECT * FROM sugar_logs
      WHERE profile_id = ? AND (${clauses.join(" OR ")})
      ORDER BY logged_at DESC;`,
    values
  );
  return rows.map(mapSugar);
}

/** The bare fields lib/entryGuard.ts asks about, not a full row read.
 *  `id` is what lets a caller pass its own row back as `excludeId` (P5b) so
 *  editing an existing reading never flags against its own pre-edit row. */
export interface RecentSugarLog {
  id: string;
  logged_at: string;
  glucose_level_mgdl: number;
}

/**
 * Readings logged between `sinceIso` and `untilIso` (open-ended when omitted),
 * for the duplicate-entry check (lib/entryGuard.ts /
 * components/useEntryGuardConfirm.tsx). A plain fact lookup, not a warning of
 * its own - the caller decides what, if anything, to ask about.
 */
export async function listRecentSugarLogs(
  profileId: string,
  sinceIso: string,
  untilIso?: string
): Promise<RecentSugarLog[]> {
  const db = await getDb();
  const values = untilIso ? [profileId, sinceIso, untilIso] : [profileId, sinceIso];
  return db.getAllAsync<RecentSugarLog>(
    `SELECT id, logged_at, glucose_level_mgdl FROM sugar_logs
      WHERE profile_id = ? AND logged_at >= ? ${untilIso ? "AND logged_at <= ?" : ""}
      ORDER BY logged_at DESC;`,
    values
  );
}

/** Records the Apple Health sample UUID for a mirrored reading (schema v10). */
export async function setSugarLogHealthUuid(
  id: string,
  healthkitUuid: string | null
): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE sugar_logs SET healthkit_uuid = ? WHERE id = ?;", [
    healthkitUuid,
    id,
  ]);
}

/** Rows the history transfer may write to Health: this profile's app-entered
 *  readings since `sinceIso` that have no Health sample yet. The pure selector
 *  (lib/healthBackfill.ts) applies the same rule again on top of this. */
export async function listHealthBackfillRows(
  profileId: string,
  sinceIso: string
): Promise<SugarLog[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<SugarRow>(
    `SELECT * FROM sugar_logs
      WHERE profile_id = ? AND source != 'health' AND healthkit_uuid IS NULL AND logged_at >= ?
      ORDER BY logged_at ASC;`,
    [profileId, sinceIso]
  );
  return rows.map(mapSugar);
}

/** Which of these Health sample ids are linked to a local row right now. */
export async function listLinkedHealthUuids(uuids: readonly string[]): Promise<string[]> {
  if (uuids.length === 0) return [];
  const db = await getDb();
  const rows = await db.getAllAsync<{ healthkit_uuid: string }>(
    `SELECT healthkit_uuid FROM sugar_logs WHERE healthkit_uuid IN (${uuids.map(() => "?").join(",")});`,
    [...uuids]
  );
  return rows.map((r) => r.healthkit_uuid);
}

/** The local rows currently linked to any of these Health sample ids. */
export async function listHealthUuidLinks(
  uuids: readonly string[]
): Promise<{ id: string; profile_id: string; healthkit_uuid: string }[]> {
  if (uuids.length === 0) return [];
  const db = await getDb();
  return db.getAllAsync<{ id: string; profile_id: string; healthkit_uuid: string }>(
    `SELECT id, profile_id, healthkit_uuid FROM sugar_logs WHERE healthkit_uuid IN (${uuids.map(() => "?").join(",")});`,
    [...uuids]
  );
}

/** Source and Health sample id of every reading of this profile that carries
 *  one, for revoking the app's own copies before the rows are deleted. */
export async function listHealthMirrorRows(
  profileId: string
): Promise<{ source: string; healthkit_uuid: string | null }[]> {
  const db = await getDb();
  return db.getAllAsync<{ source: string; healthkit_uuid: string | null }>(
    "SELECT source, healthkit_uuid FROM sugar_logs WHERE profile_id = ? AND healthkit_uuid IS NOT NULL;",
    [profileId]
  );
}

/**
 * Deletes a sugar log and returns its healthkit_uuid (or null) so the caller can
 * best-effort revoke the mirrored Apple Health sample. Returning it here means
 * every delete path (journal swipe, undo) gets the value without a second query.
 */
export async function deleteSugarLog(id: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ healthkit_uuid: string | null }>(
    "SELECT healthkit_uuid FROM sugar_logs WHERE id = ?;",
    [id]
  );
  await db.runAsync("DELETE FROM sugar_logs WHERE id = ?;", [id]);
  return row?.healthkit_uuid ?? null;
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
 * Imports a whole batch of health-store samples in ONE transaction, and returns
 * how many rows were actually new.
 *
 * The candidate set is resolved from a SINGLE range query (widened by the
 * dedupe window on both ends, so a match just outside the sample span is still
 * seen) instead of a COUNT per sample, and inserts skip the row read-back
 * addSugarLog does for its return value. A 300-sample sync used to be ~900
 * round trips outside any transaction, so an interrupted sync could leave a
 * partially imported window. Which samples actually get inserted is decided
 * by planHealthImport (3d): every existing reading counts, not only rows this
 * app previously imported.
 */
export async function insertHealthSugarLogs(
  profileId: string,
  samples: HealthSugarSample[]
): Promise<number> {
  if (samples.length === 0) return 0;
  const db = await getDb();

  let from = samples[0].logged_at;
  let to = samples[0].logged_at;
  for (const s of samples) {
    if (s.logged_at < from) from = s.logged_at;
    if (s.logged_at > to) to = s.logged_at;
  }
  const windowMs = SUGAR_DEDUP_WINDOW_MINUTES * 60_000;
  const rangeFrom = new Date(Date.parse(from) - windowMs).toISOString();
  const rangeTo = new Date(Date.parse(to) + windowMs).toISOString();

  const existing = await db.getAllAsync<ExistingSugarReading>(
    `SELECT logged_at, glucose_level_mgdl FROM sugar_logs
      WHERE profile_id = ? AND logged_at BETWEEN ? AND ?;`,
    [profileId, rangeFrom, rangeTo]
  );

  const toInsert = planHealthImport(samples, existing);

  let inserted = 0;
  await db.withTransactionAsync(async () => {
    for (const s of toInsert) {
      await db.runAsync(
        `INSERT INTO sugar_logs
           (id, profile_id, glucose_level_mgdl, period_tag, source, logged_at, tags)
         VALUES (?, ?, ?, ?, 'health', ?, '[]');`,
        [uuid(), profileId, Math.round(s.glucose_level_mgdl), s.period_tag, s.logged_at]
      );
      inserted++;
    }
  });
  return inserted;
}

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
  /** The meal template this row was logged from (schema v13). Provenance only:
   *  see lib/db/mealTemplates.ts and MealLog.meal_template_id. */
  meal_template_id?: string | null;
}

export async function addMealLog(input: NewMealLogInput): Promise<MealLog> {
  const db = await getDb();
  const id = uuid();
  const loggedAt = input.logged_at ?? new Date().toISOString();
  await db.runAsync(
    `INSERT INTO meal_logs
       (id, profile_id, sugar_log_id, food_id, custom_food_name, portion_g,
        calculated_carbs_g, insulin_dose_units, photo_uri_local, personal_note, logged_at, tags,
        meal_template_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
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
      input.meal_template_id ?? null,
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
  limit = 500,
  range?: DateRange
): Promise<MealLog[]> {
  const db = await getDb();
  const { sql, values } = rangeClause("logged_at", range);
  const rows = await db.getAllAsync<MealRow>(
    `SELECT * FROM meal_logs WHERE profile_id = ?${sql} ORDER BY logged_at DESC LIMIT ?;`,
    [profileId, ...values, limit]
  );
  return rows.map(mapMeal);
}

/** The bare fields lib/entryGuard.ts asks about, not a full row read.
 *  `foodKey` mirrors what a caller building a NEW meal's own foodKey must
 *  produce (see components/useEntryGuardConfirm.tsx): the catalog food_id
 *  when there is one, otherwise the custom name lower-cased and trimmed - the
 *  same comparison key on both sides is what makes the match work. `id` is
 *  what lets a caller pass its own row back as `excludeId` (P5b) so editing
 *  an existing meal never flags against its own pre-edit row. */
export interface RecentMealLog {
  id: string;
  logged_at: string;
  foodKey: string | null;
  foodName: string | null;
}

/**
 * Meals logged between `sinceIso` and `untilIso` (open-ended when omitted),
 * for the duplicate-entry check (lib/entryGuard.ts /
 * components/useEntryGuardConfirm.tsx). A plain fact lookup, not a warning of
 * its own - the caller decides what, if anything, to ask about.
 */
export async function listRecentMealLogs(
  profileId: string,
  sinceIso: string,
  untilIso?: string
): Promise<RecentMealLog[]> {
  const db = await getDb();
  const values = untilIso ? [profileId, sinceIso, untilIso] : [profileId, sinceIso];
  const rows = await db.getAllAsync<{
    id: string;
    logged_at: string;
    food_id: string | null;
    custom_food_name: string | null;
  }>(
    `SELECT id, logged_at, food_id, custom_food_name FROM meal_logs
      WHERE profile_id = ? AND logged_at >= ? ${untilIso ? "AND logged_at <= ?" : ""}
      ORDER BY logged_at DESC;`,
    values
  );
  return rows.map((r) => ({
    id: r.id,
    logged_at: r.logged_at,
    foodKey: r.food_id ?? (r.custom_food_name ? r.custom_food_name.trim().toLowerCase() : null),
    foodName: r.custom_food_name,
  }));
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
 *
 * Returns the deleted reading's healthkit_uuid (or null), so the caller can
 * revoke the mirrored Apple Health sample exactly like the journal delete does.
 * Undo used to drop the local row and leave that sample behind for good.
 */
export async function deleteMealRecord(
  id: string,
  createdSugarLogId?: string | null
): Promise<string | null> {
  await deleteMealLog(id);
  if (!createdSugarLogId) return null;
  return deleteSugarLog(createdSugarLogId);
}

export type MealLogUpdate = Partial<
  Pick<
    MealLog,
    | "food_id"
    | "sugar_log_id"
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
/** How many of the newest meal rows getRecentMeals groups over. */
const RECENT_MEAL_SCAN_ROWS = 200;

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
 *
 * The grouping key is an EXPRESSION (COALESCE over a lowercased name), which no
 * index can serve, so grouping straight off meal_logs meant scanning and
 * aggregating the profile's entire meal history to show eight chips. The inner
 * query narrows to the newest RECENT_MEAL_SCAN_ROWS meals first - that one IS
 * index-served (idx_meal_profile is (profile_id, logged_at DESC), and the LIMIT
 * stops it early) - and the grouping then runs over a bounded set. "Recent" is
 * exactly what this list claims to be, so a bounded look-back is the honest read.
 *
 * Rows logged from a TEMPLATE are excluded (meal_template_id IS NULL). They have
 * their own surface, which re-logs the template's CURRENT items, offers undo and
 * arms the post-meal reminder; a chip here would re-log a frozen copy of the
 * totals under the template's name and do none of those three things. Filtered in
 * the INNER query so template rows do not eat the bounded look-back either.
 */
export async function getRecentMeals(
  profileId: string,
  limit = 8
): Promise<RecentMeal[]> {
  const db = await getDb();
  const scan = Math.max(limit * 25, RECENT_MEAL_SCAN_ROWS);
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
       FROM (SELECT id, food_id, custom_food_name, portion_g, calculated_carbs_g,
                    logged_at
               FROM meal_logs
              WHERE profile_id = ?
                AND meal_template_id IS NULL
                AND (food_id IS NOT NULL
                     OR TRIM(COALESCE(custom_food_name, '')) <> '')
              ORDER BY logged_at DESC
              LIMIT ?) m
       LEFT JOIN foods f ON f.id = m.food_id
      GROUP BY COALESCE(m.food_id, LOWER(TRIM(m.custom_food_name)))
      ORDER BY _lastAt DESC
      LIMIT ?;`,
    [profileId, scan, limit]
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

/**
 * Previous logs of the SAME meal, newest first: same catalogue food (by
 * food_id), or for a typed-name meal, the same normalized custom name. Powers
 * the meal-response screen's "previous attempts" comparison (see
 * lib/mealResponse.ts). Each row still needs its own computeMealResponse call
 * against the profile's readings, this only finds the matching meals.
 */
export async function getMealResponseHistory(
  profileId: string,
  meal: Pick<MealLog, "id" | "food_id" | "custom_food_name">,
  limit = 5
): Promise<MealLog[]> {
  const db = await getDb();
  let rows: MealRow[];
  if (meal.food_id) {
    rows = await db.getAllAsync<MealRow>(
      `SELECT * FROM meal_logs WHERE profile_id = ? AND food_id = ? AND id != ?
       ORDER BY logged_at DESC LIMIT ?;`,
      [profileId, meal.food_id, meal.id, limit]
    );
  } else {
    const name = (meal.custom_food_name ?? "").trim().toLowerCase();
    if (!name) return [];
    rows = await db.getAllAsync<MealRow>(
      `SELECT * FROM meal_logs WHERE profile_id = ? AND food_id IS NULL AND id != ?
         AND LOWER(TRIM(custom_food_name)) = ?
       ORDER BY logged_at DESC LIMIT ?;`,
      [profileId, meal.id, name, limit]
    );
  }
  return rows.map(mapMeal);
}

