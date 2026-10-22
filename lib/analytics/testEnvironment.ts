import * as Device from "expo-device";
import { requireOptionalNativeModule } from "expo-modules-core";
import { Platform } from "react-native";

import { isScreenshotMode } from "../screenshotMode";

export interface TestEnvironmentSignals {
  /** expo-device isDevice: false on an emulator or simulator, null/undefined when unknown. */
  isDevice: boolean | null | undefined;
  /** A development build (Metro dev mode). */
  dev: boolean;
  /** The store-screenshot capture pipeline. */
  screenshot: boolean;
  /** Firebase Test Lab / Google Play pre-launch report device (Android only). */
  testLab: boolean;
}

/**
 * True when usage analytics must stay silent because the traffic is not a real
 * person's: emulators, simulators, dev builds, screenshot capture and the Google
 * Play pre-launch / Firebase Test Lab robots. An unknown isDevice counts as a
 * real device, so a missing signal never silences real users.
 */
export function isTestEnvironment(signals: TestEnvironmentSignals): boolean {
  return signals.isDevice === false || signals.dev || signals.screenshot || signals.testLab;
}

interface TestLabModule {
  isTestLab?(): boolean;
}

function readTestLab(): boolean {
  if (Platform.OS !== "android") return false;
  try {
    const native = requireOptionalNativeModule<TestLabModule>("ZerospikeLiveActivity");
    return native?.isTestLab?.() === true;
  } catch {
    return false;
  }
}

let cached: boolean | null = null;

/**
 * The live reading. EXPO_PUBLIC_ANALYTICS_DEV=1 keeps a dev build able to try the
 * real function (the switch the sink always had); emulators, screenshot mode and
 * test labs stay silent whatever it says. Cached: none of it changes while the
 * app runs.
 */
export function isTestEnvironmentNow(): boolean {
  if (cached !== null) return cached;
  let isDevice: boolean | null | undefined;
  try {
    isDevice = Device.isDevice;
  } catch {
    isDevice = undefined;
  }
  cached = isTestEnvironment({
    isDevice,
    dev: __DEV__ && process.env.EXPO_PUBLIC_ANALYTICS_DEV !== "1",
    screenshot: isScreenshotMode(),
    testLab: readTestLab(),
  });
  return cached;
}
