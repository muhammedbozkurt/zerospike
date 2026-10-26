/**
 * The journal never lists sensor readings one by one: each day with readings
 * gets a single summary row ("CGM: 284 readings") that opens that day's curve.
 * Pure, so scripts/cgmCurve.test.ts covers the merge and the filter rules.
 */
import type { CgmDaySummary } from "../db/cgmCurveSql";

export interface CgmDayEntry {
  kind: "cgmday";
  id: string;
  /** The day's newest sensor reading, which is where the row sits in the list. */
  logged_at: string;
  dayKey: string;
  count: number;
  avgMgdl: number;
  /** Share of the day's readings inside the target band, 0..100. */
  inRangePct: number;
}

export function cgmDayEntry(s: CgmDaySummary): CgmDayEntry {
  return {
    kind: "cgmday",
    id: s.dayKey,
    logged_at: s.lastAt,
    dayKey: s.dayKey,
    count: s.count,
    avgMgdl: s.avgMgdl,
    inRangePct: s.count > 0 ? Math.round((s.inRange / s.count) * 100) : 0,
  };
}

/** Summary rows belong to the "all" and "glucose" lists only. */
export function cgmDaysForFilter(filter: string): boolean {
  return filter === "all" || filter === "glucose";
}

/**
 * Merges the summary rows into a newest-first feed. The result stays newest
 * first; on equal times the summary goes after the feed's own rows.
 */
export function mergeCgmDays<T extends { logged_at: string }>(
  entries: readonly T[],
  days: readonly CgmDayEntry[]
): (T | CgmDayEntry)[] {
  if (days.length === 0) return [...entries];
  const sortedDays = [...days].sort((a, b) => (a.logged_at < b.logged_at ? 1 : a.logged_at > b.logged_at ? -1 : 0));
  const out: (T | CgmDayEntry)[] = [];
  let d = 0;
  for (const e of entries) {
    while (d < sortedDays.length && sortedDays[d].logged_at > e.logged_at) {
      out.push(sortedDays[d++]);
    }
    out.push(e);
  }
  while (d < sortedDays.length) out.push(sortedDays[d++]);
  return out;
}

export function isCgmDayEntry(e: { kind: string }): e is CgmDayEntry {
  return e.kind === "cgmday";
}

/** How many days of summaries each screen asks for. */
export const CGM_PREVIEW_DAYS = 14;
export const CGM_JOURNAL_DAYS = 30;
export const CGM_JOURNAL_MAX_DAYS = 90;
