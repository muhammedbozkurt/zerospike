/**
 * v9 → v10 migration SQL, in one place so scripts/migration.test.ts runs the
 * REAL statement (matching the v8/v9 pattern).
 *
 * v10 adds ONE nullable column to sugar_logs: `healthkit_uuid`. It records the
 * HealthKit sample UUID of a manual reading that the user opted to mirror into
 * Apple Health, so the mirror can be revoked (delete) later. It is a plain
 * ADD COLUMN - no CHECK change, no foreign key, no table rebuild - so unlike v8/v9
 * this needs no scratch-table dance and cannot lose a row. NULL for every existing
 * row and for any reading that was never written to Health.
 */
export const V10_ADD_HK_UUID =
  "ALTER TABLE sugar_logs ADD COLUMN healthkit_uuid TEXT;";
