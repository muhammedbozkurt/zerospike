import type { InjectionSite, SitePoint } from "./db/types";
import { SELECTABLE_SITES, SITE_POINTS, canonicalSite } from "./db/types";

/**
 * Pure point-picking core behind `leastRecentlyUsedPoint` (lib/db/injections.ts),
 * pulled out so it can run under plain `node`/`tsx` with no SQLite involved
 * (scripts/rotation.test.ts). Rotation bookkeeping, not medical advice: never
 * suggests where to inject, only which point has gone longest without a record.
 */

/** A point key that survives map lookups ("abdomen_left:3"). */
export function pointKey(site: InjectionSite, point: SitePoint): string {
  return `${site}:${point}`;
}

export interface RotationPoint {
  site: InjectionSite;
  point: SitePoint;
}

export interface RotationPickInput {
  /** MAX(logged_at) per canonical site+point, inside the active rotation-cycle
   *  window (or the whole history when no cycle was started). Keyed by
   *  `pointKey(canonicalSite(site), point)`. */
  cycleLastUsed: Map<string, string>;
  /** The site+point of the profile's single most recent LOGGED record, across
   *  all time and independent of the cycle window - null with no history yet. */
  lastPoint: RotationPoint | null;
  /** The point universe to choose from; defaults to the 32 selectable
   *  region x point combinations in canonical order. Overridable only so a test
   *  can exercise the "only option left" fallback below, which the real
   *  32-point space never actually reaches. */
  allPoints?: RotationPoint[];
}

const DEFAULT_POINTS: RotationPoint[] = SELECTABLE_SITES.flatMap((site) =>
  SITE_POINTS.map((point) => ({ site, point }))
);

/**
 * The point left untouched the longest, the same "never-used wins, else
 * oldest" rule as before, EXCEPT the profile's last-logged point is taken out
 * of the running first: a suggestion must never repeat the point the user just
 * used while any other point exists at all (32 candidates minus the one just
 * used still leaves 31). It only comes back when it is literally the only
 * point in the universe - never true for the real 32-point map, reachable only
 * through the `allPoints` override.
 *
 * Because excluding lastPoint happens BEFORE the never-used/oldest split, a
 * rotation-cycle reset (which can make lastPoint read as "never used in this
 * cycle") still skips straight to the next canonical point instead of looping
 * back to the one just injected.
 */
export function pickLeastRecentlyUsedPoint(input: RotationPickInput): RotationPoint {
  const { cycleLastUsed, lastPoint, allPoints = DEFAULT_POINTS } = input;
  const lastKey = lastPoint ? pointKey(canonicalSite(lastPoint.site), lastPoint.point) : null;
  const candidates =
    lastKey == null ? allPoints : allPoints.filter((p) => pointKey(p.site, p.point) !== lastKey);
  // Only the degenerate single-point universe (never true for the shipped
  // 32-point map) falls back to the full list, i.e. to lastPoint itself.
  const pool = candidates.length > 0 ? candidates : allPoints;

  const neverUsed = pool.find((p) => !cycleLastUsed.has(pointKey(p.site, p.point)));
  if (neverUsed) return neverUsed;

  return pool.slice().sort((a, b) => {
    const la = cycleLastUsed.get(pointKey(a.site, a.point))!;
    const lb = cycleLastUsed.get(pointKey(b.site, b.point))!;
    return la < lb ? -1 : la > lb ? 1 : 0;
  })[0];
}
