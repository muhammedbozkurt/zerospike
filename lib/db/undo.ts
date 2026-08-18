import { getDb } from "./index";

/**
 * Undo support for deletions across the app.
 *
 * A delete is now immediate + undoable (a 6-second toast) instead of a blocking
 * confirm dialog. To make undo faithful, we SNAPSHOT the exact rows a delete
 * would remove BEFORE deleting, then re-insert them verbatim (original ids and
 * all) on undo. Snapshotting raw rows keeps every column - profile_id, source,
 * meal_log_id, tags - so a restored entry is byte-for-byte the one that was
 * removed, and any foreign-key link it carried is preserved.
 *
 * The meal case mirrors deleteMealLog: deleting a meal also removes the bolus row
 * the calculator wrote for it (source = 'calculator'), so undo captures and
 * restores that row too. A reading the user had logged before the meal is never
 * touched by the meal delete, so it is not part of the snapshot.
 */

type Row = Record<string, string | number | null>;

export interface DeletionSnapshot {
  sugar?: Row[];
  meals?: Row[];
  injections?: Row[];
  foods?: Row[];
  /** med_logs rows (schema v16). Named for the table, not for `meals` above. */
  meds?: Row[];
}

async function insertRow(
  db: Awaited<ReturnType<typeof getDb>>,
  table: string,
  row: Row
): Promise<void> {
  const cols = Object.keys(row);
  if (cols.length === 0) return;
  const placeholders = cols.map(() => "?").join(", ");
  await db.runAsync(
    `INSERT OR REPLACE INTO ${table} (${cols.join(", ")}) VALUES (${placeholders});`,
    cols.map((c) => row[c])
  );
}

/** Captures the rows a delete of this journal entry will remove. */
export async function captureDeletion(
  kind: "glucose" | "meal" | "injection" | "med",
  id: string
): Promise<DeletionSnapshot> {
  const db = await getDb();
  if (kind === "glucose") {
    return { sugar: await db.getAllAsync<Row>("SELECT * FROM sugar_logs WHERE id = ?;", [id]) };
  }
  if (kind === "med") {
    return {
      meds: await db.getAllAsync<Row>("SELECT * FROM med_logs WHERE id = ?;", [id]),
    };
  }
  if (kind === "injection") {
    return {
      injections: await db.getAllAsync<Row>(
        "SELECT * FROM injection_logs WHERE id = ?;",
        [id]
      ),
    };
  }
  // meal: the meal row + the calculator bolus deleteMealLog also removes.
  return {
    meals: await db.getAllAsync<Row>("SELECT * FROM meal_logs WHERE id = ?;", [id]),
    injections: await db.getAllAsync<Row>(
      "SELECT * FROM injection_logs WHERE meal_log_id = ? AND source = 'calculator';",
      [id]
    ),
  };
}

/** Captures a custom food row so deleting it from the catalogue is undoable. */
export async function captureFoodDeletion(id: string): Promise<DeletionSnapshot> {
  const db = await getDb();
  return {
    foods: await db.getAllAsync<Row>(
      "SELECT * FROM foods WHERE id = ? AND is_custom = 1;",
      [id]
    ),
  };
}

/**
 * Re-inserts a captured snapshot verbatim. Foods and meals go back before
 * injections so a bolus row's meal_log_id foreign key resolves.
 *
 * ONE column is deliberately not restored: sugar_logs.healthkit_uuid. Deleting a
 * reading revokes its mirrored Apple Health sample, so that UUID names a sample
 * that no longer exists; writing it back left the restored row claiming a mirror
 * it does not have. The reading comes back un-mirrored, which is the truth.
 */
export async function restoreDeletion(snap: DeletionSnapshot): Promise<void> {
  const db = await getDb();
  for (const row of snap.foods ?? []) await insertRow(db, "foods", row);
  for (const row of snap.meals ?? []) await insertRow(db, "meal_logs", row);
  for (const row of snap.sugar ?? []) {
    await insertRow(
      db,
      "sugar_logs",
      "healthkit_uuid" in row ? { ...row, healthkit_uuid: null } : row
    );
  }
  for (const row of snap.injections ?? []) await insertRow(db, "injection_logs", row);
  // Medication rows reference nothing but their profile, so their order in here
  // does not matter; they go last to keep the linked tables above together.
  for (const row of snap.meds ?? []) await insertRow(db, "med_logs", row);
}
