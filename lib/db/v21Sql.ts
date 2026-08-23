/**
 * The schema v21 statements, kept in a dependency-free module so the migration
 * test (scripts/migration.test.ts) can execute the REAL SQL against a scratch
 * database - the same arrangement as v13Sql..v20Sql.
 *
 * v21 turns the AlarmKit opt-in (v19's `alarm_enabled`) into the DEFAULT, and
 * adds the one column that makes doing so reversible per row:
 *
 *   - alarm_user_set   1 once the user has themselves chosen how a reminder
 *                      should be delivered (the alarm/notification badge in
 *                      app/settings/reminders.tsx, or the switch in
 *                      components/ReminderEditSheet.tsx). NOT NULL DEFAULT 0,
 *                      so every row the app itself wrote - onboarding's
 *                      reminders, the legacy bridge, the new default - stays 0
 *                      and is treated as "never asked".
 *
 * The two UPDATEs below run, in this order, right after the ADD COLUMN:
 *
 *   1. V21_MARK_EXPLICIT_CHOICE persists 2.2.0's ONLY known trace of intent.
 *      The single way `alarm_enabled` could reach 1 in 2.2.0 was the user
 *      reaching for the "Play as alarm" switch, so those rows are a real
 *      choice and must survive step 2 untouched.
 *   2. V21_DEFAULT_TO_ALARM flips everything still unmarked to alarm.
 *
 * Ordering is the whole point: run the other way around, step 1 would mark
 * every row (they would all read alarm_enabled = 1 by then) and the distinction
 * between "chose the alarm" and "never touched it" would be gone for good.
 *
 * Both UPDATEs belong to the ONE run that actually adds the column (see
 * migrateToV21's guard): they describe a single moment - the release where the
 * default changed - not a rule to keep re-applying. Replaying them against a
 * database that already has the column would read rows the app itself wrote
 * afterwards and mark them as the user's own choice, which is exactly the
 * information they exist to protect.
 *
 * A row deliberately left OFF in 2.2.0 is indistinguishable in the database
 * from one nobody ever touched (both are a plain 0), so it does get flipped
 * here; the compensation is in the UI, not in SQL - the 2.3.0 tour says it
 * once, and the per-row badge turns it back with a single tap (which then
 * writes alarm_user_set = 1, so this can never happen to that row again).
 *
 * Plain ALTER TABLE ADD COLUMN plus two UPDATEs, no rebuild: the v8/v9/v11
 * lesson is that a rebuild is the only thing that risks a row.
 * `V21_REMINDERS_COLUMNS` is consumed twice - once (guarded) by migrateToV21
 * for a migrating install, and once (unconditionally, since the table was JUST
 * created) by createSchemaV1's fresh-install path in ./index.ts - so both paths
 * run the exact same ALTER statement onto the exact same reminders table and
 * end up with byte-identical DDL. The fresh-install path replays the two
 * UPDATEs as well, where an empty table makes them a no-op, so neither path can
 * drift from the other.
 */

export const V21_REMINDERS_COLUMNS: { name: string; type: string }[] = [
  { name: "alarm_user_set", type: "INTEGER NOT NULL DEFAULT 0" },
];

export const V21_MARK_EXPLICIT_CHOICE =
  "UPDATE reminders SET alarm_user_set = 1 WHERE alarm_enabled = 1;";

export const V21_DEFAULT_TO_ALARM =
  "UPDATE reminders SET alarm_enabled = 1 WHERE alarm_user_set = 0;";
