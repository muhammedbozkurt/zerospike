import { getDb } from "./index";
import { uuid } from "../uuid";
import type { MedLog, SavedMed } from "./types";
import type { DateRange } from "../insights";

/**
 * Oral medication logging (schema v16).
 *
 * Tracking only, and deliberately thin: a row says that the user took something
 * and when. Nothing here suggests, reminds, doses or schedules, and no other
 * calculation in the app reads these rows - active insulin, the carb ratios and
 * every metric stay exactly what they were.
 *
 * Times are epoch MILLISECONDS here (med_logs.taken_at is an INTEGER column, see
 * ./v16Sql), not the ISO strings the older log tables use. The journal feed is
 * where the two meet: it converts taken_at into the same ISO instant the other
 * kinds carry, so one ordered union still sorts (./journalSql).
 */

export interface NewMedInput {
  profileId: string;
  /** When the medication was taken, epoch ms. Separate from created_at, so a
   *  backdated entry records the time it happened, not the time it was typed. */
  takenAt: number;
  name?: string | null;
  note?: string | null;
}

/** Records one oral medication entry. */
export async function logMed(input: NewMedInput): Promise<MedLog> {
  const db = await getDb();
  const id = uuid();

  await db.runAsync(
    `INSERT INTO med_logs (id, profile_id, taken_at, name, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?);`,
    [
      id,
      input.profileId,
      input.takenAt,
      input.name ?? null,
      input.note ?? null,
      Date.now(),
    ]
  );

  return (await db.getFirstAsync<MedLog>(
    "SELECT * FROM med_logs WHERE id = ?;",
    [id]
  ))!;
}

/**
 * A profile's medication entries, newest first. The optional span is applied in
 * SQL for the same reason it is everywhere else in this layer: a report of an old
 * range must be complete rather than whatever fits inside the newest `limit` rows.
 *
 * The bounds are bound as NUMBERS, because taken_at is an INTEGER column - an ISO
 * string would compare as text against integers and match nothing at all.
 */
export async function listMeds(
  profileId: string,
  range?: DateRange,
  limit = 500
): Promise<MedLog[]> {
  const db = await getDb();
  const bounds = range
    ? { sql: " AND taken_at BETWEEN ? AND ?", values: [range.start, range.end] }
    : { sql: "", values: [] as number[] };
  return db.getAllAsync<MedLog>(
    `SELECT * FROM med_logs WHERE profile_id = ?${bounds.sql}
      ORDER BY taken_at DESC LIMIT ?;`,
    [profileId, ...bounds.values, limit]
  );
}

export async function getMed(id: string): Promise<MedLog | null> {
  const db = await getDb();
  return db.getFirstAsync<MedLog>("SELECT * FROM med_logs WHERE id = ?;", [id]);
}

export async function deleteMed(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM med_logs WHERE id = ?;", [id]);
}

export type MedUpdate = Partial<Pick<MedLog, "taken_at" | "name" | "note">>;

/** Partial update of a medication entry. Returns the fresh row, or null if gone.
 *  created_at is not patchable: it records when the row was written. */
export async function updateMed(
  id: string,
  patch: MedUpdate
): Promise<MedLog | null> {
  const db = await getDb();
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    fields.push(`${key} = ?`);
    values.push(value as string | number | null);
  }
  if (fields.length > 0) {
    await db.runAsync(`UPDATE med_logs SET ${fields.join(", ")} WHERE id = ?;`, [
      ...values,
      id,
    ]);
  }
  return getMed(id);
}

/* ── Saved medication names (schema v18) ───────────────────────────────────
 *
 * A per-profile "my medications" list: names the user has already typed once
 * into the form above, most-recently-used first, so a repeat entry is a tap
 * instead of retyping (components/QuickAddSheet.tsx, components/MedEditSheet.tsx,
 * app/settings/medications.tsx). Backed by the "meds" table (schema v18, see
 * ./v18Sql), which is COMPLETELY SEPARATE from med_logs above: renaming or
 * deleting a saved name here never rewrites or deletes a single past diary
 * entry - see renameMed/deleteSavedMed below.
 *
 * Named distinctly from the med_logs functions above (listSavedMeds /
 * deleteSavedMed rather than listMeds / deleteMed) so importing both sections
 * in the same file - the medication form needs to log an entry AND remember
 * its name - never collides.
 */

export async function listSavedMeds(profileId: string): Promise<SavedMed[]> {
  const db = await getDb();
  return db.getAllAsync<SavedMed>(
    "SELECT * FROM meds WHERE profile_id = ? ORDER BY last_used_at DESC;",
    [profileId]
  );
}

export async function getSavedMed(id: string): Promise<SavedMed | null> {
  const db = await getDb();
  return db.getFirstAsync<SavedMed>("SELECT * FROM meds WHERE id = ?;", [id]);
}

/**
 * Records that `name` was just used: saves it if the profile has never saved
 * it before, or just bumps last_used_at (the sort key listSavedMeds reads) if
 * it has. Called after every medication entry is logged or edited - see
 * components/QuickAddSheet.tsx and components/MedEditSheet.tsx. A blank name
 * is a no-op: there is nothing worth remembering as a shortcut.
 *
 * `at` defaults to now, but the callers above always pass the entry's own
 * taken_at instead - a backdated entry should sort the saved name by when it
 * was actually taken, the same value the schema v18 migration seeds
 * last_used_at from (see V18_SEED_FROM_MED_LOGS in ./v18Sql).
 */
export async function upsertMedUse(
  profileId: string,
  name: string,
  at: number = Date.now()
): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  const db = await getDb();
  const existing = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM meds WHERE profile_id = ? AND name = ?;",
    [profileId, trimmed]
  );
  if (existing) {
    await db.runAsync("UPDATE meds SET last_used_at = ? WHERE id = ?;", [
      at,
      existing.id,
    ]);
    return;
  }
  await db.runAsync(
    `INSERT INTO meds (id, profile_id, name, last_used_at, created_at)
     VALUES (?, ?, ?, ?, ?);`,
    [uuid(), profileId, trimmed, at, at]
  );
}

/**
 * Renames a saved medication (app/settings/medications.tsx). Returns the
 * fresh row, or null if it is gone. A blank name is rejected (returns the
 * row unchanged) rather than saving an empty shortcut. Past med_logs entries
 * keep whatever name they were written with - this only relabels the
 * shortcut, never rewrites history.
 *
 * Can throw on the table's own UNIQUE(profile_id, name) constraint if the new
 * name collides with another saved medication of the same profile; the
 * caller is expected to catch that and tell the user (see
 * app/settings/medications.tsx).
 */
export async function renameMed(id: string, name: string): Promise<SavedMed | null> {
  const trimmed = name.trim();
  if (!trimmed) return getSavedMed(id);
  const db = await getDb();
  await db.runAsync("UPDATE meds SET name = ? WHERE id = ?;", [trimmed, id]);
  return getSavedMed(id);
}

/** Removes a saved medication from the list (app/settings/medications.tsx).
 *  Past med_logs entries that used its name are untouched - deleting a
 *  shortcut is not deleting history. */
export async function deleteSavedMed(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM meds WHERE id = ?;", [id]);
}
