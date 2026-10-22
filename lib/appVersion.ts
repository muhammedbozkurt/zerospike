import { Platform } from "react-native";
import * as Application from "expo-application";
import Constants from "expo-constants";

/**
 * expo-constants 57 no longer carries nativeBuildVersion/nativeAppVersion, so the
 * installed binary's numbers come from expo-application, with the app config as
 * the fallback (it is what the build was stamped from).
 */
export function getAppVersion(): string {
  return Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? "unknown";
}

/** For payloads where "unknown" would read as a real version: empty when the binary and the config both say nothing. */
export function getAppVersionOrEmpty(): string {
  const v = getAppVersion();
  return v === "unknown" ? "" : v;
}

export function getBuildNumber(): string {
  const native = Application.nativeBuildVersion;
  if (native) return native;
  // Each store has its own number; the other platform's field is never a stand-in.
  const configured =
    Platform.OS === "ios"
      ? Constants.expoConfig?.ios?.buildNumber
      : Platform.OS === "android"
        ? Constants.expoConfig?.android?.versionCode
        : undefined;
  return configured !== undefined && configured !== null && configured !== "" ? String(configured) : "unknown";
}
