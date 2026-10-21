import type { GlucoseUnit } from "./db/types";
import { hasDecimalSeparator } from "./numberInput";
import { readStepperText, sanitizeStepperText } from "./stepperInput";

/**
 * Pure rules behind components/NumericField: what a typed string means, when it
 * is an error, and where a - / + press lands. Kept free of React so
 * scripts/numericField.test.ts can run it under plain Node.
 *
 * The invariant is the same as the old Stepper's: the parent only ever receives
 * a number that is exactly what the field shows and lies inside [min, max].
 * Empty or out-of-range text is reported as null, never clamped into a value the
 * user did not type.
 */

export interface NumericBounds {
  min?: number;
  max?: number;
  decimals: number;
}

export type NumericReadKind = "ok" | "empty" | "below" | "above" | "malformed";

export interface NumericReading {
  /** The text as the field should show it: digits and one separator. */
  text: string;
  kind: NumericReadKind;
  /** The committed number, or null while empty, outside the bounds or malformed. */
  value: number | null;
}

/** Keeps digits and one separator (comma, dot or the Arabic decimal mark) and
 *  at most `decimals` places. "7,5" and "7.5" both survive and read the same.
 *  A whole-number field keeps every separator VISIBLE ("45,5" stays "45,5") and
 *  read() refuses it: nothing is dropped or cut, so no later key can land on a
 *  different number than the one on screen. */
export function filterNumericText(raw: string, decimals: number): string {
  return sanitizeStepperText(raw, decimals);
}

const NUMERAL = "0-9\\u0660-\\u0669\\u06F0-\\u06F9";
const CLEAN = new RegExp(`^[${NUMERAL}]*[.,\\u066B]?[${NUMERAL}]*$`);

function read(raw: string, typed: boolean, b: NumericBounds): NumericReading {
  const text = filterNumericText(raw, b.decimals);
  const r = readStepperText(text, b);
  // One character appended at the end is typing: a stray letter or a second
  // separator is simply not entered. Anything else (a paste, a replaced
  // selection) must be a plain number; "-3", "1e2" and "7.5.5" are refused and
  // said so, rather than quietly turned into another number.
  let clean = true;
  // A separator in a whole-number field, typed or pasted, is an error on screen.
  if (b.decimals <= 0 && hasDecimalSeparator(text)) {
    return { text, kind: "malformed", value: null };
  }
  if (!typed) {
    const t = raw.trim();
    clean = CLEAN.test(t);
    if (clean && b.decimals > 0) {
      const sep = t.search(/[.,\u066B]/);
      if (sep >= 0 && t.length - sep - 1 > b.decimals) clean = false;
    }
  }
  if (!clean) return { text, kind: "malformed", value: null };
  return { text, kind: r.kind, value: r.kind === "ok" ? r.value : null };
}

/** Reads a whole string as if it arrived at once (a paste, a stored value). */
export function readNumeric(raw: string, b: NumericBounds): NumericReading {
  return read(raw, false, b);
}

/** raw is prev with characters taken out (backspace, a cut selection). */
function isDeletion(raw: string, prev: string): boolean {
  if (raw.length >= prev.length) return false;
  let i = 0;
  for (const ch of prev) {
    if (i < raw.length && raw[i] === ch) i++;
  }
  return i === raw.length;
}

/** Reads what the input now holds, given what it held a moment ago. */
export function readNumericInput(raw: string, prev: string, b: NumericBounds): NumericReading {
  const appended = raw.length === prev.length + 1 && raw.startsWith(prev);
  return read(raw, appended || isDeletion(raw, prev), b);
}

/** True when the field already shows `value`: its own echo coming back through
 *  the parent. Anything else came from outside (a chip, a slider, a tap on an
 *  offer) and must replace the text. */
export function fieldShowsValue(reading: NumericReading, value: number | null): boolean {
  if (reading.kind === "ok") return value != null && Math.abs((reading.value as number) - value) <= 1e-9;
  return value == null;
}

