import { getDb } from "./index";
import { uuid } from "../uuid";
import type {
  Injection,
  InjectionSite,
  InsulinPen,
  InsulinType,
} from "./types";
import { INJECTION_SITES, parseTags, serializeTags } from "./types";

// Raw row carries `tags` as the stored JSON string; mapper parses to LogTag[].
type InjectionRow = Omit<Injection, "tags"> & { tags: string | null };
const mapInjection = (r: InjectionRow): Injection => ({
  ...r,
  tags: parseTags(r.tags),
});

/**
 * Insulin pens and injection-site logging (schema v4).
 *
 * Tracking only: nothing here gives medical advice. `recommendNextSite` is a
 * plain "least-recently-used" rotation helper, not a dosing recommendation.
 * Free/Pro gating lives in the UI; these functions never check entitlement.
 */

// ── Pens ─────────────────────────────────────────────────────────────────

/** Free tier keeps a single active pen; 2+ is a Pro feature (gated in the UI). */
export const FREE_PEN_LIMIT = 1;

export async function getPen(id: string): Promise<InsulinPen | null> {
  const db = await getDb();
  return db.getFirstAsync<InsulinPen>(
    "SELECT * FROM insulin_pens WHERE id = ?;",
    [id]
  );
}

export async function createPen(
  profileId: string,
  name: string,
  insulinType: InsulinType,
  totalUnits: number
): Promise<InsulinPen> {
  const db = await getDb();
  const id = uuid();
  const now = new Date().toISOString();
  const total = Math.max(0, totalUnits);
  await db.runAsync(
    `INSERT INTO insulin_pens
       (id, profile_id, name, insulin_type, total_units, remaining_units, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?);`,
    [id, profileId, name.trim() || "Pen", insulinType, total, total, now]
  );
  return (await getPen(id))!;
}

export async function listPens(
  profileId: string,
  activeOnly = false
): Promise<InsulinPen[]> {
  const db = await getDb();
  const sql = activeOnly
    ? "SELECT * FROM insulin_pens WHERE profile_id = ? AND is_active = 1 ORDER BY created_at DESC;"
    : "SELECT * FROM insulin_pens WHERE profile_id = ? ORDER BY is_active DESC, created_at DESC;";
  return db.getAllAsync<InsulinPen>(sql, [profileId]);
}

export type PenUpdate = Partial<
  Omit<InsulinPen, "id" | "profile_id" | "created_at">
>;

/** Patch name / active state / a manual remaining-units correction. */
export async function updatePen(
  id: string,
  patch: PenUpdate
): Promise<InsulinPen> {
  const db = await getDb();
  const fields: string[] = [];
  const values: (string | number)[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    fields.push(`${key} = ?`);
    values.push(value as string | number);
  }
  if (fields.length > 0) {
    values.push(id);
    await db.runAsync(
      `UPDATE insulin_pens SET ${fields.join(", ")} WHERE id = ?;`,
      values
    );
  }
  return (await getPen(id))!;
}

/** Deletes a pen. Linked injections keep their history (pen_id → NULL via FK). */
export async function deletePen(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM insulin_pens WHERE id = ?;", [id]);
}

/** Active-pen count for the free/Pro gate (UI compares against FREE_PEN_LIMIT). */
export async function getActivePenCount(profileId: string): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ c: number }>(
    "SELECT COUNT(*) AS c FROM insulin_pens WHERE profile_id = ? AND is_active = 1;",
    [profileId]
  );
  return row?.c ?? 0;
}

// ── Injections ─────────────────────────────────────────────────────────────

export interface NewInjectionInput {
  profile_id: string;
  site: InjectionSite;
  dose_units?: number | null;
  pen_id?: string | null;
  insulin_type?: InsulinType | null;
  meal_log_id?: string | null;
  note?: string | null;
  logged_at?: string;
  tags?: string[];
}

/**
 * Records an injection. If a pen and a positive dose are given, the dose is
 * deducted from that pen's remaining units in the same transaction (clamped at
 * 0, so a pen never goes negative).
 */
