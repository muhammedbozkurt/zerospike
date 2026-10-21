import {
  ratioConfirmPatch,
  ratioDraftDiffers,
  ratioDraftPatch,
  unconfirmedFlag,
  type RatioFields,
} from "./calcSetup";
import type { GlucoseUnit } from "./db/types";

/**
 * Writes the calculator's four numbers from Profile and Targets without losing
 * or reordering anything.
 *
 * The field used to save on every keystroke, comparing against the profile in
 * React context, which only refreshes after a write lands. Typing "12" saved
 * "1", then compared "12" against a context that still said the old value, and
 * two overlapping updates could land in either order. Here:
 *  - typing only records a draft; the write waits for a pause (delayMs) or an
 *    explicit flush (blur, leaving the screen, ticking the box);
 *  - "what is stored" is the last set this writer sent, held in the writer, not
 *    the possibly stale profile;
 *  - writes go through one queue, strictly in the order they were planned;
 *  - the first edit of a CONFIRMED set withdraws the confirmation at once (a
 *    flag-only write), so the figures never outlive the numbers they came from
 *    while the new value waits for its pause.
 *
 * One writer serves the calculator's sheet and Profile and Targets, so both
 * write the same profile record in the same way. Values are kept as soon as
 * they are typed, even with other fields still empty.
 */

export interface StoredRatios {
  carb_ratio_breakfast: number;
  carb_ratio_lunch: number;
  carb_ratio_dinner: number;
  insulin_sensitivity_factor: number;
  ratios_confirmed: number;
}

export type RatioPatch = Partial<StoredRatios>;

export interface RatioWriter {
  /** Record the latest draft; the write follows after a pause. */
  update(draft: RatioFields): void;
  /** Write whatever is pending now; resolves once the queue has drained. */
  flush(): Promise<void>;
  /** Tick or untick the box: flushes first, then queues the flag. Resolves true
   *  only when the box was ticked and every write reached the profile. */
  confirm(checked: boolean): Promise<boolean>;
  /** Drop the pending timer (the screen is going away after a final flush). */
  cancelTimer(): void;
}

export const RATIO_WRITE_DELAY_MS = 700;

export function createRatioWriter(opts: {
  stored: StoredRatios | null;
  persist: (patch: RatioPatch) => Promise<void>;
  /** After a failed write: the freshest stored set to compare against. */
  reload?: () => StoredRatios | null;
  /** The profile's glucose unit, for comparing the correction factor as shown. */
  unit?: () => GlucoseUnit;
  onError?: (e: unknown) => void;
  delayMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}): RatioWriter {
  const delayMs = opts.delayMs ?? RATIO_WRITE_DELAY_MS;
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));

  const unitOf = () => opts.unit?.() ?? "mgdl";
  let written: StoredRatios | null = opts.stored;
  let pending: RatioFields | null = null;
  let timer: unknown = null;
  let tail: Promise<void> = Promise.resolve();
  let failed = false;

  function enqueue(patch: RatioPatch): void {
    tail = tail.then(async () => {
      try {
        await opts.persist(patch);
      } catch (e) {
        failed = true;
        opts.onError?.(e);
        if (opts.reload) written = opts.reload();
      }
    });
  }

  function cancelTimer(): void {
    if (timer != null) {
      clearTimer(timer);
      timer = null;
    }
  }

  function plan(): void {
    const draft = pending;
    pending = null;
    if (!draft || !written) return;
    const patch = ratioDraftPatch(written, draft, unitOf());
    if (!patch) return;
    written = { ...written, ...patch };
    enqueue(patch);
  }

  return {
    update(draft) {
      pending = draft;
      if (
        written &&
        written.ratios_confirmed === 1 &&
        ratioDraftDiffers(written, draft, unitOf())
      ) {
        const patch = { ratios_confirmed: unconfirmedFlag(written) };
        written = { ...written, ...patch };
        enqueue(patch);
      }
      cancelTimer();
      timer = setTimer(() => {
        timer = null;
        plan();
      }, delayMs);
    },
    flush() {
      cancelTimer();
      plan();
      return tail;
    },
    async confirm(checked) {
      failed = false;
      cancelTimer();
      plan();
      let queued = false;
      if (written) {
        const patch = ratioConfirmPatch(written, checked);
        if (patch) {
          written = { ...written, ...patch };
          enqueue(patch);
          queued = true;
        }
      }
      await tail;
      return checked && queued && !failed;
    },
    cancelTimer,
  };
}
