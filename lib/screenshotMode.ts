import { useSyncExternalStore } from "react";

/**
 * Store-screenshot mode: a build-time + env double lock so it can NEVER reach a
 * release binary.
 *
 *  1. `__DEV__`: false in any production build (Metro strips the dev branch).
 *  2. `EXPO_PUBLIC_SCREENSHOT_MODE === "1"`: an env flag set only by the local
 *     capture pipeline (scripts/store-shots.sh); never set in CI/release.
 *
 * BOTH must hold. The check lives here alone so there is exactly one place to
 * audit before a store submission. Everything screenshot-related (the seed, the
 * capture-only route params) gates on this function.
 */
export function isScreenshotMode(): boolean {
  return __DEV__ && process.env.EXPO_PUBLIC_SCREENSHOT_MODE === "1";
}

/**
 * Capture-only platform override (?scPlatform=android on any screenshot
 * deep-link). The Android store art is composed from the SAME iOS captures, so
 * a frame meant for Play must leave out chrome that only exists on iOS (the
 * dashboard's Apple Health card - Health Connect is deliberately absent from
 * the Android build).
 *
 * It is module state rather than a param read at the leaf because the param
 * arrives on the ROOT deep-link and the tab screen re-mounts underneath it. The
 * flag is STICKY for the shot and cleared by the very next link that does not
 * carry scPlatform=android (scPlatform=ios, or no param at all), so one Android
 * frame can never bleed into the next capture of the same pass.
 *
 * Behind the same double lock as everything else here: setScreenshotPlatform is
 * a no-op unless isScreenshotMode(), so the flag is permanently false in any
 * release binary and the card renders exactly as it always has.
 */
let androidSourceShot = false;
const androidSourceListeners = new Set<() => void>();

export function setScreenshotPlatform(value?: string | null): void {
  const next = isScreenshotMode() && value === "android";
  if (next === androidSourceShot) return;
  androidSourceShot = next;
  for (const listener of androidSourceListeners) listener();
}

function subscribeAndroidSource(listener: () => void): () => void {
  androidSourceListeners.add(listener);
  return () => {
    androidSourceListeners.delete(listener);
  };
}

function getAndroidSource(): boolean {
  return androidSourceShot;
}

/** True while the current capture stands in for an Android frame. */
export function useScreenshotAndroidSource(): boolean {
  return useSyncExternalStore(
    subscribeAndroidSource,
    getAndroidSource,
    getAndroidSource
  );
}
