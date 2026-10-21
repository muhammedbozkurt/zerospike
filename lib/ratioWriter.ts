import {
  ratioConfirmPatch,
  ratioSetPatch,
  type RatioFields,
} from "./calcSetup";

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
 *  - writes go through one queue, strictly in the order they were planned.
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
  /** Tick or untick the box: flushes first, then queues the flag. */
  confirm(checked: boolean): Promise<void>;
  /** Drop the pending timer (the screen is going away after a final flush). */
  cancelTimer(): void;
}

export const RATIO_WRITE_DELAY_MS = 700;

export function createRatioWriter(opts: {
  stored: StoredRatios | null;
  persist: (patch: RatioPatch) => Promise<void>;
  /** After a failed write: the freshest stored set to compare against. */
  reload?: () => StoredRatios | null;
  onError?: (e: unknown) => void;
  delayMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}): RatioWriter {
  const delayMs = opts.delayMs ?? RATIO_WRITE_DELAY_MS;
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));

  let written: StoredRatios | null = opts.stored;
  let pending: RatioFields | null = null;
  let timer: unknown = null;
  let tail: Promise<void> = Promise.resolve();

  function enqueue(patch: RatioPatch): void {
    tail = tail.then(async () => {
      try {
        await opts.persist(patch);
      } catch (e) {
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
    const complete =
      draft.breakfast != null && draft.lunch != null && draft.dinner != null && draft.isfMgdl != null;
    let patch: RatioPatch | null = null;
    if (complete) {
      patch = ratioSetPatch(written, draft);
    } else if (written.ratios_confirmed === 1) {
      // A field was emptied: the numbers the box vouched for are no longer all
      // there, so the confirmation goes with them.
      patch = { ratios_confirmed: 0 };
    }
    if (!patch) return;
    written = { ...written, ...patch };
    enqueue(patch);
  }

  return {
    update(draft) {
      pending = draft;
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
      cancelTimer();
      plan();
      if (written) {
        const patch = ratioConfirmPatch(written, checked);
        if (patch) {
          written = { ...written, ...patch };
          enqueue(patch);
        }
      }
      await tail;
    },
    cancelTimer,
  };
}
