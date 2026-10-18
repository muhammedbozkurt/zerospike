/**
 * Four-step heat scale for the injection map, from the 0..1 level that
 * lib/injectionHeat produces. Pure: scripts/injectionMapTiers.test.ts covers it.
 *
 * Run: npx tsx scripts/injectionMapTiers.test.ts
 */

export type Tier = 0 | 1 | 2 | 3;

export const TIER_LOW = 0.34;
export const TIER_HIGH = 0.67;

/** 0 = never used (neutral), 1..3 = used, lighter to deeper. The lightest used
 *  level (USED_FLOOR) always lands in tier 1, never in tier 0. */
export function heatTier(level: number): Tier {
  if (!(level > 0)) return 0;
  if (level < TIER_LOW) return 1;
  if (level < TIER_HIGH) return 2;
  return 3;
}

/** Outline weight is a non-colour cue: only the deepest tier is heavier. */
export function tierStroke(tier: Tier): number {
  return tier === 3 ? 1.5 : 1;
}
