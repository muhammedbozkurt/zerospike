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
