import { getDb } from "./index";
import { uuid } from "../uuid";
import { OTHER_PRODUCT_ID } from "../insulinCatalog";
import type {
  BolusKind,
  Injection,
  InjectionSite,
  InsulinType,
  SitePoint,
} from "./types";
import type { DateRange } from "../insights";
import {
  INJECTION_SITES,
  SITE_POINTS,
  asSitePoint,
  canonicalSite,
  isRetiredSite,
  parseBolusKind,
  parseTags,
  serializeTags,
} from "./types";
import { pickLeastRecentlyUsedPoint, pointKey } from "../rotationPick";
import { emitInjectionSaved, emitRemoved } from "./healthRecordHooks";
import { afterCommit } from "./txEvents";

export { pointKey };

// Raw row carries `tags` as the stored JSON string and `site_point` as a plain
// integer; the mapper narrows both.
type InjectionRow = Omit<Injection, "tags" | "site_point" | "bolus_kind"> & {
  tags: string | null;
  site_point: number | null;
  bolus_kind: string | null;
};
const mapInjection = (r: InjectionRow): Injection => ({
  ...r,
  site_point: asSitePoint(r.site_point),
  bolus_kind: parseBolusKind(r.bolus_kind),
  tags: parseTags(r.tags),
});

// ── Pure bolus_kind patch decision ──────────────────────────────────────────
// TEST-EXTRACT-START (pinned verbatim by scripts/injectionsBolusKind.test.ts:
// this module pulls in expo-sqlite at import time, which the plain-node test
// harness cannot load, so the test reads this exact block out of the shipped
// source instead of importing it - see that file's header for the mechanism)

/** bolus_kind only ever describes a bolus row; a basal (or type-less) row never
 *  carries one, whatever the caller passed in. */
function normalizedBolusKind(
  insulinType: InsulinType | null | undefined,
  bolusKind: BolusKind | null | undefined
): BolusKind | null {
  return insulinType === "bolus" ? bolusKind ?? null : null;
}

/** Whether resolving the patch needs the row's CURRENT insulin_type: only when
 *  bolus_kind is set explicitly without insulin_type in the same patch - the
 *  one case where "is this row still a bolus row" cannot be read off the
 *  patch alone. */
function needsCurrentInsulinType(
  patch: Pick<InjectionUpdate, "insulin_type" | "bolus_kind">
): boolean {
  return patch.bolus_kind !== undefined && patch.insulin_type === undefined;
}

/**
 * Whether an UPDATE should write injection_logs.bolus_kind, and what value.
 *
 * Only two situations touch the column: the caller sets bolus_kind explicitly,
 * or insulin_type moves OFF 'bolus' (which forces the kind back to null). Any
 * OTHER patch - including one that sets insulin_type to 'bolus' without naming
 * a kind, e.g. the calculator's `{dose_units, insulin_type: 'bolus', tags,
 * logged_at}` correction - must leave the column untouched, or a kind the user
 * picked by hand (Injection tab -> "Yemek oncesi"/"Duzeltme") silently
 * disappears the next time the calculator re-saves the same meal's dose.
 */
