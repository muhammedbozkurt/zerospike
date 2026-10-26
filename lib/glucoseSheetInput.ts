import type { GlucoseUnit } from "./db/types";
import { readNumeric, readNumericInput } from "./numericField";

/** What the glucose entry sheet accepts as a typed value, in the display unit.
 *  Wider than GLUCOSE_ENTRY_BOUNDS on purpose: 601-900 mg/dL is still saved and
 *  only described as past a meter's range (glucose.aboveMeterRange). */
export function glucoseSheetBounds(unit: GlucoseUnit) {
  return unit === "mmol"
    ? ({ min: 0.5, max: 50, decimals: 1 } as const)
    : ({ min: 1, max: 900, decimals: 0 } as const);
}

/** The field must hold a whole paste ("110,5", "1100") so it can be judged and
 *  named as an error instead of being cut to its first characters. */
export const GLUCOSE_SHEET_MAX_CHARS = 12;

/** Where a parsed value sits against the sheet's bounds. "above" shows the
 *  range line and keeps Save shut, like a malformed paste does. */
export function glucoseSheetValueState(
  typed: number | null,
  unit: GlucoseUnit
): "ok" | "below" | "above" | "empty" {
  if (typed == null) return "empty";
  const b = glucoseSheetBounds(unit);
  if (typed > b.max) return "above";
  if (typed < b.min) return "below";
  return "ok";
}

const ONE_SEPARATOR_NUMBER = /^[0-9٠-٩۰-۹]*[.,٫]?[0-9٠-٩۰-۹]*$/;

/** What the hero field does with a new string. A digit inserted after the
 *  decimal mark ("5,5" -> "5,65") or a paste with one place too many is only
 *  too precise: the field cuts it to its precision and, if the cut text is a
 *  plain number, accepts it. Minus signs, exponents and a second separator
 *  stay malformed (never quietly turned into another number). */
export function readGlucoseSheetInput(
  raw: string,
  prev: string,
  mmol: boolean
): { text: string; bad: boolean } {
  const decimals = mmol ? 1 : 0;
  const r = readNumericInput(raw, prev, { decimals });
  if (r.kind !== "malformed") return { text: r.text, bad: false };
  if (decimals > 0 && ONE_SEPARATOR_NUMBER.test(raw.trim())) {
    const again = readNumeric(r.text, { decimals });
    if (again.kind !== "malformed") return { text: again.text, bad: false };
  }
  return { text: r.text, bad: true };
}

/** Outside tap / Android back: with a typed value and the keyboard up, only the
 *  keyboard goes away; otherwise the sheet closes. */
export function outsideTapAction(valueText: string, keyboardVisible: boolean): "keyboard" | "close" {
  return valueText.trim() !== "" && keyboardVisible ? "keyboard" : "close";
}
