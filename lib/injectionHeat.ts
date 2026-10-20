/**
 * Heat tier of an injection-map region or rotation point, from its OWN entry
 * count in the window.
 *
 * Pure and React-free so scripts/injectionHeat.test.ts can exercise it.
 *
 * The scale is ABSOLUTE: 0, 1, 2, 3 and 4+ entries. It does not look at the
 * other regions or points, so a single entry never paints the busiest-looking
 * plate, an untouched point never shares a colour with a used one, and the
 * legend can state the same five values the plates use. Regions and points use
 * the one scale.
 */

export type HeatTier = 0 | 1 | 2 | 3 | 4;

/** Smallest entry count of each tier, lightest first. */
export const HEAT_TIER_MIN: readonly [number, number, number, number, number] = [0, 1, 2, 3, 4];

/** Legend text of each tier, same order as HEAT_TIER_MIN. Plain numerals, so
 *  no translation is involved. */
export const HEAT_TIER_LABELS: readonly [string, string, string, string, string] = [
  "0",
  "1",
  "2",
  "3",
  "4+",
];

export function heatTierForCount(count: number): HeatTier {
  if (!(count >= HEAT_TIER_MIN[1])) return 0;
  if (count >= HEAT_TIER_MIN[4]) return 4;
  if (count >= HEAT_TIER_MIN[3]) return 3;
  if (count >= HEAT_TIER_MIN[2]) return 2;
  return 1;
}
