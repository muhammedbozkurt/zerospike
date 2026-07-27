import { getDb } from "./index";
import { uuid } from "../uuid";
import type { Injection, InjectionSite, InsulinType, SitePoint } from "./types";
import {
  INJECTION_SITES,
  SELECTABLE_SITES,
  SITE_POINTS,
  asSitePoint,
  parseTags,
  serializeTags,
} from "./types";

// Raw row carries `tags` as the stored JSON string and `site_point` as a plain
// integer; the mapper narrows both.
type InjectionRow = Omit<Injection, "tags" | "site_point"> & {
  tags: string | null;
  site_point: number | null;
};
const mapInjection = (r: InjectionRow): Injection => ({
  ...r,
  site_point: asSitePoint(r.site_point),
  tags: parseTags(r.tags),
});

/**
 * Injection-site logging.
 *
 * Tracking only: nothing here gives medical advice. `recommendNextSite` is a
 * plain "least-recently-used" rotation helper, not a dosing recommendation.
 * Free/Pro gating lives in the UI; these functions never check entitlement.
 */

// ── Injections ─────────────────────────────────────────────────────────────

export interface NewInjectionInput {
  profile_id: string;
  site: InjectionSite;
  /** Which of the region's four rotation points; null when not specified. */
  site_point?: SitePoint | null;
  dose_units?: number | null;
  insulin_type?: InsulinType | null;
  meal_log_id?: string | null;
  note?: string | null;
  /** 'manual' (default) or 'calculator' for the auto-written mealtime bolus. */
  source?: string;
  logged_at?: string;
  tags?: string[];
}

