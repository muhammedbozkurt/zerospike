/**
 * Small pure-geometry helpers shared by the SVG signature components (rings,
 * donut, gauges). No React, no side effects - just math, so they are trivial to
 * reason about and reuse across the dashboard, Insights, the report and Watch.
 */

/** A point on a circle. Angles are in degrees, 0 deg = 3 o'clock, clockwise. */
export function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/**
 * SVG path for an arc stroke from `startDeg` to `endDeg` (clockwise) on a circle
 * of radius `r` centred at (cx, cy). Used for the glucose ring gauge track and
 * fill. 12 o'clock is 0 deg; a 270 deg gauge opens at the bottom (start 135,
 * sweep 270).
 */
export function arcPath(
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number
): string {
  const start = polar(cx, cy, r, startDeg);
  const end = polar(cx, cy, r, endDeg);
  const large = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
  const sweep = endDeg > startDeg ? 1 : 0;
  return `M${start.x.toFixed(2)},${start.y.toFixed(2)} A${r},${r} 0 ${large} ${sweep} ${end.x.toFixed(2)},${end.y.toFixed(2)}`;
}

/** Clamp `n` into [min, max]. */
export function clamp(n: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Maps a glucose value (mg/dL) to a 0..1 fraction of the ring, over a display
 * domain of 40..300 mg/dL. Decorative only - the numeric value is always shown
 * in the centre, so the exact sweep is never read as a measurement.
 */
export function glucoseFraction(mgdl: number, lo = 40, hi = 300): number {
  return clamp((mgdl - lo) / (hi - lo));
}

/** A series scaled into a `width` x `height` box, one point per value, evenly
 *  spaced on x. `domainMin`/`domainMax` are the Y-axis range the values are
 *  normalized against - split out from {@link seriesPaths} so a second series
 *  (a percentile ribbon's upper/lower edge) can share the exact same Y-scale
 *  as the primary line instead of being independently min/max-fit, which
 *  would make the two visually disagree about where a value sits. */
export function seriesPoints(
  data: number[],
  width: number,
  height: number,
  domainMin: number,
  domainMax: number,
  pad = 3
): { x: number; y: number }[] {
  if (!data || data.length === 0) return [];
  const span = domainMax - domainMin || 1;
  const n = data.length;
  const stepX = n > 1 ? (width - pad * 2) / (n - 1) : 0;
  const px = (i: number) => pad + i * stepX;
  const py = (v: number) => pad + (1 - (v - domainMin) / span) * (height - pad * 2);
  return data.map((v, i) => ({ x: px(i), y: n > 1 ? py(v) : height / 2 }));
}

/** Catmull-Rom-to-Bezier smoothed path through `pts` (a soft curve, not a
 *  zigzag) - the line half of {@link seriesPaths}, pulled out so a ribbon's
 *  upper/lower edges can be smoothed with the identical formula the median
 *  line uses. Needs at least one point; a single point renders as a dot (a
 *  zero-length "line"). */
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

/** Line + closed-area path through already-scaled `pts` (see {@link
 *  seriesPoints}) - the shared second half of {@link seriesPaths}, exposed so
 *  a caller that needs several series on ONE shared Y-domain (a median line
 *  plus its percentile ribbons) can compute points with an explicit domain
 *  and still get the identical curve-building/area-closing logic. */
export function pathsFromPoints(
  pts: { x: number; y: number }[],
  width: number,
  height: number,
  pad = 3
): { line: string; area: string } {
  if (pts.length < 2) {
    const y = pts[0]?.y ?? height / 2;
    const line = `M${pad},${y.toFixed(1)} L${width - pad},${y.toFixed(1)}`;
    return { line, area: `${line} L${width - pad},${height - pad} L${pad},${height - pad} Z` };
  }
  const line = smoothPath(pts);
  const area = `${line} L${pts[pts.length - 1].x.toFixed(1)},${height - pad} L${pts[0].x.toFixed(1)},${height - pad} Z`;
  return { line, area };
}

/**
 * Build a smooth-ish SVG path (line and, optionally, a closed area) through a
 * numeric series scaled into a `width` x `height` box. Uses Catmull-Rom to
 * Bezier smoothing so the gradient area charts read as soft curves, not zigzag.
 */
export function seriesPaths(
  data: number[],
  width: number,
  height: number,
  pad = 3
): { line: string; area: string } {
  if (!data || data.length === 0) return { line: "", area: "" };
  const min = Math.min(...data);
  const max = Math.max(...data);
  const pts = seriesPoints(data, width, height, min, max, pad);
  return pathsFromPoints(pts, width, height, pad);
}

/**
 * A closed, smoothed ribbon between two same-length series (e.g. a p25-p75
 * percentile band): the upper edge left-to-right, then the lower edge
 * right-to-left, both smoothed with the same Catmull-Rom curve the median
 * line uses so the ribbon reads as one soft shape rather than a line paired
 * with a jagged fill. `upper`/`lower` must already share the caller's chosen
 * Y-domain (see {@link seriesPoints}) so the ribbon lines up with whatever
 * line is drawn over it.
 */
export function ribbonPath(
  upper: { x: number; y: number }[],
  lower: { x: number; y: number }[]
): string {
  if (upper.length === 0 || lower.length === 0) return "";
  const top = smoothPath(upper);
  const bottomReversed = [...lower].reverse();
  // Continue the path from the upper curve's end into the lower curve's
  // (reversed) end with a straight line, then smooth back along it.
  const bottom = smoothPath(bottomReversed);
  // bottom starts with its own "M"; replace it with "L" to keep one single path.
  return `${top} L${bottomReversed[0].x.toFixed(1)},${bottomReversed[0].y.toFixed(1)} ${bottom.replace(/^M[^ ]+/, "")} Z`;
}

export function lerpHex(a: string, b: string, t: number): string {
  const pa = a.replace("#", "");
  const pb = b.replace("#", "");
  const ai = [0, 2, 4].map((i) => parseInt(pa.slice(i, i + 2), 16));
  const bi = [0, 2, 4].map((i) => parseInt(pb.slice(i, i + 2), 16));
  const ci = ai.map((v, i) => Math.round(v + (bi[i] - v) * t));
  return `#${ci.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
