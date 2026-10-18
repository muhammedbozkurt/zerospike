/**
 * The schema v26 column lists, dependency-free so the migration test runs the
 * REAL statements.
 *
 * v26 adds one nullable `health_uuid` TEXT to meal_logs and to injection_logs:
 * the id of the sample this app mirrored into Apple Health / Health Connect
 * for that row (carbohydrates for a meal, insulin delivery for an injection),
 * so an edit or delete can revoke the mirror. Same role as sugar_logs.
 * healthkit_uuid (v10). Plain guarded ADD COLUMNs: no rebuild, no row touched,
 * NULL for every existing row and for any row never written to Health.
 */
export const V26_MEAL_COLUMNS: { name: string; type: string }[] = [
  { name: "health_uuid", type: "TEXT" },
];

export const V26_INJECTION_COLUMNS: { name: string; type: string }[] = [
  { name: "health_uuid", type: "TEXT" },
];
