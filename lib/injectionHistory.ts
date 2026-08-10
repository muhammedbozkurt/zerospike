import type { Injection } from "./db/types";
import { formatDate, formatDateKey, formatWeekday, relativeDay } from "./format";

/**
 * Injection-tab-only history helpers: day grouping and the initial-slice /
 * "show more" paging. Mirrors app/(tabs)/index.tsx's journal grouping exactly
 * (relative label vs. weekday + date chip) without editing that file, per the
 * ownership split - injection.tsx is the only caller.
 */

export interface InjectionDaySection {
  key: string;
  /** "Today" / "Yesterday", else the weekday name (falls back to the date
   *  itself without full Intl weekday support). */
  title: string;
  /** The concrete localized date, always shown alongside `title`. */
  dateLabel: string;
  data: Injection[];
}

/** Groups injections (already newest-first) into day sections, same rule as
 *  the dashboard journal: relative word for today/yesterday, weekday further
 *  back, the date chip shown next to it either way. */
export function groupInjectionsByDay(
  items: Injection[],
  labels: { today: string; yesterday: string }
): InjectionDaySection[] {
  const sections: InjectionDaySection[] = [];
  const byKey = new Map<string, Injection[]>();
  for (const inj of items) {
    const key = formatDateKey(inj.logged_at);
    let data = byKey.get(key);
    if (!data) {
      data = [];
      byKey.set(key, data);
      const rel = relativeDay(inj.logged_at, labels);
      const dateLabel = formatDate(inj.logged_at);
      sections.push({
        key,
        title: rel !== dateLabel ? rel : formatWeekday(inj.logged_at) || dateLabel,
        dateLabel,
        data,
      });
    }
    data.push(inj);
  }
  return sections;
}

/** The initial history slice: everything within `days`, capped at `max`
 *  records - whichever boundary the newest-first list hits first, so a light
 *  history shows its last couple of weeks in full while a heavy one still
 *  opens fast. Later pages are plain count-based (see injection.tsx).
 *
 *  Never returns empty while `items` has rows: a profile whose newest record
 *  already sits outside the day window still gets that one row up front,
 *  otherwise the screen would misreport "no history" over records that just
 *  need a "show more" tap. */
export function initialHistorySlice(items: Injection[], days: number, max: number): Injection[] {
  const cutoff = Date.now() - days * 86_400_000;
  const out: Injection[] = [];
  for (const inj of items) {
    if (out.length >= max) break;
    if (new Date(inj.logged_at).getTime() < cutoff) break;
    out.push(inj);
  }
  if (out.length === 0 && items.length > 0) out.push(items[0]);
  return out;
}
