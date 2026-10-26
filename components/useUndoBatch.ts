import { useEffect, useRef } from "react";
import { AccessibilityInfo } from "react-native";
import { useTranslation } from "react-i18next";

import { useFeedback } from "./Feedback";
import { restoreBatch, type DeletionSnapshot } from "../lib/db/undo";
import { logCrash } from "../lib/analytics";
import { hapticSuccess, hapticWarning } from "../lib/haptics";
import {
  shouldRestoreBatch,
  UNDO_TOAST_MS,
  UNDO_TOAST_SCREEN_READER_MS,
  undoBatchWindowMs,
} from "../lib/feedback";

/**
 * Accumulating delete + undo, shared by every delete surface (dashboard journal,
 * injection history, custom foods).
 *
 * A single delete shows "Entry deleted" with an undo. Consecutive deletes inside
 * that window COLLAPSE into one toast ("N entries deleted") whose single undo
 * restores them all - so a second delete never buries the first entry's undo.
 * The batch window (undoBatchWindowMs, lib/feedback.ts) matches the toast's own
 * visible duration plus a small safety margin, and both read the SAME constants
 * Feedback.tsx uses for the toast itself (D2 in the 2.3.1 delete audit): they
 * used to be set independently and drift apart, so a "Geri Al" tap that still
 * looked live silently did nothing.
 *
 * The caller captures the snapshot first (each screen deletes from a different
 * table), then hands it here with the delete to run. `onRestored`, if given, runs
 * once after a successful undo with the snapshots that were just re-inserted -
 * for side effects that only apply to a restore, not the delete itself (see
 * useJournalRows.tsx's Apple Health re-mirror).
 */
export function useUndoBatch(
  onChanged: () => void,
  onRestored?: (snapshots: DeletionSnapshot[]) => void | Promise<void>
) {
  const { t } = useTranslation();
  const { toast } = useFeedback();
  const batchRef = useRef<DeletionSnapshot[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mirrors the same probe Feedback.tsx runs for the toast itself (screen
  // reader state is not part of useFeedback's public API), so the batch window
  // extends in lockstep with how long the toast that offers "Undo" stays up.
  const screenReaderOn = useRef(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isScreenReaderEnabled()
      .then((on) => {
        if (alive) screenReaderOn.current = on;
      })
      .catch(() => {
        // treat an unavailable probe as "off"; the timing stays as it was
      });
    const sub = AccessibilityInfo.addEventListener("screenReaderChanged", (on) => {
      screenReaderOn.current = on;
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  return async function deleteWithUndo(
    snapshot: DeletionSnapshot,
    runDelete: () => Promise<void>
  ): Promise<void> {
    hapticWarning();
    await runDelete();
    onChanged();

    batchRef.current.push(snapshot);
    const count = batchRef.current.length;
    if (timerRef.current) clearTimeout(timerRef.current);
    const toastMs = screenReaderOn.current ? UNDO_TOAST_SCREEN_READER_MS : UNDO_TOAST_MS;
    timerRef.current = setTimeout(() => {
      batchRef.current = [];
    }, undoBatchWindowMs(toastMs));

    const offerUndo = (message: string, kind: "info" | "error") =>
      toast(message, kind, { label: t("common.undo"), onPress: undoAll });

    const undoAll = async (): Promise<void> => {
      const snaps = batchRef.current.slice();
      batchRef.current = [];
      if (timerRef.current) clearTimeout(timerRef.current);
      // The batch window already elapsed (or a stray extra tap): nothing
      // left to restore, so this must not fire the success haptic or
      // onChanged - that would report success for an undo that did nothing.
      if (!shouldRestoreBatch(snaps.length)) return;
      const { restored, failed, error } = await restoreBatch(snaps);
      if (failed.length > 0) {
        // The un-restored snapshots go back into the batch so the next press
        // retries them instead of the rows being gone for good.
        batchRef.current = [...failed, ...batchRef.current];
        timerRef.current = setTimeout(() => {
          batchRef.current = [];
        }, undoBatchWindowMs(screenReaderOn.current ? UNDO_TOAST_SCREEN_READER_MS : UNDO_TOAST_MS));
        logCrash(error, { screen: "undo", op: "restore" });
        hapticWarning();
        if (restored.length > 0) {
          onChanged();
          try {
            await onRestored?.(restored);
          } catch {
            // best-effort restore side effects; those entries are back
          }
        }
        offerUndo(t("common.saveFailed"), "error");
        return;
      }
      hapticSuccess();
      onChanged();
      // AWAITED, and caught: these side effects can be asynchronous (P17
      // re-arms the countdown a meal delete ended, on top of the existing
      // Apple Health re-mirror), and firing them off unawaited left an
      // unhandled rejection on any failure and no ordering at all between
      // them and whatever the caller did next. A failure here must not
      // undo the undo: the rows are already back, so it is swallowed the
      // same way every other best-effort side effect on this path is.
      try {
        await onRestored?.(snaps);
      } catch {
        // best-effort restore side effects; the entries themselves are back
      }
    };

    offerUndo(count > 1 ? t("journal.deletedN", { n: count }) : t("journal.deleted"), "info");
  };
}
