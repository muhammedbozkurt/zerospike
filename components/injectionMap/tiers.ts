import type { HeatTier } from "../../lib/injectionHeat";

export type Tier = HeatTier;

/** Outline weight is a non-colour cue: only the deepest tier is heavier. */
export function tierStroke(tier: Tier): number {
  return tier === 3 ? 1.5 : 1;
}
