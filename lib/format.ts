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

/** Localized weekday name (e.g. "Sali" / "Tuesday"); "" without full Intl. */
export function formatWeekday(iso: string): string {
  const d = new Date(iso);
  try {
    return d.toLocaleDateString(locale(), { weekday: "long" });
  } catch {
    return "";
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

/**
 * Where the percent sign goes, and whether it is spaced, is a LANGUAGE rule, not
 * a typing habit: Turkish writes "%92", English "92%", German/French/Spanish
 * "92 %". Every call site used to hand-write its own sign, so one Turkish session
 * showed both "%92" and "92%". These two helpers are the only place the sign is
 * ever produced.
 */
export interface PctParts {
  /** The number alone, in the locale's digits and decimal mark. */
  number: string;
  /** The percent sign plus whatever spacing the locale puts next to it. */
  sign: string;
  /** True when the sign belongs BEFORE the number (Turkish). */
  signFirst: boolean;
}

/** Splits a percentage into number + sign, for widgets that style the sign
 *  separately (a donut centre, a stat tile's small suffix). `value` is 0..100. */
export function pctParts(value: number, decimals = 0): PctParts {
  const safe = Number.isFinite(value) ? value : 0;
  try {
    const parts = new Intl.NumberFormat(locale(), {
      style: "percent",
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).formatToParts(safe / 100);
    const signIndex = parts.findIndex((p) => p.type === "percentSign");
    if (signIndex >= 0) {
      const number = parts
        .filter((p) => p.type !== "percentSign" && p.type !== "literal")
        .map((p) => p.value)
        .join("");
      const literal = parts.find((p) => p.type === "literal")?.value ?? "";
      const signFirst = signIndex === 0;
      return {
        number,
        sign: signFirst ? `%${literal}` : `${literal}%`,
        signFirst,
      };
    }
  } catch {
    // no full Intl, fall through to the table below
  }
  const lang = locale().slice(0, 2);
  const raw = safe.toFixed(decimals);
  const number = lang === "en" ? raw : raw.replace(".", ",");
  if (lang === "tr") return { number, sign: "%", signFirst: true };
  return { number, sign: lang === "en" ? "%" : " %", signFirst: false };
}

/** A percentage in the active language's own convention. `value` is 0..100. */
export function pct(value: number, decimals = 0): string {
  const p = pctParts(value, decimals);
  return p.signFirst ? `${p.sign}${p.number}` : `${p.number}${p.sign}`;
}

/**
 * An amount in its store currency, written the way the APP's language writes
 * money. Keyed to the app language, not the device's: a Turkish user who put the
 * phone in English still reads the price on a Turkish screen, and passing
 * `undefined` as the locale used to hand that decision to the device.
 */
export function money(amount: number, currencyCode: string): string {
  try {
    return new Intl.NumberFormat(locale(), {
      style: "currency",
      currency: currencyCode,
    }).format(amount);
  } catch {
    return `${Math.round(amount * 100) / 100}`;
  }
}