function resolveBolusKindPatch(
  patch: Pick<InjectionUpdate, "insulin_type" | "bolus_kind">,
  currentInsulinType: InsulinType | null
): { touches: false } | { touches: true; value: BolusKind | null } {
  const movesOffBolus =
    patch.insulin_type !== undefined && patch.insulin_type !== "bolus";
  if (patch.bolus_kind === undefined && !movesOffBolus) return { touches: false };
  const effectiveType =
    patch.insulin_type !== undefined ? patch.insulin_type : currentInsulinType;
  return { touches: true, value: normalizedBolusKind(effectiveType, patch.bolus_kind) };
}
// TEST-EXTRACT-END

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
  /** Null / omitted when no region was chosen (schema v11). */
  site?: InjectionSite | null;
  /** Which of the region's four rotation points; null when not specified. */
  site_point?: SitePoint | null;
  dose_units?: number | null;
  insulin_type?: InsulinType | null;
  /** Meal vs correction (schema v15). Forced to null unless insulin_type is 'bolus'. */
  bolus_kind?: BolusKind | null;
  /** Which product this injection actually used (schema v22, see
   *  ../insulinCatalog). insulin_product_other only applies while
   *  insulin_product_id is the catalog's OTHER_PRODUCT_ID. */
  insulin_product_id?: string | null;
  insulin_product_other?: string | null;
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
       (id, profile_id, site, site_point, dose_units, insulin_type, bolus_kind,
        insulin_product_id, insulin_product_other,
        meal_log_id, note, source, logged_at, tags)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      id,
      input.profile_id,
      input.site ?? null,
      input.site_point ?? null,
      input.dose_units ?? null,
      input.insulin_type ?? null,
      normalizedBolusKind(input.insulin_type, input.bolus_kind),
      input.insulin_product_id ?? null,
      input.insulin_product_id === OTHER_PRODUCT_ID ? (input.insulin_product_other ?? null) : null,
      input.meal_log_id ?? null,
      input.note ?? null,
      input.source ?? "manual",
      loggedAt,
      serializeTags(input.tags),
    ]
  );

  const injection = mapInjection(
    (await db.getFirstAsync<InjectionRow>(
      "SELECT * FROM injection_logs WHERE id = ?;",
      [id]
    ))!
  );
  afterCommit(() => emitInjectionSaved(injection, null));
  return injection;
}

export async function getInjection(id: string): Promise<Injection | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<InjectionRow>(
    "SELECT * FROM injection_logs WHERE id = ?;",
    [id]
  );
  return row ? mapInjection(row) : null;
}

export async function getInjections(
  profileId: string,
  limit = 300,
  /** Optional span, applied in SQL so a report of an old range is complete. */
  range?: DateRange
): Promise<Injection[]> {
  const db = await getDb();
  const bounds = range
    ? {
        sql: " AND logged_at BETWEEN ? AND ?",
        values: [
          new Date(range.start).toISOString(),
          new Date(range.end).toISOString(),
        ],
      }
    : { sql: "", values: [] as string[] };
  const rows = await db.getAllAsync<InjectionRow>(
    `SELECT * FROM injection_logs WHERE profile_id = ?${bounds.sql} ORDER BY logged_at DESC LIMIT ?;`,
    [profileId, ...bounds.values, limit]
  );
  return rows.map(mapInjection);
}

/** Rows of this profile logged after `loggedAtIso`: where a freshly saved,
 *  possibly back-dated row falls in the newest-first History list. */
export async function countInjectionsAfter(profileId: string, loggedAtIso: string): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM injection_logs WHERE profile_id = ? AND logged_at > ?;",
    [profileId, loggedAtIso]
  );
  return row?.n ?? 0;
}

