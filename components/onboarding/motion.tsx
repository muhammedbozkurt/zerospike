/**
 * Onboarding motion - now a thin re-export of the app-wide motion language
 * (lib/theme/motion). Kept as a local module so the onboarding components' import
 * paths stay stable. The old constant names alias the shared tokens.
 */
export { FadeSlideIn, useCountUp, DURATION, STAGGER_MS } from "../../lib/theme/motion";
import { DURATION, STAGGER_MS } from "../../lib/theme/motion";

export const ENTRANCE_DURATION_MS = DURATION.base;
export const ENTRANCE_STAGGER_MS = STAGGER_MS;
export const COUNT_UP_DURATION_MS = DURATION.count;
