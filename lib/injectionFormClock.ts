/** A hand-picked time left alone this long (app in the background) is treated
 *  as abandoned: the next entry is far more likely "now" than that old pick. */
export const ABANDONED_TIME_MS = 30 * 60_000;

export type ForegroundTimeAction = "keep" | "refresh" | "reset";

/**
 * What the form does with its time when the app returns to the foreground.
 * An untouched time simply follows "now"; a hand-picked one is kept through a
 * short trip and dropped (back to "now", picked flag cleared) after a long one.
 */
export function foregroundTimeAction(opts: {
  timeTouched: boolean;
  hiddenMs: number;
}): ForegroundTimeAction {
  if (!opts.timeTouched) return "refresh";
  return opts.hiddenMs >= ABANDONED_TIME_MS ? "reset" : "keep";
}

/** The timestamp a save writes: a time nobody picked is "now" at save time, so
 *  a form left open for hours never logs its mount-time clock. */
export function saveTimestamp(opts: { timeTouched: boolean; loggedAt: Date; now: Date }): Date {
  return opts.timeTouched ? opts.loggedAt : opts.now;
}
