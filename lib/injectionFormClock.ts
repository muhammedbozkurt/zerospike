/** A hand-picked time left alone this long (app in the background) is marked
 *  stale: it may still be right (logging last night's dose), so it is kept and
 *  the save asks before using it. */
export const ABANDONED_TIME_MS = 30 * 60_000;

export type ForegroundTimeAction = "keep" | "refresh" | "stale";

/** What the save does with a stale pick: write it as picked, or write "now". */
export type StaleTimeChoice = "picked" | "now";

/** Maps the three-outcome dialog (time button, "now" button, dismissed) onto a
 *  choice. Dismissing is not an answer: it cancels the save. */
export function staleTimeChoiceFrom(result: boolean | null): StaleTimeChoice | "cancel" {
  if (result === null) return "cancel";
  return result ? "picked" : "now";
}

/**
 * What the form does with its time when the app returns to the foreground.
 * An untouched time simply follows "now"; a hand-picked one is kept, and after
 * a long trip it is flagged stale so the save can confirm it.
 */
export function foregroundTimeAction(opts: {
  timeTouched: boolean;
  hiddenMs: number;
}): ForegroundTimeAction {
  if (!opts.timeTouched) return "refresh";
  return opts.hiddenMs >= ABANDONED_TIME_MS ? "stale" : "keep";
}

/** The timestamp a save writes: a time nobody picked is "now" at save time, so
 *  a form left open for hours never logs its mount-time clock. */
export function saveTimestamp(opts: {
  timeTouched: boolean;
  loggedAt: Date;
  now: Date;
  choice?: StaleTimeChoice;
}): Date {
  if (opts.choice === "now") return opts.now;
  return opts.timeTouched ? opts.loggedAt : opts.now;
}
