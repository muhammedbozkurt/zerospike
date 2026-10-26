/**
 * A direction arrow from the last few sensor readings. Pure and brand free.
 * It describes how the recent readings moved; it has no thresholds on the
 * glucose level, no range and no alert.
 */

export type CgmTrend = "up2" | "up" | "flat" | "down" | "down2";

export interface TrendReading {
  /** ISO string or epoch milliseconds. */
  at: string | number;
  /** mg/dL, integer. */
  mgdl: number;
}

/** Readings older than this, measured from the newest one, are not used. */
export const TREND_WINDOW_MIN = 20;
export const TREND_MIN_READINGS = 3;
/** The readings must span at least this long, so three samples taken within a
 *  minute of each other do not make a slope. */
export const TREND_MIN_SPAN_MIN = 8;
/** A newest reading older than this (against `nowMs`) gives no arrow. */
export const TREND_MAX_AGE_MIN = 20;

/** mg/dL per minute: below FLAT is flat, from DOUBLE up is a double arrow. */
export const TREND_FLAT_PER_MIN = 1;
export const TREND_DOUBLE_PER_MIN = 2;

function toMs(at: string | number): number {
  return typeof at === "number" ? at : Date.parse(at);
}

/**
 * Least-squares slope over the readings within TREND_WINDOW_MIN of the newest
 * one. Returns null when there are fewer than TREND_MIN_READINGS usable
 * readings, they span less than TREND_MIN_SPAN_MIN, or (when `nowMs` is given)
 * the newest is older than TREND_MAX_AGE_MIN.
 */
export function cgmTrend(
  readings: readonly TrendReading[],
  nowMs?: number
): CgmTrend | null {
  const points = readings
    .map((r) => ({ t: toMs(r.at), v: r.mgdl }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v))
    .sort((a, b) => a.t - b.t);
  if (points.length < TREND_MIN_READINGS) return null;

  const newest = points[points.length - 1].t;
  if (nowMs !== undefined && nowMs - newest > TREND_MAX_AGE_MIN * 60000) return null;

  const from = newest - TREND_WINDOW_MIN * 60000;
  const window = points.filter((p) => p.t >= from);
  if (window.length < TREND_MIN_READINGS) return null;
  if (newest - window[0].t < TREND_MIN_SPAN_MIN * 60000) return null;

  const n = window.length;
  const t0 = window[0].t;
  let sumX = 0;
  let sumY = 0;
  for (const p of window) {
    sumX += (p.t - t0) / 60000;
    sumY += p.v;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  let num = 0;
  let den = 0;
  for (const p of window) {
    const dx = (p.t - t0) / 60000 - meanX;
    num += dx * (p.v - meanY);
    den += dx * dx;
  }
  if (den === 0) return null;
  const perMin = num / den;

  const abs = Math.abs(perMin);
  if (abs < TREND_FLAT_PER_MIN) return "flat";
  if (abs >= TREND_DOUBLE_PER_MIN) return perMin > 0 ? "up2" : "down2";
  return perMin > 0 ? "up" : "down";
}
