import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * One-time in-app notice for the injection body map's self-view -> observer-view
 * flip (components/InjectionBodyMap.tsx SIDE CONVENTION note): a returning user
 * with existing injection history has the old left-on-left layout memorised, so
 * the map tab shows one short explanatory toast the first time it opens after
 * the change, then never again. A fresh install never had the old layout, so the
 * caller only shows this to a profile that already has at least one injection
 * record - see the has-history check at the call site in app/(tabs)/injection.tsx.
 */
const FLIP_NOTICE_KEY = "injectionMapFlipNoticeV1";

export async function injectionMapFlipNoticeSeen(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(FLIP_NOTICE_KEY)) === "true";
  } catch {
    // Storage unavailable: fail closed (treat as already seen) so a read error
    // cannot turn into a toast repeating on every launch.
    return true;
  }
}

export async function markInjectionMapFlipNoticeSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(FLIP_NOTICE_KEY, "true");
  } catch {
    // best-effort persistence, matches lib/services/downsell.ts
  }
}
