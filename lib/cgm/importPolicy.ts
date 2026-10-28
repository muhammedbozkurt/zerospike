import type { CgmMode } from "./state";

/**
 * Who may pull from the platform health store, and how far back.
 *
 * Pro: the full import (iOS 90 days, Android 30), the background sync and the
 * long curve. Free, in CGM mode: while the app is open, the last 24 hours (the
 * same span the free curve shows, lib/cgm/pro.ts), so choosing CGM during
 * onboarding is not an empty screen. Free, any other mode: nothing, the Health
 * card sells Pro as before.
 */
export const FREE_IMPORT_WINDOW_DAYS = 1;

export type HealthImportPlan = "full" | "free24h" | "none";

export function healthImportPlan(input: { isPro: boolean; mode: CgmMode }): HealthImportPlan {
  if (input.isPro) return "full";
  return input.mode === "cgm" ? "free24h" : "none";
}

/** The card, the open-time import and the connect flow all ask this one question. */
export function healthImportAllowed(input: { isPro: boolean; mode: CgmMode }): boolean {
  return healthImportPlan(input) !== "none";
}
