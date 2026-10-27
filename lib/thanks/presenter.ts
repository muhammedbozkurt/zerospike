/**
 * The state machine behind the thank-you sheet's presentation, kept out of the
 * component so it can be driven with fake timers under plain node. Timers, the
 * clock-free gate, the slot claim and every side effect are injected.
 *
 * - schedule(): after SETTLE_MS (a Modal that is still dismissing would make iOS
 *   refuse this one) the gate is checked AGAIN, the slot is claimed, an attempt
 *   is counted and the sheet goes up.
 * - A Modal that has not reported onShown within SHOW_TIMEOUT_MS was refused: it
 *   is taken down, the slot is given back and the moment stays pending (nothing
 *   is stamped), then the flow is nudged to try again, up to MAX attempts.
 * - confirm() is the ONLY place a moment becomes "seen": it clears pending and
 *   reports it, and only once per presentation.
 * - background() drops the timers and any presentation that never confirmed,
 *   and keeps the presenter inert (schedule() and a late settle callback do
 *   nothing) until foreground(): taking the sheet down re-runs the host's
 *   effects, which would otherwise set up a fresh presentation in the
 *   background. foreground() resets the attempt budget and restarts the flow
 *   once, so a pending moment that used up its attempts is tried again when the
 *   app comes back.
 */

export const SETTLE_MS = 1200;
export const SHOW_TIMEOUT_MS = 4000;
export const MAX_SHOW_ATTEMPTS = 5;

export interface PresenterDeps {
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  /** Whether nothing stands in the way right now (tab screen, no Modal, ...). */
  clear: () => boolean;
  /** The one-sheet slot (lib/sheetClaim); null when another sheet holds it. */
  claim: () => (() => void) | null;
  setVisible: (visible: boolean) => void;
  /** The moment is no longer waiting in memory. */
  clearPending: () => void;
  /** The sheet is really on screen: log it and stamp it on disk. */
  onSeen: () => void;
  /** Ask the host to run its effects again. */
  nudge: () => void;
  settleMs?: number;
  timeoutMs?: number;
  maxAttempts?: number;
}

export function createSheetPresenter(d: PresenterDeps) {
  const settleMs = d.settleMs ?? SETTLE_MS;
  const timeoutMs = d.timeoutMs ?? SHOW_TIMEOUT_MS;
  const maxAttempts = d.maxAttempts ?? MAX_SHOW_ATTEMPTS;

  let attempts = 0;
  let confirmed = true;
  let settle: unknown = null;
  let watchdog: unknown = null;
  let release: (() => void) | null = null;
  let inBackground = false;

  const stop = (handle: unknown) => {
    if (handle !== null) d.clearTimer(handle);
  };
  const cancelSettle = () => {
    stop(settle);
    settle = null;
  };
  const cancelWatchdog = () => {
    stop(watchdog);
    watchdog = null;
  };
  const releaseClaim = () => {
    release?.();
    release = null;
  };

  /** Takes an unconfirmed presentation down; the moment stays pending. */
  const abandon = () => {
    confirmed = true;
    d.setVisible(false);
    releaseClaim();
  };

  return {
    /** Starts (or restarts) the settle wait. Returns the cancel for the effect cleanup. */
    schedule(): () => void {
      cancelSettle();
      if (inBackground) return cancelSettle;
      settle = d.setTimer(() => {
        settle = null;
        if (inBackground || !d.clear() || attempts >= maxAttempts) return;
        const claim = d.claim();
        if (!claim) return;
        attempts += 1;
        release = claim;
        confirmed = false;
        d.setVisible(true);
        watchdog = d.setTimer(() => {
          watchdog = null;
          if (confirmed) return;
          abandon();
          d.nudge();
        }, timeoutMs);
      }, settleMs);
      return cancelSettle;
    },
    /** The sheet reported onShown (or was closed): the one place a moment is seen. */
    confirm(): void {
      if (confirmed) return;
      confirmed = true;
      cancelWatchdog();
      d.clearPending();
      d.onSeen();
    },
    /** The slot is held only while the sheet is up. */
    releaseClaim,
    background(): void {
      inBackground = true;
      cancelSettle();
      cancelWatchdog();
      if (!confirmed) abandon();
    },
    foreground(): void {
      inBackground = false;
      attempts = 0;
      d.nudge();
    },
    dispose(): void {
      cancelSettle();
      cancelWatchdog();
      releaseClaim();
    },
    attempts: () => attempts,
  };
}
