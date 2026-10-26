import type { InsulinType, MealSlot, PeriodTag, SitePoint } from "./types";
import { CGM_SHOT_SOURCE_APP } from "./screenshotGlucose";

/**
 * Store-screenshot seed (see ./screenshotSeed): the rows it wipes and
 * re-creates, written as ONE transaction on a connection of their own.
 *
 * Done one autocommit statement at a time on the shared connection, they got
 * swallowed by any withTransactionAsync another code path had open there
 * (expo-sqlite's is not isolated) and undone by its ROLLBACK: a previous
 * language's meal survived the wipe (today's carbs 180/187 instead of 135) or
 * the language switch was reverted, while the pass still marked itself done.
 * withExclusiveTransactionAsync cannot be joined from outside, lands all or
 * nothing, and makes a concurrent pass wait. Fixed ids keep re-runs convergent.
 *
 * No React Native imports: scripts/screenshotSeedAtomic.test.ts runs these
 * functions against node:sqlite.
 */

export interface SeedSql {
  runAsync(source: string, params: (string | number | null)[]): Promise<unknown>;
}

export interface SeedTxnHost {
  withExclusiveTransactionAsync(task: (txn: SeedSql) => Promise<void>): Promise<void>;
}

export function seedRowId(kind: string, profileId: string, n: number): string {
  return `screenshot-${kind}-${profileId}-${n}`;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Retries only a busy database: a pass that collides with another writer
 *  waits for it instead of being dropped (a dropped pass would leave the
 *  previous language on screen). */
export async function runSeedTransaction(
  host: SeedTxnHost,
  task: (txn: SeedSql) => Promise<void>,
  attempts = 20,
  waitMs = 250
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await host.withExclusiveTransactionAsync(task);
      return;
    } catch (err) {
      if (attempt >= attempts || !/locked|busy/i.test(String(err))) throw err;
      await sleep(waitMs);
    }
  }
}

export interface SeedMealRow {
  name: string;
  carbs: number;
  portionG: number;
  dose: number;
  loggedAt: string;
}

/** Every meal of the profile is replaced by `rows`. Mirrors deleteMealLog for
 *  what hangs off a meal: the transaction's own connection runs without
 *  foreign_keys, so the ON DELETE effects are spelled out. */
export async function replaceSeedMeals(
  sql: SeedSql,
  profileId: string,
  rows: readonly SeedMealRow[]
): Promise<void> {
  const ofProfile = "SELECT id FROM meal_logs WHERE profile_id = ?";
  await sql.runAsync(
    `DELETE FROM injection_logs WHERE source = 'calculator' AND meal_log_id IN (${ofProfile});`,
    [profileId]
  );
  await sql.runAsync(
    `UPDATE injection_logs SET meal_log_id = NULL WHERE meal_log_id IN (${ofProfile});`,
    [profileId]
  );
  await sql.runAsync("DELETE FROM meal_logs WHERE profile_id = ?;", [profileId]);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    await sql.runAsync(
      `INSERT INTO meal_logs
         (id, profile_id, custom_food_name, portion_g, calculated_carbs_g,
          insulin_dose_units, logged_at)
       VALUES (?, ?, ?, ?, ?, ?, ?);`,
      [seedRowId("meal", profileId, i), profileId, r.name, r.portionG, r.carbs, r.dose, r.loggedAt]
    );
  }
}

export interface SeedTemplateRow {
  name: string;
  slot: MealSlot;
  itemName: string;
  carbs: number;
  portionG: number;
}

/** Every template of the profile (and its items) is replaced by `rows`, one
 *  typed-name item each, in the order given. */
export async function replaceSeedTemplates(
  sql: SeedSql,
  profileId: string,
  rows: readonly SeedTemplateRow[],
  nowMs: number
): Promise<void> {
  await sql.runAsync(
    "DELETE FROM meal_template_items WHERE template_id IN (SELECT id FROM meal_templates WHERE profile_id = ?);",
    [profileId]
  );
  await sql.runAsync("DELETE FROM meal_templates WHERE profile_id = ?;", [profileId]);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const id = seedRowId("template", profileId, i);
    await sql.runAsync(
      `INSERT INTO meal_templates
         (id, profile_id, name, slot, sort_order, use_count, last_used_at, created_at)
       VALUES (?, ?, ?, ?, ?, 0, NULL, ?);`,
      [id, profileId, r.name, r.slot, i, new Date(nowMs + i).toISOString()]
    );
    await sql.runAsync(
      `INSERT INTO meal_template_items
         (id, template_id, food_id, name_snapshot, carb_100g_snapshot, portion_g,
          carbs_g_fixed, sort_order)
       VALUES (?, ?, NULL, ?, 0, ?, ?, 0);`,
      [seedRowId("template-item", profileId, i), id, r.itemName, r.portionG, r.carbs]
    );
  }
}

