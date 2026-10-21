import type { GlucoseUnit } from "./db/types";
import { glucoseToDisplay } from "./glucose";
import { defaultGlucoseUnitForRegion } from "./unitByRegion";

/** The fixed sample reading on the first onboarding page, in mg/dL. It is
 *  shown in the device region's unit; the user's own unit is chosen later. */
export const ONBOARDING_EXAMPLE_MGDL = 108;

export function onboardingExample(regionOrTag: string | null | undefined): {
  unit: GlucoseUnit;
  mgdl: number;
  display: number;
} {
  const unit = defaultGlucoseUnitForRegion(regionOrTag);
  return { unit, mgdl: ONBOARDING_EXAMPLE_MGDL, display: glucoseToDisplay(ONBOARDING_EXAMPLE_MGDL, unit) };
}
