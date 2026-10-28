import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Boolean flags kept per profile (`<base>.<profileId>`). They used to be one
 * value for the whole device, so a caregiver switching profiles inherited what
 * the previous profile had toggled or dismissed.
 *
 * The first read for ANY profile that finds no scoped value yet, but does find
 * the old device-wide one, carries it over to THAT profile and deletes the
 * global key: a one-time, lossless move; every read after that is per profile.
 */
export async function readProfileFlag(baseKey: string, profileId: string): Promise<boolean> {
  const scopedKey = `${baseKey}.${profileId}`;
  const scoped = await AsyncStorage.getItem(scopedKey);
  if (scoped != null) return scoped === "true";
  const legacy = await AsyncStorage.getItem(baseKey);
  if (legacy == null) return false;
  await AsyncStorage.setItem(scopedKey, legacy);
  await AsyncStorage.removeItem(baseKey);
  return legacy === "true";
}

export async function writeProfileFlag(baseKey: string, profileId: string, value: boolean): Promise<void> {
  await AsyncStorage.setItem(`${baseKey}.${profileId}`, value ? "true" : "false");
}

/** The Health import switch (dashboard card, CGM mode). health.ts reads the same key. */
export const HEALTH_IMPORT_FLAG = "zerospike.cgmSync";
