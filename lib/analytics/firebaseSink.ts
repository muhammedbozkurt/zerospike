import { setAnalyticsSink, setCrashSink } from "./index";
import { getAnalyticsConsent, isAnalyticsEnabledNow, onAnalyticsEnabledChange } from "./optOut";

/**
 * Attaches Firebase Analytics + Crashlytics as the live sink for the analytics
 * facade. Called once from app/_layout.tsx bootstrap.
 *
 * Skipped in __DEV__: the native @react-native-firebase modules only exist in a
 * prebuilt dev-client / release binary (not Expo Go), and dev already mirrors
 * every event to the console. The modules are lazy-required so a build without
 * the native side degrades to the no-op facade instead of crashing.
 *
 * Usage analytics are opt-in (./optOut). Two layers keep Firebase quiet until
 * the user says yes: firebase.json at the repo root switches Firebase's
 * automatic collection off in the native build, and this sink then turns
 * collection on only while the stored consent is "granted". The native flag is
 * written at every launch (true for "granted", false for "declined" and
 * "unanswered"), so it cannot drift from the answer, and it follows the switch
 * live. Events are handed to Firebase only while granted, too. Crashlytics is
 * not part of this switch: crash reports stay on (legitimate interest, see the
 * privacy policy; firebase.json keeps its auto collection on).
 */
export function initAnalyticsSink(): void {
  if (__DEV__) return;
  try {
    const analytics = require("@react-native-firebase/analytics").default;
    const crashlytics = require("@react-native-firebase/crashlytics").default;
    // Resolves once the stored answer is known; events logged before then wait
    // here, in order, and are judged by it.
    const consentKnown = getAnalyticsConsent();
    setAnalyticsSink((name, params) => {
      void consentKnown
        .then(async () => {
          if (isAnalyticsEnabledNow()) await analytics().logEvent(name, params);
        })
        .catch(() => {});
    });
    setCrashSink((error) => {
      const e = error instanceof Error ? error : new Error(String(error));
      crashlytics().recordError(e);
    });
    onAnalyticsEnabledChange((enabled) =>
      analytics().setAnalyticsCollectionEnabled(enabled)
    );
    void consentKnown
      .then((state) => analytics().setAnalyticsCollectionEnabled(state === "granted"))
      .catch(() => {});
  } catch {
    // native module missing (e.g. Expo Go); stay on the no-op facade
  }
}

/**
 * After "Delete my server records" succeeded: Firebase keeps its own app
 * instance and what it collected under it, so the SDK is told to forget both
 * (the next event, if the user is opted in, starts a new instance). Skipped in
 * __DEV__ like the sink itself, and never throws: the server records are gone
 * whether or not this works.
 */
export async function resetFirebaseAnalyticsData(): Promise<void> {
  if (__DEV__) return;
  try {
    const analytics = require("@react-native-firebase/analytics").default;
    await analytics().resetAnalyticsData();
  } catch {
    // native module missing or the reset failed
  }
}
