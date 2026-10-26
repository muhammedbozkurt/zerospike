export type SavePhase = "confirm" | "write" | "after";
export type SaveOutcome = "saved" | "cancelled" | "failed" | "busy";

/**
 * Shared save path of the injection form and its edit sheet.
 *
 * The lock is a ref taken before the first await: a state flag only flips after
 * a render, and the confirm dialogs and duplicate-entry reads in front of the
 * write left a window in which a second tap started a second save.
 *
 * Nothing here throws. A failed write goes to onError("write") so the caller can
 * show a toast and keep the form values; an error AFTER the row was written
 * (toast, navigation) is reported as "after" and the outcome stays "saved", so a
 * retry can never duplicate a row that is already stored.
 */
export async function runGuardedSave<T>(opts: {
  lock: { current: boolean };
  setBusy: (busy: boolean) => void;
  confirm: () => Promise<boolean>;
  write: () => Promise<T>;
  onSaved: (saved: T) => void | Promise<void>;
  onError: (err: unknown, phase: SavePhase) => void;
}): Promise<SaveOutcome> {
  const { lock, setBusy, confirm, write, onSaved, onError } = opts;
  if (lock.current) return "busy";
  lock.current = true;
  setBusy(true);
  try {
    let go: boolean;
    try {
      go = await confirm();
    } catch (err) {
      onError(err, "confirm");
      return "failed";
    }
    if (!go) return "cancelled";
    let saved: T;
    try {
      saved = await write();
    } catch (err) {
      onError(err, "write");
      return "failed";
    }
    try {
      await onSaved(saved);
    } catch (err) {
      onError(err, "after");
    }
    return "saved";
  } finally {
    lock.current = false;
    setBusy(false);
  }
}
