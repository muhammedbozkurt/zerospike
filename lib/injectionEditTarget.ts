/**
 * Deep-link into the Injection tab's edit sheet for ONE existing row
 * (toast "Add region" after a meal save, entry-guard "Add region to that
 * entry"). Pure: no router, no db, no React; every effect is injected so the
 * flow is testable with fakes. The sheet edits the row in place
 * (updateInjection), so adding a region never creates a second bolus.
 */

import type { InjectionSite, SitePoint } from "./db/types";

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

/** The row to open, or null (deleted, undone, other profile, no active profile)
 *  so the caller falls back to the History list without a sheet. */
export function pickEditRow<T extends { id: string; profile_id?: string }>(
  id: string | null,
  row: T | null | undefined,
  profileId: string | null | undefined
): T | null {
  if (id == null || !row || row.id !== id) return null;
  if (!profileId || (row.profile_id && row.profile_id !== profileId)) return null;
  return row;
}

/** Reads ONE row and applies pickEditRow; a failing read is the same as a
 *  missing row (History only), reported through onError. */
export async function loadEditRow<T extends { id: string; profile_id?: string }>(deps: {
  id: string;
  profileId: string | null | undefined;
  fetchRow: (id: string) => Promise<T | null | undefined>;
  onError?: (err: unknown) => void;
}): Promise<T | null> {
  try {
    return pickEditRow(deps.id, await deps.fetchRow(deps.id), deps.profileId);
  } catch (err) {
    deps.onError?.(err);
    return null;
  }
}

/** Region chosen on the save form, carried into the sheet as its starting value. */
export type SitePreset = { site: InjectionSite; point: SitePoint | null };

/** What the Injection tab does with an incoming route request. Clears the
 *  params first so a later plain visit does not reopen the sheet. */
export function handleEditRequest(
  params: { editId?: string | string[]; focus?: string | string[] },
  deps: {
    showHistory: () => void;
    clearParams: () => void;
    openEdit: (id: string) => void;
  }
): boolean {
  const req = parseEditRequest(params);
  if (!req) return false;
  deps.showHistory();
  deps.clearParams();
  if (req.id) deps.openEdit(req.id);
  return true;
}

/** Same window as the double-bolus nudge (DOUBLE_BOLUS_WINDOW_MINUTES in
 *  lib/db/injections.ts, pinned equal by scripts/injectionSiteEdit.test.ts;
 *  that module cannot be imported here, it needs the sqlite runtime). */
export const ADD_SITE_WINDOW_MINUTES = 15;

/** A meal-save bolus (calculator) that still has no region. */
export function isRegionlessMealBolus(row: {
  source?: string | null;
  site?: string | null;
  insulin_type?: string | null;
}): boolean {
  return row.source === "calculator" && row.insulin_type === "bolus" && row.site == null;
}

/**
 * "Add region to that entry" is only a fair offer when the new form entry IS
 * that entry typed again: a region-less meal bolus, within the double-bolus
 * window, with the SAME dose. A different dose (a correction) must be saved as
 * its own row, or the dose would silently go unrecorded.
 */
export function offerAddSiteToRow(opts: {
  row: { source?: string | null; site?: string | null; insulin_type?: string | null; dose_units: number | null };
  rowAtMs: number;
  entryAtMs: number;
  doseUnits: number | null | undefined;
}): boolean {
  if (!isRegionlessMealBolus(opts.row)) return false;
  if (opts.doseUnits == null || opts.row.dose_units == null) return false;
  if (Math.abs(opts.row.dose_units - opts.doseUnits) > 1e-9) return false;
  return Math.abs(opts.entryAtMs - opts.rowAtMs) <= ADD_SITE_WINDOW_MINUTES * 60_000;
}

export type GuardAddSiteChoice = "addSite" | "save" | "cancel";

/** What the three-way entry-guard dialog means for the pending save. Adding a
 *  region never saves the new form: it opens the matched row's sheet instead. */
export function guardAddSiteOutcome(
  choice: GuardAddSiteChoice,
  matchedId: string
): { save: boolean; openEditId: string | null } {
  if (choice === "addSite") return { save: false, openEditId: matchedId };
  if (choice === "save") return { save: true, openEditId: null };
  return { save: false, openEditId: null };
}

/** The toast action for a region-less meal bolus: opens the row's edit route.
 *  Looks the row up, never writes one. */
export function noSiteToastAction(deps: {
  label: string;
  lookupRowId: () => Promise<string | null>;
  navigate: (params: InjectionEditParams) => void;
  onError?: (err: unknown) => void;
  secondary?: { label: string; onPress: () => void | Promise<void> };
}): {
  label: string;
  onPress: () => void;
  secondary?: { label: string; onPress: () => void | Promise<void> };
} {
  return {
    label: deps.label,
    onPress: () => {
      void (async () => {
        let rowId: string | null = null;
        try {
          rowId = await deps.lookupRowId();
        } catch (err) {
          deps.onError?.(err);
        }
        deps.navigate(siteEditParams(rowId));
      })();
    },
    ...(deps.secondary ? { secondary: deps.secondary } : {}),
  };
}

/** Entry-guard dialog flow with the UI injected (components/useEntryGuardConfirm.tsx
 *  supplies the real dialogs). Returns whether the pending save may go ahead. */
export async function runGuardDialog(deps: {
  hasNotices: boolean;
  addSiteId: string | undefined;
  onAddSite?: (injectionId: string) => void;
  confirmSave: () => Promise<boolean>;
  chooseAddSite: () => Promise<GuardAddSiteChoice>;
}): Promise<boolean> {
  if (!deps.hasNotices) return true;
  if (deps.addSiteId && deps.onAddSite) {
    const outcome = guardAddSiteOutcome(await deps.chooseAddSite(), deps.addSiteId);
    if (outcome.openEditId) deps.onAddSite(outcome.openEditId);
    return outcome.save;
  }
  return deps.confirmSave();
}
