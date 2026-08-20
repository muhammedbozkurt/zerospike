/**
 * The schema v19 statements, kept in a dependency-free module so the migration
 * test (scripts/migration.test.ts) can execute the REAL SQL against a scratch
 * database - the same arrangement as v13Sql/v14Sql/v15Sql/v16Sql/v17Sql/v18Sql.
 *
 * v19 adds two columns to the reminders registry (schema v17, see ./v17Sql):
 *
 *   - profile_id      who a reminder row belongs to. Nullable and carries NO
 *                      foreign key, unlike med_logs/meds/injection_logs: the
 *                      table predates per-profile ownership (it was device-
 *                      level, like NotificationPrefs), so every row that
 *                      already existed lands here as NULL. Turning those NULL
 *                      rows into real ownership is a RUNTIME, one-time
 *                      hand-off (adoptOrphanReminders, ./remindersBridge.ts),
 *                      never a schema-level migration - a migration step
 *                      cannot know which profile is "active" (see the
 *                      dependency-free note atop ./migrations.ts), and a
 *                      guess baked into the schema step could never be
 *                      corrected once user_version has already moved past it.
 *   - alarm_enabled   1 when a reminder should also ring as a real (AlarmKit)
 *                      alarm rather than only a notification. NOT NULL
 *                      DEFAULT 0, so every row - existing or new - keeps
 *                      exactly the behavior it had until it opts in. Column
 *                      only in THIS wave (2.2.0's A4): no UI reads or writes
 *                      it yet, and no screen shows it. The AlarmKit wave
 *                      (2.2.0's A1) is what turns it into an actual feature.
 *
 * Both are plain ALTER TABLE ADD COLUMN (no CHECK, no rebuild): the v8/v9/v11
 * lesson is that a rebuild is the only thing that risks a row, and neither
 * column needs one. `V19_REMINDERS_COLUMNS` is consumed twice - once (guarded)
 * by migrateToV19 for a migrating install, and once (unconditionally, since
 * the table was JUST created) by createSchemaV1's fresh-install path in
 * ./index.ts - so both paths run the exact same ALTER statements in the exact
 * same order onto the exact same V17_CREATE-shaped table, and end up with
 * byte-identical reminders DDL.
 */

export const V19_REMINDERS_COLUMNS: { name: string; type: string }[] = [
  { name: "profile_id", type: "TEXT" },
  { name: "alarm_enabled", type: "INTEGER NOT NULL DEFAULT 0" },
];