/**
 * Which error the field shows under itself, if any. Above the maximum (and a
 * malformed paste) is wrong the moment it is shown; below the minimum is only
 * wrong once the user leaves the field, because "1" on the way to "110" is not
 * a mistake. An empty field is an error only when it is required.
 */
export function numericError(
  kind: NumericReadKind,
  opts: { blurred: boolean; required: boolean }
): "below" | "above" | "required" | "malformed" | null {
  if (kind === "above") return "above";
  if (kind === "malformed") return "malformed";
  if (kind === "below") return opts.blurred ? "below" : null;
  if (kind === "empty") return opts.required && opts.blurred ? "required" : null;
  return null;
}

/** - / + act only on a number or an empty field; on refused text they do nothing,
 *  so a rejected "150" never jumps to a step from somewhere else. */
export function stepAllowed(kind: NumericReadKind, required = false): boolean {
  return kind === "ok" || (kind === "empty" && !required);
}

/** Whether the screen may act on the field: false for any text the field
 *  refuses to commit (outside the bounds, or empty on a required field). */
export function numericValid(kind: NumericReadKind, required: boolean): boolean {
  return kind === "ok" || (kind === "empty" && !required);
}

export interface NumericStepConfig extends NumericBounds {
  step: number;
}

/**
 * A - / + press. From an empty field "+" lands on the smallest value the field
 * accepts (at least one step), and "-" leaves it empty: the field never fills
 * itself, and the first number is always the user's own press.
 */
export function stepNumeric(
  current: number | null,
  dir: 1 | -1,
  c: NumericStepConfig
): number | null {
  const q = c.decimals > 0 ? Math.pow(10, c.decimals) : 1;
  if (current == null) {
    if (dir < 0) return null;
    let start = Math.max(c.min ?? 0, c.step);
    if (c.max != null) start = Math.min(c.max, start);
    return Math.round(start * q) / q;
  }
  let v = Math.round((current + dir * c.step) * q) / q;
  if (c.max != null) v = Math.min(c.max, v);
  if (c.min != null) v = Math.max(c.min, v);
  return v;
}

/** True when a press in `dir` cannot change the value (the button greys out). */
export function stepIsBlocked(
  current: number | null,
  dir: 1 | -1,
  c: NumericStepConfig
): boolean {
  const next = stepNumeric(current, dir, c);
  return next === current;
}

/* ── Entry bounds, one place ───────────────────────────────────────────────
 * The carb ratio and correction-factor bounds live in lib/calcSetup.ts next to
 * the rest of the ratio rules. Dose and glucose entry are here. */

/** A meal dose typed in the calculator, in units. */
export const DOSE_BOUNDS = { min: 0, max: 100, decimals: 2, step: 0.5 } as const;

/** One logged injection (injection tab, basal confirm, the injection editor).
 *  Wider than a meal dose and never below BASAL_DAILY_BOUNDS.max: a profile's daily basal fills a basal injection. */
export const INJECTION_DOSE_BOUNDS = { min: 0, max: 200, decimals: 2, step: 0.5 } as const;

/** The daily long-acting total, Profile and onboarding alike. */
export const BASAL_DAILY_BOUNDS = { min: 0, max: 200, decimals: 1, step: 0.5 } as const;

/**
 * The upper bound while EDITING a stored record: never below the value the
 * record already holds, so an older entry above the current limit can still be
 * opened and corrected (its site, time or note) without first lowering the dose.
 */
export function editableMax(max: number, original: number | null | undefined): number {
  return original != null && Number.isFinite(original) ? Math.max(max, original) : max;
}

/** A typed glucose reading, in the profile's display unit (20-600 mg/dL). */
export const GLUCOSE_ENTRY_BOUNDS = {
  mgdl: { min: 20, max: 600, decimals: 0 },
  mmol: { min: 1.1, max: 33.3, decimals: 1 },
} as const;

export function glucoseEntryBounds(unit: GlucoseUnit): NumericBounds {
  return GLUCOSE_ENTRY_BOUNDS[unit === "mmol" ? "mmol" : "mgdl"];
}
