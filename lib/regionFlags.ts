import Constants from "expo-constants";
import { getLocales } from "expo-localization";

/** EU member states plus the EEA-only members (Iceland, Liechtenstein, Norway). */
export const EU_EEA_REGIONS: readonly string[] = [
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR",
  "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL",
  "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  "IS", "LI", "NO",
];

/**
 * Remote-free region switch for the dose calculator. `extra.euHideCalculator`
 * in app.json is the only input and is absent by default, so the calculator
 * stays visible everywhere until the field is set to true; with it on, the
 * calculator is hidden on devices whose region is in the EU or the EEA. An
 * unknown region or an unreadable config never hides anything.
 */
export function calculatorHiddenForRegion(): boolean {
  try {
    const extra = Constants.expoConfig?.extra as Record<string, unknown> | undefined;
    if (extra?.euHideCalculator !== true) return false;
    const region = String(getLocales()[0]?.regionCode ?? "").trim().toUpperCase();
    return EU_EEA_REGIONS.includes(region);
  } catch {
    return false;
  }
}
