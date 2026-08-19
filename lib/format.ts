/** Small shared formatting helpers.
 *
 * R7: numbers, dates and times are now LOCALE-AWARE (Intl / toLocale*), keyed to
 * the active app language, so a Turkish or German user sees "5,5" and a 24-hour
 * clock while an English user sees "5.5" and a 12-hour clock - on every surface.
 * Only formatDateKey stays fixed: it is a storage / grouping key, never shown.
 * Every call is guarded so a runtime without full Intl falls back to the plain
 * form instead of throwing. */

import { getActiveLang } from "./lang";

// The Arabic bundle is written with Western digits throughout, but Intl's
// default numbering system for "ar" is Eastern Arabic (١٢٣), so a screen would
// mix the two: a translated label next to an Intl-formatted number. The -u-nu-latn
// extension pins the digits without touching any other Arabic convention.
function localeTagFor(lang: string): string {
  return lang.slice(0, 2) === "ar" ? "ar-u-nu-latn" : lang;
}

/** The BCP-47 tag every Intl call in the app formats with. Exported because
 *  lib/glucose formats the one number that matters most and must not resolve
 *  the locale differently from every other surface. */
export function formatLocale(): string {
  return localeTagFor(getActiveLang());
}

/** Languages that write the decimal mark as a comma. Used in the no-Intl
 *  fallback below (with Intl the locale data decides), and exported because the
 *  CSV export has to pick its delimiter from the SAME list: a hand-kept "every
 *  language except English" rule put comma decimals into the Japanese and Arabic
 *  files, whose numbers are written with a dot. */
export const COMMA_DECIMAL = ["tr", "de", "es", "fr", "it", "pt"];

function two(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  try {
    return d.toLocaleTimeString(formatLocale(), { hour: "2-digit", minute: "2-digit" });
  } catch {
    return `${two(d.getHours())}:${two(d.getMinutes())}`;
  }
}

/**
 * A clock time (HH:MM), formatted against an EXPLICIT language rather than the
 * app's ambient active-language state. For a surface that renders outside the
 * app's own JS lifecycle - the Android widget's headless task handler wakes on
 * its own schedule and may never have run the app's i18n init in that process -
 * `getActiveLang()` cannot be trusted there. Callers instead pass the language
 * already carried in their own data snapshot (see LiveData.lang).
 */
export function formatTimeForLang(ms: number, lang: string): string {
  const d = new Date(ms);
  try {
    return d.toLocaleTimeString(localeTagFor(lang), { hour: "2-digit", minute: "2-digit" });
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
    return d.toLocaleDateString(formatLocale());
  } catch {
    return `${two(d.getDate())}.${two(d.getMonth() + 1)}.${d.getFullYear()}`;
  }
}

/** Localized weekday name (e.g. "Sali" / "Tuesday"); "" without full Intl. */
export function formatWeekday(iso: string): string {
  const d = new Date(iso);
  try {
    return d.toLocaleDateString(formatLocale(), { weekday: "long" });
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
    return rounded.toLocaleString(formatLocale(), { maximumFractionDigits: 2 });
  } catch {
    return `${rounded}`;
  }
}

/**
 * Unicode bidi isolate marks (LRI/PDI): wrapping a purely-LTR run (a date
 * range, a number+sign pair) in these makes it render as one atomic
 * left-to-right block no matter which way the surrounding paragraph
 * resolves. Real-device RTL testing showed the RN `writingDirection` style
 * prop is NOT reliable for this on its own - a "date - date" or "word
 * number%" string still got its parts reordered under Arabic - so this is
 * the string-level fix: it works regardless of how the native text view
 * threads (or drops) the style prop.
 */
const LRI = "⁦";
const PDI = "⁩";

/** Wraps `s` so it always renders as one LTR block (a date range, a
 *  pre-joined "50%"), regardless of the surrounding writing direction. */
export function isolateLtr(s: string): string {
  return `${LRI}${s}${PDI}`;
}

/** Opens an LTR isolate around `s` without closing it - for smuggling the
 *  boundary through an i18n template this code cannot edit, e.g.
 *  `t("x", { min: openLtrIsolate(min), max: closeLtrIsolate(max) })` against
 *  a fixed "{{min}}-{{max}}" template isolates "min-max" as one block even
 *  though the literal "-" lives in the (untouched) translation string. */
export function openLtrIsolate(s: string): string {
  return `${LRI}${s}`;
}

/** Closes an LTR isolate opened with {@link openLtrIsolate}. */
export function closeLtrIsolate(s: string): string {
  return `${s}${PDI}`;
}

/**
 * Strips embedded bidi control marks (LRM/RLM U+200E/U+200F, ALM U+061C) from
 * `s`. Confirmed on-device root cause of the date-range chip bug: ICU's own
 * "ar" date pattern inserts an RLM before every "/" separator (verified via
 * `new Date(...).toLocaleDateString("ar-u-nu-latn")` -> "28‏/7‏/2026"),
 * so ICU is already voting for local RTL runs INSIDE the string. Wrapping
 * that in our own isolateLtr() is not enough - the embedded RLM still wins
 * the bidi resolution inside the isolate and reorders the date's own digit
 * groups. Only needed when a formatDate() output is being hand-composed into
 * a larger string this file then re-isolates itself (as with the range chip
 * below); a lone formatDate() call left to render on its own should keep its
 * marks, since ICU put them there for exactly that unwrapped case.
 */
export function stripBidiMarks(s: string): string {
  return s.replace(/[‎‏؜]/g, "");
}

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
    const parts = new Intl.NumberFormat(formatLocale(), {
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
  const lang = formatLocale().slice(0, 2);
  const raw = safe.toFixed(decimals);
  const number = COMMA_DECIMAL.includes(lang) ? raw.replace(".", ",") : raw;
  if (lang === "tr") return { number, sign: "%", signFirst: true };
  // Only de/fr/es space the sign; en/it/pt/ja/ar write it tight to the number.
  const spaced = lang === "de" || lang === "fr" || lang === "es";
  return { number, sign: spaced ? " %" : "%", signFirst: false };
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
    return new Intl.NumberFormat(formatLocale(), {
      style: "currency",
      currency: currencyCode,
    }).format(amount);
  } catch {
    return `${Math.round(amount * 100) / 100}`;
  }
}
