import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Rotation-cycle start per profile, kept in AsyncStorage so injection_logs are
 * NEVER rewritten. The heat colours and the least-recently-used helper read
 * history from this timestamp on; starting a new cycle is pure presentation
 * bookkeeping and no logged row is hidden from the history list.
 */

const keyFor = (profileId: string) => `zerospike.rotationCycleStart.${profileId}`;

export async function getRotationCycleStart(
  profileId: string
): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(keyFor(profileId));
  } catch {
    return null;
  }
}

/** Stamps "now" as the profile's cycle start and returns it. */
export async function startRotationCycle(profileId: string): Promise<string> {
  const now = new Date().toISOString();
  try {
    await AsyncStorage.setItem(keyFor(profileId), now);
  } catch {
    // Storage failure only loses the presentation stamp, never a log row.
  }
  return now;
}
