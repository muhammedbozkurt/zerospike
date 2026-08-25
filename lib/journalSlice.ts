/**
 * How much of the journal feed one slice reveals. Pure and dependency-free, the
 * same way lib/alarmSelect.ts and lib/postMealTimer.ts are, so
 * scripts/journalSlice.test.ts can exercise the boundaries under plain Node.
 *
 * Two callers, two very different jobs, one rule:
 *
 *  - The DASHBOARD shows a PREVIEW. It is not the journal, it is a glance at the
 *    end of it, sitting under a hero, a countdown and a context strip - so it
 *    stops at a couple of days and a screenful of rows, and hands off to the
 *    full screen. It deliberately does not grow in place: a list that expands
 *    inside a page that is already scrolling is the nested-scroll trap this
 *    layout is meant to avoid.
 *  - The JOURNAL SCREEN (app/journal.tsx) is the whole history, and keeps the
 *    "show more" paging that used to live on the dashboard.
 */

/** One row of the merged feed, as far as slicing is concerned. */
export interface JournalSliceRow {
  /** ISO timestamp, newest first across the list. */
  logged_at: string;
}

export interface JournalSliceLimits {
  /** Hard cap on rows in one slice. */
  maxEntries: number;
  /** Cap on how many DISTINCT calendar days one slice may span. */
  maxDays: number;
}

/** The dashboard preview: the last couple of days, and never more than a
 *  screenful. Whichever fills first ends the slice. */
export const JOURNAL_PREVIEW_LIMITS: JournalSliceLimits = {
  maxEntries: 15,
  maxDays: 2,
};

/** The full journal screen, where "show more" reveals another slice. */
export const JOURNAL_PAGE_LIMITS: JournalSliceLimits = {
  maxEntries: 50,
  maxDays: 14,
};

/** How much wider the SQL window gets when a page-down runs past the loaded
 *  feed (app/journal.tsx). */
export const JOURNAL_LOAD_STEP = 250;

/**
 * The local calendar day a timestamp falls on, as a sortable key.
 *
 * Days are counted in LOCAL time, and counted as distinct DAYS rather than as a
 * rolling number of hours, because that is what the list actually draws: it is
 * grouped into day sections, so "two days" has to mean two of those sections.
 * A rolling 48-hour window would cut the middle of a day whenever the newest
 * row happened to be logged in the evening.
 *
 * Mirrors lib/format.ts's formatDateKey, reimplemented here only so this file
 * stays importable by a plain Node test (that module reaches into Intl through
 * the app's locale plumbing).
 */
export function journalDayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * End index of the next slice, walking the newest-first feed from `from`.
 *
 * Stops at `maxEntries` rows, or as soon as a row would open a
 * `maxDays + 1`-th distinct day - whichever comes first. The day count is
 * anchored on the slice's OWN newest row rather than on "now", so a user who
 * has not logged for a month still opens on their last days of records instead
 * of on an empty list with a button under it.
 *
 * A slice always advances by at least one row, so a sparse feed can never
 * stall the button.
 */
export function nextJournalCut(
  list: readonly JournalSliceRow[],
  from: number,
  limits: JournalSliceLimits
): number {
  if (from >= list.length) return from;
  const days = new Set<string>();
  let i = from;
  while (i < list.length && i - from < limits.maxEntries) {
    const key = journalDayKey(list[i].logged_at);
    if (!days.has(key)) {
      // The row that would open one day too many ends the slice, and is left
      // for the next one.
      if (days.size >= limits.maxDays) break;
      days.add(key);
    }
    i++;
  }
  return Math.max(i, from + 1);
}
