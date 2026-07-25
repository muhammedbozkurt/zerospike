import { getActiveLang } from "./lang";

/**
 * Locale-correct uppercasing for UI labels, so `textTransform:"uppercase"` (and
 * Tailwind's `uppercase`) can be dropped where Turkish casing matters.
 *
 * The Turkish 'i' must uppercase to the DOTTED 'İ' and 'ı' to the dotless 'I';
 * a plain CSS `text-transform:uppercase` or JS `toUpperCase()` produces the
 * wrong letter on some platforms. This does the Turkish mapping explicitly, so
 * the result is correct regardless of the runtime's Intl/ICU coverage, and falls
 * back to a locale-aware uppercase elsewhere.
 */
export function upper(value: string): string {
  const lang = getActiveLang().slice(0, 2);
  if (lang === "tr") {
    return value.replace(/i/g, "İ").replace(/ı/g, "I").toUpperCase();
  }
  try {
    return value.toLocaleUpperCase(lang);
  } catch {
    return value.toUpperCase();
  }
}
