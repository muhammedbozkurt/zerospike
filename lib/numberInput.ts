import type { GlucoseUnit } from "./db/types";

/**
 * ONE normalizer for every numeric text field in the app (glucose, dose, carb
 * ratio, portion, targets, thresholds).
 *
 * Each screen used to filter its own input, and the filters disagreed: the mmol
 * glucose field stripped the comma outright, so a Turkish or German keyboard's
 * "5,5" became 55 mmol/L - a fictional reading that produced a large fictional
 * correction. Other fields accepted several separators and then converted only
 * the first one, so "1,5,5" parsed as 1.5 while the screen showed something
 * else. A single pair of functions keeps sanitizing and parsing in agreement
 * everywhere.
 *
 * Nothing here blocks input: text is sanitized as it is typed, and parsing
 * reports "no value" (null) rather than inventing one.
 */

/**
 * A character's value as a Western digit, or null when it is not a digit at all.
 *
 * An Arabic keyboard types ٠١٢٣ (Eastern Arabic) and a Persian one ۰۱۲۳, and
 * those are the SAME numbers - the app just writes them in Latin digits
 * everywhere (lib/format pins Intl to -u-nu-latn). Dropping them left the field
 * empty after a full reading was typed, which reads as an app that refuses
 * input rather than one that transliterates it. Every other character behaves
 * exactly as before.
 */
function latinDigit(ch: string): string | null {
  if (ch >= "0" && ch <= "9") return ch;
  const code = ch.charCodeAt(0);
  if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
  if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0);
  return null;
}

/**
 * Digits plus AT MOST ONE decimal separator. The separator the user typed is
 * preserved (a comma stays a comma) so the field still reads naturally in
 * locales that write 5,5; parseDecimalText handles the conversion. U+066B
 * (Arabic decimal separator, "٫") counts as a separator too. Any other
 * non-digit - including U+066C, the Arabic thousands separator - is dropped
 * like before.
 */
export function sanitizeDecimalText(raw: string): string {
  let out = "";
  let hasSeparator = false;
  for (const ch of raw) {
    const digit = latinDigit(ch);
    if (digit !== null) {
      out += digit;
    } else if ((ch === "." || ch === "," || ch === "٫") && !hasSeparator) {
      hasSeparator = true;
      out += ch;
    }
  }
  return out;
}

/** Digits only, for fields that store whole numbers (mg/dL, grams). The text
 *  stops at the first decimal separator: "45,5" is 45, never 455 (dropping the
 *  separator and keeping the digit behind it was a silent tenfold). */
export function sanitizeIntegerText(raw: string): string {
  let out = "";
  for (const ch of raw) {
    if (ch === "." || ch === "," || ch === "٫") break;
    const digit = latinDigit(ch);
    if (digit !== null) out += digit;
  }
  return out;
}

export function sanitizeNumberText(raw: string, decimals: boolean): string {
  return decimals ? sanitizeDecimalText(raw) : sanitizeIntegerText(raw);
}

/**
 * Text to number. Comma, dot, and U+066B (Arabic decimal separator) all read as
 * the decimal separator and a second separator is ignored. Returns null for an
 * empty or unparseable field: what an EMPTY field means belongs to the caller,
 * so no screen can quietly substitute a computed value for something the user
 * cleared.
 */
export function parseDecimalText(raw: string): number | null {
  const cleaned = sanitizeDecimalText(raw).replace(/[,٫]/, ".");
  if (cleaned === "" || cleaned === ".") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * The point above which a typed reading is described as beyond the range a
 * meter reports: 33.3 mmol/L and 600 mg/dL are the ceilings consumer meters
 * top out at. Purely descriptive - the value is still accepted and stored,
 * because a record of what the user actually saw is worth more than a clean
 * database.
 */
export const GLUCOSE_INPUT_CEILING = { mmol: 33.3, mgdl: 600 } as const;

export function glucoseAboveCeiling(
  displayValue: number | null,
  unit: GlucoseUnit
): boolean {
  if (displayValue == null || !Number.isFinite(displayValue)) return false;
  return displayValue > GLUCOSE_INPUT_CEILING[unit];
}
