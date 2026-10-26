import { getDb } from "./index";
import { emitInjectionSaved, emitMealSaved } from "./healthRecordHooks";
import { getMealLog } from "./logs";
import { getInjection } from "./injections";
import { planRestoreSteps, type DeletionSnapshot, type Row } from "./undoSql";

export type { DeletionSnapshot, Row, RestoreStep } from "./undoSql";
export { planRestoreSteps } from "./undoSql";

/**
 * Undo support for deletions across the app.
 *
 * A delete is now immediate + undoable (a toast, see lib/feedback.ts for the
 * shared window) instead of a blocking confirm dialog. To make undo faithful, we
 * SNAPSHOT the exact rows a delete would remove BEFORE deleting, then re-insert
 * them verbatim (original ids and all) on undo. Snapshotting raw rows keeps
 * every column - profile_id, source, meal_log_id, tags - so a restored entry is
 * byte-for-byte the one that was removed, and any foreign-key link it carried is
 * preserved.
 *
 * The meal case mirrors deleteMealLog: deleting a meal also removes the bolus row
 * the calculator wrote for it (source = 'calculator'), so undo captures and
 * restores that row too. A reading the user had logged before the meal is never
 * touched by the meal delete, so it is not part of the snapshot.
 *
 * A glucose delete carries a second, indirect casualty: meal_logs.sugar_log_id is
 * ON DELETE SET NULL (see lib/db/index.ts), so any meal that pointed at the
 * reading loses that link the moment the reading is deleted - and re-inserting
 * the reading on undo does not undo the SET NULL. `linkedMealIds` captures which
 * meals to re-link, and restoreDeletion writes the link back AFTER the reading
 * itself exists again (see lib/db/undoSql.ts's planRestoreSteps for the exact
 * order, and scripts/undoDelete.test.ts for the DB-free proof of that order).
 *
 * The plan itself (which tables get which rows, in what order) lives in
 * lib/db/undoSql.ts, dependency-free of expo-sqlite, so it can be exercised by a
 * plain Node test - this module is the thin DB-touching half that runs it.
 */

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
    const [sugar, linkedMeals] = await Promise.all([
      db.getAllAsync<Row>("SELECT * FROM sugar_logs WHERE id = ?;", [id]),
      db.getAllAsync<{ id: string }>("SELECT id FROM meal_logs WHERE sugar_log_id = ?;", [id]),
    ]);
    return { sugar, linkedMealIds: linkedMeals.map((m) => m.id) };
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

/** Re-inserts a captured snapshot verbatim, in the order planRestoreSteps
 *  decides (see that function, in lib/db/undoSql.ts, for why the order matters). */
export async function restoreDeletion(snap: DeletionSnapshot): Promise<void> {
  const db = await getDb();
  for (const step of planRestoreSteps(snap)) {
    if (step.op === "insert") {
      for (const row of step.rows) await insertRow(db, step.table, row);
    } else if (step.op === "restoreMealDoses") {
      // `AND insulin_dose_units = 0`: a dose typed on the meal in the meantime
      // is the user's own and is not overwritten by the restore.
      for (const item of step.items) {
        await db.runAsync(
          "UPDATE meal_logs SET insulin_dose_units = ? WHERE id = ? AND insulin_dose_units = 0;",
          [item.dose, item.mealId]
        );
      }
    } else {
      // `AND sugar_log_id IS NULL`: the ON DELETE SET NULL that ran when the
      // reading was deleted is the only link this restore is undoing. If the
      // meal was re-linked to a DIFFERENT reading in the meantime (a
      // calculator edit, during the undo window), that new link is the
      // user's own doing and must not be overwritten by this restore.
      for (const mealId of step.mealIds) {
        await db.runAsync(
          "UPDATE meal_logs SET sugar_log_id = ? WHERE id = ? AND sugar_log_id IS NULL;",
          [step.sugarLogId, mealId]
        );
      }
    }
  }
  // The rows are already back: a Health mirror failure must not report the
  // restore as failed, since a retry would announce the records a second time.
  try {
    await remirrorRestoredRecords(snap);
  } catch {}
}

/** The restored meal and insulin rows come back with health_uuid NULL (the
 *  delete revoked their samples), so each is announced as a fresh save and the
 *  health mirror writes it again when its switch is on. */
export async function remirrorRestoredRecords(snap: DeletionSnapshot): Promise<void> {
  for (const row of snap.meals ?? []) {
    const meal = await getMealLog(String(row.id));
    if (meal) emitMealSaved(meal, null);
  }
  for (const row of snap.injections ?? []) {
    const injection = await getInjection(String(row.id));
    if (injection) emitInjectionSaved(injection, null);
  }
}

export interface RestoreBatchResult {
  restored: DeletionSnapshot[];
  /** The failing snapshot and everything after it, in original order. */
  failed: DeletionSnapshot[];
  error?: unknown;
}

/**
 * Restores snapshots in order and stops at the first failure, handing back what
 * is still un-restored so the caller can keep it for another attempt. Every
 * insert is INSERT OR REPLACE, so re-running a half-applied snapshot is safe.
 */
export async function restoreBatch(
  snaps: DeletionSnapshot[],
  restore: (snap: DeletionSnapshot) => Promise<void> = restoreDeletion
): Promise<RestoreBatchResult> {
  const restored: DeletionSnapshot[] = [];
  for (let i = 0; i < snaps.length; i++) {
    try {
      await restore(snaps[i]);
    } catch (error) {
      return { restored, failed: snaps.slice(i), error };
    }
    restored.push(snaps[i]);
  }
  return { restored, failed: [] };
}
