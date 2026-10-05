import { parseDecimalText, sanitizeNumberText } from "./numberInput";

export interface StepperBounds {
  min?: number;
  max?: number;
  decimals: number;
}

export type StepperRead =
  | { kind: "ok"; value: number }
  | { kind: "empty" }
  | { kind: "below"; value: number }
  | { kind: "above"; value: number };

/**
 * Pure rules behind components/Stepper's typed field. The invariant: the
 * parent only ever receives a value that is exactly what the field shows and
 * lies inside [min, max]. Empty or out-of-range text is never committed; the
 * screen learns about it through validity instead.
 */

/** Digits plus one separator, with at most `decimals` digits after it. */
export function sanitizeStepperText(raw: string, decimals: number): string {
  const cleaned = sanitizeNumberText(raw, decimals > 0);
  if (decimals <= 0) return cleaned;
  const m = cleaned.search(/[.,٫]/);
  if (m < 0) return cleaned;
  return cleaned.slice(0, m + 1 + decimals);
}

/** No snapping and no rounding: what was typed is what is read. */
export function readStepperText(text: string, b: StepperBounds): StepperRead {
  const parsed = parseDecimalText(text);
  if (parsed == null) return { kind: "empty" };
  if (b.min != null && parsed < b.min) return { kind: "below", value: parsed };
  if (b.max != null && parsed > b.max) return { kind: "above", value: parsed };
  return { kind: "ok", value: parsed };
}

/** A +/- press: round to `decimals`, then clamp to [min, max]. */
export function stepStepperValue(current: number, delta: number, b: StepperBounds): number {
  const q = b.decimals > 0 ? Math.pow(10, b.decimals) : 1;
  let v = Math.round((current + delta) * q) / q;
  if (b.max != null) v = Math.min(b.max, v);
  if (b.min != null) v = Math.max(b.min, v);
  return v;
}

/** Blur: valid text keeps the committed value, anything else returns to the value the field had on focus. */
export function resolveStepperBlur(
  read: StepperRead,
  baseline: number,
  current: number
): { value: number; emit: boolean } {
  if (read.kind === "ok") return { value: current, emit: false };
  return { value: baseline, emit: baseline !== current };
}

/** Unmount while invalid: only a fragment the parent actually received needs undoing. */
export function shouldRevertOnUnmount(valid: boolean, baseline: number, current: number): boolean {
  return !valid && baseline !== current;
}

/**
 * While focused, a prop value is the echo of the typed text only when the
 * field already reads that value; anything else came from outside (chip,
 * slider, another control) and must replace the text, even if it equals an
 * earlier emit.
 */
export function fieldShowsValue(text: string, value: number, b: StepperBounds): boolean {
  const r = readStepperText(text, b);
  return r.kind === "ok" && Math.abs(r.value - value) <= 1e-9;
}

/** Same reference when nothing changed, so setState bails out without a render. */
export function nextInvalidKeys(
  prev: ReadonlySet<string>,
  key: string,
  valid: boolean
): ReadonlySet<string> {
  if (valid === !prev.has(key)) return prev;
  const next = new Set(prev);
  if (valid) next.delete(key);
  else next.add(key);
  return next;
}
