/**
 * Turns a Nightscout /api/v1/entries.json answer into importable readings.
 * Pure. Only what is needed is read: type, sgv, date (epoch ms), _id, device.
 *
 *  - sgv is mg/dL as stored by Nightscout. The server's DISPLAY_UNITS setting
 *    only changes how it shows values, so nothing is converted here.
 *  - dateString and utcOffset are ignored: they carry the uploader's local time.
 *  - 39 and 401 are Dexcom's LOW and HIGH codes, not measurements.
 */
import type { ImportedGlucoseRow } from "../db/healthImportSql";

export const NS_MGDL_MIN = 20;
export const NS_MGDL_MAX = 600;
const LOW_CODE = 39;
const HIGH_CODE = 401;
const DAY_MS = 86_400_000;
const FUTURE_SLACK_MS = 5 * 60_000;
const MAX_AGE_MS = 90 * DAY_MS;
const ID_MAX = 64;
const DEVICE_MAX = 64;

export interface ParsedEntries {
  rows: ImportedGlucoseRow[];
  /** Newest and oldest accepted date among all entries, readable or not. */
  newestMs: number | null;
  oldestMs: number | null;
  /** How many entries were looked at. */
  seen: number;
}

function cleanString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length > 0 ? t.slice(0, max) : null;
}

/**
 * `floorMs`: entries at or before it are not imported (the moment the user
 * cleared their data; those readings must not come back).
 */
export function parseNightscoutEntries(
  raw: unknown,
  nowMs: number,
  floorMs: number | null = null
): ParsedEntries {
  const out: ParsedEntries = { rows: [], newestMs: null, oldestMs: null, seen: 0 };
  if (!Array.isArray(raw)) return out;
  const seenIds = new Set<string>();
  for (const item of raw) {
    if (item == null || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    const date = e.date;
    if (typeof date !== "number" || !Number.isFinite(date)) continue;
    if (date > nowMs + FUTURE_SLACK_MS || date < nowMs - MAX_AGE_MS) continue;
    out.seen++;
    if (out.newestMs == null || date > out.newestMs) out.newestMs = date;
    if (out.oldestMs == null || date < out.oldestMs) out.oldestMs = date;

    if (e.type !== "sgv") continue;
    const sgv = e.sgv;
    if (typeof sgv !== "number" || !Number.isFinite(sgv)) continue;
    const mgdl = Math.round(sgv);
    if (mgdl === LOW_CODE || mgdl === HIGH_CODE) continue;
    if (mgdl < NS_MGDL_MIN || mgdl > NS_MGDL_MAX) continue;
    if (floorMs != null && date <= floorMs) continue;

    const externalId = cleanString(e._id, ID_MAX) ?? `${Math.round(date)}:${mgdl}`;
    if (seenIds.has(externalId)) continue;
    seenIds.add(externalId);
    out.rows.push({
      at: new Date(date).toISOString(),
      mgdl,
      source: "nightscout",
      sourceApp: cleanString(e.device, DEVICE_MAX),
      externalId,
      isCgm: true,
    });
  }
  return out;
}
