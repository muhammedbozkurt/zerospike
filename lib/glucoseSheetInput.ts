import type { GlucoseUnit } from "./db/types";

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
