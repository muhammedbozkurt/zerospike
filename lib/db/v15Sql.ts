/**
 * v14 → v15 migration SQL, in one place so scripts/migration.test.ts runs the
 * REAL statements (matching the v8/v9/v10 pattern).
 *
 * v15 adds the insulin product a profile uses (basal_insulin_id, bolus_insulin_id)
 * and the profile's own daily basal dose (basal_daily_units), plus which kind of
 * bolus an injection was (bolus_kind: meal vs correction). All four are nullable
 * with no DEFAULT and no CHECK: a plain ADD COLUMN cannot carry a CHECK without a
 * table rebuild (the v8/v9/v11 lesson), and these are optional inputs the app may
 * never collect for a given profile, so validation of the stored value lives in
 * TS (lib/insulinCatalog.ts, lib/db/types.ts) instead.
 */

export const V15_PROFILE_COLUMNS: { name: string; type: string }[] = [
  { name: "basal_daily_units", type: "REAL" },
  { name: "basal_insulin_id", type: "TEXT" },
  { name: "bolus_insulin_id", type: "TEXT" },
];

export const V15_ADD_BOLUS_KIND =
  "ALTER TABLE injection_logs ADD COLUMN bolus_kind TEXT;";
