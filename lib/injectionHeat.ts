/**
 * How dark an injection-map plate is drawn, from the COUNT alone.
 *
 * Pure and React-free so scripts/injectionHeat.test.ts can exercise it.
 *
 * The old scale divided a region's count by the busiest region's count. With a
 * single region ever used that ratio is 1 after the very first entry, so the
 * map jumped straight to its darkest tone and the colour carried no meaning.
 *
 * The scale here is ROTATION-AWARE instead of relative: the reference point is
 * the count a region would hold if the same history were spread evenly over all
 * eight regions, doubled, so an evenly rotated history lands mid-ramp at every
 * volume and only genuine over-use reaches the dark end. At low volumes the
 * minimum denominators keep the scale from being decided by two or three
 * entries. Points work the same way inside their own region's share.
 *
 * Nothing here reads a point index, a SITE_POINTS position or a logging order:
 * the level is a function of counts only.
 */

/** Regions the map offers for selection (lib/db/types SELECTABLE_SITES). */
export const SELECTABLE_REGION_COUNT = 8;
/** Rotation points inside one region (lib/db/types SITE_POINTS). */
export const POINTS_PER_REGION = 4;

/** Floors under the denominators, so a handful of entries cannot define the
 *  scale on their own and an early history reads pale rather than saturated. */
export const REGION_MIN_DENOM = 6;
export const POINT_MIN_DENOM = 3;

/**
 * Lightest tone a USED plate may take. A never-used plate is a true 0, so
 * "used once in a long history" stays visibly apart from "never touched"
 * instead of rounding into it.
 */
export const USED_FLOOR = 0.16;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function level(count: number, denom: number): number {
  if (count <= 0) return 0;
  return clamp01(Math.max(USED_FLOOR, count / denom));
}

/**
 * Fill level for one region.
 * @param count entries logged on this region in the window
 * @param total entries logged across all selectable regions in the same window
 */
export function regionHeatLevel(count: number, total: number): number {
  const denom = Math.max(REGION_MIN_DENOM, (2 * Math.max(0, total)) / SELECTABLE_REGION_COUNT);
  return level(count, denom);
}

/**
 * Fill level for one rotation point, measured against its OWN region's share
 * rather than the busiest point on the body.
 * @param count entries logged on this point in the window
 * @param regionCount entries logged on the point's region in the same window
 */
export function pointHeatLevel(count: number, regionCount: number): number {
  const denom = Math.max(POINT_MIN_DENOM, (2 * Math.max(0, regionCount)) / POINTS_PER_REGION);
  return level(count, denom);
}
