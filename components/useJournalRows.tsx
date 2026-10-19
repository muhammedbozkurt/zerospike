import React, { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { useApp } from "../lib/store/AppContext";
import { mealEditRoute } from "../lib/mealRoute";
import { captureDeletion, type DeletionSnapshot } from "../lib/db/undo";
import {
  applyAfterDeleteFromSnapshot,
  isEmptyAftermath,
  undoAfterDelete,
  type DeletionAftermath,
} from "../lib/afterDelete";
import { deleteMealLog, deleteSugarLog } from "../lib/db/logs";
import { deleteInjection } from "../lib/db/injections";
import { deleteMed } from "../lib/db/meds";
import {
  deleteGlucoseRowFromHealth,
  writeGlucoseToHealthIfEnabled,
  shouldAnnounceHealthWriteFailure,
  HEALTH_NAME,
} from "../lib/services/health";
import { syncLiveData } from "../lib/services/liveData";
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
import type { PeriodTag } from "../lib/db/types";
import { planAftermathReplay } from "../lib/feedback";
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
  /** The row's own swipe-to-delete (components/JournalItem.tsx). Confirms first
   *  (same dialog as the edit sheets' own Delete button), then runs the same
   *  undo-toast delete as everything else. */
  onRowDelete: (entry: JournalEntry) => void;
  /** Deletes with the same undo toast as every other path, but WITHOUT its own
   *  confirm - for a caller whose confirm already ran (the screen's own
   *  GlucoseInputSheet, which asks before calling this). */
  deleteEntry: (entry: JournalEntry) => Promise<void>;
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
  const { actionSheet, confirm, toast } = useFeedback();
  const { entries, onChanged, onEditGlucose } = input;

  const [editInjection, setEditInjection] = useState<InjectionEntry | null>(null);
  const [editMed, setEditMed] = useState<MedEntry | null>(null);

  // D4: the widget/Live Activity/watch snapshot is otherwise only refreshed by
  // the dashboard tab's own effect on `dataVersion`, which freezes while that
  // tab is off screen (freezeOnBlur) - so a delete or undo from the full journal
  // screen left the lock-screen card showing a reading that no longer existed
  // until the user switched tabs back. Every change this hook makes goes
  // through here instead of the caller's raw onChanged.
  const handleChanged = useCallback(() => {
    onChanged();
    if (activeProfile) void syncLiveData(activeProfile.id, activeProfile.glucose_unit);
  }, [onChanged, activeProfile]);

  // H4: undo does not just put the row back - if this profile still has Apple
  // Health write-back on, the reading is re-mirrored and gets a fresh sample,
  // the same as if it had just been logged. writeGlucoseToHealthIfEnabled does
  // its own eligibility check (iOS, opted in, this profile's own scope), so an
  // off toggle or a different profile's scope is a silent no-op here, exactly
  // as it is on the original log path. Non-glucose snapshots (and glucose ones
  // sourced from Health, which never carry a mirror) skip straight through.
  const remirrorRestoredGlucose = useCallback(async (snapshots: DeletionSnapshot[]) => {
    for (const snap of snapshots) {
      for (const row of snap.sugar ?? []) {
        if (row.source === "health") continue;
        const mgdl = Number(row.glucose_level_mgdl);
        const loggedAt = row.logged_at;
        if (!Number.isFinite(mgdl) || typeof loggedAt !== "string") continue;
        try {
          const ok = await writeGlucoseToHealthIfEnabled({
            id: String(row.id),
            profile_id: String(row.profile_id),
            glucose_level_mgdl: mgdl,
            period_tag: (row.period_tag as PeriodTag | null) ?? "unset",
            source: String(row.source ?? "manual"),
            logged_at: loggedAt,
            tags: [],
            healthkit_uuid: null,
          });
          if (!ok && shouldAnnounceHealthWriteFailure()) {
            toast(t("dashboard.healthWriteFailed", { health: HEALTH_NAME }), "info");
          }
        } catch {
          // best-effort re-mirror; the local restore already succeeded either way
        }
      }
    }
  }, [t, toast]);

  // P17: a delete can take down more than rows. A meal that armed the post-meal
  // countdown is the case device QA found - the card kept counting down to a
  // check on a meal the user had just deleted - so the countdown it started
  // ends with it, and a template's usage counters lose the meal they counted
  // (lib/afterDelete.ts owns both decisions, and the entry points here are not
  // its only callers: app/calculator.tsx, app/(tabs)/food.tsx and
  // app/meal-template.tsx run the same pair).
  //
  // Held in a ref rather than folded into the snapshot because none of it is a
  // row: the snapshot is the DB half of an undo and stays purely that.
  //
  // ACCUMULATING, one entry per delete that settled something. It was a single
  // slot at first, on the assumption that at most one delete in a collapsed
  // batch could end a countdown - which is wrong: the batch window is seconds
  // long (lib/feedback.ts) and the user can arm a fresh countdown inside it, so
  // "delete A ends countdown X, user starts Y, delete B ends Y" is reachable
  // and overwriting lost X entirely.
  const postMealUndoRef = useRef<
    { mealIds: string[]; aftermath: DeletionAftermath }[]
  >([]);

  // Deletes that are never undone would otherwise accumulate here for the life
  // of the screen. The batch itself can only ever hold a handful (they collapse
  // inside one toast), so anything past this is abandoned by definition.
  const MAX_PENDING_AFTERMATH = 20;

  // Restore-only side effects, run once after a successful undo: the Apple
  // Health re-mirror above, plus whatever the deletes settled outside the
  // database. Only entries whose OWN meal this undo actually restored are
  // replayed - in a collapsed "N deleted" batch the other rows have nothing to
  // do with them.
  //
  // NEWEST FIRST, which decides the one case where two entries disagree: if the
  // batch ended countdown X and then countdown Y, the state the user last had
  // was Y, so Y is what comes back. X is not armed on top of it - undoAfterDelete
  // sees a countdown running and leaves it alone - so the same countdown is
  // never restored twice and an older one never displaces a newer one. Template
  // counters are absolute prior values, so replaying them oldest-LAST lands on
  // the pair from before the whole batch, which is the correct one.
  //
  // handleChanged runs again afterwards because useUndoBatch already refreshed
  // the screen BEFORE this, i.e. before any of it had been put back.
  const restoreDeleteSideEffects = useCallback(
    async (snapshots: DeletionSnapshot[]) => {
      await remirrorRestoredGlucose(snapshots);
      const pending = postMealUndoRef.current;
      postMealUndoRef.current = [];
      if (pending.length === 0) return;
      const restoredIds = new Set<string>();
      for (const snap of snapshots) {
        for (const row of snap.meals ?? []) restoredIds.add(String(row.id));
      }
      const replay = planAftermathReplay(pending, restoredIds);
      for (const entry of replay) await undoAfterDelete(entry.aftermath);
      if (replay.length > 0) handleChanged();
    },
    [remirrorRestoredGlucose, handleChanged]
  );

  // Delete immediately (no blocking confirm from THIS layer - see
  // confirmAndDelete below for the two entry points that ask first) with an
  // accumulating undo (shared useUndoBatch: consecutive deletes collapse into
  // one "N deleted" toast). Each snapshot restores the entry with every linked
  // row it took with it (a meal's calculator bolus, a glucose reading's linked
  // meal - see captureDeletion).
  const deleteEntryWithUndo = useUndoBatch(handleChanged, restoreDeleteSideEffects);

  const deleteWithUndo = useCallback(
    async (entry: JournalEntry) => {
      const snap = await captureDeletion(entry.kind, entry.id);
      await deleteEntryWithUndo(snap, async () => {
        if (entry.kind === "glucose") {
          // Revoke the mirrored Apple Health sample (best-effort) when the local
          // reading is deleted (undo included - undo re-adds without a mirror,
          // then remirrorRestoredGlucose above re-creates it if eligible). In
          // line behind a write of this reading still in flight, and ahead of
          // the write an undo queues.
          void deleteGlucoseRowFromHealth(entry.id, await deleteSugarLog(entry.id));
        } else if (entry.kind === "injection") await deleteInjection(entry.id);
        else if (entry.kind === "med") await deleteMed(entry.id);
        else await deleteMealLog(entry.id);
        // AFTER the rows are gone: the decision reads which meals are still
        // recorded, and the deleted one must not count as its own survivor.
        // Inside runDelete so it lands before useUndoBatch refreshes the
        // screen, i.e. the dashboard never renders the stale countdown.
        const aftermath = await applyAfterDeleteFromSnapshot(snap);
        if (!isEmptyAftermath(aftermath)) {
          postMealUndoRef.current.push({
            mealIds: (snap.meals ?? []).map((row) => String(row.id)),
            aftermath,
          });
          if (postMealUndoRef.current.length > MAX_PENDING_AFTERMATH) {
            postMealUndoRef.current.shift();
          }
        }
      });
    },
    [deleteEntryWithUndo]
  );

  /** Both new delete entry points (the row's own swipe, and the destructive
   *  button inside each edit sheet's own confirm) share ONE confirmation: a
   *  plain factual question, plus a second line when a glucose reading also
   *  has a mirrored Apple Health sample (journal.deleteHealthNote) - healthkit
   *  copies are not implied by default, so this is the one place that decides
   *  whether the extra line is warranted. Cancelling does nothing at all: the
   *  row (or sheet) stays exactly as it was, nothing is captured or deleted. */
  const confirmAndDelete = useCallback(
    async (entry: JournalEntry) => {
      const hasHealthNote = entry.kind === "glucose" && entry.healthkit_uuid != null;
      const ok = await confirm({
        message: hasHealthNote
          ? `${t("journal.deleteEntry")}\n\n${t("journal.deleteHealthNote", { health: HEALTH_NAME })}`
          : t("journal.deleteEntry"),
        confirmLabel: t("common.delete"),
        cancelLabel: t("common.cancel"),
        destructive: true,
        icon: "trash-outline",
      });
      if (!ok) return;
      await deleteWithUndo(entry);
    },
    [confirm, t, deleteWithUndo]
  );

  /** Tap = correct the entry, each kind through its own edit flow. */
  const openEdit = useCallback(
    (entry: JournalEntry) => {
      if (entry.kind === "meal") {
        router.push(mealEditRoute(entry));
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

  // Behind a ref so the four row callbacks keep ONE identity for the life of
  // the screen: they are handed to a memoized JournalItem, and a new identity
  // on every render re-renders every visible row (photos included).
  const actionsRef = useRef({ openEdit, onEntryLongPress, openMealResponse, confirmAndDelete });
  actionsRef.current = { openEdit, onEntryLongPress, openMealResponse, confirmAndDelete };
  const onRowPress = useCallback((e: JournalEntry) => actionsRef.current.openEdit(e), []);
  const onRowLongPress = useCallback(
    (e: JournalEntry) => actionsRef.current.onEntryLongPress(e),
    []
  );
  const onRowOpenResponse = useCallback(
    (e: JournalEntry) => actionsRef.current.openMealResponse(e),
    []
  );
  const onRowDelete = useCallback((e: JournalEntry) => {
    void actionsRef.current.confirmAndDelete(e);
  }, []);

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
        onDelete={() => {
          // The sheet's own confirm (same dialog, no health note for an
          // injection) already ran before this fires.
          const target = editInjection;
          setEditInjection(null);
          if (target) void deleteWithUndo(target);
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
        onDelete={() => {
          const target = editMed;
          setEditMed(null);
          if (target) void deleteWithUndo(target);
        }}
      />
    </>
  );

  return {
    onRowPress,
    onRowLongPress,
    onRowOpenResponse,
    onRowDelete,
    deleteEntry: deleteWithUndo,
    mealResponseIds,
    sheets,
  };
}
