import type { GlucoseUnit } from "../db/types";
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
  /** Always null: the Swift surfaces still decode this optional key, so it is
   *  kept in the payload and never filled. */
  trend: null;
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

/** Older than this the reading is drawn stale (faded). */
export const CGM_STALE_MIN = 20;

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
    trend: null,
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

/**
 * What the "next reminder" computation may offer a surface in a sensor mode:
 * the same set the app itself schedules. Measurement reminders the user has not
 * opted back in read as switched off (the withCgmPause rule of
 * lib/cgm/reminderMode.ts), and the post-meal end is withheld because a sensor
 * mode arms nothing to ring there (notifications.ts schedulePostMealAt). The
 * countdown itself is a separate LiveData field and is unaffected.
 */
export function widgetUpcomingInputs<T extends { id: string; type: string; enabled: number }>(
  mode: LiveCgmMode,
  rows: readonly T[],
  optIn: ReadonlySet<string>,
  postMealEndsAt: number | null
): { rows: T[]; postMealEndsAt: number | null } {
  if (mode === "manual") return { rows: [...rows], postMealEndsAt };
  return {
    rows: rows.map((r) =>
      r.type === "glucose" && !optIn.has(r.id) ? { ...r, enabled: 0 } : r
    ),
    postMealEndsAt: null,
  };
}

/** Newest sensor row of a profile (at most one). Reads idx_sugar_cgm. */
export async function loadCgmReadings(profileId: string): Promise<CgmReading[]> {
  const { getDb } = await import("../db/index");
  const db = await getDb();
  const rows = await db.getAllAsync<{ glucose_level_mgdl: number; logged_at: string }>(
    `SELECT glucose_level_mgdl, logged_at FROM sugar_logs
      WHERE profile_id = ? AND is_cgm = 1 ORDER BY logged_at DESC LIMIT 1;`,
    [profileId]
  );
  return rows.map((r) => ({
    at: new Date(r.logged_at).getTime(),
    mgdl: r.glucose_level_mgdl,
  }));
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
  ageText: string;
  stale: boolean;
  ageMin: number;
  /** epoch ms of the reading. A widget bitmap that cannot redraw by the clock
   *  (Android) shows this as a clock time, which stays true however long the
   *  bitmap sits, where `ageText` would freeze at its render-time value. */
  readAt: number;
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
    ageText: cgmAgeText(ageMin, data.labels),
    stale,
    ageMin,
    readAt: cgm.at,
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
