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
  /** A deleted food's dependants (captureFoodDeletion): the favorite and portion
   *  rows its ON DELETE CASCADE removes, and the meals its ON DELETE SET NULL
   *  unlinked, so undo can put every one of them back. */
  favorites?: Row[];
  portions?: Row[];
  foodMeals?: FoodMealLink[];
  /** meal_template_items ids whose food_id the delete set to NULL. */
  templateItemIds?: string[];
}

/** One meal that pointed at a deleted food. `original` is its custom_food_name
 *  before the delete, `current` the name the delete left on it (the food's own
 *  name when it had none, so the meal keeps a label once food_id is gone). */
export interface FoodMealLink {
  mealId: string;
  original: string | null;
  current: string | null;
}

/**
 * One step of a restore, in the order it must run. Pure data - no db access -
 * so the ORDER a restore executes in is testable without a database (see
 * scripts/undoDelete.test.ts).
 */
export type RestoreStep =
  | {
      op: "insert";
      table: "foods" | "food_portions" | "favorites" | "meal_logs" | "sugar_logs" | "injection_logs" | "med_logs";
      rows: Row[];
    }
  | { op: "clearHealthTombstones"; items: { profileId: string; loggedAt: string; mgdl: number }[] }
  | { op: "relinkMealsToFood"; foodId: string; items: FoodMealLink[] }
  | { op: "relinkTemplateItems"; foodId: string; itemIds: string[] }
  | { op: "relinkMealsToSugar"; sugarLogId: string; mealIds: string[] }
  | { op: "restoreMealDoses"; items: { mealId: string; dose: number }[] };

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

/** Same reasoning for meal_logs / injection_logs.health_uuid: the delete
 *  revoked that sample, so the row returns unlinked and is re-mirrored. */
function stripRecordUuid(row: Row): Row {
  return "health_uuid" in row ? { ...row, health_uuid: null } : row;
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
  // Dependants of a food come back right after it: their foreign keys point at it.
  if (snap.portions && snap.portions.length > 0) steps.push({ op: "insert", table: "food_portions", rows: snap.portions });
  if (snap.favorites && snap.favorites.length > 0) steps.push({ op: "insert", table: "favorites", rows: snap.favorites });
  const foodId = snap.foods?.[0]?.id;
  if (snap.foodMeals && snap.foodMeals.length > 0 && foodId != null) {
    steps.push({ op: "relinkMealsToFood", foodId: String(foodId), items: snap.foodMeals });
  }
  if (snap.templateItemIds && snap.templateItemIds.length > 0 && foodId != null) {
    steps.push({ op: "relinkTemplateItems", foodId: String(foodId), itemIds: snap.templateItemIds });
  }
  if (snap.meals && snap.meals.length > 0) steps.push({ op: "insert", table: "meal_logs", rows: snap.meals.map(stripRecordUuid) });
  if (snap.sugar && snap.sugar.length > 0) {
    steps.push({ op: "insert", table: "sugar_logs", rows: snap.sugar.map(stripHealthUuid) });
  }
  // Deleting an imported reading wrote a tombstone (schema v28) that keeps the
  // import from bringing it back. Restoring the row retires that tombstone, or a
  // later source-side re-write of the sample would be refused for good.
  const tombstones: { profileId: string; loggedAt: string; mgdl: number }[] = [];
  for (const row of snap.sugar ?? []) {
    const mgdl = Number(row.glucose_level_mgdl);
    if (row.source === "health" && row.profile_id != null && row.logged_at != null && Number.isFinite(mgdl)) {
      tombstones.push({ profileId: String(row.profile_id), loggedAt: String(row.logged_at), mgdl });
    }
  }
  if (tombstones.length > 0) steps.push({ op: "clearHealthTombstones", items: tombstones });
  const sugarLogId = snap.sugar?.[0]?.id;
  if (snap.linkedMealIds && snap.linkedMealIds.length > 0 && sugarLogId != null) {
    steps.push({
      op: "relinkMealsToSugar",
      sugarLogId: String(sugarLogId),
      mealIds: snap.linkedMealIds,
    });
  }
  if (snap.injections && snap.injections.length > 0) {
    steps.push({ op: "insert", table: "injection_logs", rows: snap.injections.map(stripRecordUuid) });
  }
  // Deleting a calculator bolus zeroes its meal's dose (deleteInjection), so
  // taking the delete back returns the dose too. A meal snapshot restores the
  // meal row verbatim and needs none of this.
  if (!snap.meals || snap.meals.length === 0) {
    const items: { mealId: string; dose: number }[] = [];
    for (const row of snap.injections ?? []) {
      const dose = Number(row.dose_units);
      if (
        row.source === "calculator" &&
        row.insulin_type === "bolus" &&
        row.meal_log_id != null &&
        Number.isFinite(dose) &&
        dose > 0
      ) {
        items.push({ mealId: String(row.meal_log_id), dose });
      }
    }
    if (items.length > 0) steps.push({ op: "restoreMealDoses", items });
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
