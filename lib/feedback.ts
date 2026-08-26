/**
 * Pure rules behind the feedback overlays (components/Feedback.tsx): which host
 * paints them, and how a dialog's buttons lay out. Kept free of React and React
 * Native so both are testable by a standalone harness.
 */

// ---------------------------------------------------------------------------
// Host stack
// ---------------------------------------------------------------------------

/**
 * Every screen presented as a native modal mounts its own <FeedbackHost />,
 * because an overlay can only be seen and touched inside the view controller
 * that is currently on top. Exactly one host may paint at a time, and it must be
 * the topmost one: screens mount outermost-first, so the most recently
 * registered host is the topmost.
 */
export function activeHostId(stack: readonly number[]): number | null {
  return stack.length > 0 ? stack[stack.length - 1] : null;
}

/** Registration is append-only, so registration order is stack order. */
export function pushHost(stack: readonly number[], id: number): number[] {
  return [...stack, id];
}

/**
 * A host leaves when its screen closes. Removing one that is not on top (a
 * screen replaced from underneath a newly pushed one) must not disturb the
 * host that is currently painting.
 */
export function popHost(stack: readonly number[], id: number): number[] {
  return stack.filter((h) => h !== id);
}

// ---------------------------------------------------------------------------
// Dialog button layout
// ---------------------------------------------------------------------------

/**
 * Side by side, each dialog button gets about half the dialog's inner width,
 * which fits roughly this many characters once the font has shrunk as far as it
 * is allowed to.
 *
 * Every Cancel / Delete / Confirm pair stays well under it in all five
 * languages (the longest is German "Bestätigen", 10 characters). The scanner's
 * pair blows past it in every language: German and French render "Save as New
 * Food" as 32 characters.
 */
export const MAX_SIDE_BY_SIDE_LABEL = 12;

/**
 * True when the two buttons must stack (primary on top) rather than share a
 * row. Shrinking the font alone cannot save a 32-character label in half a
 * dialog; it would clip or wrap.
 */
export function shouldStackButtons(
  confirmLabel: string,
  cancelLabel: string
): boolean {
  return Math.max(confirmLabel.length, cancelLabel.length) > MAX_SIDE_BY_SIDE_LABEL;
}

// ---------------------------------------------------------------------------
// Undo timing
// ---------------------------------------------------------------------------

/**
 * How long a delete's "Undo" toast (components/Feedback.tsx) stays up, and how
 * long the batch behind it (components/useUndoBatch.ts) still has something to
 * restore. The two used to be set independently (6200ms vs. a screen-reader-only
 * 20000ms) and drifted apart: a "Geri Al" tapped after the batch had already
 * cleared, but while the toast was still visible, did nothing while still
 * playing the success haptic. One pair of constants, imported by both sides,
 * keeps them locked together.
 */
export const UNDO_TOAST_MS = 5000;
/** Screen reader open: the same reasoning as the toast's own note in
 *  Feedback.tsx - reaching the button by swipe takes longer than reading it. */
export const UNDO_TOAST_SCREEN_READER_MS = 20000;
/** The batch stays open a little past the toast itself, so tapping "Undo" in
 *  the same instant the toast starts to fade still lands. */
const UNDO_BATCH_SAFETY_MS = 200;
export function undoBatchWindowMs(toastMs: number): number {
  return toastMs + UNDO_BATCH_SAFETY_MS;
}

/** Whether a pending "Undo" tap has anything left to restore. The batch window
 *  already elapsing (or a stray extra tap) must not run a restore, fire the
 *  success haptic, or call onChanged - a "Geri Al" that does nothing is not a
 *  success (D2 in the 2.3.1 delete audit). */
export function shouldRestoreBatch(pendingSnapshotCount: number): boolean {
  return pendingSnapshotCount > 0;
}

/**
 * Which of the side effects a collapsed delete batch settled outside the
 * database get replayed by an undo, and in what order (P17).
 *
 * `pending` is in the order the deletes happened. An entry is replayed only
 * when the undo actually restored one of ITS meals: a "3 entries deleted" toast
 * restores three unrelated rows, and a countdown ended for one of them has
 * nothing to do with the other two.
 *
 * The result is NEWEST FIRST, which settles the one case where two entries
 * disagree. Only one post-meal countdown can run at a time, so a batch that
 * ended countdown X and later countdown Y describes a user who had Y running
 * most recently - Y is the state to put back, and X must not be armed over it.
 * Replaying newest first lets the newer one win by being first, rather than by
 * anything having to compare them. Absolute values (a template's usage
 * counters) go the other way round and want the OLDEST applied last, which the
 * same order gives for free: the oldest entry holds the pair from before the
 * whole batch, and it lands last.
 */
export function planAftermathReplay<T extends { mealIds: readonly string[] }>(
  pending: readonly T[],
  restoredMealIds: ReadonlySet<string>
): T[] {
  const out: T[] = [];
  for (let i = pending.length - 1; i >= 0; i--) {
    const entry = pending[i];
    if (entry.mealIds.some((id) => restoredMealIds.has(id))) out.push(entry);
  }
  return out;
}