export async function logInjection(
  input: NewInjectionInput
): Promise<Injection> {
  const db = await getDb();
  const id = uuid();
  const loggedAt = input.logged_at ?? new Date().toISOString();
  const dose = input.dose_units ?? null;
  const penId = input.pen_id ?? null;

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO injection_logs
         (id, profile_id, site, dose_units, pen_id, insulin_type, meal_log_id, note, logged_at, tags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        id,
        input.profile_id,
        input.site,
        dose,
        penId,
        input.insulin_type ?? null,
        input.meal_log_id ?? null,
        input.note ?? null,
        loggedAt,
        serializeTags(input.tags),
      ]
    );
    if (penId && dose != null && dose > 0) {
      await db.runAsync(
        `UPDATE insulin_pens
           SET remaining_units = MAX(0, remaining_units - ?)
         WHERE id = ?;`,
        [dose, penId]
      );
    }
  });

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

/**
 * Deletes an injection. If it was tied to a pen with a positive dose, those
 * units are returned to the pen (capped at the pen's total) in one transaction.
 */
export async function deleteInjection(id: string): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    const row = await db.getFirstAsync<{
      pen_id: string | null;
      dose_units: number | null;
    }>("SELECT pen_id, dose_units FROM injection_logs WHERE id = ?;", [id]);
    if (row?.pen_id && row.dose_units != null && row.dose_units > 0) {
      await db.runAsync(
        `UPDATE insulin_pens
           SET remaining_units = MIN(total_units, remaining_units + ?)
         WHERE id = ?;`,
        [row.dose_units, row.pen_id]
      );
    }
    await db.runAsync("DELETE FROM injection_logs WHERE id = ?;", [id]);
  });
}

// ── Rotation helpers ─────────────────────────────────────────────────────

export interface SiteUsage {
  site: InjectionSite;
  /** Most recent use within the window, or null if unused. */
  lastUsedAt: string | null;
  /** Number of injections at this site within the window. */
  count: number;
}

/**
 * Per-site usage over the last `days`, for the rotation overview. Every one of
 * the eight sites is returned (unused ones with lastUsedAt = null, count = 0).
 */
export async function getSiteUsageHistory(
  profileId: string,
  days = 14
): Promise<SiteUsage[]> {
  const db = await getDb();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = await db.getAllAsync<{
    site: InjectionSite;
    lastUsedAt: string;
    count: number;
  }>(
    `SELECT site, MAX(logged_at) AS lastUsedAt, COUNT(*) AS count
       FROM injection_logs
      WHERE profile_id = ? AND logged_at >= ?
      GROUP BY site;`,
    [profileId, since]
  );
  const map = new Map(rows.map((r) => [r.site, r]));
  return INJECTION_SITES.map((site) => {
    const r = map.get(site);
    return { site, lastUsedAt: r?.lastUsedAt ?? null, count: r?.count ?? 0 };
  });
}

/**
 * Suggests the next site to use: the one left untouched the longest (a simple
 * rotation reminder, not medical advice). A never-used site wins outright; with
 * no history at all, the first canonical site is returned as a default.
 */
export async function recommendNextSite(
  profileId: string
): Promise<InjectionSite> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ site: InjectionSite; lastUsedAt: string }>(
    `SELECT site, MAX(logged_at) AS lastUsedAt
       FROM injection_logs WHERE profile_id = ? GROUP BY site;`,
    [profileId]
  );
  const lastUsed = new Map(rows.map((r) => [r.site, r.lastUsedAt]));

  // Any never-used site wins (in canonical order).
  const neverUsed = INJECTION_SITES.find((s) => !lastUsed.has(s));
  if (neverUsed) return neverUsed;

  // Otherwise the site whose most-recent use is the oldest.
  return INJECTION_SITES.slice().sort((a, b) => {
    const la = lastUsed.get(a)!;
    const lb = lastUsed.get(b)!;
    return la < lb ? -1 : la > lb ? 1 : 0;
  })[0];
}
