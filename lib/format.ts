/** Small shared formatting helpers.
 *
 * R7: numbers, dates and times are now LOCALE-AWARE (Intl / toLocale*), keyed to
 * the active app language, so a Turkish or German user sees "5,5" and a 24-hour
 * clock while an English user sees "5.5" and a 12-hour clock - on every surface.
 * Only formatDateKey stays fixed: it is a storage / grouping key, never shown.
 * Every call is guarded so a runtime without full Intl falls back to the plain
 * form instead of throwing. */

import { getActiveLang } from "./lang";

function locale(): string {
  return getActiveLang();
}

function two(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  try {
    return d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
  } catch {
    return `${two(d.getHours())}:${two(d.getMinutes())}`;
  }
}

/** Stable, NON-localized key for grouping/storage (never displayed). */
export function formatDateKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

/** A localized short date (e.g. "23.07.2026" / "7/23/2026"). */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  try {
    return d.toLocaleDateString(locale());
  } catch {
    return `${two(d.getDate())}.${two(d.getMonth() + 1)}.${d.getFullYear()}`;
  }
}

/** Human day label relative to today/yesterday, otherwise a localized date. */
export function relativeDay(
  iso: string,
  labels: { today: string; yesterday: string }
): string {
  const d = new Date(iso);
  const now = new Date();
  const startOf = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (diffDays === 0) return labels.today;
  if (diffDays === 1) return labels.yesterday;
  return formatDate(iso);
}

/** Compact number for display: trims trailing zeros and uses the locale's own
 *  decimal / grouping marks (3.0 → "3", 3.5 → "3,5" in tr). */
export function num(n: number): string {
  const rounded = Number.isInteger(n) ? n : Math.round(n * 100) / 100;
  try {
    return rounded.toLocaleString(locale(), { maximumFractionDigits: 2 });
  } catch {
    return `${rounded}`;
  }
}
