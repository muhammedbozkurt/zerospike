import type { Scheme } from "./tokens";

let locks = 0;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((l) => l());
}

export function acquireRemountLock(): () => void {
  locks += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    locks -= 1;
    if (locks === 0) notify();
  };
}

export function isRemountLocked(): boolean {
  return locks > 0;
}

export function subscribeRemountLock(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** While locked, an OS-driven scheme change waits; the applied scheme stays. */
export function heldScheme(wanted: Scheme, applied: Scheme | null, locked: boolean): Scheme {
  return locked && applied ? applied : wanted;
}

/** Same hold for the Increase Contrast flag: it also remounts the tree (the
 *  ThemeRemount key), so it must wait for the lock like the scheme does. */
export function heldFlag(wanted: boolean, applied: boolean | null, locked: boolean): boolean {
  return locked && applied !== null ? applied : wanted;
}
