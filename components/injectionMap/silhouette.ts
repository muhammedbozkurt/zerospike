import type { InjectionSite, SitePoint } from "../../lib/db/types";
import { SITE_POINTS, pointGrid } from "../../lib/db/types";

/**
 * Injection map geometry: silhouette outlines, the eight regions, their touch
 * rectangles and the zoom boxes. Pure (no React Native), so
 * scripts/injectionMapHit.test.ts can measure it.
 *
 * Run the measurement: npx tsx scripts/injectionMapHit.test.ts
 */

export type Surface = "front" | "back";

export interface Region {
  site: InjectionSite;
  /** Point layout inside the box: a 2x2 grid, a top-to-bottom column, or a
   *  single left-to-right row. */
  layout: "grid" | "column" | "row";
  /** Which tab the region lives on. */
  surface: Surface;
  /** Region container [x, y, w, h] in viewBox units. */
  box: readonly [number, number, number, number];
  /** Corner radius; w/2 turns the box into a capsule. */
  rx: number;
  /** For "row" layouts: the row's vertical position as a fraction of the box
   *  height (default 0.5). The buttocks use 0.35 so the line sits on the upper
   *  gluteal band. */
  rowYFactor?: number;
}

export const VB_W = 240;
export const VB_H = 380;
export const VB_ASPECT = VB_W / VB_H;
export const CENTER_X = VB_W / 2;

type Pt = readonly [number, number];

/**
 * Closed smooth outline through the given points. Each segment's control
 * points come from the neighbouring points (Catmull-Rom), so both tangents at
 * a joint are the same line: G1 continuity everywhere, no corner can appear.
 */
