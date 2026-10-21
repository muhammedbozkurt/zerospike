/**
 * Scroll hint (small down chevron) rules, kept pure: no React Native import,
 * so scripts/scrollHint.test.ts can run them under tsx.
 *
 * The hint shows only while the content overflows the visible area AND the user
 * has not scrolled yet, once per screen. Under Reduce Motion it is a single
 * static frame (appears/disappears without any fade or movement).
 */

/** Content must exceed the viewport by more than this (pt) to count as overflow. */
export const SCROLL_HINT_OVERFLOW_PT = 24;

/** Scrolled past this offset (pt) = the user got the message; the hint goes away. */
export const SCROLL_HINT_SCROLLED_PT = 8;

/** Space between the scroll area's bottom edge (or the pinned bar) and the hint. */
export const SCROLL_HINT_GAP_PT = 10;

export const SCROLL_HINT_KEY_PREFIX = "zerospike.scrollHintSeen.";

export function scrollHintKey(screenId: string): string {
  return `${SCROLL_HINT_KEY_PREFIX}${screenId}`;
}

export function hasOverflow(contentHeight: number, viewportHeight: number): boolean {
  if (!(contentHeight > 0) || !(viewportHeight > 0)) return false;
  return contentHeight > viewportHeight + SCROLL_HINT_OVERFLOW_PT;
}

export function hasScrolled(scrollY: number): boolean {
  return scrollY > SCROLL_HINT_SCROLLED_PT;
}

export interface ScrollHintState {
  contentHeight: number;
  viewportHeight: number;
  scrollY: number;
  /** Already shown for this screen (memory or persisted). */
  seen: boolean;
}

export function shouldShowHint(s: ScrollHintState): boolean {
  if (s.seen) return false;
  if (hasScrolled(s.scrollY)) return false;
  return hasOverflow(s.contentHeight, s.viewportHeight);
}

/**
 * Distance of the hint above the anchor, which sits at the scroll area's bottom
 * edge. A pinned bar that overlaps the scroll area (pinnedHeight, already
 * including its own safe-area padding) pushes the hint above it; otherwise the
 * home-indicator inset applies when the scroll area runs to the screen edge.
 */
export function hintBottomOffset(opts: { insetBottom?: number; pinnedHeight?: number }): number {
  const pinned = Math.max(0, opts.pinnedHeight ?? 0);
  const inset = Math.max(0, opts.insetBottom ?? 0);
  return (pinned > 0 ? pinned : inset) + SCROLL_HINT_GAP_PT;
}

export interface ScrollHintMotion {
  /** Bobbing loop. */
  animate: boolean;
  /** Fade in/out; false = appear and disappear in one frame. */
  fade: boolean;
  /** Bob cycles before it rests (about 1.8 s total). */
  loops: number;
}

export function scrollHintMotion(reduceMotion: boolean): ScrollHintMotion {
  return reduceMotion ? { animate: false, fade: false, loops: 0 } : { animate: true, fade: true, loops: 2 };
}
