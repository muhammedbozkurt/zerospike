/**
 * The pure planning half of lib/db/undo.ts, kept dependency-free (no expo-sqlite
 * import) so scripts/undoDelete.test.ts can call planRestoreSteps directly - the
 * same arrangement as journalSql.ts and healthImportSql.ts.
 */

export type Row = Record<string, string | number | null>;

export interface DeletionSnapshot {
  sugar?: Row[];
  meals?: Row[];
  injections?: Row[];
  foods?: Row[];
  /** med_logs rows (schema v16). Named for the table, not for `meals` above. */
  meds?: Row[];
  /** meal_logs ids whose sugar_log_id pointed at the deleted reading (glucose
   *  deletes only, see captureDeletion in lib/db/undo.ts). Empty/undefined for
   *  every other kind. */
  linkedMealIds?: string[];
}

/**
 * One step of a restore, in the order it must run. Pure data - no db access -
 * so the ORDER a restore executes in is testable without a database (see
 * scripts/undoDelete.test.ts).
 */
export type RestoreStep =
  | { op: "insert"; table: "foods" | "meal_logs" | "sugar_logs" | "injection_logs" | "med_logs"; rows: Row[] }
  | { op: "relinkMealsToSugar"; sugarLogId: string; mealIds: string[] };

/**
 * ONE column is deliberately stripped before a sugar_logs row goes back:
 * healthkit_uuid. Deleting a reading revokes its mirrored Apple Health sample,
 * so that UUID names a sample that no longer exists; writing it back would leave
 * the restored row claiming a mirror it does not have. The reading comes back
 * un-mirrored (the truth), and useJournalRows.tsx re-mirrors it fresh when the
 * profile's Health write-back is on (H4 in the 2.3.1 delete audit) - that call
 * belongs there, not in lib/db/undo.ts: this module is a pure DB layer and never
 * imports the RN Health service.
 */
function stripHealthUuid(row: Row): Row {
  return "healthkit_uuid" in row ? { ...row, healthkit_uuid: null } : row;
}

/**
 * The pure plan behind restoreDeletion: which tables get which rows back, and in
 * what order. Foods and meals go back before injections so a bolus row's
 * meal_log_id foreign key resolves; the reading itself goes back before its
 * meal-link relink step, which is the one ordering restoreDeletion cannot get
 * wrong (D1 in the 2.3.1 delete audit) - relinking a meal to a reading that is
 * not in the table yet would target a row that does not exist.
 */
export function planRestoreSteps(snap: DeletionSnapshot): RestoreStep[] {
  const steps: RestoreStep[] = [];
  if (snap.foods && snap.foods.length > 0) steps.push({ op: "insert", table: "foods", rows: snap.foods });
  if (snap.meals && snap.meals.length > 0) steps.push({ op: "insert", table: "meal_logs", rows: snap.meals });
  if (snap.sugar && snap.sugar.length > 0) {
    steps.push({ op: "insert", table: "sugar_logs", rows: snap.sugar.map(stripHealthUuid) });
  }
  const sugarLogId = snap.sugar?.[0]?.id;
  if (snap.linkedMealIds && snap.linkedMealIds.length > 0 && sugarLogId != null) {
    steps.push({
      op: "relinkMealsToSugar",
      sugarLogId: String(sugarLogId),
      mealIds: snap.linkedMealIds,
    });
  }
  if (snap.injections && snap.injections.length > 0) {
    steps.push({ op: "insert", table: "injection_logs", rows: snap.injections });
  }
  // Medication rows reference nothing but their profile, so their order in here
  // does not matter; they go last to keep the linked tables above together.
  if (snap.meds && snap.meds.length > 0) steps.push({ op: "insert", table: "med_logs", rows: snap.meds });
  return steps;
}

/** A meal row that a delete removed, reduced to the three facts anything
 *  downstream of the delete needs: which meal, whose, and when it happened. */
export interface DeletedMeal {
  id: string;
  /** meal_logs.profile_id, or null on a row that somehow carries none. */
  profileId: string | null;
  /** meal_logs.logged_at parsed to epoch ms. */
  loggedAtMs: number;
  /** meal_logs.meal_template_id: the template this meal was logged from, whose
   *  usage counters were bumped for it (touchTemplate) and now have one meal
   *  fewer to count. Null for a meal that came from no template. */
  templateId: string | null;
}

/**
 * The meals a snapshot says were removed, for the side effects a delete has to
 * settle OUTSIDE the database (lib/afterDelete.ts). Pure and here rather than
 * there so it is covered by the same DB-free test as the restore plan.
 *
 * Only `meals` counts. A GLUCOSE delete's snapshot carries `linkedMealIds` -
 * meals that merely lost a link to the reading - and those rows are still in
 * the table, so they are deliberately not deleted meals.
 *
 * A row whose logged_at will not parse is dropped rather than passed on as
 * NaN: a moment that cannot be read cannot be compared to a countdown's anchor,
 * and guessing one would risk ending a timer that has nothing to do with it.
 */
export function deletedMealsFromSnapshot(snap: DeletionSnapshot): DeletedMeal[] {
  const out: DeletedMeal[] = [];
  for (const row of snap.meals ?? []) {
    if (row.id == null) continue;
    const loggedAtMs = Date.parse(String(row.logged_at ?? ""));
    if (!Number.isFinite(loggedAtMs)) continue;
    out.push({
      id: String(row.id),
      profileId: row.profile_id == null ? null : String(row.profile_id),
      loggedAtMs,
      templateId: row.meal_template_id == null ? null : String(row.meal_template_id),
    });
  }
  return out;
}
