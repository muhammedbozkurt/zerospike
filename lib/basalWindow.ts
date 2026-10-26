/** Half-width of the "already logged" duplicate window: an existing basal
 *  row within this many hours of the target time, either direction, counts
 *  as the same dose. */
export const DUPLICATE_WINDOW_HOURS = 3;

/**
 * Today's (or, once past, the most recent PAST) occurrence of a reminder's
 * daily "HH:MM" time - what a basal reminder tap/action is ABOUT, distinct
 * from `now` (a reminder that fired at 22:00 and is opened at 00:30 the next
 * day still means "the 22:00 dose", not "right now"). A malformed time
 * string falls back to `now` itself, since there is nothing else honest to
 * show.
 */
export function reminderTriggerTime(time: string, now: Date = new Date()): Date {
  const [h, m] = time.split(":").map((n) => parseInt(n, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return new Date(now);
  const candidate = new Date(now);
  candidate.setHours(h, m, 0, 0);
  if (candidate.getTime() > now.getTime()) {
    candidate.setDate(candidate.getDate() - 1);
  }
  return candidate;
}

export function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Scoped (dashboard) open: the card shows because TODAY has no basal row, so
 * it is about today. A reminder whose last trigger is from an earlier day
 * (22:00 reminder, opened at 09:00) would pre-fill yesterday's time and write
 * the dose there, out of the card's own today view; only a trigger that
 * already rang today may own the open, otherwise the caller uses "now".
 */
export function pickScopedReminder<T extends { targetTime: Date }>(
  candidate: T | null,
  now: Date
): T | null {
  return candidate && isSameLocalDay(candidate.targetTime, now) ? candidate : null;
}

/** Time bounds of the duplicate check around `targetTime`. `sameDayOnly`
 *  (dashboard entry) clips the window to the target's local day, the same day
 *  rule the dashboard uses to decide whether today has a basal row. */
export function duplicateBounds(
  targetTime: Date,
  opts: { sameDayOnly?: boolean } = {}
): { sinceMs: number; untilMs: number } {
  const half = DUPLICATE_WINDOW_HOURS * 3_600_000;
  let sinceMs = targetTime.getTime() - half;
  let untilMs = targetTime.getTime() + half;
  if (opts.sameDayOnly) {
    const dayStart = new Date(targetTime);
    dayStart.setHours(0, 0, 0, 0);
    const nextDay = new Date(dayStart);
    nextDay.setDate(nextDay.getDate() + 1);
    sinceMs = Math.max(sinceMs, dayStart.getTime());
    untilMs = Math.min(untilMs, nextDay.getTime() - 1);
  }
  return { sinceMs, untilMs };
}
