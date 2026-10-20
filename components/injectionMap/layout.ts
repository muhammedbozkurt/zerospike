import { VB_ASPECT, VB_H, VB_W, type Geometry } from "./silhouette";

/**
 * Sizes of the injection map that depend on the screen, kept React-free so
 * scripts/injectionMapGeometry.test.ts and scripts/injectionMapRender.ts use
 * the very numbers the component uses.
 */

/** Screen height not given to the figure: header, tab bar, safe areas, zoom bar and legend. */
export const CHROME_RESERVE = 520;
/** Narrowest figure. 250 is what a 320 pt phone fits (78 % of the width), and a
 *  taller phone is not allowed to shrink it below that: the region plates and
 *  their gaps are specified at this size. */
export const MIN_MAP_W = 250;
export const MAX_MAP_W = 384;

export function mapWidth(winW: number, winH: number): number {
  const fitW = Math.round(((winH - CHROME_RESERVE) * VB_W) / VB_H);
  return Math.max(MIN_MAP_W, Math.min(Math.round(winW * 0.78), MAX_MAP_W, fitW));
}

export function mapHeight(svgW: number): number {
  return Math.round((svgW * VB_H) / VB_W);
}

/** Full size of a rotation-point dot in the zoom, in screen points. */
export const DOT_R_MAX = 23;
/** Never shrink below this: the digit still has to be legible. */
export const DOT_R_MIN = 14;
/** Clear space the zoom keeps between two dots and between a dot and the
 *  region plate edge, in screen points. */
export const DOT_GAP_PT = 8;

/** Screen points per viewBox unit of a zoomed region. */
export function zoomPtPerUnit(geo: Geometry, svgW: number): number {
  return svgW / geo.zoom[2];
}

export interface DotMetrics {
  /** Dot radius in screen points. */
  r: number;
  /** Closest pair of dot centres, in points. */
  pairPt: number;
  /** Closest dot centre to a plate edge, in points. */
  edgePt: number;
}

/**
 * Dot radius of a zoomed region: the full 23 pt unless that would leave less
 * than DOT_GAP_PT between neighbouring dots or between a dot and the plate
 * edge, in which case the dot shrinks just enough.
 */
export function dotMetrics(geo: Geometry, svgW: number): DotMetrics {
  const k = zoomPtPerUnit(geo, svgW);
  const [bx, by, bw, bh] = geo.region.box;
  let pair = Infinity;
  let edge = Infinity;
  geo.points.forEach((p, i) => {
    edge = Math.min(edge, p.x - bx, bx + bw - p.x, p.y - by, by + bh - p.y);
    for (let j = i + 1; j < geo.points.length; j++) {
      pair = Math.min(pair, Math.hypot(p.x - geo.points[j].x, p.y - geo.points[j].y));
    }
  });
  const pairPt = pair * k;
  const edgePt = edge * k;
  const r = Math.max(DOT_R_MIN, Math.min(DOT_R_MAX, (pairPt - DOT_GAP_PT) / 2, edgePt - DOT_GAP_PT));
  return { r, pairPt, edgePt };
}

/** Digit sizes inside a dot, in points: the point number and the count below it. */
export function dotFonts(r: number): { point: number; count: number } {
  return { point: r * 0.65, count: r * 0.39 };
}

/** Upper bound of a bold digit's advance as a fraction of the font size. */
export const DIGIT_EM = 0.62;

/**
 * True when a count of `digits` digits, drawn where the dot draws it, sits
 * inside the circle (all four corners of its box).
 */
export function countFitsInDot(r: number, digits: number): boolean {
  const f = dotFonts(r).count;
  const baseline = r * 0.62;
  const top = baseline - f * 0.72;
  const halfW = (digits * f * DIGIT_EM) / 2;
  return [top, baseline].every((y) => Math.hypot(halfW, y) <= r);
}

/**
 * Decorative L/R side badges, anchored in viewBox units and drawn at a fixed pt
 * size, beside the head. They sit above the shoulder line so the wider arms
 * never run under them.
 */
export const BADGE_INNER_X = 56;
export const BADGE_TOP_Y = 56;
export const BADGE_H = 18;
/** Budgeted for the longest label, Arabic "يمين"; a single letter just centres. */
export const BADGE_MAX_W = 52;
