import { deleteSugarLog } from "../db/logs";
import { deleteGlucoseRowFromHealth } from "./health";

/**
 * "Undo" on the saved-reading toast: removes the reading just logged and
 * revokes its mirrored Apple Health / Health Connect sample, in line behind a
 * write of it that may still be in flight (the same call the journal delete
 * makes). Nothing else needs reversing: a reading carries no stock, pen or
 * summary table of its own, and the daily figures are recomputed from the rows
 * on the next bumpData().
 */
export async function undoNewGlucose(id: string): Promise<void> {
  await deleteGlucoseRowFromHealth(id, await deleteSugarLog(id));
}
