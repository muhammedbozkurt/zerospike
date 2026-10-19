import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";

import { markWhatsNewSeen } from "./whatsNew";
import type { KeyValueStore } from "./feedbackSurvey";

export const whatsNewKv: KeyValueStore = {
  get: (key) => AsyncStorage.getItem(key),
  set: (key, value) => AsyncStorage.setItem(key, value),
};

export function currentAppVersion(): string {
  return Constants.nativeAppVersion ?? Constants.expoConfig?.version ?? "";
}

/** Called when onboarding ends: a fresh install is never owed the update sheet. */
export function markWhatsNewSeenNow(): Promise<void> {
  return markWhatsNewSeen(whatsNewKv, currentAppVersion());
}