export type InjectionUpdate = Partial<
  Pick<
    Injection,
    | "site"
    | "site_point"
    | "dose_units"
    | "insulin_type"
    | "bolus_kind"
    | "insulin_product_id"
    | "insulin_product_other"
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
  const mirrored =
    patch.dose_units !== undefined ||
    patch.insulin_type !== undefined ||
    patch.logged_at !== undefined;
  const beforeRow = mirrored
    ? await db.getFirstAsync<InjectionRow>("SELECT * FROM injection_logs WHERE id = ?;", [id])
    : null;

  // bolus_kind is only ever valid on a bolus row; resolveBolusKindPatch decides
  // whether this patch touches it at all, and needs the row's CURRENT type only
  // in the one case where the patch alone cannot say (see its doc comment).
  let currentInsulinType: InsulinType | null = null;
  if (needsCurrentInsulinType(patch)) {
    const current = await db.getFirstAsync<{ insulin_type: InsulinType | null }>(
      "SELECT insulin_type FROM injection_logs WHERE id = ?;",
      [id]
    );
    currentInsulinType = current?.insulin_type ?? null;
  }
  const bolusKindPatch = resolveBolusKindPatch(patch, currentInsulinType);

  // insulin_product_other is only meaningful while insulin_product_id is the
  // catalog's OTHER_PRODUCT_ID - the same rule logInjection applies on insert.
  // Without this, a patch that moves the row onto a real catalog product leaves
  // the old free-text name behind in the column, and a patch that carries only
  // the free text can resurrect it on a row that is no longer "other".
  const touchesProduct =
    patch.insulin_product_id !== undefined || patch.insulin_product_other !== undefined;
  let productOther: string | null = null;
  if (touchesProduct) {
    let effectiveId: string | null;
    if (patch.insulin_product_id !== undefined) {
      effectiveId = patch.insulin_product_id ?? null;
    } else {
      const current = await db.getFirstAsync<{ insulin_product_id: string | null }>(
        "SELECT insulin_product_id FROM injection_logs WHERE id = ?;",
        [id]
      );
      effectiveId = current?.insulin_product_id ?? null;
    }
    productOther =
      effectiveId === OTHER_PRODUCT_ID ? (patch.insulin_product_other ?? null) : null;
  }

  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (key === "bolus_kind") continue; // handled below, via bolusKindPatch
    if (key === "insulin_product_other") continue; // handled below, via productOther
    if (key === "tags") {
      fields.push("tags = ?");
      values.push(serializeTags(value as string[]));
    } else {
      fields.push(`${key} = ?`);
      values.push(value as string | number | null);
    }
  }
  if (bolusKindPatch.touches) {
    fields.push("bolus_kind = ?");
    values.push(bolusKindPatch.value);
  }
  if (touchesProduct) {
    fields.push("insulin_product_other = ?");
    values.push(productOther);
  }
  // A row turned into basal is no longer a meal's bolus: the calculator's
  // ownership marks go, or deleting the meal would delete the user's basal and
  // the journal feed would hide it (lib/db/journalSql.ts).
  if (patch.insulin_type === "basal") {
    fields.push("meal_log_id = NULL");
    fields.push("source = CASE WHEN source = 'calculator' THEN 'manual' ELSE source END");
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
  const after = row ? mapInjection(row) : null;
  if (after && beforeRow) {
    const previous = mapInjection(beforeRow);
    afterCommit(() => emitInjectionSaved(after, previous));
  }
  return after;
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
    "SELECT * FROM injection_logs WHERE meal_log_id = ? AND source = 'calculator' AND insulin_type = 'bolus' ORDER BY logged_at DESC, id DESC LIMIT 1;",
    [mealLogId]
  );
  return row ? mapInjection(row) : null;
}

/** Deletes an injection (its history row only; no stock accounting). A
 *  calculator bolus also takes its meal's dose with it, so the meal row and
 *  the history never disagree and a later meal edit cannot bring the dose back
 *  (lib/db/undoSql.ts restores it on undo). */
export async function deleteInjection(id: string): Promise<void> {
  const db = await getDb();
  const link = await db.getFirstAsync<{
    health_uuid: string | null;
    meal_log_id: string | null;
    source: string | null;
    insulin_type: string | null;
  }>(
    "DELETE FROM injection_logs WHERE id = ? RETURNING health_uuid, meal_log_id, source, insulin_type;",
    [id]
  );
  if (!link) return;
  if (link.source === "calculator" && link.insulin_type === "bolus" && link.meal_log_id) {
    await db.runAsync("UPDATE meal_logs SET insulin_dose_units = 0 WHERE id = ?;", [
      link.meal_log_id,
    ]);
  }
  afterCommit(() => emitRemoved("insulin", [{ id, uuid: link.health_uuid ?? null }]));
}

/** Links (or clears) the health-store sample id of an injection's insulin
 *  delivery (schema v26). False when the row is gone. */
export async function setInjectionHealthUuid(
  id: string,
  healthUuid: string | null
): Promise<boolean> {
  const db = await getDb();
  const res = await db.runAsync("UPDATE injection_logs SET health_uuid = ? WHERE id = ?;", [
    healthUuid,
    id,
  ]);
  return res.changes > 0;
}

