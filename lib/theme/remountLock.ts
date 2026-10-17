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
