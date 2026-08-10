/**
 * The schema v12 statements, kept dependency-free so the migration test
 * (scripts/migration.test.ts) executes the REAL SQL against a scratch database -
 * the same arrangement as v8Sql/v9Sql/v11Sql.
 *
 * v12 adds nothing but INDEXES on the foreign-key CHILD columns. SQLite indexes
 * the PARENT side of a foreign key (it has to, the parent key is unique) but
 * never the child, so enforcing a referential action meant a full table scan of
 * every referencing table:
 *
 *   - deleting a reading    scanned meal_logs   (sugar_log_id ON DELETE SET NULL)
 *   - deleting a food       scanned meal_logs   (food_id      ON DELETE SET NULL)
 *                           and favorites       (food_id      ON DELETE CASCADE)
 *   - deleting a meal       scanned injection_logs (meal_log_id ON DELETE SET NULL)
 *
 * Clearing a profile's records runs three of those in a row, and the journal's
 * per-row delete/undo path pays one on every single tap. injection_logs.meal_log_id
 * is also read directly by deleteMealLog() and getCalculatorInjectionForMeal().
 *
 * favorites.profile_id and the three log tables' profile_id are deliberately NOT
 * here: they are already the leading column of an existing index (the
 * UNIQUE(profile_id, food_id) constraint and idx_*_profile respectively).
 *
 * Every statement is CREATE INDEX IF NOT EXISTS, so a re-run - or an install that
 * already got these from a fresh schema - is a no-op. No row is read, written or
 * moved: an interrupted run leaves the data exactly as it was.
 */

export const V12_INDEX_MEAL_SUGAR =
  "CREATE INDEX IF NOT EXISTS idx_meal_sugar_log ON meal_logs (sugar_log_id);";

export const V12_INDEX_MEAL_FOOD =
  "CREATE INDEX IF NOT EXISTS idx_meal_food ON meal_logs (food_id);";

export const V12_INDEX_FAVORITES_FOOD =
  "CREATE INDEX IF NOT EXISTS idx_favorites_food ON favorites (food_id);";

export const V12_INDEX_INJECTION_MEAL =
  "CREATE INDEX IF NOT EXISTS idx_injection_meal_log ON injection_logs (meal_log_id);";

/**
 * Not a foreign key, but the same shape of problem: the food tab asks for one
 * category at a time (counts, then the drilled-in list) and had no index to do it
 * with, so each question scanned all 562 catalog rows.
 */
export const V12_INDEX_FOODS_CATEGORY =
  "CREATE INDEX IF NOT EXISTS idx_foods_category ON foods (is_custom, category);";

/** Applied in order; each one is independently idempotent. */
export const V12_INDEXES: string[] = [
  V12_INDEX_MEAL_SUGAR,
  V12_INDEX_MEAL_FOOD,
  V12_INDEX_FAVORITES_FOOD,
  V12_INDEX_INJECTION_MEAL,
  V12_INDEX_FOODS_CATEGORY,
];