function smoothClosed(pts: readonly Pt[]): string {
  const n = pts.length;
  const f = (v: number): string => (Math.round(v * 10) / 10).toString();
  let d = `M ${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return `${d} Z`;
}

const mirrorX = (p: Pt): Pt => [VB_W - p[0], p[1]];
const shiftX = (p: Pt): Pt => [CENTER_X + p[0], p[1]];

/**
 * Right half of the body as offsets from the midline, head top to crotch.
 * Key stations: head, neck (about 45% of the shoulder width), rounded shoulder,
 * waist (about 72% of the shoulder), hip (widest), thigh, and a lower leg that
 * the fill gradient fades out. Neck-to-shoulder and waist-to-hip turn over
 * more than 14 units.
 */
const HALF: readonly Pt[] = [
  [0, 8],
  [11, 10],
  [19, 18],
  [22, 29],
  [21, 40],
  [17.5, 50.5],
  [11.5, 57],
  [9.5, 64],
  [9.5, 72],
  [13, 78],
  [25, 83],
  [38, 86],
  [46, 91],
  [49, 99],
  [46, 114],
  [42.5, 130],
  [40, 146],
  [37.5, 160],
  [34.5, 174],
  [36, 188],
  [39.5, 203],
  [42, 218],
  [41.5, 234],
  [40, 248],
  [39, 272],
  [37, 298],
  [34, 322],
  [31, 345],
  [28, 362],
  [23, 372],
  [14, 376],
  [5, 372],
  [3, 352],
  [2.5, 320],
  [2.5, 290],
  [2.5, 262],
  [2, 250],
  [0, 245],
];

const ARM_HALF: readonly Pt[] = [
  [46, 95],
  [52, 92.5],
  [58, 97],
  [61.5, 107],
  [62.5, 125],
  [62, 150],
  [61.5, 175],
  [60, 196],
  [58.5, 209],
  [54.5, 216],
  [50.5, 212],
  [49, 196],
  [47.5, 175],
  [46.5, 152],
  [46, 130],
  [45, 115],
  [45, 100],
];

function bodyLoop(): Pt[] {
  const right = HALF.map(shiftX);
  const left = HALF.slice(1, -1)
    .map(shiftX)
    .map(mirrorX)
    .reverse();
  return [...right, ...left];
}

export const TORSO_PATH = smoothClosed(bodyLoop());
export const ARM_PATHS: readonly string[] = [
  smoothClosed(ARM_HALF.map(shiftX)),
  smoothClosed(ARM_HALF.map(shiftX).map(mirrorX)),
];
export const SPINE_PATH = `M ${CENTER_X} 70 L ${CENTER_X} 200`;
export const NAVEL = { x: CENTER_X, y: 176, r: 1.7 } as const;

/** Where the fill and outline begin to dissolve, and where they are gone. */
export const FADE_FROM = 305;
export const FADE_TO = 374;

const rightBox = (dx: number, y: number, w: number, h: number): Region["box"] => [CENTER_X + dx, y, w, h];
const leftBox = (dx: number, y: number, w: number, h: number): Region["box"] => [CENTER_X - dx - w, y, w, h];

/**
 * The eight regions. SIDE CONVENTION - OBSERVER VIEW: the figure faces the
 * user as another person would, so the user's own LEFT side is drawn on the
 * RIGHT of the picture. Site ids keep their meaning (thigh_left is the user's
 * left thigh); only the box sits at its mirror partner's screen position.
 * The buttocks live on the back tab and follow the same flip.
 *
 * Boxes keep at least 2 units clear of the outline and 4 units between
 * neighbours; the touch rectangles are measured in scripts/injectionMapHit.test.ts.
 */
export const REGIONS: readonly Region[] = [
  { site: "abdomen_left", layout: "row", surface: "front", box: rightBox(4, 156, 27, 34), rx: 11 },
  { site: "abdomen_right", layout: "row", surface: "front", box: leftBox(4, 156, 27, 34), rx: 11 },
  { site: "thigh_left", layout: "column", surface: "front", box: rightBox(8, 252, 24, 48), rx: 11 },
  { site: "thigh_right", layout: "column", surface: "front", box: leftBox(8, 252, 24, 48), rx: 11 },
  { site: "arm_left", layout: "column", surface: "front", box: rightBox(50, 112, 10, 34), rx: 5 },
  { site: "arm_right", layout: "column", surface: "front", box: leftBox(50, 112, 10, 34), rx: 5 },
  { site: "buttock_left", layout: "row", surface: "back", box: rightBox(4, 206, 28, 34), rx: 12, rowYFactor: 0.4 },
  { site: "buttock_right", layout: "row", surface: "back", box: leftBox(4, 206, 28, 34), rx: 12, rowYFactor: 0.4 },
];

/** Invisible touch padding in units: toward the midline (inner), away from it
 *  (outer), up and down. */
interface HitPad {
  inner: number;
  outer: number;
  top: number;
  bottom: number;
}

const HIT_PAD: Record<string, HitPad> = {
  abdomen: { inner: 2.5, outer: 14, top: 8, bottom: 2 },
  thigh: { inner: 6.5, outer: 13, top: 0, bottom: 0 },
  arm: { inner: 16.5, outer: 16.5, top: 9, bottom: 1 },
  buttock: { inner: 2.5, outer: 13.5, top: 5, bottom: 5 },
};

/** Screen-right boxes are the user's *_left sites (observer view). */
function isScreenRight(site: InjectionSite): boolean {
  return site.endsWith("_left");
}

/** The region's touch rectangle [x, y, w, h]. */
export function hitBoxFor(r: Region): Region["box"] {
  const base = r.site.split("_")[0];
  const pad = HIT_PAD[base];
  const [x, y, w, h] = r.box;
  const leftPad = isScreenRight(r.site) ? pad.inner : pad.outer;
  const rightPad = isScreenRight(r.site) ? pad.outer : pad.inner;
  return [x - leftPad, y - pad.top, w + leftPad + rightPad, h + pad.top + pad.bottom];
}

export interface PlacedPoint {
  point: SitePoint;
  x: number;
  y: number;
}

/** Even spread along the box's long axis, with an edge margin so the dot drawn
 *  on a point never pokes out of its own region plate. */
const SPREAD = [0.14, 0.38, 0.62, 0.86] as const;

export function placePoints(r: Region): PlacedPoint[] {
  const [bx, by, bw, bh] = r.box;
  if (r.layout === "grid") {
    return SITE_POINTS.map((point) => {
      const { row, col } = pointGrid(point);
      return {
        point,
        x: bx + bw * (col === 0 ? 0.28 : 0.72),
        y: by + bh * (row === 0 ? 0.27 : 0.73),
      };
    });
  }
  if (r.layout === "row") {
    return SITE_POINTS.map((point) => ({
      point,
      x: bx + bw * SPREAD[point - 1],
      y: by + bh * (r.rowYFactor ?? 0.5),
    }));
  }
  return SITE_POINTS.map((point) => ({
    point,
    x: bx + bw / 2,
    y: by + bh * SPREAD[point - 1],
  }));
}

export type ViewBox = readonly [number, number, number, number];

/**
 * Padding around a zoomed region, per layout. A dot is drawn at a fixed 23pt
 * radius whatever the zoom, so only the units-per-screen-point ratio decides
 * whether neighbouring dots collide. A "row" region spreads its four dots over
 * the box width, so its pad stays tight (3 units).
 */
const ZOOM_PAD: Record<Region["layout"], number> = { grid: 11, column: 11, row: 3 };

export function zoomViewBox(r: Region): ViewBox {
  const box = r.box;
  const pad = ZOOM_PAD[r.layout];
  let w = box[2] + pad * 2;
  let h = box[3] + pad * 2;
  if (w / h > VB_ASPECT) h = w / VB_ASPECT;
  else w = h * VB_ASPECT;
  let x = box[0] + box[2] / 2 - w / 2;
  let y = box[1] + box[3] / 2 - h / 2;
  if (w <= VB_W) x = Math.min(Math.max(x, 0), VB_W - w);
  if (h <= VB_H) y = Math.min(Math.max(y, 0), VB_H - h);
  return [x, y, w, h];
}

export const FULL_VIEW: ViewBox = [0, 0, VB_W, VB_H];

export interface Geometry {
  region: Region;
  points: PlacedPoint[];
  zoom: ViewBox;
  cx: number;
  cy: number;
}

export const GEOMETRY: Map<InjectionSite, Geometry> = new Map(
  REGIONS.map((region) => [
    region.site,
    {
      region,
      points: placePoints(region),
      zoom: zoomViewBox(region),
      cx: region.box[0] + region.box[2] / 2,
      cy: region.box[1] + region.box[3] / 2,
    },
  ])
);
