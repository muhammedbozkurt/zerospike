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
