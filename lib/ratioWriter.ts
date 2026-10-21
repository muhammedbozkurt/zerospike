import {
  ratioConfirmDraftPatch,
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
 *    while the new value waits for its pause;
 *  - ticking the box writes the draft's four numbers AND the flag as ONE patch,
 *    so a confirmation can never be stored beside numbers it does not vouch for,
 *    and a failed write leaves the profile exactly as it was;
 *  - a failed write puts the draft back, so the next flush tries it again.
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
  /** Tick or untick the box. Ticking writes the draft on screen together with
   *  the flag (one patch); resolves true only when that write reached the
   *  profile. Unticking withdraws the confirmation and resolves false. */
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
  let lastDraft: RatioFields | null = null;
  let timer: unknown = null;
  let tail: Promise<void> = Promise.resolve();

  // Every write gets the next generation. A write that fails AFTER a newer one
  // was planned must not touch the writer's picture of the profile or bring its
  // old draft back: the newer write already carries the whole set, and putting
  // the stale draft back would overwrite what the user confirmed with it.
  let gen = 0;

  function enqueue(patch: RatioPatch, onFail?: () => void): Promise<boolean> {
    const mine = ++gen;
    const task = tail.then(async () => {
      try {
        await opts.persist(patch);
        return true;
      } catch (e) {
        if (mine === gen) {
          opts.onError?.(e);
          if (opts.reload) written = opts.reload();
          onFail?.();
        }
        return false;
      }
    });
    tail = task.then(() => undefined);
    return task;
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
    void enqueue(patch, () => {
      if (!pending) pending = draft;
    });
  }

  return {
    update(draft) {
      pending = draft;
      lastDraft = draft;
      if (
        written &&
        written.ratios_confirmed === 1 &&
        ratioDraftDiffers(written, draft, unitOf())
      ) {
        const patch = { ratios_confirmed: unconfirmedFlag(written) };
        written = { ...written, ...patch };
        void enqueue(patch);
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
      cancelTimer();
      if (!written) return false;
      if (!checked) {
        plan();
        const off = ratioConfirmPatch(written, false);
        if (off) {
          written = { ...written, ...off };
          void enqueue(off);
        }
        await tail;
        return false;
      }
      const draft = pending ?? lastDraft;
      const patch = draft ? ratioConfirmDraftPatch(draft) : ratioConfirmPatch(written, true);
      if (!patch) {
        plan();
        await tail;
        return false;
      }
      pending = null;
      written = { ...written, ...patch };
      return enqueue(patch, () => {
        if (!pending) pending = draft ?? null;
      });
    },
    cancelTimer,
  };
}

/**
 * The box's press handler: one press at a time, and "confirmed" is reported at
 * most once. A second tap while the first write is still running is swallowed
 * (it used to run a second confirm that UNticked the box, and a second
 * router.back() that also closed the calculator's open record).
 */
export function createConfirmGate(opts: {
  confirm: (checked: boolean) => Promise<boolean>;
  /** Called once, after the first successful confirmation. */
  onConfirmed: () => void;
  onBusy?: (busy: boolean) => void;
}): { press: (checked: boolean) => Promise<void>; isBusy: () => boolean } {
  let busy = false;
  let confirmedOnce = false;
  return {
    isBusy: () => busy,
    async press(checked) {
      if (busy) return;
      busy = true;
      opts.onBusy?.(true);
      try {
        const ok = await opts.confirm(checked);
        if (ok && !confirmedOnce) {
          confirmedOnce = true;
          opts.onConfirmed();
        }
      } finally {
        busy = false;
        opts.onBusy?.(false);
      }
    },
  };
}
