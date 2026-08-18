import { getDb } from "./index";
import { uuid } from "../uuid";
import type { Reminder, ReminderType } from "./types";
import {
  bridgeLegacyReminders,
  type LegacyReminderPrefs,
} from "./remindersBridge";

/**
 * The reminders registry (schema v17, see ./v17Sql): a single table backing
 * every scheduled local reminder the app manages - basal, oral medication,
 * glucose, and any number of user-defined custom ones. Device-level, like
 * lib/services/notificationPrefs.ts (no profile_id): a reminder schedule
 * follows the device owner's own day, not one profile.
 *
 * This file only stores rows and orders them, following the same shape as
 * lib/db/meds.ts and lib/db/mealTemplates.ts. Turning a row into an actual OS
 * notification - permission, the per-profile gates, the identifier scheme -
 * lives in lib/services/notifications.ts (applyReminders).
 */

/** The most reminders a user can keep at once. */
export const MAX_REMINDERS = 10;

export async function listReminders(): Promise<Reminder[]> {
  const db = await getDb();
  return db.getAllAsync<Reminder>(
    "SELECT * FROM reminders ORDER BY sort ASC, created_at ASC;"
  );
}

export async function getReminder(id: string): Promise<Reminder | null> {
  const db = await getDb();
  return db.getFirstAsync<Reminder>(
    "SELECT * FROM reminders WHERE id = ?;",
    [id]
  );
}

export async function countReminders(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ c: number }>(
    "SELECT COUNT(*) AS c FROM reminders;"
  );
  return row?.c ?? 0;
}

/** Whether one more reminder can be added without crossing MAX_REMINDERS. */
export async function canAddReminder(): Promise<boolean> {
  return (await countReminders()) < MAX_REMINDERS;
}

export interface NewReminderInput {
  type: ReminderType;
  label?: string | null;
  time: string;
  /** Defaults to on, matching the column's own DEFAULT 1. */
  enabled?: boolean;
}

/**
 * Adds a reminder at the end of the list. Throws once MAX_REMINDERS is already
 * stored: a full list is a deliberate ceiling the caller has to react to
 * (a disabled "add" button, a message), not a case to fail into silently.
 */
export async function createReminder(
  input: NewReminderInput
): Promise<Reminder> {
  const db = await getDb();
  if ((await countReminders()) >= MAX_REMINDERS) {
    throw new Error(
      `createReminder: limit of ${MAX_REMINDERS} reminders reached`
    );
  }
  const id = uuid();
  const next = await db.getFirstAsync<{ next: number | null }>(
    "SELECT MAX(sort) + 1 AS next FROM reminders;"
  );
  await db.runAsync(
    `INSERT INTO reminders (id, type, label, time, enabled, sort, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?);`,
    [
      id,
      input.type,
      input.label ?? null,
      input.time,
      input.enabled === false ? 0 : 1,
      next?.next ?? 0,
      Date.now(),
    ]
  );
  return (await getReminder(id))!;
}

export interface ReminderUpdate {
  type?: ReminderType;
  label?: string | null;
  time?: string;
  enabled?: boolean;
}

/** Partial update of a reminder. Returns the fresh row, or null if it is gone. */
export async function updateReminder(
  id: string,
  patch: ReminderUpdate
): Promise<Reminder | null> {
  const db = await getDb();
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  if (patch.type !== undefined) {
    fields.push("type = ?");
    values.push(patch.type);
  }
  if (patch.label !== undefined) {
    fields.push("label = ?");
    values.push(patch.label);
  }
  if (patch.time !== undefined) {
    fields.push("time = ?");
    values.push(patch.time);
  }
  if (patch.enabled !== undefined) {
    fields.push("enabled = ?");
    values.push(patch.enabled ? 1 : 0);
  }
  if (fields.length > 0) {
    values.push(id);
    await db.runAsync(
      `UPDATE reminders SET ${fields.join(", ")} WHERE id = ?;`,
      values
    );
  }
  return getReminder(id);
}

/** Deletes a reminder. Its notification is torn down separately (see
 *  applyReminders in lib/services/notifications.ts, which sweeps any
 *  "zerospike-rem-" identifier no longer backed by a row). */
export async function deleteReminder(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM reminders WHERE id = ?;", [id]);
}

/**
 * Writes the user's own arrangement: sort becomes the position in
 * `orderedIds`. One transaction, mirroring reorderTemplates in
 * ./mealTemplates.ts.
 */
export async function reorderReminders(
  orderedIds: readonly string[]
): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < orderedIds.length; i++) {
      await db.runAsync("UPDATE reminders SET sort = ? WHERE id = ?;", [
        i,
        orderedIds[i],
      ]);
    }
  });
}

/**
 * Runs the one-time legacy-prefs bridge (see ./remindersBridge) against the
 * real database. Returns whether THIS call actually seeded the table -
 * lib/services/notifications.ts uses that to know whether the pre-registry
 * fixed-id notifications still need cancelling.
 */
export async function applyLegacyRemindersBridge(
  prefs: LegacyReminderPrefs
): Promise<boolean> {
  const db = await getDb();
  return bridgeLegacyReminders(db, prefs, uuid);
}

/**
 * Creates or updates the registry's single basal row to match a profile
 * setup's choice - app/onboarding.tsx and app/profile-setup.tsx both used to
 * hand this off to the legacy prefs.basal/basalTime bridge instead
 * (applyLegacyRemindersBridge above), which only ever runs ONCE per device: a
 * second profile, or a restarted onboarding attempt after an earlier one
 * already fired the bridge, silently had its basal choice do nothing.
 *
 * `time` is only written into an EXISTING row when `timeTouched` is true: an
 * untouched default must never clobber a time some other profile already set,
 * since the schedule is shared device-wide (no profile_id on this table). A
 * brand new row always gets `time`, touched or not - it has to start somewhere.
 *
 * Returns false only when a new row was needed and MAX_REMINDERS was already
 * reached; the caller decides how to surface that (an existing row is always
 * updated in place, never blocked by the limit).
 */
export async function syncBasalReminderRow(
  showsBasal: boolean,
  time: string,
  timeTouched: boolean
): Promise<boolean> {
  const rows = await listReminders();
  const basalRow = rows.find((r) => r.type === "basal") ?? null;

  if (!showsBasal) {
    if (basalRow && basalRow.enabled === 1) {
      await updateReminder(basalRow.id, { enabled: false });
    }
    return true;
  }

  if (basalRow) {
    await updateReminder(basalRow.id, {
      enabled: true,
      ...(timeTouched ? { time } : {}),
    });
    return true;
  }

  if (rows.length >= MAX_REMINDERS) return false;
  await createReminder({ type: "basal", time, enabled: true });
  return true;
}
