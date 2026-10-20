import type { HeatTier } from "../../lib/injectionHeat";

export type Tier = HeatTier;

/** Outline weight is a non-colour cue: the lightest tier carries a firmer frame
 *  so a white plate still reads on the figure, and only the deepest tier is
 *  heavier than the middle ones. */
export function tierStroke(tier: Tier): number {
  if (tier === 4) return 1.5;
  if (tier === 0) return 1.3;
  return 1;
}
