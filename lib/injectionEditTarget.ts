/**
 * Deep-link into the Injection tab's edit sheet for ONE existing row
 * (toast "Add region" after a meal save, entry-guard "Add region to that
 * entry"). Pure: no router, no db. The sheet edits the row in place
 * (updateInjection), so adding a region never creates a second bolus.
 */

export type InjectionEditParams = {
  editId: string;
  /** Lands on History even when the row is gone. */
  focus: "history";
};

/** Route params for the Injection tab. A null id (row not found when the
 *  toast action ran) still lands on History, just without a sheet. */
export function siteEditParams(rowId: string | null | undefined): InjectionEditParams {
  return { editId: rowId ?? "", focus: "history" };
}

export type EditRequest = { id: string | null };

/** null = these params carry no edit request (plain tab visit or cleared params). */
export function parseEditRequest(params: {
  editId?: string | string[];
  focus?: string | string[];
}): EditRequest | null {
  const raw = Array.isArray(params.editId) ? params.editId[0] : params.editId;
  const focus = Array.isArray(params.focus) ? params.focus[0] : params.focus;
  const id = raw && raw.length > 0 ? raw : null;
  if (id == null && focus !== "history") return null;
  return { id };
}

/** The row to open, or null (deleted, undone, other profile) so the caller
 *  falls back to the History list without a sheet. */
export function pickEditRow<T extends { id: string; profile_id?: string }>(
  id: string | null,
  row: T | null | undefined,
  profileId: string | null | undefined
): T | null {
  if (id == null || !row || row.id !== id) return null;
  if (profileId && row.profile_id && row.profile_id !== profileId) return null;
  return row;
}

/** A row the entry guard may offer "add region to that entry" for: written by
 *  the meal save (calculator) and still without a region. */
export function isRegionlessMealBolus(row: {
  source?: string | null;
  site?: string | null;
  insulin_type?: string | null;
}): boolean {
  return row.source === "calculator" && row.insulin_type === "bolus" && row.site == null;
}

/** What the two-way entry-guard dialog (true = add region to the matched row,
 *  false = save anyway, null = dismissed) means for the pending save. Adding a
 *  region never saves the new form: it opens the matched row's sheet instead. */
export function guardAddSiteOutcome(
  choice: boolean | null,
  matchedId: string
): { save: boolean; openEditId: string | null } {
  if (choice === true) return { save: false, openEditId: matchedId };
  if (choice === false) return { save: true, openEditId: null };
  return { save: false, openEditId: null };
}
