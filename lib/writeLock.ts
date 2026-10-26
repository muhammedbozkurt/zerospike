/**
 * Serial queue for multi-statement DB write units. expo-sqlite's
 * withTransactionAsync is not exclusive, so two overlapping units can collide
 * on BEGIN and leave one half applied. Not re-entrant: a unit must not call
 * another unit guarded by the same lock.
 */
export function createWriteLock(): <T>(run: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(run: () => Promise<T>): Promise<T> => {
    const next = tail.then(run, run);
    tail = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  };
}
