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
 * Digits plus AT MOST ONE decimal separator. The separator the user typed is
 * preserved (a comma stays a comma) so the field still reads naturally in
 * locales that write 5,5; parseDecimalText handles the conversion.
 */
export function sanitizeDecimalText(raw: string): string {
  let out = "";
  let hasSeparator = false;
  for (const ch of raw) {
    if (ch >= "0" && ch <= "9") {
      out += ch;
    } else if ((ch === "." || ch === ",") && !hasSeparator) {
      hasSeparator = true;
      out += ch;
    }
  }
  return out;
}

/** Digits only, for fields that store whole numbers (mg/dL, grams). */
export function sanitizeIntegerText(raw: string): string {
  let out = "";
  for (const ch of raw) if (ch >= "0" && ch <= "9") out += ch;
  return out;
}

export function sanitizeNumberText(raw: string, decimals: boolean): string {
  return decimals ? sanitizeDecimalText(raw) : sanitizeIntegerText(raw);
}

/**
 * Text to number. Comma and dot both read as the decimal separator and a second
 * separator is ignored. Returns null for an empty or unparseable field: what an
 * EMPTY field means belongs to the caller, so no screen can quietly substitute a
 * computed value for something the user cleared.
 */
export function parseDecimalText(raw: string): number | null {
  const cleaned = sanitizeDecimalText(raw).replace(",", ".");
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
