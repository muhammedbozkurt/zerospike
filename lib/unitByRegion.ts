import type { GlucoseUnit } from "./db/types";

/** Regions whose clinics and meters report blood glucose in mmol/L. Every other
 *  region keeps the app's long-standing mg/dL starting point. */
const MMOL_REGIONS: ReadonlySet<string> = new Set(["GB", "AU", "CA", "IE", "NZ"]);

/** "GB", "gb", "en-GB", "en_GB", "zh-Hans-CN" -> the upper-case region, else "". */
export function regionFromLocaleTag(tagOrRegion: string | null | undefined): string {
  const raw = String(tagOrRegion ?? "").trim();
  if (!raw) return "";
  const parts = raw.split(/[-_]/);
  if (parts.length === 1) return /^[A-Za-z]{2}$/.test(raw) ? raw.toUpperCase() : "";
  const region = parts.slice(1).find((p) => /^[A-Za-z]{2}$/.test(p));
  return region ? region.toUpperCase() : "";
}

/** The starting unit for a fresh install, from the device region (or a locale tag). */
export function defaultGlucoseUnitForRegion(
  regionOrTag: string | null | undefined
): GlucoseUnit {
  return MMOL_REGIONS.has(regionFromLocaleTag(regionOrTag)) ? "mmol" : "mgdl";
}

/** Onboarding's first unit. A profile already on mmol is kept as is; the
 *  profile's mg/dL is just the table default before onboarding ends, so only
 *  then does the region decide. */
export function initialOnboardingUnit(
  profileUnit: GlucoseUnit | null | undefined,
  regionOrTag: string | null | undefined
): GlucoseUnit {
  return profileUnit === "mmol" ? "mmol" : defaultGlucoseUnitForRegion(regionOrTag);
}
