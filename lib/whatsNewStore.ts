import AsyncStorage from "@react-native-async-storage/async-storage";
import { getAppVersionOrEmpty } from "./appVersion";

import { markWhatsNewSeen } from "./whatsNew";
import type { KeyValueStore } from "./feedbackSurvey";

export const whatsNewKv: KeyValueStore = {
  get: (key) => AsyncStorage.getItem(key),
  set: (key, value) => AsyncStorage.setItem(key, value),
};

export function currentAppVersion(): string {
  return getAppVersionOrEmpty();
}

/** Called when onboarding ends: a fresh install is never owed the update sheet. */
export function markWhatsNewSeenNow(): Promise<void> {
  return markWhatsNewSeen(whatsNewKv, currentAppVersion());
}
