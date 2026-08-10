/**
 * The schema v13 statements, kept dependency-free so the migration test
 * (scripts/migration.test.ts) executes the REAL SQL against a scratch database -
 * the same arrangement as v8Sql/v9Sql/v11Sql/v12Sql.
 *
 * v13 adds the repeating-meal TEMPLATES: a named list of items the user defines
 * once and logs with one tap. Two new tables plus ONE nullable column, and
 * nothing else is touched:
 *
 *   - meal_templates       the recipe: a name, an optional slot, its order and
 *                          how often it has been used.
 *   - meal_template_items  what is in it. Each item keeps BOTH a nullable
 *                          food_id and a name + carb_100g SNAPSHOT (see below).
 *   - meal_logs.meal_template_id  which template a logged meal came from.
 *
 * A template is a RECIPE, not a record: it is descriptive of what the user
 * repeats, it never suggests anything, and logging it writes ONE meal_logs row
 * (custom_food_name = the template name, portion_g = the sum of the item
 * portions, calculated_carbs_g = the total). Writing one row per item would
 * break the two things the rest of the app is built on: a dose is attributed to
 * a single meal (injection_logs.meal_log_id) and one save is undone in one step.
 *
 * meal_logs.meal_template_id carries NO foreign key on purpose. It is
 * provenance, not a reference: the recorded meal must survive the template being
 * renamed, re-itemised or deleted, and a column that sits in a foreign-key
 * constraint cannot be removed with DROP COLUMN in SQLite - which is exactly why
 * v8 had to rebuild a whole table to get rid of one dead column.
 *
 * Why an item keeps a food_id AND a snapshot: the food_id is the LIVE link, so a
 * correction to a custom food's carb value reaches every template that uses it
 * (an uncorrected old value would go on producing a wrong dose). The snapshot is
 * insurance against losing the catalogue row: a deleted food nulls the food_id
 * (ON DELETE SET NULL) and the template still knows what the item was and what
 * it counted for. carbs_g_fixed exists for the "make a template out of a past
 * meal" path: a meal logged as a typed name has no carb_100g and can have a
 * portion of 0, so deriving its carbs would divide a total that is not there.
 *
 * The whole migration is CREATE TABLE / CREATE INDEX IF NOT EXISTS plus a single
 * guarded ADD COLUMN: no table is rebuilt, no row is read, written or moved, and
 * a re-run is a no-op.
 */

/**
 * `slot` is nullable and is ONLY an ordering signal (a template named "morning
 * routine" sorts first in the morning). It never enters a dose: the carb ratio
 * always comes from the clock via activeMealSlot(), because a ratio describes the
 * body's time of day, not the name of a recipe. There is no snack slot - MealSlot
 * has three values and there is no carb_ratio_snack column - so a snack template
 * is simply one with slot NULL.
 */
export const V13_CREATE_TEMPLATES = `
  CREATE TABLE IF NOT EXISTS meal_templates (
    id TEXT PRIMARY KEY NOT NULL,
    profile_id TEXT NOT NULL,
    name TEXT NOT NULL,
    slot TEXT CHECK (slot IS NULL OR slot IN ('breakfast','lunch','dinner')),
    sort_order INTEGER NOT NULL DEFAULT 0,
    use_count INTEGER NOT NULL DEFAULT 0,
    last_used_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (profile_id) REFERENCES user_profiles (id) ON DELETE CASCADE
  );`;

/**
 * The CHECK is the one thing an item cannot be: anonymous. Without either a
 * food_id or a name there is nothing to show on the row and nothing to fall back
 * on once the catalogue row is gone.
 */
export const V13_CREATE_TEMPLATE_ITEMS = `
  CREATE TABLE IF NOT EXISTS meal_template_items (
    id TEXT PRIMARY KEY NOT NULL,
    template_id TEXT NOT NULL,
    food_id TEXT,
    name_snapshot TEXT NOT NULL,
    carb_100g_snapshot REAL NOT NULL DEFAULT 0,
    portion_g REAL NOT NULL DEFAULT 0,
    carbs_g_fixed REAL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    CHECK (food_id IS NOT NULL OR TRIM(name_snapshot) <> ''),
    FOREIGN KEY (template_id) REFERENCES meal_templates (id) ON DELETE CASCADE,
    FOREIGN KEY (food_id) REFERENCES foods (id) ON DELETE SET NULL
  );`;

/** The template list is always "this profile's, in its own order". */
export const V13_INDEX_TEMPLATES_PROFILE =
  "CREATE INDEX IF NOT EXISTS idx_meal_templates_profile ON meal_templates (profile_id, sort_order, created_at);";

/** Items are only ever read one template at a time, in item order. */
export const V13_INDEX_ITEMS_TEMPLATE =
  "CREATE INDEX IF NOT EXISTS idx_meal_template_items_template ON meal_template_items (template_id, sort_order);";

/** Create-only DDL; applied in order, each statement independently idempotent. */
export const V13_CREATE: string[] = [
  V13_CREATE_TEMPLATES,
  V13_CREATE_TEMPLATE_ITEMS,
  V13_INDEX_TEMPLATES_PROFILE,
  V13_INDEX_ITEMS_TEMPLATE,
];

/**
 * The only statement that touches an existing table. Nullable with no default and
 * no foreign key, so every stored meal keeps its values verbatim and simply
 * reads as "not from a template".
 */
export const V13_ADD_MEAL_TEMPLATE_ID =
  "ALTER TABLE meal_logs ADD COLUMN meal_template_id TEXT;";
