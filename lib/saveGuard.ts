export interface SaveLock {
  current: boolean;
}

export type ExclusiveResult<T> = { ran: true; value: T } | { ran: false };

/** A ref, not state: React state lags a render behind, so a second tap landing
 *  before the first re-render would still see the button as free. */
export async function runExclusive<T>(
  lock: SaveLock,
  fn: () => Promise<T>
): Promise<ExclusiveResult<T>> {
  if (lock.current) return { ran: false };
  lock.current = true;
  try {
    return { ran: true, value: await fn() };
  } finally {
    lock.current = false;
  }
}

/** True when the write went through; false (never a throw) when it failed, so
 *  the caller can say so and put the old value back. */
export async function tryWrite(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch {
    return false;
  }
}
