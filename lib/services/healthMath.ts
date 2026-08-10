import { mmolToMgdl } from "../glucose";

/**
 * Pure, platform-agnostic helpers for the health-store import (lib/services/
 * health.ts). Kept free of any react-native import so they can be unit-tested
 * in a standalone TS harness (scripts/calc.test.ts).
 */

/** Default dedup grain: collapse the same physical sample re-read with sub-second
 *  jitter into one row, while keeping readings minutes apart distinct. */
export const SNAP_SECONDS = 60;

/**
 * Snap an ISO timestamp to a fixed grain (default 60 s). HealthKit can return
 * the same sample with millisecond drift across syncs (`…00.123Z` vs `…00.000Z`);
 * snapping makes the exact-string dedup collapse them instead of duplicating.
 */
export function snapIso(iso: string, seconds: number = SNAP_SECONDS): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const grain = seconds * 1000;
  return new Date(Math.round(t / grain) * grain).toISOString();
}

/**
 * Resolve a health record's canonical mg/dL from its EXPLICIT unit fields.
 * Never infers the unit from magnitude, and a clinically real severe-hypo mg/dL
 * reading (e.g. 22) overlaps the mmol range, and a magnitude guess would
 * silently 18×-inflate that life-threatening LOW into a fake HIGH. Each platform
 * already knows its unit (iOS queries in mg/dL; Android exposes both fields), so
 * we only convert a value KNOWN to be mmol. Returns null if neither is usable.
 */
export function pickMgdl(fields: {
  mgdl?: number | null;
  mmol?: number | null;
}): number | null {
  const { mgdl, mmol } = fields;
  if (mgdl != null && Number.isFinite(mgdl) && mgdl > 0) return mgdl;
  if (mmol != null && Number.isFinite(mmol) && mmol > 0) return mmolToMgdl(mmol);
  return null;
}
