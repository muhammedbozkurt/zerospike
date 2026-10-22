/**
 * Tiny module-cache store for an OS flag whose first read is async. No
 * react-native import, so scripts/theme.test.ts runs it in plain Node.
 * `value` is readable synchronously from the first render; `ready` flips once
 * the first real answer (or a failure) arrived, so a consumer can hold its
 * first paint until the flag is known instead of mounting twice.
 */
export interface FlagStore {
  getValue(): boolean;
  isReady(): boolean;
  /** A real reading: marks the store ready and publishes a change. */
  set(v: boolean): void;
  /** The first read failed or never answered: ready, value unchanged. */
  markReady(): void;
  subscribe(l: () => void): () => void;
}

export function createFlagStore(initial = false): FlagStore {
  let value = initial;
  let ready = false;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  return {
    getValue: () => value,
    isReady: () => ready,
    set(v) {
      const changed = v !== value || !ready;
      value = v;
      ready = true;
      if (changed) emit();
    },
    markReady() {
      if (ready) return;
      ready = true;
      emit();
    },
    subscribe(l) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
  };
}
