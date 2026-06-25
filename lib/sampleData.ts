import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Per-profile flag for the first-run "sample data" preview. Shared by the
 * dashboard (load/clear) and Settings (load demo / clear logs) so the two entry
 * points never drift out of sync (e.g. a stuck "viewing sample data" banner
 * after logs are cleared elsewhere).
 */
const key = (profileId: string) => `zerospike.sampleData.${profileId}`;

export async function markSampleActive(profileId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(key(profileId), "true");
  } catch {
    // best-effort
  }
}

export async function clearSampleFlag(profileId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key(profileId));
  } catch {
    // best-effort
  }
}

export async function isSampleActive(profileId: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(key(profileId))) === "true";
  } catch {
    return false;
  }
}
