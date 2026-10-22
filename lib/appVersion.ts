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

export function getBuildNumber(): string {
  const native = Application.nativeBuildVersion;
  if (native) return native;
  const ios = Constants.expoConfig?.ios?.buildNumber;
  if (ios) return String(ios);
  const android = Constants.expoConfig?.android?.versionCode;
  return android !== undefined && android !== null ? String(android) : "unknown";
}