/** Health sample ids of every injection of this profile that carries one. */
export async function listInjectionHealthUuids(profileId: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ health_uuid: string }>(
    "SELECT health_uuid FROM injection_logs WHERE profile_id = ? AND health_uuid IS NOT NULL;",
    [profileId]
  );
  return rows.map((r) => r.health_uuid);
}

/** The bare fields lib/entryGuard.ts asks about, not a full row read. `id` is
 *  what lets a caller pass its own row back as `excludeId` (P5b) so editing
 *  an existing injection never flags against its own pre-edit row. */
export interface RecentInjection {
  id: string;
  logged_at: string;
  insulin_type: InsulinType | null;
  dose_units: number | null;
  source?: string | null;
  site?: InjectionSite | null;
}

/**
 * Injections logged between `sinceIso` and `untilIso` (open-ended when
 * omitted), for the duplicate-entry check (lib/entryGuard.ts /
 * components/useEntryGuardConfirm.tsx). A plain fact lookup, not a warning of
 * its own - the caller decides what, if anything, to ask about.
 */
export async function listRecentInjections(
  profileId: string,
  sinceIso: string,
  untilIso?: string
): Promise<RecentInjection[]> {
  const db = await getDb();
  const values = untilIso ? [profileId, sinceIso, untilIso] : [profileId, sinceIso];
  return db.getAllAsync<RecentInjection>(
    `SELECT id, logged_at, insulin_type, dose_units, source, site FROM injection_logs
      WHERE profile_id = ? AND logged_at >= ? ${untilIso ? "AND logged_at <= ?" : ""}
      ORDER BY logged_at DESC;`,
    values
  );
}

/** How close in time a manual bolus entry has to be to an existing
 *  calculator-written bolus to trigger the "double bolus" nudge (R10 1.4). */
export const DOUBLE_BOLUS_WINDOW_MINUTES = 15;

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

/**
 * The whole rotation picture for a window: every region's usage, plus the two
 * buckets that belong to no selectable region but are still the user's own
 * history and must not vanish from the board.
 */
export interface RotationUsage {
  sites: SiteUsage[];
  /** Injections with NO region recorded at all (site null, e.g. a calculator
   *  mealtime bolus). Shown as "unassigned", never attributed to a region. */
  noSiteCount: number;
  /** Injections in a retired region (the v9 abdomen quadrants), as one legacy
   *  total. Those regions are no longer offered, so they get no card of their
   *  own - but the entries happened and are reported. */
  legacyCount: number;
  /** Most recent use across the retired regions, or null if there is none. */
  legacyLastUsedAt: string | null;
}

/**
 * Per-site AND per-point usage over the last `days`, for the rotation heat map.
 * Every INJECTION_SITES region is returned (twelve since schema v9, including the
 * legacy general-abdomen buckets), each carrying its four points
 * (unused ones with lastUsedAt = null, count = 0). Rows logged before v8 have no
 * point, so they land in `unassignedCount` and still count toward the region.
 *
 * Two kinds of row belong to no region CARD, and both are reported alongside the
 * regions rather than dropped: entries in a retired quadrant (legacyCount) and
 * entries with no region at all (noSiteCount). Silently omitting either showed
 * the user a rotation history that was missing their own entries.
 *
 * This is a usage VISUALISATION, not guidance: it reports what the user already
 * logged and nothing more.
 *
 * `cycleStart` (the profile's rotation-cycle stamp, see lib/rotationCycle) can
 * narrow the window further: rows logged before it stop feeding the heat
 * colours while the rows themselves stay untouched in injection_logs.
 */
