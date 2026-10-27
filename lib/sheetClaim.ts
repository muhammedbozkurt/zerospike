/**
 * One-slot claim for the self-opening sheets (What's new, the thank-you sheet).
 * Two Modals cannot present together, and the overlay count (registerOverlay)
 * only rises once a sheet has rendered, which is later than the moment it
 * decides to open. A host claims the slot synchronously right before it decides,
 * so the second one sees the first and waits; releasing tells the waiting host
 * to look again, so neither sheet is lost. Dependency-free for plain node tests.
 */

let held = false;
const listeners = new Set<() => void>();

/** The release function, or null when another sheet already holds the slot. */
export function claimSheet(): (() => void) | null {
  if (held) return null;
  held = true;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    held = false;
    listeners.forEach((cb) => cb());
  };
}

export function sheetClaimed(): boolean {
  return held;
}

export function onSheetRelease(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
