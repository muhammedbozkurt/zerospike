/**
 * The schema v17 statements, kept dependency-free so the migration test
 * (scripts/migration.test.ts) executes the REAL SQL against a scratch database -
 * the same arrangement as v13Sql/v14Sql/v16Sql.
 *
 * v17 adds the reminders REGISTRY: one table backing every scheduled local
 * reminder the app manages - the three that already existed (basal, oral
 * medication, glucose) plus any number of user-defined custom ones. It is
 * device-level, like NotificationPrefs (lib/services/notificationPrefs.ts): no
 * profile_id, because a reminder schedule follows the device owner's own day,
 * not one profile.
 *
 * This table does not replace NotificationPrefs: the master switch, the weekly
 * summary, the idle nudge, the low-follow-up and the post-meal timer all stay
 * exactly where they were. Only the three per-time reminders that used to be
 * individual booleans + "HH:MM" strings (basal/basalTime, med/medTime,
 * glucose/glucoseTime) move here, generalized into rows so a user can also add
 * one of their own (type='custom'). A ONE-TIME bridge (lib/db/remindersBridge.ts,
 * run from lib/services/notifications.ts on the first call of its apply flow,
 * never from initDatabase - see the top of lib/db/migrations.ts for why a
 * migration step must never depend on another service) seeds this table from
 * whatever those three were already set to. From then on this table is the only
 * thing consulted to decide what actually gets scheduled; the legacy prefs
 * fields stay readable but stop driving anything.
 *
 * CREATE TABLE IF NOT EXISTS and nothing more: no existing table is read,
 * written, rebuilt or dropped, so an interrupted run leaves every row exactly as
 * it was and a re-run is a no-op (the v14/v16 pattern).
 */

/**
 * `label` is the only thing a custom reminder is called; NULL for the three
 * built-in types, whose copy comes from i18n (notifications.basalTitle etc, and
 * notifications.customTitle for a custom row - see lib/services/notifications.ts).
 * `time` is "HH:MM", parsed the same way every other daily reminder in the app
 * already is (see parseHHMM). `enabled` defaults to 1 so a freshly bridged row
 * (seeded only when the legacy toggle was ON) starts armed, exactly as it was.
 * `sort` is the user's own ordering, `created_at` is epoch MILLISECONDS (unlike
 * the older log tables' ISO text) because nothing here needs to be range-queried
 * against a reading or a meal.
 */
export const V17_CREATE_REMINDERS = `
  CREATE TABLE IF NOT EXISTS reminders (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('glucose','med','basal','custom')),
    label TEXT,
    time TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );`;

/** The registry is always read whole, in the user's own order - see
 *  lib/db/reminders.ts (listReminders) and applyReminders in
 *  lib/services/notifications.ts, which schedules every row in one pass. */
export const V17_INDEX_REMINDERS_SORT =
  "CREATE INDEX IF NOT EXISTS idx_reminders_sort ON reminders (sort, created_at);";

/** Create-only DDL; applied in order, each statement independently idempotent. */
export const V17_CREATE: string[] = [
  V17_CREATE_REMINDERS,
  V17_INDEX_REMINDERS_SORT,
];
