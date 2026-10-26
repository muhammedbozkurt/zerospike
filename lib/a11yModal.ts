import { useEffect, useSyncExternalStore } from "react";

/**
 * accessibilityViewIsModal only silences the SIBLINGS of the modal view. The
 * in-tree sheets (quick add, meal compose, carb estimate) sit inside a tab
 * screen, so the tab bar, which lives above the screen, stayed in the
 * VoiceOver tree. A sheet registers here while it is up and the tab layout
 * hides its bar from assistive tech for that time.
 */
let open = 0;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

export function registerA11yModal(): () => void {
  open += 1;
  emit();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    open -= 1;
    emit();
  };
}

export function a11yModalCount(): number {
  return open;
}

/** Call with the sheet's visibility; true while the sheet is on screen. */
export function useA11yModalPresence(visible: boolean): void {
  useEffect(() => {
    if (!visible) return;
    return registerA11yModal();
  }, [visible]);
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useA11yModalOpen(): boolean {
  return useSyncExternalStore(subscribe, () => open > 0, () => false);
}
