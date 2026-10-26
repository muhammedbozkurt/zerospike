/**
 * Lean glucose reads for the screens and the report that need every reading of
 * a span (Insights, AGP, the PDF), sensor streams included. Four columns and no
 * tags JSON: ninety days of five-minute readings is 26 000 rows, and mapping each
 * one through SELECT * was the cost, not the query.
 *
 * The SQL lives here without a module-level database import, so
 * scripts/cgmPerfInsights.test.ts runs the real statements on node:sqlite.
 */
import type { DateRange } from "../insights";
import { parseTags } from "./types";
import type { SugarLog } from "./types";
import type { GlucosePoint } from "../cgm/metrics";

interface Reader {
  getAllAsync<T>(sql: string, params: (string | number | null)[]): Promise<T[]>;
}

export type GlucoseScope = "all" | "cgm" | "manual";

/**
 * Placeholders: profile_id, then (when a range is given) from and to as ISO,
 * then (when `limit` is set) the row count. With a limit the NEWEST rows are
 * kept, so a cap never drops the recent end of a span.
 */
export function glucosePointsSql(
  withRange: boolean,
  scope: GlucoseScope = "all",
  withLimit = false
): string {
  const scopeClause =
    scope === "cgm" ? " AND is_cgm = 1" : scope === "manual" ? " AND is_cgm = 0" : "";
  return `SELECT logged_at, glucose_level_mgdl, source, is_cgm FROM sugar_logs
      WHERE profile_id = ?${withRange ? " AND logged_at BETWEEN ? AND ?" : ""}${scopeClause}
      ORDER BY logged_at${withLimit ? " DESC LIMIT ?" : ""};`;
}

function isoBounds(range?: DateRange): string[] {
  return range
    ? [new Date(range.start).toISOString(), new Date(range.end).toISOString()]
    : [];
}

export async function readGlucosePoints(
  db: Reader,
  profileId: string,
  range?: DateRange,
  scope: GlucoseScope = "all",
  limit?: number
): Promise<GlucosePoint[]> {
  const params: (string | number)[] = [profileId, ...isoBounds(range)];
  if (limit != null) params.push(limit);
  const rows = await db.getAllAsync<GlucosePoint>(
    glucosePointsSql(range != null, scope, limit != null),
    params
  );
  if (limit != null) rows.reverse();
  for (const r of rows) r.t = Date.parse(r.logged_at);
  return rows;
}

/** Every reading in the span, oldest first, as lean points (the newest `limit`
 *  of them when a limit is given). */
export async function listGlucosePoints(
  profileId: string,
  range?: DateRange,
  scope: GlucoseScope = "all",
  limit?: number
): Promise<GlucosePoint[]> {
  const { getDb } = await import("./index");
  return readGlucosePoints(await getDb(), profileId, range, scope, limit);
}

/** A lean point with the SugarLog shape the metric functions are typed on. */
export type SugarPoint = SugarLog & { is_cgm: number; t: number };

const NO_TAGS: SugarLog["tags"] = Object.freeze([]) as unknown as SugarLog["tags"];

export function pointAsSugar(profileId: string, p: GlucosePoint): SugarPoint {
  return {
    id: "",
    profile_id: profileId,
    glucose_level_mgdl: p.glucose_level_mgdl,
    period_tag: "unset",
    source: p.source ?? "health",
    logged_at: p.logged_at,
    tags: NO_TAGS,
    healthkit_uuid: null,
    is_cgm: 1,
    t: p.t ?? Date.parse(p.logged_at),
  };
}

type FullRow = Omit<SugarLog, "tags"> & { tags: string | null; is_cgm: number };

/**
 * What the Insights screen computes from: the hand-entered readings with every
 * column (their tags and periods feed the patterns), newest `manualLimit` of
 * them, plus every sensor reading of the span as lean rows. One 2000-row read of
 * everything let a sensor stream fill the cap and push the user's own readings
 * out.
 */
export async function readInsightsSugar(
  db: Reader,
  profileId: string,
  range: DateRange,
  manualLimit = 2000
): Promise<SugarPoint[]> {
  const [manual, cgm] = await Promise.all([
    db.getAllAsync<FullRow>(
      `SELECT * FROM sugar_logs WHERE profile_id = ? AND logged_at BETWEEN ? AND ? AND is_cgm = 0
        ORDER BY logged_at DESC LIMIT ?;`,
      [profileId, ...isoBounds(range), manualLimit]
    ),
    readGlucosePoints(db, profileId, range, "cgm"),
  ]);
  const out: SugarPoint[] = manual.map((r) => ({
    ...r,
    tags: parseTags(r.tags),
    t: Date.parse(r.logged_at),
  }));
  for (const p of cgm) out.push(pointAsSugar(profileId, p));
  return out;
}

export async function listInsightsSugar(
  profileId: string,
  range: DateRange,
  manualLimit = 2000
): Promise<SugarPoint[]> {
  const { getDb } = await import("./index");
  return readInsightsSugar(await getDb(), profileId, range, manualLimit);
}

/** One timestamp per quarter hour that holds a sensor reading since `sinceIso`,
 *  enough to name the local days the sensor was feeding the journal. */
export const CGM_ACTIVITY_SQL = `SELECT MIN(logged_at) AS logged_at FROM sugar_logs
      WHERE profile_id = ? AND is_cgm = 1 AND logged_at >= ?
      GROUP BY substr(logged_at, 1, 13), CAST(substr(logged_at, 15, 2) AS INTEGER) / 15;`;

export async function readCgmActivity(
  db: Reader,
  profileId: string,
  sinceIso: string
): Promise<string[]> {
  const rows = await db.getAllAsync<{ logged_at: string }>(CGM_ACTIVITY_SQL, [
    profileId,
    sinceIso,
  ]);
  return rows.map((r) => r.logged_at);
}

/** Timestamps of sensor activity for the logging streak (see consecutiveLogDays). */
export async function listCgmActivity(profileId: string, sinceIso: string): Promise<string[]> {
  const { getDb } = await import("./index");
  return readCgmActivity(await getDb(), profileId, sinceIso);
}
