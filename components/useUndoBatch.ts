import { useRef } from "react";
import { useTranslation } from "react-i18next";

import { useFeedback } from "./Feedback";
import { restoreDeletion, type DeletionSnapshot } from "../lib/db/undo";
import { hapticSuccess, hapticWarning } from "../lib/haptics";

/**
 * Accumulating delete + undo, shared by every delete surface (dashboard journal,
 * injection history, custom foods).
 *
 * A single delete shows "Entry deleted" with a 6-second undo. Consecutive deletes
 * inside that window COLLAPSE into one toast ("N entries deleted") whose single
 * undo restores them all - so a second delete never buries the first entry's
 * undo. The batch window (6200ms) matches the toast's own visible duration.
 *
 * The caller captures the snapshot first (each screen deletes from a different
 * table), then hands it here with the delete to run.
 */
export function useUndoBatch(onChanged: () => void) {
  const { t } = useTranslation();
  const { toast } = useFeedback();
  const batchRef = useRef<DeletionSnapshot[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    timerRef.current = setTimeout(() => {
      batchRef.current = [];
    }, 6200);

    toast(
      count > 1 ? t("journal.deletedN", { n: count }) : t("journal.deleted"),
      "info",
      {
        label: t("common.undo"),
        onPress: async () => {
          const snaps = batchRef.current.slice();
          batchRef.current = [];
          if (timerRef.current) clearTimeout(timerRef.current);
          for (const s of snaps) await restoreDeletion(s);
          hapticSuccess();
          onChanged();
        },
      }
    );
  };
}
