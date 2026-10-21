import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { Platform } from "react-native";

import {
  FATAL_JS_STORAGE_KEY,
  createFatalHandler,
  parseFatalReport,
  pickLatestReport,
  type FatalReport,
} from "./fatalReport";

type ErrorUtilsLike = {
  getGlobalHandler?: () => ((error: unknown, isFatal?: boolean) => void) | undefined;
  setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void;
};

let installed = false;

/**
 * Keeps the last fatal JS error on the device before React Native hands it to
 * the native crash path (index.js calls this first thing). The stored text is
 * the error message (capped) and stack only, and it is never sent anywhere on
 * its own: the user sees it in Settings > About and may attach it to feedback.
 */
export function installFatalCapture(): void {
  if (installed) return;
  const utils = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
  if (!utils?.setGlobalHandler) return;
  installed = true;
  const platform: "ios" | "android" = Platform.OS === "ios" ? "ios" : "android";
  utils.setGlobalHandler(
    createFatalHandler({
      previous: utils.getGlobalHandler?.() ?? null,
      save: (report) => AsyncStorage.setItem(FATAL_JS_STORAGE_KEY, JSON.stringify(report)),
      context: () => ({
        platform,
        build: String(Constants.nativeBuildVersion ?? ""),
        version: String(Constants.nativeAppVersion ?? Constants.expoConfig?.version ?? ""),
        now: () => new Date(),
      }),
    })
  );
}

async function nativeModule() {
  try {
    return await import("../modules/zerospike-live-activity");
  } catch {
    return null;
  }
}

/** The newer of the native and the JS record, or null when there is none. */
export async function loadLastFatalReport(): Promise<FatalReport | null> {
  let js: FatalReport | null = null;
  try {
    js = parseFatalReport(await AsyncStorage.getItem(FATAL_JS_STORAGE_KEY));
  } catch {
    js = null;
  }
  const mod = await nativeModule();
  const native = mod ? mod.getLastFatalReport() : null;
  return pickLatestReport(native, js);
}

/** Removes both records. */
export async function clearLastFatalReports(): Promise<void> {
  try {
    await AsyncStorage.removeItem(FATAL_JS_STORAGE_KEY);
  } catch {
    // best-effort
  }
  const mod = await nativeModule();
  mod?.clearLastFatalReport();
}
