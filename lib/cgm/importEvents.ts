/**
 * A tiny in-process bus for "sensor data changed". The importers (Health,
 * Nightscout) publish after they wrote or removed rows, the mode setting
 * publishes when it changes, and any screen showing sensor data subscribes to
 * refresh. Dependency-free so it loads under plain Node.
 */

export type CgmChange = {
  kind: "import" | "mode" | "clear";
  profileId: string;
};

type Listener = (change: CgmChange) => void;

const listeners = new Set<Listener>();

export function subscribeCgmChanges(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitCgmChanged(change: CgmChange): void {
  for (const listener of [...listeners]) {
    try {
      listener(change);
    } catch {
      // one broken subscriber must not stop the others
    }
  }
}