/** Records an injection (insulin type + optional dose against a site + point). */
export async function logInjection(
  input: NewInjectionInput
): Promise<Injection> {
  const db = await getDb();
  const id = uuid();
  const loggedAt = input.logged_at ?? new Date().toISOString();

  await db.runAsync(
    `INSERT INTO injection_logs
       (id, profile_id, site, site_point, dose_units, insulin_type, meal_log_id,
        note, source, logged_at, tags)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      id,
      input.profile_id,
      input.site,
      input.site_point ?? null,
      input.dose_units ?? null,
      input.insulin_type ?? null,
      input.meal_log_id ?? null,
      input.note ?? null,
      input.source ?? "manual",
      loggedAt,
      serializeTags(input.tags),
    ]
  );

  return mapInjection(
    (await db.getFirstAsync<InjectionRow>(
      "SELECT * FROM injection_logs WHERE id = ?;",
      [id]
    ))!
  );
}

export async function getInjections(
  profileId: string,
  limit = 300
): Promise<Injection[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<InjectionRow>(
    "SELECT * FROM injection_logs WHERE profile_id = ? ORDER BY logged_at DESC LIMIT ?;",
    [profileId, limit]
  );
  return rows.map(mapInjection);
}

export type InjectionUpdate = Partial<
  Pick<
    Injection,
    | "site"
    | "site_point"
    | "dose_units"
    | "insulin_type"
    | "note"
    | "logged_at"
    | "tags"
  >
>;

/** Partial update of an injection. Returns the fresh row, or null if gone. */
export async function updateInjection(
  id: string,
  patch: InjectionUpdate
): Promise<Injection | null> {
  const db = await getDb();

  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (key === "tags") {
      fields.push("tags = ?");
      values.push(serializeTags(value as string[]));
    } else {
      fields.push(`${key} = ?`);
      values.push(value as string | number | null);
    }
  }

  if (fields.length > 0) {
    await db.runAsync(
      `UPDATE injection_logs SET ${fields.join(", ")} WHERE id = ?;`,
      [...values, id]
    );
  }

  const row = await db.getFirstAsync<InjectionRow>(
    "SELECT * FROM injection_logs WHERE id = ?;",
    [id]
  );
  return row ? mapInjection(row) : null;
}

/**
 * The bolus row the calculator wrote for a meal, if any. Only ever returns a
 * row this app created; a hand-entered injection that happens to reference the
 * same meal belongs to the user and is not managed on their behalf.
 */
export async function getCalculatorInjectionForMeal(
  mealLogId: string
): Promise<Injection | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<InjectionRow>(
    "SELECT * FROM injection_logs WHERE meal_log_id = ? AND source = 'calculator' ORDER BY logged_at DESC LIMIT 1;",
    [mealLogId]
  );
  return row ? mapInjection(row) : null;
}

/** Deletes an injection (its history row only; no stock accounting). */
export async function deleteInjection(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM injection_logs WHERE id = ?;", [id]);
}

/** How close in time a manual bolus entry has to be to an existing
 *  calculator-written bolus to trigger the "double bolus" nudge (R10 1.4). */
export const DOUBLE_BOLUS_WINDOW_MINUTES = 15;

/**
 * The nearest calculator-written bolus within DOUBLE_BOLUS_WINDOW_MINUTES of
 * `at`, if any — the gentle "you already have a bolus from the calculator
 * around this time" confirm. Never blocks the save; it only asks first.
 * `excludeId` skips the row being edited itself, so correcting a
 * calculator-written bolus never flags against its own value.
 */
export async function findRecentCalculatorBolus(
  profileId: string,
  at: Date,
  excludeId?: string
): Promise<Injection | null> {
  const db = await getDb();
  const half = DOUBLE_BOLUS_WINDOW_MINUTES * 60_000;
  const from = new Date(at.getTime() - half).toISOString();
  const to = new Date(at.getTime() + half).toISOString();
  const row = await db.getFirstAsync<InjectionRow>(
    `SELECT * FROM injection_logs
      WHERE profile_id = ? AND source = 'calculator' AND insulin_type = 'bolus'
        AND logged_at BETWEEN ? AND ? AND id != ?
      ORDER BY logged_at DESC LIMIT 1;`,
    [profileId, from, to, excludeId ?? ""]
  );
  return row ? mapInjection(row) : null;
}

// ── Rotation helpers ─────────────────────────────────────────────────────

export interface SiteUsage {
  site: InjectionSite;
  /** Most recent use within the window, or null if unused. */
  lastUsedAt: string | null;
  /** Number of injections at this site within the window. */
  count: number;
  /** The same figures broken down by the region's four rotation points. */
  points: PointUsage[];
  /** Injections in the window with no point recorded (rows from before v8). */
  unassignedCount: number;
}

export interface PointUsage {
  site: InjectionSite;
  point: SitePoint;
  lastUsedAt: string | null;
  count: number;
}

/** A point key that survives map lookups ("abdomen_left:3"). */
export function pointKey(site: InjectionSite, point: SitePoint): string {
  return `${site}:${point}`;
}

/**
 * Per-site AND per-point usage over the last `days`, for the rotation heat map.
 * Every INJECTION_SITES region is returned (twelve since schema v9, including the
 * legacy general-abdomen buckets), each carrying its four points
 * (unused ones with lastUsedAt = null, count = 0). Rows logged before v8 have no
 * point, so they land in `unassignedCount` and still count toward the region.
 *
 * This is a usage VISUALISATION, not guidance: it reports what the user already
 * logged and nothing more.
 */
export async function getSiteUsageHistory(
  profileId: string,
  days = 14
): Promise<SiteUsage[]> {
  const db = await getDb();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = await db.getAllAsync<{
    site: InjectionSite;
    site_point: number | null;
    lastUsedAt: string;
    count: number;
  }>(
    `SELECT site, site_point, MAX(logged_at) AS lastUsedAt, COUNT(*) AS count
       FROM injection_logs
      WHERE profile_id = ? AND logged_at >= ?
      GROUP BY site, site_point;`,
    [profileId, since]
  );

  return INJECTION_SITES.map((site) => {
    const forSite = rows.filter((r) => r.site === site);
    const points: PointUsage[] = SITE_POINTS.map((point) => {
      const r = forSite.find((x) => asSitePoint(x.site_point) === point);
      return {
        site,
        point,
        lastUsedAt: r?.lastUsedAt ?? null,
        count: r?.count ?? 0,
      };
    });
    const unassigned = forSite.filter((r) => asSitePoint(r.site_point) == null);
    const lastUsedAt = forSite.reduce<string | null>(
      (acc, r) => (acc == null || r.lastUsedAt > acc ? r.lastUsedAt : acc),
      null
    );
    return {
      site,
      lastUsedAt,
      count: forSite.reduce((sum, r) => sum + r.count, 0),
      points,
      unassignedCount: unassigned.reduce((sum, r) => sum + r.count, 0),
    };
  });
}

/**
 * The point left untouched the longest across every region: the point-level form
 * of the old least-recently-used helper. A never-used point wins outright (in
 * canonical region/point order); with no history at all the first point of the
 * first region is returned.
 *
 * Rotation bookkeeping, not medical advice. The UI presents it as "least
 * recently used", never as "inject here".
 */
export async function leastRecentlyUsedPoint(
  profileId: string
): Promise<{ site: InjectionSite; point: SitePoint }> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    site: InjectionSite;
    site_point: number | null;
    lastUsedAt: string;
  }>(
    `SELECT site, site_point, MAX(logged_at) AS lastUsedAt
       FROM injection_logs WHERE profile_id = ? GROUP BY site, site_point;`,
    [profileId]
  );

  const lastUsed = new Map<string, string>();
  for (const r of rows) {
    const point = asSitePoint(r.site_point);
    if (point == null) continue;
    lastUsed.set(pointKey(r.site, point), r.lastUsedAt);
  }

  // Rotation only ever suggests a selectable (v9) region, never a legacy
  // general-abdomen bucket that the map no longer offers for a new entry.
  const all = SELECTABLE_SITES.flatMap((site) =>
    SITE_POINTS.map((point) => ({ site, point }))
  );
  const neverUsed = all.find((p) => !lastUsed.has(pointKey(p.site, p.point)));
  if (neverUsed) return neverUsed;

  return all.slice().sort((a, b) => {
    const la = lastUsed.get(pointKey(a.site, a.point))!;
    const lb = lastUsed.get(pointKey(b.site, b.point))!;
    return la < lb ? -1 : la > lb ? 1 : 0;
  })[0];
}

/**
 * Region-level form of the same idea, kept for the surfaces that only speak in
 * regions (the rotation card copy).
 */
export async function recommendNextSite(
  profileId: string
): Promise<InjectionSite> {
  return (await leastRecentlyUsedPoint(profileId)).site;
}
