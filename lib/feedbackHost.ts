/**
 * Host-stack selection for the feedback overlays (components/Feedback.tsx).
 *
 * Every screen presented as a native modal mounts its own <FeedbackHost />,
 * because an overlay can only be seen and touched inside the view controller
 * that is currently on top. Exactly one host may paint at a time, and it must be
 * the topmost one: screens mount outermost-first, so the most recently
 * registered host is the topmost.
 *
 * Kept as a pure module so the rule is testable without React or React Native.
 */

/** The host that paints: the most recently registered one. */
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
