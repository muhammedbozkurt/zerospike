/**
 * The schema v31 column list, dependency-free so the migration test runs the
 * REAL statement.
 *
 * v31 adds one nullable `created_sugar_log_id` TEXT to meal_logs: the id of the
 * glucose reading THIS meal's save created. A reading the user had logged before
 * the meal (and the meal merely linked to) is never recorded here, so a later
 * correction of the meal's time can tell "my own reading" from "someone else's
 * measurement" without guessing from timestamps. Deliberately no foreign key: it
 * is provenance, and the id simply dangles once the reading is deleted. NULL for
 * every existing row, which reads as "created elsewhere" (the safe side: the
 * reading is not moved). Plain guarded ADD COLUMN: no rebuild, no row touched.
 */
export const V31_MEAL_COLUMNS: { name: string; type: string }[] = [
  { name: "created_sugar_log_id", type: "TEXT" },
];
