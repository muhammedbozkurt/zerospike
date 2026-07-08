import { setAnalyticsSink, setCrashSink } from "./index";

/**
 * Attaches Firebase Analytics + Crashlytics as the live sink for the analytics
 * facade. Called once from app/_layout.tsx bootstrap.
 *
 * Skipped in __DEV__: the native @react-native-firebase modules only exist in a
 * prebuilt dev-client / release binary (not Expo Go), and dev already mirrors
 * every event to the console. The modules are lazy-required so a build without
 * the native side degrades to the no-op facade instead of crashing.
 */
export function initAnalyticsSink(): void {
  if (__DEV__) return;
  try {
    const analytics = require("@react-native-firebase/analytics").default;
    const crashlytics = require("@react-native-firebase/crashlytics").default;
    setAnalyticsSink((name, params) => {
      analytics().logEvent(name, params);
    });
    setCrashSink((error) => {
      const e = error instanceof Error ? error : new Error(String(error));
      crashlytics().recordError(e);
    });
  } catch {
    // native module missing (e.g. Expo Go) — stay on the no-op facade
  }
}
