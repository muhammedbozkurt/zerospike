import { getDb } from "./index";
import { uuid } from "../uuid";
import type { MedLog } from "./types";
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
