import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Which sensor brand a profile uses, kept only on this device. It selects the
 * explanatory note shown next to the Health CGM mode; nothing reads it for
 * data, and it is never sent anywhere.
 */
export type CgmBrand = "dexcom" | "libre" | "medtronic" | "eversense" | "other";

export const CGM_BRANDS: readonly CgmBrand[] = ["dexcom", "libre", "medtronic", "eversense", "other"];

/** Per-profile AsyncStorage base (`<base>.<profileId>`, lib/profileScopedKeys.ts). */
export const CGM_BRAND_KEY = "zerospike.cgmBrand";

export function cgmBrandKey(profileId: string): string {
  return `${CGM_BRAND_KEY}.${profileId}`;
}

export function parseCgmBrand(raw: unknown): CgmBrand | null {
  return CGM_BRANDS.find((b) => b === raw) ?? null;
}

export async function getCgmBrand(profileId: string): Promise<CgmBrand | null> {
  try {
    return parseCgmBrand(await AsyncStorage.getItem(cgmBrandKey(profileId)));
  } catch {
    return null;
  }
}

export async function setCgmBrand(profileId: string, brand: CgmBrand): Promise<void> {
  await AsyncStorage.setItem(cgmBrandKey(profileId), brand);
}

/** Forgets the sensor brand (the profile went back to manual entry). */
export async function clearCgmBrand(profileId: string): Promise<void> {
  await AsyncStorage.removeItem(cgmBrandKey(profileId));
}

/** Translation keys of the note for a brand, in display order. The Nightscout
 *  sentence is included only when that option exists in this build. */
export function cgmBrandMessageKeys(brand: CgmBrand, nightscout: boolean): string[] {
  const ns = nightscout ? ["cgmBrand.nightscoutLine"] : [];
  switch (brand) {
    case "dexcom":
      return ["cgmBrand.msgDexcom"];
    case "libre":
      return ["cgmBrand.msgLibre", ...ns, "cgmBrand.manualLine"];
    default:
      return ["cgmBrand.msgOther", ...ns];
  }
}
