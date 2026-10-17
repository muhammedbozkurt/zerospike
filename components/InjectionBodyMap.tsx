import React, { useCallback, useEffect, useMemo, useState } from "react";
import { I18nManager, Pressable, Text, useWindowDimensions, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import Svg, {
  Circle,
  Defs,
  G,
  LinearGradient,
  Path,
  Rect,
  Stop,
  Text as SvgText,
} from "react-native-svg";

import type { InjectionSite, SitePoint } from "../lib/db/types";
import { SITE_POINTS, pointGrid } from "../lib/db/types";
import type { PointUsage, SiteUsage } from "../lib/db/injections";
import { pointHeatLevel, regionHeatLevel } from "../lib/injectionHeat";
import { GLUCOSE_COLORS, RADIUS, THEME, glow } from "../lib/theme/tokens";
import { withAlpha } from "./rich/GlassCard";
import { formatDate } from "../lib/format";
import { hapticSelect } from "../lib/haptics";
import { isScreenshotMode } from "../lib/screenshotMode";

/**
 * Injection-site usage map (schema v9), at ROTATION-POINT resolution.
 *
 * ONE silhouette, divided into the eight selectable regions by a near-black
 * outline. A region's fill is a single-hue sequential ramp driven by COUNT
 * alone, on the rotation-aware scale in lib/injectionHeat: untouched regions
 * stay pale, an evenly rotated history sits mid-ramp whatever its volume, and
 * only a region carrying far more than its share goes deep teal. Tapping a
 * region zooms the SVG onto it and reveals its four rotation points at full
 * touch size.
 *
 * Colour is a picture of the user's OWN history: nothing says where to inject,
 * and every colour is paired with a count, so it reads without hue.
 */

/** Which face of the body a region sits on. The silhouette only draws the front,
 *  so "back" regions need their own plate to stop them reading as front ones. */
type Surface = "front" | "back";

interface Region {
  site: InjectionSite;
  /** Point layout inside the box: a 2x2 grid, a top-to-bottom column, or a
   *  single left-to-right row. */
  layout: "grid" | "column" | "row";
  /** Body face. "back" swaps the frequency plate for BACK_STOPS and dashes the
   *  region outline; it never changes which side of the picture the box is on. */
  surface: Surface;
  /** Region container [x, y, w, h] in viewBox units. */
  box: readonly [number, number, number, number];
  /** Corner radius; w/2 turns the box into a capsule (limbs). */
  rx: number;
  /** For "row" layouts: the row's vertical position as a fraction of the box
   *  height (default 0.5). The buttocks use 0.35 so the injection line sits on
   *  the upper gluteal band, per clinical guidance. */
  rowYFactor?: number;
}

// Head, neck and body as ONE outline on the 0 0 240 380 viewBox (symmetric about
// x=120), so the jaw flows into the neck and the neck into sloping shoulders with
// no seam where a separate head shape would overlap the body. Proportions are a
// stylised ~7 heads; the torso stays wide enough for the belly regions.
const BODY_PATH =
  "M 120 13 C 107.6 13 99 24.1 99 36.5 C 99 42.9 100 50.4 104.5 55 C 106.8 57.4 108.3 60.4 108.7 64 " +
  "C 109.1 68.1 108.1 73.5 104.5 75.5 C 95 80.8 84.4 83.9 74 87 C 67 89.1 60.7 96.7 60 104 " +
  "C 58.8 116 59 128 58.5 140 C 58 152 57.1 164 56.5 176 C 55.5 196 54.4 216 54 236 " +
  "C 53.9 241.3 53.2 246.8 54.5 252 C 55.5 255.8 56.5 261 60.5 261 C 64.7 261 65.4 255.1 66 251 " +
  "C 66.7 246.1 66.3 241 66.5 236 C 67.5 215.9 71 196 73 176 C 74.3 163.3 75.7 150.7 76.5 138 " +
  "C 76.8 132.7 77.1 127.3 77.6 122 C 77.8 120.3 77.7 116.5 79.4 116.5 C 81.1 116.5 81 120.3 81.2 122 " +
  "C 81.6 126.3 81.7 130.7 82 135 C 82.7 146.7 86 158.3 86 170 C 86 183.4 83.5 196.6 83 210 " +
  "C 82.5 221.7 84.2 233.3 85 245 C 85.6 254 87.3 263 88 272 C 88.6 280 90.5 288 90.5 296 " +
  "C 90.5 303.3 89.4 310.7 90.5 318 C 92.2 329 95.5 339.9 95.5 351 C 95.5 355.4 94.2 359.7 93.5 364 " +
  "C 92.8 368.4 97.6 372.5 102 372.5 C 105.9 372.5 110.3 369.9 110.5 366 C 110.7 361 110 356 110 351 " +
  "C 110 340 113 329 113 318 C 113 310.7 113.4 303.3 113.5 296 C 113.8 280.6 115.1 265.3 116 250 " +
  "C 116.5 241.3 116 232.5 117.5 224 C 117.9 221.6 117.5 217 120 217 C 122.5 217 122.1 221.6 122.5 224 " +
  "C 124 232.5 123.5 241.3 124 250 C 124.9 265.3 126.2 280.6 126.5 296 C 126.6 303.3 127 310.7 127 318 " +
  "C 127 329 130 340 130 351 C 130 356 129.3 361 129.5 366 C 129.7 369.9 134.1 372.5 138 372.5 " +
  "C 142.4 372.5 147.2 368.4 146.5 364 C 145.8 359.7 144.5 355.4 144.5 351 C 144.5 339.9 147.8 329 149.5 318 " +
  "C 150.6 310.7 149.5 303.3 149.5 296 C 149.5 288 151.4 280 152 272 C 152.7 263 154.4 254 155 245 " +
  "C 155.8 233.3 157.5 221.7 157 210 C 156.5 196.6 154 183.4 154 170 C 154 158.3 157.3 146.7 158 135 " +
  "C 158.3 130.7 158.4 126.3 158.8 122 C 159 120.3 158.9 116.5 160.6 116.5 C 162.3 116.5 162.2 120.3 162.4 122 " +
  "C 162.9 127.3 163.2 132.7 163.5 138 C 164.3 150.7 165.7 163.3 167 176 C 169 196 172.5 215.9 173.5 236 " +
  "C 173.7 241 173.3 246.1 174 251 C 174.6 255.1 175.3 261 179.5 261 C 183.5 261 184.5 255.8 185.5 252 " +
  "C 186.8 246.8 186.1 241.3 186 236 C 185.6 216 184.5 196 183.5 176 C 182.9 164 182 152 181.5 140 " +
  "C 181 128 181.2 116 180 104 C 179.3 96.7 173 89.1 166 87 C 155.6 83.9 145 80.8 135.5 75.5 " +
  "C 131.9 73.5 130.9 68.1 131.3 64 C 131.7 60.4 133.2 57.4 135.5 55 C 140 50.4 141 42.9 141 36.5 " +
  "C 141 24.1 132.4 13 120 13 Z";

const VB_W = 240;
const VB_H = 380;
const VB_ASPECT = VB_W / VB_H;

/**
 * The eight regions, hand-fitted to BODY_PATH so no box crosses the silhouette
 * edge and no two boxes touch.
 *
 * SIDE CONVENTION - OBSERVER VIEW. The silhouette faces the user, the way
 * another person standing opposite them would: the user's own LEFT side is
 * drawn on the RIGHT of the picture (and vice versa) - a full mirror flip of a
 * self-view body map. Every region keeps its SEMANTIC site id from
 * lib/db/types.ts (thigh_left is still, and only ever, the user's own left
 * thigh - stored rows are never touched by this), but its box below sits at its
 * mirror partner's SCREEN position: abdomen_left draws in what used to be
 * abdomen_right's box, and so on for every left/right pair. So a box's position
 * and its label deliberately do NOT name the same physical side any more -
 * that split is the whole point of an observer-view diagram. The buttocks sit
 * on the far face of that same body and follow the identical left/right screen
 * flip - there is no second flip for them. injectionMap.selfViewNote says this
 * in words under the map, and the two side badges mark the user's actual side
 * on the picture, each now pinned to the same screen half as its own left/right
 * boxes (badges and boxes moved together - see the `badges` useMemo below).
 *
 * Buttocks are drawn on the hip line of the single silhouette, the usual
 * simplification on a one-face injection diagram, and carry surface: "back" so
 * the plate tells the user they are looking at the far side.
 *
 * Every box below (grown by HALO) is sampled against a Bezier-sampled polygon of
 * BODY_PATH at 2400 points around its contour: the WORST clearance to the
 * silhouette edge is 2.19 units (upper arm) and the tightest gap between two
 * boxes is 4 units. The arm boxes in particular are narrow because the limb
 * tapers - their bottom end has to fit the arm where it is NARROWEST, not where
 * the plate starts. (Both facts are about the physical boxes, which are exact
 * left/right mirror pairs - relabelling which site sits in which box does not
 * change either measurement.)
 */
const REGIONS: readonly Region[] = [
  { site: "abdomen_left", layout: "row", surface: "front", box: [123, 162, 26.5, 26], rx: 8 },
  { site: "abdomen_right", layout: "row", surface: "front", box: [90.5, 162, 26.5, 26], rx: 8 },
  { site: "thigh_left", layout: "column", surface: "front", box: [128.5, 225, 19, 46], rx: 9.5 },
  { site: "thigh_right", layout: "column", surface: "front", box: [92.5, 225, 19, 46], rx: 9.5 },
  { site: "arm_left", layout: "column", surface: "front", box: [168.5, 120.5, 9, 32], rx: 4.5 },
  { site: "arm_right", layout: "column", surface: "front", box: [62.5, 120.5, 9, 32], rx: 4.5 },
  { site: "buttock_left", layout: "row", surface: "back", box: [126.5, 192, 26, 28], rx: 8, rowYFactor: 0.35 },
  { site: "buttock_right", layout: "row", surface: "back", box: [87.5, 192, 26, 28], rx: 8, rowYFactor: 0.35 },
];

/**
 * Invisible touch-target padding, rebalanced for the boxes above. Pads are
 * viewBox-LITERAL directions, not anatomical ones, so each site's left/right
 * pair was mirrored along with its box above: a site whose box moved from the
 * screen's left half to its right half gets its own left/right pad values
 * swapped too, so the padding still points outward (onto empty background)
 * and inward (toward the torso) exactly as before - only the site LABEL on
 * each physical pad shape changed, not the shape itself. 44pt is 42.24
 * viewBox units at the narrowest supported width (winW 320 -> svgW 250), and
 * every padded rect was checked against every other box and padded rect: no
 * pair overlaps and the tightest gap is 1 unit.
 *
 *  - arm (9 x 32 drawn): 26 units outward onto empty background, 8 inward, and
 *    4/7 vertically -> 43 x 43 units, over 44pt both ways. The outward pad stops
 *    at x=36.5, which is still ~17pt clear of the frequency legend column.
 *  - abdomen (26.5 x 26): 9 units toward the arm rect (2-unit gap), 2.5 toward
 *    its mirror twin (1-unit gap across the navel), 14 up into the empty
 *    ribcage and 2 down (2-unit gap to the buttock rect) -> 38 x 42 units. The
 *    midline is the hard limit here, so this one stays just under 44pt wide.
 *  - buttock (26 x 28): now takes 14 units outward and 3 inward plus 2 below,
 *    43 x 30 units, because the arm rect no longer reaches down this far.
 *  - thigh (19 x 46): 17 outward, 7 toward its twin (3-unit gap across the
 *    groin) -> 43 units wide; already over 44pt tall, so no vertical pad.
 */
interface HitPad {
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
}

const HIT_PAD: Partial<Record<InjectionSite, HitPad>> = {
  arm_left: { left: 8, right: 26, top: 4, bottom: 7 },
  arm_right: { left: 26, right: 8, top: 4, bottom: 7 },
  thigh_left: { left: 7, right: 17 },
  thigh_right: { left: 17, right: 7 },
  abdomen_left: { left: 2.5, right: 9, top: 14, bottom: 2 },
  abdomen_right: { left: 9, right: 2.5, top: 14, bottom: 2 },
  buttock_left: { left: 3, right: 14, bottom: 2 },
  buttock_right: { left: 14, right: 3, bottom: 2 },
};

/** The region's box, grown by HIT_PAD if it has one; otherwise the box itself
 *  (the drawn Rect already IS the hit target for every other region). */
function hitBoxFor(r: Region): Region["box"] {
  const pad = HIT_PAD[r.site];
  if (!pad) return r.box;
  const [x, y, w, h] = r.box;
  const l = pad.left ?? 0;
  const rt = pad.right ?? 0;
  const tp = pad.top ?? 0;
  const bt = pad.bottom ?? 0;
  return [x - l, y - tp, w + l + rt, h + tp + bt];
}

interface PlacedPoint {
  point: SitePoint;
  x: number;
  y: number;
}

/** Even spread along the box's long axis, with an edge margin so the 44pt+ dot
 *  drawn on a point never pokes out of its own region plate. */
const SPREAD = [0.14, 0.38, 0.62, 0.86] as const;

function placePoints(r: Region): PlacedPoint[] {
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
    // One horizontal line, vertically centred: the belly reads as four spots
    // beside the navel and the buttock as four spots along the upper hip
    // line, rather than a quadrant grid.
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

type ViewBox = readonly [number, number, number, number];

/**
 * Padding around a zoomed region, in viewBox units, per layout.
 *
 * A dot is drawn at a fixed 23pt radius whatever the zoom, so the only thing
 * that decides whether two neighbouring dots collide is how many viewBox units
 * the zoom spreads across the screen. Grid/column regions are long, so 11 units
 * of air is free: at the narrowest supported phone (winW 320 -> svgW 250) the
 * closest pair is 56.3pt apart (arm) against the 46pt dot diameter, and the dot
 * radius comes out at 3.14 units inside a 4.5-unit half-width plate.
 *
 * A "row" region puts all four dots side by side across the box's own width and
 * its zoom width is exactly box width + 2 * pad, so the pad has to stay tight;
 * at 3 units the same 320-wide phone leaves 48.9pt between neighbouring centres
 * on the 26.5-unit abdomen and 48.75pt on the 26-unit buttock (both against the
 * 46pt dot diameter), and every wider screen only opens that up.
 */
const ZOOM_PAD: Record<Region["layout"], number> = { grid: 11, column: 11, row: 3 };

function zoomViewBox(r: Region): ViewBox {
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

const FULL_VIEW: ViewBox = [0, 0, VB_W, VB_H];

interface Geometry {
  region: Region;
  points: PlacedPoint[];
  zoom: ViewBox;
  cx: number;
  cy: number;
}

const GEOMETRY: Map<InjectionSite, Geometry> = new Map(
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

export interface PointSelection {
  site: InjectionSite;
  point: SitePoint;
}

/** Days after which a use no longer counts as "recent" for the heat weighting. */
const RECENCY_WINDOW_DAYS = 30;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * The usage ramp: transparent (never used) -> cyan (occasional) -> warm orange
 * (frequent and recent). Two segments so a lightly used point is clearly
 * distinct from an untouched one without already reading as "hot". Used by the
 * region sheet, whose dots sit on the DARK card surface.
 */
export function heatFill(intensity: number): string {
  const i = Math.min(1, Math.max(0, intensity));
  if (i <= 0) return "rgba(255,255,255,0.05)";
  if (i < 0.5) {
    const t = i / 0.5;
    return `rgba(46,230,255,${lerp(0.14, 0.6, t).toFixed(2)})`;
  }
  const t = (i - 0.5) / 0.5;
  const r = Math.round(lerp(46, 255, t));
  const g = Math.round(lerp(230, 122, t));
  const b = Math.round(lerp(255, 60, t));
  return `rgba(${r},${g},${b},${lerp(0.6, 0.85, t).toFixed(2)})`;
}

/**
 * Single-hue SEQUENTIAL ramp for the silhouette: pale at 0, deep teal at 1.
 * The body is drawn light, so "more often used" = darker ink on that light
 * ground, which stays legible on the dark app background at both ends.
 */
type Rgb = readonly [number, number, number];

const FREQ_STOPS: readonly Rgb[] = [
  [232, 245, 250],
  [166, 216, 232],
  [92, 172, 199],
  [38, 112, 146],
  [9, 48, 68],
];

/**
 * The same sequential idea for regions on the BACK of the body (the buttocks):
 * a neutral desaturated slate where the front ramp is teal, so a back plate is
 * telling the user "far side" at every frequency, not only when it is empty.
 *
 * It is a ramp of its own rather than a translucent veil laid over the front one
 * because ANY constant veil makes the two surfaces collapse into each other
 * somewhere along the scale: a dark veil converges at the dark end, a mid-grey
 * one in the middle (measured: 1.01:1 at level 0.7). As its own ramp it keeps a
 * 7.06:1 spread end to end, so "used a lot" still reads as clearly darker here.
 *
 * Against the front ramp it measures 1.60-1.81:1 over levels 0-0.6, 1.21-1.68:1
 * over 0.6-0.85, then the two cross in luminance at level 0.94 (only ever the
 * single busiest region), where the back plate is still neutral grey against a
 * saturated teal and the dashed outline is the cue that does not depend on
 * colour at all.
 */
const BACK_STOPS: readonly Rgb[] = [
  [188, 195, 203],
  [148, 157, 168],
  [108, 118, 132],
  [72, 82, 96],
  [44, 52, 64],
];

function rampRgb(stops: readonly Rgb[], t: number): Rgb {
  const v = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(v));
  const f = v - i;
  const a = stops[i];
  const b = stops[i + 1];
  return [
    Math.round(lerp(a[0], b[0], f)),
    Math.round(lerp(a[1], b[1], f)),
    Math.round(lerp(a[2], b[2], f)),
  ];
}

function rgbCss(c: Rgb): string {
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export function frequencyFill(t: number): string {
  return rgbCss(rampRgb(FREQ_STOPS, t));
}

/** The plate for one region: same scale, the ramp chosen by the body face. */
function surfaceRgb(surface: Surface, t: number): Rgb {
  return rampRgb(surface === "back" ? BACK_STOPS : FREQ_STOPS, t);
}

const INK_DARK = "#08161d";
const INK_LIGHT = "#eaf6fa";

/**
 * Label colour that keeps its contrast on ANY plate. The two inks swap at the
 * plate luminance where they are equally good (about 0.18), which is the choice
 * that maximises the worst case rather than a hand-set position on one ramp:
 * swept across both ramps the floor is 4.04:1, up from 3.67:1 under the old
 * fixed "t >= 0.72" switch, and the flip lands within a hair of where that old
 * switch sat, so the front map looks unchanged.
 */
function inkOn(plate: Rgb): string {
  const lin = (v: number): number => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const luminance = 0.2126 * lin(plate[0]) + 0.7152 * lin(plate[1]) + 0.0722 * lin(plate[2]);
  return luminance < 0.18 ? INK_LIGHT : INK_DARK;
}

/** How recently a point was used, 0 (never / long ago) to 1 (today). */
export function recencyWeight(lastUsedAt: string | null, now: number): number {
  if (!lastUsedAt) return 0;
  const t = new Date(lastUsedAt).getTime();
  if (Number.isNaN(t)) return 0;
  const days = (now - t) / 86_400_000;
  if (days <= 0) return 1;
  if (days >= RECENCY_WINDOW_DAYS) return 0;
  return 1 - days / RECENCY_WINDOW_DAYS;
}

/** Whole days since a timestamp (for the accessibility recency phrase). */
export function daysSince(lastUsedAt: string | null, now: number): number | null {
  if (!lastUsedAt) return null;
  const t = new Date(lastUsedAt).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now - t) / 86_400_000));
}

/** Neutral, educational absorption-speed note per region type (info, NOT advice;
 *  no insulin type is ever tied to a site). */
export function absorptionKey(site: InjectionSite): string {
  if (site.startsWith("abdomen")) return "injection.absorbFast";
  if (site.startsWith("arm")) return "injection.absorbMedFast";
  if (site.startsWith("thigh")) return "injection.absorbMedSlow";
  return "injection.absorbSlow"; // buttock / hip
}

/** Near-black region outline, derived from the darkest background token. */
const EDGE = withAlpha(THEME.bg.g1, 0.88);
const BODY_EDGE = withAlpha(THEME.bg.g1, 0.34);

/** Offset of the accent ring around a selected region. Kept small enough that the
 *  ring still clears the narrowest region (the upper arm) without crossing the
 *  silhouette edge. */
const HALO = 1.4;

/** Inset of the second ring drawn INSIDE a region's own box, used only when a
 *  region is both selected and the rotation suggestion at once (see
 *  showRotationHint below). HALO cannot be reused outward for a second ring -
 *  it is already tuned to the tightest clearance on the silhouette (the upper
 *  arm) - so the second ring goes inward instead, which is always safe: it
 *  stays inside a box that is itself already well inside the body outline.
 *  2.4 keeps a positive width even on the narrowest box (the arm, 9 units). */
const REGION_INSET = 2.4;

/** Same idea at zoom/point level: the outer ring keeps the point selection's
 *  existing offset, the inner ring (combined state only) sits a few units
 *  closer to the dot so the two never overlap. */
const POINT_RING_OUTER = 3.5;
const POINT_RING_INNER = 1.3;

/**
 * Rotation-suggestion ring colour (the least-recently-used region/point),
 * drawn only when the caller opts in via showRotationHint - see the prop doc
 * below. Derived from GLUCOSE_COLORS.normal (the app's existing target-range
 * green) rather than a new hex. Checked against the three surfaces this ring
 * can sit on:
 *  - THEME.accent (cyan, hue ~187deg): this green sits at hue ~157deg, a
 *    ~30deg hue separation, so a selected AND suggested region/point (both
 *    rings drawn at once) never reads as one colour.
 *  - THEME.caution (amber, hue ~33deg, used elsewhere on this same screen for
 *    the repeat-point notice): ~124deg apart, not close.
 *  - Legibility: 7.5:1 (WCAG luminance) against the darkest back-surface
 *    (buttock) plate, and ~1.1-1.5:1 against the lightest front plate/skin -
 *    the same order of magnitude as THEME.accent's own selection ring against
 *    those same light surfaces (~1.36-1.39:1), which already ships today. On
 *    light ground both rings read by hue and stroke shape (solid/dashed), not
 *    by darkness, same as the rest of this map's outline language.
 */
const ROTATION_COLOR = GLUCOSE_COLORS.normal;

/** Fade-out then fade-in around the instant viewBox swap (ms). */
const FADE_OUT = 110;
const FADE_IN = 170;

/** Dash used on every "back" surface mark: the region outline on the map and the
 *  swatch in the front/back key, so the two always read as the same thing. */
const BACK_DASH: readonly [number, number] = [3.2, 2.4];

/**
 * The two swatches in the front/back key, sampled at the level where the ramps
 * are furthest apart (1.79:1, saturated teal against neutral slate; both stay
 * over 3.9:1 on the dark card). Both colours come out of surfaceRgb, so there is
 * no second hand-written hex to drift from the map.
 */
const SURFACE_KEY = [
  { key: "front" as const, fill: rgbCss(surfaceRgb("front", 0.5)), dashed: false },
  { key: "back" as const, fill: rgbCss(surfaceRgb("back", 0.5)), dashed: true },
];

/** Hard ceiling on the key's width so a long translation cannot creep leftwards
 *  over the figure: 96pt still leaves the head ~10 viewBox units of air at the
 *  narrowest supported width, and the key sits above the silhouette's own top. */
const SURFACE_KEY_MAX_W = 96;

/**
 * Decorative L/R side badges, anchored in viewBox units and drawn at a fixed pt
 * size, beside the shoulders. The inner edge sits at x=56 (mirrored to 184),
 * which measures 5.7 units clear of the silhouette at the smallest supported
 * width and more as the map grows, 18.1 units above the padded arm hit rect and
 * 22.1 above the arm plate at that same width (both open up as the map grows,
 * since the badge height is a
 * fixed pt value), and clear of the frequency legend column on the left at every
 * width down to winW 320. Both anchors are still just x=56 and x=184 under the
 * observer-view flip; only WHICH badge key (sideLeft/sideRight) is assigned to
 * which anchor changed - see the `badges` useMemo below.
 */
const BADGE_INNER_X = 56;
const BADGE_TOP_Y = 84;
const BADGE_H = 15;
/** Budgeted for the longest label, Arabic "يمين"; a single letter just centres. */
const BADGE_MAX_W = 52;

export function InjectionBodyMap({
  usage,
  noSiteCount = 0,
  selected,
  onSelect,
  windowDays = 30,
  initialZoom,
  cycleStart,
  onStartNewCycle,
  showRotationHint = false,
}: {
  usage: SiteUsage[];
  /** Injections with NO region recorded at all (e.g. a calculator mealtime
   *  bolus, RotationUsage.noSiteCount from lib/db/injections). These never
   *  show on the silhouette itself - surfaced as a count below it instead, so
   *  a profile that only ever uses the calculator does not read as having no
   *  history at all. */
  noSiteCount?: number;
  selected: PointSelection | null;
  onSelect: (selection: PointSelection) => void;
  windowDays?: number;
  /** Store-screenshot only: open this region's zoom on mount. */
  initialZoom?: string;
  /** Profile's rotation-cycle stamp (lib/rotationCycle), if one was started. */
  cycleStart?: string | null;
  /** Opens the parent's confirm dialog and stamps a new cycle. */
  onStartNewCycle?: () => void;
  /** Rotation ("least-recently-used") is a Pro feature - callers pass their
   *  own isProUser here. Defaults to false so a caller that forgets this prop
   *  fails closed (no hint) rather than leaking it. When false, the ring, the
   *  legend row and the accessibility suffix are all skipped; model.least is
   *  still computed (cheap) but never surfaced. */
  showRotationHint?: boolean;
}) {
  const { t } = useTranslation();
  // RTL EXEMPTION: this card is an anatomical body diagram. Left/right badges
  // and the zoom header below are pinned to the SVG's fixed (never-mirrored)
  // artwork, so every physical left/right style here is swapped back by hand
  // to render byte-identical to LTR instead of following RN's automatic
  // swapLeftAndRightInRTL flip.
  const rtl = I18nManager.isRTL;
  const { width: winW, height: winH } = useWindowDimensions();
  // Silhouette scales with the screen width (capped) so it fills the card on both
  // a narrow phone and a wide tablet. Height follows the viewBox aspect, so it
  // never changes when data or zoom state does.
  const svgW = Math.min(Math.round(winW * 0.78), 384);
  const svgH = Math.round((svgW * VB_H) / VB_W);
  const legendH = Math.round(svgH * 0.44);

  // Side badges live outside the SVG (so they can be hidden from the screen
  // reader as one unit) but are placed from the same viewBox anchors, pinned by
  // the edge that faces the body so a longer word grows away from the figure.
  const badges = useMemo(() => {
    const scale = svgW / VB_W;
    const base = {
      position: "absolute" as const,
      top: BADGE_TOP_Y * scale,
      height: BADGE_H,
      maxWidth: BADGE_MAX_W,
      minWidth: 20,
      paddingHorizontal: 4,
      borderRadius: BADGE_H / 2,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      borderWidth: 1,
      borderColor: THEME.border,
      backgroundColor: withAlpha("#ffffff", 0.07),
    };
    // Physical anchor, pre-swapped for RTL: RN flips left<->right automatically
    // (swapLeftAndRightInRTL), so writing the opposite key here cancels that
    // flip and the badge lands on the same physical side as LTR - this trick is
    // unchanged by the observer-view flip below, it still guarantees each
    // badge's PHYSICAL position is identical whether I18nManager.isRTL is true
    // or false.
    //
    // OBSERVER VIEW: sideLeft names the user's own left side, which the
    // mirrored silhouette (see the SIDE CONVENTION note above REGIONS) now
    // draws on the RIGHT of the picture, so sideLeft takes the anchor formula
    // that used to belong to sideRight, and sideRight takes sideLeft's old
    // formula. Only which KEY owns which formula moved; the formulas
    // themselves, and the RTL-cancelling trick inside them, are untouched.
    return [
      {
        key: "sideLeft" as const,
        style: { ...base, [rtl ? "right" : "left"]: (VB_W - BADGE_INNER_X) * scale },
      },
      {
        key: "sideRight" as const,
        style: { ...base, [rtl ? "left" : "right"]: svgW - BADGE_INNER_X * scale },
      },
    ];
  }, [svgW, rtl]);

  const [openSite, setOpenSite] = useState<InjectionSite | null>(null);
  const fade = useSharedValue(1);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: fade.value }));

  const now = Date.now();

  const applyZoom = useCallback(
    (site: InjectionSite | null) => {
      setOpenSite(site);
      fade.value = withTiming(1, { duration: FADE_IN });
    },
    [fade]
  );

  // The zoom is an instant viewBox swap wrapped in an opacity dip: the SVG is
  // re-rasterised sharp at the new scale, and no frame is driven by setState.
  const goTo = useCallback(
    (site: InjectionSite | null) => {
      hapticSelect();
      fade.value = withTiming(0, { duration: FADE_OUT }, (finished) => {
        if (finished) runOnJS(applyZoom)(site);
      });
    },
    [applyZoom, fade]
  );

  useEffect(() => {
    if (!initialZoom) return;
    if (GEOMETRY.has(initialZoom as InjectionSite)) setOpenSite(initialZoom as InjectionSite);
  }, [initialZoom]);

  const model = useMemo(() => {
    const bySite = new Map<InjectionSite, SiteUsage>();
    usage.forEach((u) => bySite.set(u.site, u));

    const regionSites = new Set(REGIONS.map((r) => r.site));
    const selectableUsage = usage.filter((u) => regionSites.has(u.site));
    const allPoints: PointUsage[] = selectableUsage.flatMap((u) => u.points);
    const total = selectableUsage.reduce((sum, u) => sum + u.count, 0);
    const unassigned = usage.reduce((sum, u) => sum + u.unassignedCount, 0);

    // Data logged against the retired abdomen quadrants is not on the map; surface
    // it as an aggregate note so no history is ever hidden.
    const legacyAbdomen =
      (bySite.get("abdomen_left_upper")?.count ?? 0) +
      (bySite.get("abdomen_right_upper")?.count ?? 0) +
      (bySite.get("abdomen_left_lower")?.count ?? 0) +
      (bySite.get("abdomen_right_lower")?.count ?? 0);

    // The point untouched the longest: never-used wins, then oldest last use.
    let least: PointSelection | null = null;
    let leastScore = Infinity;
    for (const p of allPoints) {
      const score = p.lastUsedAt ? new Date(p.lastUsedAt).getTime() : -1;
      if (score < leastScore) {
        leastScore = score;
        least = { site: p.site, point: p.point };
      }
    }

    return { bySite, total, unassigned, legacyAbdomen, least };
  }, [usage]);

  const open = openSite ? GEOMETRY.get(openSite) ?? null : null;
  const [vx, vy, vw, vh] = open ? open.zoom : FULL_VIEW;
  // One screen point expressed in viewBox units, so strokes, dots and labels keep
  // the same physical size at every zoom level.
  const upx = vw / svgW;

  const openUsage = openSite ? model.bySite.get(openSite) : undefined;
  const openCount = openUsage?.count ?? 0;

  function recencyPhrase(lastUsedAt: string | null): string {
    const d = daysSince(lastUsedAt, now);
    if (d == null) return t("injection.usedNever");
    if (d === 0) return t("injection.usedToday");
    return t("injection.daysAgo", { n: d });
  }

  function choose(site: InjectionSite, point: SitePoint) {
    hapticSelect();
    setOpenSite(null);
    fade.value = 1;
    onSelect({ site, point });
  }

  const selectedLabel = selected
    ? t("injection.siteWithPoint", {
        site: t(`injectionSite.${selected.site}`),
        n: selected.point,
      })
    : t("injection.tapRegion");

  const pointRadius = 23 * upx;
  const pointFont = 15 * upx;
  const countFont = 10 * upx;

  return (
    <View
      className="rounded-2xl bg-glass border border-hair p-4"
      style={[
        { minHeight: Math.round(winH * 0.5) },
        model.total > 0 ? glow(THEME.accent, 24, 0.3) : null,
      ]}
    >
      <View className="flex-row items-center justify-between mb-1">
        <Text className="text-ink font-semibold">{t("injection.pointMapTitle")}</Text>
        <Text className="text-mut text-xs">
          {t("injection.usageWindow", { n: windowDays })}
        </Text>
      </View>
      <Text className="text-mut text-[11px] leading-4">{t("injectionMap.sub")}</Text>

      {/* Fixed-height bar: the hint and the zoom header swap without moving the SVG.
          RTL EXEMPTION: flexDirection is pre-reversed and the chevron stays a
          plain (non-DirIcon) glyph so this row renders byte-identical to LTR,
          matching the frozen silhouette below it instead of mirroring. */}
      <View style={{ height: 36, flexDirection: rtl ? "row-reverse" : "row", alignItems: "center" }}>
        {open ? (
          <>
            <Pressable
              onPress={() => goTo(null)}
              accessibilityRole="button"
              accessibilityLabel={t("injectionMap.backToBody")}
              hitSlop={10}
              style={{
                width: 30,
                height: 30,
                borderRadius: 15,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1,
                borderColor: THEME.border,
                backgroundColor: withAlpha("#ffffff", 0.06),
                [rtl ? "marginLeft" : "marginRight"]: 10,
              }}
            >
              <Ionicons name="chevron-back" size={16} color={THEME.accent} />
            </Pressable>
            <Text
              numberOfLines={1}
              style={{ color: THEME.ink, fontWeight: "800", fontSize: 14, flex: 1 }}
            >
              {t(`injectionSite.${openSite}`)}
            </Text>
            <Text style={{ color: THEME.muted, fontSize: 11, fontWeight: "700" }}>
              {t("injectionMap.entries", { n: openCount })}
            </Text>
          </>
        ) : (
          <Text numberOfLines={1} style={{ color: THEME.muted, fontSize: 11, flex: 1 }}>
            {t("injectionMap.overviewHint")}
          </Text>
        )}
      </View>

      <View className="items-center" style={{ alignSelf: "stretch", position: "relative" }}>
        {/* Sequential legend, ABSOLUTE at the far left so the silhouette stays centred.
            It sits on a light plate so the dark end of the ramp reads on the dark card.
            Hidden on zoom like the front/back key: the zoomed region is drawn at the
            full width of the card and would otherwise run underneath these labels.
            Being absolute, it takes no space in the flow either way, so hiding it
            cannot move the silhouette. */}
        {!open ? (
          <View
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: 24,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text
              className="text-mut"
              numberOfLines={1}
              style={{ fontSize: 10, marginBottom: 6, width: 56, alignSelf: "flex-start" }}
            >
              {t("injection.heatHigh")}
            </Text>
            <Svg width={14} height={legendH} style={{ alignSelf: "flex-start", marginLeft: 5 }}>
              <Defs>
                <LinearGradient id="freqLegend" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={frequencyFill(1)} />
                  <Stop offset="0.5" stopColor={frequencyFill(0.5)} />
                  <Stop offset="1" stopColor={frequencyFill(0)} />
                </LinearGradient>
              </Defs>
              <Rect
                x={1}
                y={1}
                width={12}
                height={legendH - 2}
                rx={6}
                fill="url(#freqLegend)"
                stroke={EDGE}
                strokeWidth={1.2}
              />
            </Svg>
            <Text
              className="text-mut"
              numberOfLines={1}
              style={{ fontSize: 10, marginTop: 6, width: 56, alignSelf: "flex-start" }}
            >
              {t("injection.heatLow")}
            </Text>
          </View>
        ) : null}

        <Animated.View style={[{ width: svgW, height: svgH }, fadeStyle]}>
          <Svg width={svgW} height={svgH} viewBox={`${vx} ${vy} ${vw} ${vh}`}>
            <Defs>
              <LinearGradient id="bodyGrad" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#eef7fb" />
                <Stop offset="1" stopColor="#c2d5df" />
              </LinearGradient>
            </Defs>

            <G onPress={open ? () => goTo(null) : undefined}>
              <Path
                d={BODY_PATH}
                fill="url(#bodyGrad)"
                stroke={BODY_EDGE}
                strokeWidth={1.2 * upx}
              />
              <Circle cx={120} cy={170} r={2} fill="rgba(10,20,26,0.28)" />
            </G>

            {REGIONS.map((r) => {
              const geo = GEOMETRY.get(r.site)!;
              const u = model.bySite.get(r.site);
              const count = u?.count ?? 0;
              const level = regionHeatLevel(count, model.total);
              const plate = surfaceRgb(r.surface, level);
              const isOpen = openSite === r.site;
              const isSelected = selected?.site === r.site;
              const holdsLeast = showRotationHint && model.least?.site === r.site;
              const [bx, by, bw, bh] = r.box;
              const [hx, hy, hw, hh] = hitBoxFor(r);
              // While a region is zoomed, its neighbours are backdrop only. Their
              // padded hit rects reach into the zoomed viewBox (thigh_left's
              // starts at x=121.5, inside thigh_right's zoom which ends at 123.5 -
              // the physical boxes are unchanged by the observer-view flip above,
              // only which site label sits in which box, so the numbers are the
              // same as before with the two site names swapped) and, drawn later,
              // answered taps meant for the open region's edge or for "back to
              // body". Dropping the handler AND the invisible rect lets those taps
              // fall through to the silhouette, which returns to the full view.
              // Nothing overlaps in the full view, so it is unchanged.
              const inert = open != null && !isOpen;
              return (
                <G
                  key={r.site}
                  opacity={inert ? 0.32 : 1}
                  onPress={inert ? undefined : () => goTo(isOpen ? null : r.site)}
                  accessible={!inert}
                  accessibilityRole={inert ? undefined : "button"}
                  accessibilityLabel={
                    inert
                      ? undefined
                      : `${t(`injectionSite.${r.site}`)} · ${t("injectionMap.entries", {
                          n: count,
                        })}${holdsLeast ? ` · ${t("injection.leastUsedPoint")}` : ""}`
                  }
                >
                  {(hw !== bw || hh !== bh) && !inert ? (
                    <Rect x={hx} y={hy} width={hw} height={hh} fill="transparent" />
                  ) : null}
                  {/* Selection and the rotation suggestion are drawn as two
                      separate rings so neither hides the other when both are
                      true at once: selection keeps its usual OUTER ring
                      (HALO is already tuned to the tightest silhouette
                      clearance, the upper arm, so it cannot grow further
                      outward for a second ring); the suggestion ring goes on
                      the outside when selection is absent, and INSIDE the box
                      (always safe - the box itself is already well inside the
                      body outline) when both apply at once. */}
                  {isSelected ? (
                    <Rect
                      x={bx - HALO}
                      y={by - HALO}
                      width={bw + HALO * 2}
                      height={bh + HALO * 2}
                      rx={r.rx + HALO}
                      fill="none"
                      stroke={THEME.accent}
                      strokeWidth={1.6 * upx}
                    />
                  ) : null}
                  {holdsLeast && !isSelected ? (
                    <Rect
                      x={bx - HALO}
                      y={by - HALO}
                      width={bw + HALO * 2}
                      height={bh + HALO * 2}
                      rx={r.rx + HALO}
                      fill="none"
                      stroke={ROTATION_COLOR}
                      strokeWidth={1.6 * upx}
                      strokeDasharray={`${3 * upx} ${3 * upx}`}
                    />
                  ) : null}
                  {/* A back region keeps the frequency ramp but paints it on the
                      slate plate and dashes its outline, the drawing convention
                      for an edge that is on the far side of the object. */}
                  <Rect
                    x={bx}
                    y={by}
                    width={bw}
                    height={bh}
                    rx={r.rx}
                    fill={rgbCss(plate)}
                    stroke={EDGE}
                    strokeWidth={2.2 * upx}
                    strokeDasharray={
                      r.surface === "back"
                        ? `${BACK_DASH[0] * upx} ${BACK_DASH[1] * upx}`
                        : undefined
                    }
                  />
                  {/* Combined state only: the plate fill above would paint over
                      an inset ring drawn earlier, so this one is drawn last,
                      on top of the opaque plate. */}
                  {holdsLeast && isSelected ? (
                    <Rect
                      x={bx + REGION_INSET}
                      y={by + REGION_INSET}
                      width={bw - REGION_INSET * 2}
                      height={bh - REGION_INSET * 2}
                      rx={Math.max(0, r.rx - REGION_INSET)}
                      fill="none"
                      stroke={ROTATION_COLOR}
                      strokeWidth={1.6 * upx}
                    />
                  ) : null}
                  {!open ? (
                    <SvgText
                      x={geo.cx}
                      y={geo.cy + countFont * 0.36}
                      fontSize={countFont}
                      fontWeight="bold"
                      fill={inkOn(plate)}
                      textAnchor="middle"
                    >
                      {String(count)}
                    </SvgText>
                  ) : null}
                </G>
              );
            })}

            {/* Zoom: the open region's four points, at full touch size. */}
            {open
              ? GEOMETRY.get(open.region.site)!.points.map((pp) => {
                  const p = openUsage?.points.find((x) => x.point === pp.point);
                  const count = p?.count ?? 0;
                  const level = pointHeatLevel(count, openCount);
                  // The dots inherit their region's face, so a zoomed buttock
                  // still reads as the back of the body rather than switching
                  // back to the front ramp under the user's finger.
                  const dot = surfaceRgb(open.region.surface, level);
                  const on = selected?.site === open.region.site && selected.point === pp.point;
                  const isLeast =
                    showRotationHint &&
                    model.least?.site === open.region.site &&
                    model.least.point === pp.point;
                  return (
                    <G
                      key={pp.point}
                      onPress={() => choose(open.region.site, pp.point)}
                      accessible
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={`${t("injection.siteWithPoint", {
                        site: t(`injectionSite.${open.region.site}`),
                        n: pp.point,
                      })} · ${t("injectionMap.entries", { n: count })} · ${recencyPhrase(
                        p?.lastUsedAt ?? null
                      )}${isLeast ? ` · ${t("injection.leastUsedPoint")}` : ""}`}
                    >
                      {/* Same outer/inner split as the region ring above: the
                          selection ring keeps its usual radius, the suggestion
                          ring moves to a smaller radius (still outside the
                          dot) only when both are true, so one never masks the
                          other. */}
                      {on ? (
                        <Circle
                          cx={pp.x}
                          cy={pp.y}
                          r={pointRadius + POINT_RING_OUTER * upx}
                          fill="none"
                          stroke={THEME.accent}
                          strokeWidth={1.8 * upx}
                        />
                      ) : null}
                      {isLeast ? (
                        <Circle
                          cx={pp.x}
                          cy={pp.y}
                          r={pointRadius + (on ? POINT_RING_INNER : POINT_RING_OUTER) * upx}
                          fill="none"
                          stroke={ROTATION_COLOR}
                          strokeWidth={1.8 * upx}
                          strokeDasharray={on ? undefined : `${3 * upx} ${3 * upx}`}
                        />
                      ) : null}
                      <Circle
                        cx={pp.x}
                        cy={pp.y}
                        r={pointRadius}
                        fill={rgbCss(dot)}
                        stroke={EDGE}
                        strokeWidth={1.6 * upx}
                        strokeDasharray={
                          open.region.surface === "back"
                            ? `${BACK_DASH[0] * upx} ${BACK_DASH[1] * upx}`
                            : undefined
                        }
                      />
                      <SvgText
                        x={pp.x}
                        y={pp.y + pointFont * 0.36}
                        fontSize={pointFont}
                        fontWeight="bold"
                        fill={inkOn(dot)}
                        textAnchor="middle"
                      >
                        {String(pp.point)}
                      </SvgText>
                    </G>
                  );
                })
              : null}
          </Svg>

          {/* Side badges, pinned beside the shoulders. Decorative: every region's
              own label already names the side, so the screen reader is told to
              skip them. Each pill is its own absolute child rather than a
              full-size overlay, so nothing ever lies across the map's taps. */}
          {!open
            ? badges.map((b) => (
                <View
                  key={b.key}
                  pointerEvents="none"
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={b.style}
                >
                  <Text
                    numberOfLines={1}
                    style={{ color: THEME.muted, fontSize: 10, fontWeight: "800" }}
                  >
                    {t(`injectionMap.${b.key}`)}
                  </Text>
                </View>
              ))
            : null}
        </Animated.View>

        {/* Front/back key, top right. Hidden on zoom so it cannot sit over the
            enlarged region or the back button above it. */}
        {!open ? (
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              right: 0,
              top: 0,
              gap: 4,
              maxWidth: SURFACE_KEY_MAX_W,
            }}
          >
            {SURFACE_KEY.map((s) => (
              <View
                key={s.key}
                style={{ flexDirection: "row", alignItems: "center", gap: 5 }}
              >
                <Svg width={11} height={11}>
                  <Circle
                    cx={5.5}
                    cy={5.5}
                    r={4.4}
                    fill={s.fill}
                    stroke={EDGE}
                    strokeWidth={1.1}
                    strokeDasharray={s.dashed ? "2.2 1.7" : undefined}
                  />
                </Svg>
                <Text
                  numberOfLines={1}
                  style={{ color: THEME.muted, fontSize: 10, fontWeight: "700" }}
                >
                  {t(`injectionMap.${s.key}`)}
                </Text>
              </View>
            ))}
            {showRotationHint ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                <Svg width={11} height={11}>
                  <Circle
                    cx={5.5}
                    cy={5.5}
                    r={4.4}
                    fill="none"
                    stroke={ROTATION_COLOR}
                    strokeWidth={1.3}
                    strokeDasharray="2.2 1.7"
                  />
                </Svg>
                <Text
                  numberOfLines={1}
                  style={{ color: THEME.muted, fontSize: 10, fontWeight: "700" }}
                >
                  {t("injectionMap.rotationHint")}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>

      <Text className="text-mut text-[11px] text-center mt-2 leading-4">
        {t("injectionMap.selfViewNote")}
      </Text>

      {/* Fixed slot: the absorption chip appears on zoom without moving anything below. */}
      <View style={{ height: 30, alignItems: "center", justifyContent: "center" }}>
        {open ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingVertical: 5,
              paddingHorizontal: 10,
              borderRadius: RADIUS.full,
              backgroundColor: withAlpha(THEME.accent, 0.12),
              borderWidth: 1,
              borderColor: withAlpha(THEME.accent, 0.3),
            }}
          >
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: THEME.accent }} />
            <Text style={{ color: THEME.accent, fontSize: 11, fontWeight: "700" }}>
              {t(absorptionKey(open.region.site))}
            </Text>
          </View>
        ) : null}
      </View>

      <Text className="text-ink font-semibold text-center mt-1">{selectedLabel}</Text>

      <Text className="text-mut text-[11px] text-center mt-2 leading-4">
        {t("injection.pointNeutral")}
      </Text>
      {!isScreenshotMode() && model.legacyAbdomen > 0 ? (
        <Text className="text-mut text-[11px] text-center mt-1">
          {t("injection.abdomenGeneral", { n: model.legacyAbdomen })}
        </Text>
      ) : null}
      {!isScreenshotMode() && model.unassigned > 0 ? (
        <Text className="text-mut text-[11px] text-center mt-1">
          {t("injection.noPointYet", { n: model.unassigned })}
        </Text>
      ) : null}
      {!isScreenshotMode() && noSiteCount > 0 ? (
        <Text className="text-mut text-[11px] text-center mt-1">
          {t("injection.noRegionCount", { n: noSiteCount })}
        </Text>
      ) : null}
      {/* A profile that only ever logs through the calculator has every dose
          in noSiteCount and none on the silhouette - "no injections yet" would
          be wrong there, so the truly-empty text only shows when there is
          really nothing recorded anywhere. */}
      {model.total === 0 && noSiteCount === 0 ? (
        <Text className="text-mut text-[11px] text-center mt-2">{t("injection.empty")}</Text>
      ) : null}

      {onStartNewCycle ? (
        <View className="flex-row items-center justify-between mt-3">
          <Text numberOfLines={1} style={{ color: THEME.muted, fontSize: 11, flex: 1 }}>
            {cycleStart ? t("injection.cycleSince", { date: formatDate(cycleStart) }) : ""}
          </Text>
          <Pressable
            onPress={onStartNewCycle}
            accessibilityRole="button"
            accessibilityLabel={t("injection.newCycle")}
            hitSlop={8}
            className="flex-row items-center rounded-full px-3 py-1.5 active:opacity-80"
            style={{
              borderWidth: 1,
              borderColor: withAlpha(THEME.accent, 0.3),
              backgroundColor: withAlpha(THEME.accent, 0.12),
            }}
          >
            <Ionicons name="refresh-outline" size={13} color={THEME.accent} />
            <Text style={{ color: THEME.accent, fontSize: 11, fontWeight: "800", marginLeft: 6 }}>
              {t("injection.newCycle")}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
