export const MINUTE_MS = 60_000;

interface AppStateLike {
  currentState: string;
  addEventListener: (type: "change", cb: (state: string) => void) => { remove: () => void };
}

interface Timers {
  setInterval: (cb: () => void, ms: number) => unknown;
  clearInterval: (id: unknown) => void;
}

/**
 * Calls `onTick` once a minute while the app is in the foreground, and once at
 * once on every return to it. Nothing runs in the background. The caller stops
 * it when the screen loses focus.
 */
export function startMinuteTick(
  onTick: () => void,
  appState: AppStateLike,
  timers: Timers = { setInterval: (cb, ms) => setInterval(cb, ms), clearInterval: (id) => clearInterval(id as never) }
): () => void {
  let id: unknown = null;
  const start = () => {
    if (id == null) id = timers.setInterval(onTick, MINUTE_MS);
  };
  const stop = () => {
    if (id != null) {
      timers.clearInterval(id);
      id = null;
    }
  };
  if (appState.currentState === "active") start();
  const sub = appState.addEventListener("change", (state) => {
    if (state === "active") {
      onTick();
      start();
    } else {
      stop();
    }
  });
  return () => {
    stop();
    sub.remove();
  };
}
