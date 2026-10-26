/**
 * Two small guards for screens that write a record and then do more.
 *
 * runExclusive: a ref-based single-flight lock. State-based "saving" flags lag
 * a render behind, so two quick taps both pass them; the ref flips synchronously.
 *
 * runSideStep: a step that follows the record write. The record exists by then,
 * so a failing step must be reported and skipped, never allowed to unwind the
 * screen and leave a saved row behind a sheet that looks unsaved.
 */

export interface SaveLock {
  current: boolean;
}

/** Runs `fn` unless it is already running. Resolves true when it ran to the end,
 *  false when it was skipped or threw (after `onError`). */
export async function runExclusive(
  lock: SaveLock,
  fn: () => Promise<void>,
  onError: (err: unknown) => void
): Promise<boolean> {
  if (lock.current) return false;
  lock.current = true;
  try {
    await fn();
    return true;
  } catch (err) {
    try {
      onError(err);
    } catch {
      // reporting must not mask the release below
    }
    return false;
  } finally {
    lock.current = false;
  }
}

/** Awaits `fn`; a throw goes to `onFail` with the step name and resolves false. */
export async function runSideStep(
  step: string,
  fn: () => unknown,
  onFail: (err: unknown, step: string) => void
): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (err) {
    try {
      onFail(err, step);
    } catch {
      // see runExclusive
    }
    return false;
  }
}
