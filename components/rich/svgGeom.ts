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
  const span = max - min || 1;
  const n = data.length;
  const stepX = n > 1 ? (width - pad * 2) / (n - 1) : 0;
  const px = (i: number) => pad + i * stepX;
  const py = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2);
  const pts = data.map((v, i) => ({ x: px(i), y: n > 1 ? py(v) : height / 2 }));

  if (pts.length < 2) {
    const y = pts[0]?.y ?? height / 2;
    const line = `M${pad},${y.toFixed(1)} L${width - pad},${y.toFixed(1)}`;
    return { line, area: `${line} L${width - pad},${height - pad} L${pad},${height - pad} Z` };
  }

  let line = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    line += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  const area = `${line} L${pts[pts.length - 1].x.toFixed(1)},${height - pad} L${pts[0].x.toFixed(1)},${height - pad} Z`;
  return { line, area };
}