export interface SeedCgmRows {
  sensor: readonly { mgdl: number; atMs: number }[];
  manual: readonly { mgdl: number; atMs: number; period_tag: PeriodTag }[];
}

/** Removes the demo sensor readings (and the hand-entered ones seeded beside
 *  them) of the profile; nothing else in sugar_logs is touched. */
export async function clearSeedCgm(sql: SeedSql, profileId: string): Promise<void> {
  await sql.runAsync(
    "DELETE FROM sugar_logs WHERE profile_id = ? AND (source_app = ? OR id LIKE ?);",
    [profileId, CGM_SHOT_SOURCE_APP, `screenshot-cgmmanual-${profileId}-%`]
  );
}

/** The demo sensor day: every demo row is replaced by `rows`, sensor readings as
 *  generic health-store rows (source 'health', is_cgm 1, no brand anywhere). */
export async function replaceSeedCgm(
  sql: SeedSql,
  profileId: string,
  rows: SeedCgmRows
): Promise<void> {
  await clearSeedCgm(sql, profileId);
  for (let i = 0; i < rows.sensor.length; i++) {
    const r = rows.sensor[i];
    const id = seedRowId("cgm", profileId, i);
    await sql.runAsync(
      `INSERT INTO sugar_logs
         (id, profile_id, glucose_level_mgdl, period_tag, source, logged_at, tags,
          source_app, external_id, is_cgm)
       VALUES (?, ?, ?, 'unset', 'health', ?, '[]', ?, ?, 1);`,
      [id, profileId, r.mgdl, new Date(r.atMs).toISOString(), CGM_SHOT_SOURCE_APP, id]
    );
  }
  for (let i = 0; i < rows.manual.length; i++) {
    const r = rows.manual[i];
    await sql.runAsync(
      `INSERT INTO sugar_logs
         (id, profile_id, glucose_level_mgdl, period_tag, source, logged_at, tags, is_cgm)
       VALUES (?, ?, ?, ?, 'manual', ?, '[]', 0);`,
      [seedRowId("cgmmanual", profileId, i), profileId, r.mgdl, r.period_tag, new Date(r.atMs).toISOString()]
    );
  }
}

export interface SeedStory {
  glucose: readonly { glucose_level_mgdl: number; period_tag: PeriodTag; logged_at: string }[];
  injections: readonly {
    site: string;
    site_point: SitePoint;
    dose_units: number;
    insulin_type: InsulinType;
    logged_at: string;
  }[];
  meds: readonly { takenAt: number; name: string }[];
}

/** The language-neutral story (first pass only): every reading, injection and
 *  medication entry of the profile is replaced by `story`. */
export async function replaceSeedStory(
  sql: SeedSql,
  profileId: string,
  story: SeedStory,
  nowMs: number
): Promise<void> {
  await sql.runAsync(
    "UPDATE meal_logs SET sugar_log_id = NULL WHERE sugar_log_id IN (SELECT id FROM sugar_logs WHERE profile_id = ?);",
    [profileId]
  );
  await sql.runAsync("DELETE FROM sugar_logs WHERE profile_id = ?;", [profileId]);
  await sql.runAsync("DELETE FROM injection_logs WHERE profile_id = ?;", [profileId]);
  await sql.runAsync("DELETE FROM med_logs WHERE profile_id = ?;", [profileId]);
  for (let i = 0; i < story.glucose.length; i++) {
    const g = story.glucose[i];
    await sql.runAsync(
      `INSERT INTO sugar_logs
         (id, profile_id, glucose_level_mgdl, period_tag, source, logged_at, tags)
       VALUES (?, ?, ?, ?, 'manual', ?, '[]');`,
      [seedRowId("glucose", profileId, i), profileId, Math.round(g.glucose_level_mgdl), g.period_tag, g.logged_at]
    );
  }
  for (let i = 0; i < story.injections.length; i++) {
    const inj = story.injections[i];
    await sql.runAsync(
      `INSERT INTO injection_logs
         (id, profile_id, site, site_point, dose_units, insulin_type, source, logged_at, tags)
       VALUES (?, ?, ?, ?, ?, ?, 'manual', ?, '[]');`,
      [
        seedRowId("injection", profileId, i),
        profileId,
        inj.site,
        inj.site_point,
        inj.dose_units,
        inj.insulin_type,
        inj.logged_at,
      ]
    );
  }
  for (let i = 0; i < story.meds.length; i++) {
    const m = story.meds[i];
    await sql.runAsync(
      `INSERT INTO med_logs (id, profile_id, taken_at, name, note, created_at)
       VALUES (?, ?, ?, ?, NULL, ?);`,
      [seedRowId("med", profileId, i), profileId, m.takenAt, m.name, nowMs]
    );
  }
}
