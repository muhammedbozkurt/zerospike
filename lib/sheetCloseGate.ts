/**
 * Lets work that raises a dialog wait until the glucose entry sheet is really
 * gone. A confirm / action sheet opened while that sheet is still up is owned
 * by the sheet's FeedbackHost (lib/feedback.ts activeHostId), and the host's
 * unmount abandons it: the dialog flashed for the length of the slide-out and
 * resolved as "Later". Dependency-free so it runs under plain node.
 *
 * - markOpen(): the sheet is up (a save is in flight).
 * - markClosed(): the sheet reported onClose. Waiters are released settleMs
 *   later, after React has unmounted the sheet's host.
 * - whenClear(): resolves true once the sheet is closed and settled (at once if
 *   it already is), false when it did not close within maxWaitMs, in which case
 *   the caller raises nothing.
 */
export const SHEET_CLOSE_SETTLE_MS = 400;
export const SHEET_CLOSE_MAX_WAIT_MS = 4000;

export interface SheetCloseGateDeps {
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  settleMs?: number;
  maxWaitMs?: number;
}

export function createSheetCloseGate(d: SheetCloseGateDeps) {
  const settleMs = d.settleMs ?? SHEET_CLOSE_SETTLE_MS;
  const maxWaitMs = d.maxWaitMs ?? SHEET_CLOSE_MAX_WAIT_MS;
  let open = false;
  let settleTimer: unknown = null;
  const waiters = new Set<(clear: boolean) => void>();

  const stopSettle = () => {
    if (settleTimer !== null) d.clearTimer(settleTimer);
    settleTimer = null;
  };
  const release = () => {
    settleTimer = null;
    const all = [...waiters];
    waiters.clear();
    all.forEach((w) => w(true));
  };

  return {
    markOpen(): void {
      open = true;
      stopSettle();
    },
    markClosed(): void {
      open = false;
      stopSettle();
      settleTimer = d.setTimer(release, settleMs);
    },
    whenClear(): Promise<boolean> {
      if (!open && settleTimer === null) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        let giveUp: unknown = null;
        const done = (clear: boolean) => {
          if (giveUp !== null) d.clearTimer(giveUp);
          waiters.delete(done);
          resolve(clear);
        };
        waiters.add(done);
        giveUp = d.setTimer(() => {
          giveUp = null;
          done(false);
        }, maxWaitMs);
      });
    },
  };
}
