import type { SugarLog } from "./db/types";

/**
 * Ambulatory Glucose Profile (AGP) — the standard chart clinicians read: glucose
 * percentile bands by time of day, pooled across all days in the window. Pure
 * and deterministic so it can be unit-tested; the PDF report renders it as SVG.
 *
 * Works best with dense (CGM) data; with sparse fingersticks the bands are still
 * computed but flagged via `totalReadings` so the report can require a minimum.
 */

/** Below this many readings an AGP is too sparse to be meaningful. */
export const AGP_MIN_READINGS = 20;

export interface AgpBand {
  hour: number; // 0..23 (local hour of day)
  n: number;
  p05: number;
  p25: number;
  p50: number; // median
  p75: number;
  p95: number;
}

export interface Agp {
  bands: AgpBand[];
  totalReadings: number;
}

/** Linear-interpolated percentile of an ASCENDING-sorted array (p in 0..100). */
export function percentile(sortedAsc: number[], p: number): number {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  if (n === 1) return sortedAsc[0];
  const idx = (p / 100) * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  const frac = idx - lo;
  return sortedAsc[lo] * (1 - frac) + sortedAsc[hi] * frac;
}

/** Pools readings in the window into 24 hour-of-day buckets and returns the
 *  percentile band for every hour that has at least one reading. */
export function computeAgp(
  sugar: SugarLog[],
  windowDays = 14,
  /** Optional explicit range (epoch ms); two-sided, overrides windowDays. */
  range?: { start: number; end: number }
): Agp {
  const since = Date.now() - windowDays * 86_400_000;
  const byHour: number[][] = Array.from({ length: 24 }, () => []);
  let total = 0;
  for (const r of sugar) {
    const t = new Date(r.logged_at).getTime();
    if (Number.isNaN(t)) continue;
    if (range ? t < range.start || t > range.end : t < since) continue;
    const h = new Date(r.logged_at).getHours();
    if (Number.isNaN(h)) continue;
    byHour[h].push(r.glucose_level_mgdl);
    total++;
  }
  const bands: AgpBand[] = [];
  for (let h = 0; h < 24; h++) {
    const vals = byHour[h];
    if (vals.length === 0) continue;
    const s = [...vals].sort((a, b) => a - b);
    bands.push({
      hour: h,
      n: s.length,
      p05: Math.round(percentile(s, 5)),
      p25: Math.round(percentile(s, 25)),
      p50: Math.round(percentile(s, 50)),
      p75: Math.round(percentile(s, 75)),
      p95: Math.round(percentile(s, 95)),
    });
  }
  return { bands, totalReadings: total };
}
