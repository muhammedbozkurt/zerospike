/**
 * What background delivery should be registered, as a pure decision so the
 * rule is testable without a device.
 *
 * Android: the one WorkManager task ("zerospike-health-sync", 15 minute floor)
 * runs when Health can sync in the background OR a Nightscout connection is
 * active and entitled. iOS: there is deliberately NO background task for
 * Nightscout (the BGTask mode is stripped from the build, plugins/
 * withIosNoProcessingMode.js); the only iOS background wake is the HealthKit
 * observer, which exists only while Health itself can run, and it pulls
 * Nightscout along. Otherwise iOS refreshes while the app is open.
 */
export interface BackgroundPlanInput {
  /** Platform.OS. */
  platform: string;
  /** Why Health cannot sync in the background, or null when it can. */
  healthBlocker: string | null;
  /** A Nightscout connection is active, the user is entitled and the secure
   *  store works (sourceSync.nightscoutBackgroundWanted). */
  nightscoutWanted: boolean;
}

export interface BackgroundPlan {
  androidTask: boolean;
  iosObserver: boolean;
}

export function planBackground(input: BackgroundPlanInput): BackgroundPlan {
  return {
    androidTask:
      input.platform === "android" && (input.healthBlocker === null || input.nightscoutWanted),
    iosObserver: input.platform === "ios" && input.healthBlocker === null,
  };
}
