import { trackSaveFailed } from "./analytics/saveFailed";
import type { PeriodTag } from "./db/types";

/**
 * Save sequencing of the glucose entry sheet (components/GlucoseInputSheet.tsx,
 * app/(tabs)/index.tsx, app/journal.tsx), kept free of React so the order is
 * testable: the write runs while the sheet is still open, the sheet leaves only
 * after it landed, and a failed write leaves the sheet (and the typed value)
 * where it is for a retry. Mirrors the calculator's save (catch + logCrash +
 * saveFailed toast, screen kept).
 */

/** `false` (or a throw) from a submit handler means the write did not land. */
export type SubmitResult = boolean | void;

export async function settleSheetSubmit(
  submit: () => Promise<SubmitResult> | SubmitResult
): Promise<boolean> {
  try {
    return (await submit()) !== false;
  } catch {
    // A write that threw is reported by attemptGlucoseWrite; what reaches this
    // catch is anything else the submit did around it.
    trackSaveFailed("glucose", "side");
    return false;
  }
}

export async function runSheetSubmit(deps: {
  submit: () => Promise<SubmitResult> | SubmitResult;
  animateOut: (done: () => void) => void;
  onClose: () => void;
  onFailed: () => void;
}): Promise<boolean> {
  const landed = await settleSheetSubmit(deps.submit);
  if (!landed) {
    deps.onFailed();
    return false;
  }
  deps.animateOut(deps.onClose);
  return true;
}

/** The screen's write step: never throws, reports once, so the sheet can stay. */
export async function attemptGlucoseWrite<T>(
  write: () => Promise<T>,
  onFailed: (err: unknown) => void
): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await write() };
  } catch (err) {
    trackSaveFailed("glucose", "write");
    onFailed(err);
    return { ok: false };
  }
}

export interface GlucoseSheetState<E> {
  open: boolean;
  edit: E | null;
  initialPeriod: PeriodTag;
}

/** A "+ Kayit > Kan sekeri" open is always a NEW reading, whatever edit
 *  target an earlier correction left behind. */
export function openNewReadingState<E>(
  prev: GlucoseSheetState<E>,
  period: PeriodTag
): GlucoseSheetState<E> {
  return { ...prev, open: true, edit: null, initialPeriod: period };
}
