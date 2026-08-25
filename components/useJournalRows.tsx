import React, { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { useApp } from "../lib/store/AppContext";
import { captureDeletion } from "../lib/db/undo";
import { deleteMealLog, deleteSugarLog } from "../lib/db/logs";
import { deleteInjection } from "../lib/db/injections";
import { deleteMed } from "../lib/db/meds";
import { deleteGlucoseFromHealth } from "../lib/services/health";
import { mealIdsWithResponse } from "../lib/mealResponse";
import { mealSlotForHour } from "../lib/insulin";
import { formatDateKey } from "../lib/format";
import type {
  GlucoseEntry,
  InjectionEntry,
  JournalEntry,
  MealEntry,
  MedEntry,
} from "../lib/db/journal";
import { useFeedback, type SheetAction } from "./Feedback";
import { useUndoBatch } from "./useUndoBatch";
import { InjectionEditSheet } from "./InjectionEditSheet";
import { MedEditSheet } from "./MedEditSheet";

/**
 * Everything a journal ROW can do, in one place: tap to correct it, press and
 * hold for the edit/delete menu, delete with an undo toast, and the additive
 * chevron that opens a meal's response.
 *
 * It exists because the journal is now drawn on TWO screens - the dashboard's
 * preview and the full app/journal.tsx - and every one of these behaviours has
 * to be identical on both. Copying them would mean a fix to the delete undo, or
 * to which kinds are editable, landing on one screen and not the other.
 *
 * The two edit sheets it owns come back as `sheets`, which the caller renders wherever
 * its own overlays live: they are driven by state that belongs to this hook, so
 * handing back only the callbacks would leave the caller unable to show them.
 */
export interface JournalRowsApi {
  /** Stable across renders, so React.memo on JournalItem actually holds. */
  onRowPress: (entry: JournalEntry) => void;
  onRowLongPress: (entry: JournalEntry) => void;
  onRowOpenResponse: (entry: JournalEntry) => void;
  /** Meal ids that have a computable response, for the row's chevron. */
  mealResponseIds: Set<string>;
  /** Render inside the screen, next to its other sheets. */
  sheets: React.ReactNode;
}

export function useJournalRows(input: {
  /** The feed the response set is computed from. On the dashboard this is the
   *  full stats feed, which is wider than the rendered list. */
  entries: JournalEntry[];
  /** Re-read after an edit sheet saves. */
  onChanged: () => void;
  /** Opens the screen's OWN glucose sheet on this row (see openEdit). */
  onEditGlucose: (entry: GlucoseEntry) => void;
}): JournalRowsApi {
  const { t } = useTranslation();
  const router = useRouter();
  const { activeProfile, bumpData } = useApp();
  const { actionSheet } = useFeedback();
  const { entries, onChanged, onEditGlucose } = input;

  const [editInjection, setEditInjection] = useState<InjectionEntry | null>(null);
  const [editMed, setEditMed] = useState<MedEntry | null>(null);

  // Delete immediately (no blocking confirm) with a 6-second, accumulating undo
  // (shared useUndoBatch: consecutive deletes collapse into one "N deleted"
  // toast). Each snapshot restores the entry with every linked row it took with
  // it (a meal's calculator bolus, etc. - see captureDeletion).
  const deleteEntryWithUndo = useUndoBatch(bumpData);

  const deleteWithUndo = useCallback(
    async (entry: JournalEntry) => {
      const snap = await captureDeletion(entry.kind, entry.id);
      await deleteEntryWithUndo(snap, async () => {
        if (entry.kind === "glucose") {
          // Revoke the mirrored Apple Health sample (best-effort) when the local
          // reading is deleted (undo included - undo re-adds without a mirror).
          void deleteGlucoseFromHealth(await deleteSugarLog(entry.id));
        } else if (entry.kind === "injection") await deleteInjection(entry.id);
        else if (entry.kind === "med") await deleteMed(entry.id);
        else await deleteMealLog(entry.id);
      });
    },
    [deleteEntryWithUndo]
  );

  /** Tap = correct the entry, each kind through its own edit flow. */
  const openEdit = useCallback(
    (entry: JournalEntry) => {
      if (entry.kind === "meal") {
        router.push({ pathname: "/calculator", params: { mealLogId: entry.id } });
      } else if (entry.kind === "glucose") {
        // Owned by the screen: the dashboard reuses the same sheet instance it
        // logs NEW readings with, so the hook cannot hold that state itself.
        // The correction they both perform is shared instead, in
        // lib/services/glucoseEdit.ts.
        onEditGlucose(entry);
      } else if (entry.kind === "injection") {
        setEditInjection(entry);
      } else if (entry.kind === "med") {
        setEditMed(entry);
      }
    },
    [router, onEditGlucose]
  );

  const openMealResponse = useCallback(
    (entry: JournalEntry) => {
      router.push({ pathname: "/meal-response", params: { mealId: entry.id } });
    },
    [router]
  );

  // Long press = edit/delete menu (the built-in cancel row closes it). A meal row
  // also offers "make a template out of this": the whole day+slot bucket it
  // belongs to becomes the items (groupMealsBySlot, resolved on the editor).
  const onEntryLongPress = useCallback(
    (entry: JournalEntry) => {
      const actions: SheetAction[] = [];
      actions.push({
        label: t("common.edit"),
        icon: "create-outline",
        onPress: () => openEdit(entry),
      });
      if (entry.kind === "meal") {
        actions.push({
          label: t("templates.fromMeal"),
          icon: "bookmark-outline",
          onPress: () =>
            router.push({
              pathname: "/meal-template",
              params: {
                fromDay: formatDateKey(entry.logged_at),
                fromSlot: mealSlotForHour(new Date(entry.logged_at).getHours()),
              },
            }),
        });
      }
      actions.push({
        label: t("common.delete"),
        icon: "trash-outline",
        destructive: true,
        onPress: () => {
          void deleteWithUndo(entry);
        },
      });
      actionSheet({ actions });
    },
    [t, openEdit, router, deleteWithUndo, actionSheet]
  );

  // Meal rows with a computable response (lib/mealResponse.ts) get a small
  // additive chevron (JournalItem) that opens it instead of the edit flow.
  // Recomputed from the already-loaded feed, no extra query.
  //
  // One pass, via mealIdsWithResponse: running the full response builder per
  // meal re-filtered every reading and re-parsed its timestamp for each one, so
  // a feed with 60 meals and 200 readings did 12 000 Date constructions to
  // decide which rows get an icon.
  const mealResponseIds = useMemo(() => {
    if (!activeProfile) return new Set<string>();
    const readings: GlucoseEntry[] = [];
    const meals: MealEntry[] = [];
    for (const e of entries) {
      if (e.kind === "glucose") readings.push(e);
      else if (e.kind === "meal") meals.push(e);
    }
    return mealIdsWithResponse(meals, readings);
  }, [entries, activeProfile]);

  // Behind a ref so the three row callbacks keep ONE identity for the life of
  // the screen: they are handed to a memoized JournalItem, and a new identity
  // on every render re-renders every visible row (photos included).
  const actionsRef = useRef({ openEdit, onEntryLongPress, openMealResponse });
  actionsRef.current = { openEdit, onEntryLongPress, openMealResponse };
  const onRowPress = useCallback((e: JournalEntry) => actionsRef.current.openEdit(e), []);
  const onRowLongPress = useCallback(
    (e: JournalEntry) => actionsRef.current.onEntryLongPress(e),
    []
  );
  const onRowOpenResponse = useCallback(
    (e: JournalEntry) => actionsRef.current.openMealResponse(e),
    []
  );

  const sheets = (
    <>
      <InjectionEditSheet
        visible={editInjection != null}
        injection={editInjection}
        onClose={() => setEditInjection(null)}
        onSaved={() => {
          setEditInjection(null);
          onChanged();
        }}
      />
      <MedEditSheet
        visible={editMed != null}
        med={editMed}
        onClose={() => setEditMed(null)}
        onSaved={() => {
          setEditMed(null);
          onChanged();
        }}
      />
    </>
  );

  return { onRowPress, onRowLongPress, onRowOpenResponse, mealResponseIds, sheets };
}