export async function getSiteUsageHistory(
  profileId: string,
  days = 14,
  cycleStart?: string | null
): Promise<RotationUsage> {
  const db = await getDb();
  const windowSince = new Date(Date.now() - days * 86_400_000).toISOString();
  const since =
    cycleStart && cycleStart > windowSince ? cycleStart : windowSince;
  const rows = await db.getAllAsync<{
    site: InjectionSite | null;
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

  // Rows with no region at all: reported as unassigned, never folded into a
  // region's heat (that is exactly what the old 'abdomen_left' stamp did).
  const noSiteCount = rows
    .filter((r) => r.site == null)
    .reduce((sum, r) => sum + r.count, 0);

  const retiredRows = rows.filter(
    (r) => r.site != null && isRetiredSite(r.site)
  );
  const legacyCount = retiredRows.reduce((sum, r) => sum + r.count, 0);
  const legacyLastUsedAt = retiredRows.reduce<string | null>(
    (acc, r) => (acc == null || r.lastUsedAt > acc ? r.lastUsedAt : acc),
    null
  );

  const sites = INJECTION_SITES.map((site) => {
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

  return { sites, noSiteCount, legacyCount, legacyLastUsedAt };
}

/**
 * The point left untouched the longest across every region: the point-level form
 * of the old least-recently-used helper. A never-used point wins outright (in
 * canonical region/point order); with no history at all the first point of the
 * first region is returned.
 *
 * Rotation bookkeeping, not medical advice. The UI presents it as "least
 * recently used", never as "inject here".
 *
 * With a `cycleStart` stamp, only rows logged since it count: a point last used
 * before the stamp reads as untouched in this cycle (presentation only, the
 * rows themselves are never rewritten).
 *
 * History logged in a RETIRED region counts toward the selectable region on the
 * same side of the navel (see canonicalSite). Dropping it made an abdomen side
 * injected yesterday under its old quadrant name read as never used, which is the
 * one thing this helper must not get wrong. Rows with no region are skipped: they
 * describe no place, so they cannot make a place look used.
 *
 * The one point NEVER returned while any other exists is wherever the profile's
 * single most recent record actually landed (all time, independent of
 * `cycleStart`): repeating a suggestion of the point just used is exactly what
 * this helper exists to avoid. See lib/rotationPick.ts for the pure selection
 * rule and its edge cases (empty history, a fresh rotation-cycle reset, every
 * point equally used).
 */
export async function leastRecentlyUsedPoint(
  profileId: string,
  cycleStart?: string | null
): Promise<{ site: InjectionSite; point: SitePoint }> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    site: InjectionSite | null;
    site_point: number | null;
    lastUsedAt: string;
  }>(
    `SELECT site, site_point, MAX(logged_at) AS lastUsedAt
       FROM injection_logs WHERE profile_id = ?${cycleStart ? " AND logged_at >= ?" : ""}
      GROUP BY site, site_point;`,
    cycleStart ? [profileId, cycleStart] : [profileId]
  );

  const cycleLastUsed = new Map<string, string>();
  for (const r of rows) {
    const point = asSitePoint(r.site_point);
    if (point == null || r.site == null) continue;
    const key = pointKey(canonicalSite(r.site), point);
    const known = cycleLastUsed.get(key);
    if (known == null || r.lastUsedAt > known) cycleLastUsed.set(key, r.lastUsedAt);
  }

  // The profile's single most recent record with a region AND a point, ALL
  // time - independent of the cycle window, so a fresh reset never lets the
  // just-used point look "never used" and come straight back.
  const lastRow = await db.getFirstAsync<{ site: InjectionSite; site_point: number }>(
    `SELECT site, site_point FROM injection_logs
      WHERE profile_id = ? AND site IS NOT NULL AND site_point IS NOT NULL
      ORDER BY logged_at DESC LIMIT 1;`,
    [profileId]
  );
  const point = lastRow ? asSitePoint(lastRow.site_point) : null;
  const lastPoint = lastRow && point != null ? { site: lastRow.site, point } : null;

  // Rotation only ever suggests a selectable (v9) region, never a legacy
  // general-abdomen bucket that the map no longer offers for a new entry.
  return pickLeastRecentlyUsedPoint({ cycleLastUsed, lastPoint });
}

/**
 * Region-level form of the same idea, kept for the surfaces that only speak in
 * regions (the rotation card copy).
 */
export async function recommendNextSite(
  profileId: string,
  cycleStart?: string | null
): Promise<InjectionSite> {
  return (await leastRecentlyUsedPoint(profileId, cycleStart)).site;
}
