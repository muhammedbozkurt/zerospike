import type { GlucoseUnit } from "../db/types";
import { cgmTrend, TREND_MAX_AGE_MIN, type CgmTrend } from "../cgm/trend";
import { formatTime } from "../format";
import { formatGlucose } from "../glucose";

/**
 * The CGM half of the live-surface snapshot (lib/services/liveData.ts). Pure
 * and dependency-light so the payload shape, the 20 minute staleness rule and
 * the Android model run under plain Node (scripts/liveDataCgm.test.ts).
 *
 * Manual profiles get `{ mode: "manual" }` and no `cgm` key at all, so every
 * surface keeps drawing exactly what it drew before sensor data existed. There
 * is no threshold and no alert here: a reading is shown, an old one is shown
 * faded or as an age only.
 */

export type LiveCgmMode = "manual" | "cgm" | "nightscout";

export interface LiveCgm {
  /** Newest sensor reading, mg/dL. */
  mgdl: number;
  /** epoch ms of that reading. */
  at: number;
  trend: CgmTrend | null;
  /** Whole minutes between the reading and the snapshot. Native surfaces that
   *  can redraw by the clock recompute it from `at`. */
  ageMin: number;
  /** `mgdl` pre-formatted in the display unit and the active locale. */
  display: string;
}

export interface CgmReading {
  at: number;
  mgdl: number;
}

/** Older than this the reading is drawn stale (faded, no arrow). */
export const CGM_STALE_MIN = TREND_MAX_AGE_MIN;

/** How many of the newest sensor rows feed the trend: a 20 minute window holds
 *  at most a handful at 1-5 minute spacing. */
export const CGM_RECENT_LIMIT = 30;

export function isCgmStale(ageMin: number): boolean {
  return ageMin > CGM_STALE_MIN;
}

function ageMinutes(at: number, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - at) / 60000));
}

export function buildLiveCgm(
  readings: readonly CgmReading[],
  nowMs: number,
  unit: GlucoseUnit
): LiveCgm | undefined {
  let newest: CgmReading | null = null;
  for (const r of readings) {
    if (!Number.isFinite(r.at) || !Number.isFinite(r.mgdl)) continue;
    if (newest == null || r.at > newest.at) newest = r;
  }
  if (newest == null) return undefined;
  return {
    mgdl: newest.mgdl,
    at: newest.at,
    trend: cgmTrend(readings, nowMs),
    ageMin: ageMinutes(newest.at, nowMs),
    display: formatGlucose(newest.mgdl, unit),
  };
}

/** The two fields LiveData adds. `cgm` is absent in manual mode and whenever a
 *  sensor mode has no sensor reading yet. */
export function cgmLiveFields(
  mode: LiveCgmMode,
  readings: readonly CgmReading[],
  nowMs: number,
  unit: GlucoseUnit
): { mode: LiveCgmMode; cgm?: LiveCgm } {
  if (mode === "manual") return { mode };
  const cgm = buildLiveCgm(readings, nowMs, unit);
  return cgm ? { mode, cgm } : { mode };
}

/** Newest sensor rows of a profile, newest first. Reads idx_sugar_cgm. */
export async function loadCgmReadings(profileId: string): Promise<CgmReading[]> {
  const { getDb } = await import("../db/index");
  const db = await getDb();
  const rows = await db.getAllAsync<{ glucose_level_mgdl: number; logged_at: string }>(
    `SELECT glucose_level_mgdl, logged_at FROM sugar_logs
      WHERE profile_id = ? AND is_cgm = 1 ORDER BY logged_at DESC LIMIT ?;`,
    [profileId, CGM_RECENT_LIMIT]
  );
  return rows.map((r) => ({
    at: new Date(r.logged_at).getTime(),
    mgdl: r.glucose_level_mgdl,
  }));
}

const TREND_GLYPH: Record<CgmTrend, string> = {
  up2: "↑↑",
  up: "↑",
  up45: "↗",
  flat: "→",
  down45: "↘",
  down: "↓",
  down2: "↓↓",
};

export function cgmTrendGlyph(trend: CgmTrend | null | undefined): string {
  return trend ? TREND_GLYPH[trend] : "";
}

interface AgeLabels {
  hourShort?: string;
  minuteShort?: string;
  agoTemplate?: string;
}

/** "4 dk önce" (or "4 dk" when `short`). Composed from the snapshot's own labels
 *  with the same template the Swift surfaces use, never an OS formatter. */
export function cgmAgeText(
  ageMin: number,
  labels?: AgeLabels,
  short = false
): string {
  const hr = labels?.hourShort ?? "hr";
  const min = labels?.minuteShort ?? "min";
  const h = Math.floor(ageMin / 60);
  const m = ageMin % 60;
  const duration =
    h > 0 ? (m > 0 ? `${h} ${hr} ${m} ${min}` : `${h} ${hr}`) : `${m} ${min}`;
  const template = labels?.agoTemplate;
  if (short || !template) return duration;
  return template.replace("{{t}}", duration);
}

export interface CgmWidgetModel {
  label: string;
  value: string;
  glyph: string;
  ageText: string;
  stale: boolean;
  ageMin: number;
}

interface CgmWidgetSource {
  mode?: string;
  cgm?: LiveCgm;
  labels?: AgeLabels & { cgm?: string };
}

/** What a JS-rendered widget draws in CGM mode, or null for the manual look.
 *  The age is measured against `nowMs` (the render), not the snapshot, because
 *  a widget bitmap can sit unredrawn for a while. */
export function cgmWidgetModel(
  data: CgmWidgetSource | null | undefined,
  nowMs: number
): CgmWidgetModel | null {
  const cgm = data?.cgm;
  if (!data || !cgm || !data.mode || data.mode === "manual") return null;
  const ageMin = ageMinutes(cgm.at, nowMs);
  const stale = isCgmStale(ageMin);
  return {
    label: data.labels?.cgm || "CGM",
    value: cgm.display,
    glyph: stale ? "" : cgmTrendGlyph(cgm.trend),
    ageText: cgmAgeText(ageMin, data.labels),
    stale,
    ageMin,
  };
}

/** The Live Activity pill text: the value with its unit, then the clock time it
 *  was read at ("142 mg/dL · 14:05"). The unit sits right after the value so it
 *  can never read as belonging to the time. The activity's content state is written only when the app
 *  syncs, so an arrow or a bare number would keep looking current on the lock
 *  screen after the sensor stopped; the reading time stays true on its own. No
 *  arrow, fresh or old. */
export function cgmReadingText(cgm: LiveCgm, unitLabel: string): string {
  return `${cgm.display} ${unitLabel} · ${formatTime(new Date(cgm.at).toISOString())}`;
}
