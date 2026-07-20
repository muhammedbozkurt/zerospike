import { getDb } from "./index";
import { uuid } from "../uuid";
import type { Injection, InjectionSite, InsulinType } from "./types";
import { INJECTION_SITES, parseTags, serializeTags } from "./types";

// Raw row carries `tags` as the stored JSON string; mapper parses to LogTag[].
type InjectionRow = Omit<Injection, "tags"> & { tags: string | null };
const mapInjection = (r: InjectionRow): Injection => ({
  ...r,
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
  dose_units?: number | null;
  insulin_type?: InsulinType | null;
  meal_log_id?: string | null;
  note?: string | null;
  logged_at?: string;
  tags?: string[];
}

/** Records an injection (insulin type + optional dose against a site). */
export async function logInjection(
  input: NewInjectionInput
): Promise<Injection> {
  const db = await getDb();
  const id = uuid();
  const loggedAt = input.logged_at ?? new Date().toISOString();

  await db.runAsync(
    `INSERT INTO injection_logs
       (id, profile_id, site, dose_units, insulin_type, meal_log_id, note, logged_at, tags)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      id,
      input.profile_id,
      input.site,
      input.dose_units ?? null,
      input.insulin_type ?? null,
      input.meal_log_id ?? null,
      input.note ?? null,
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
    "site" | "dose_units" | "insulin_type" | "note" | "logged_at" | "tags"
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

/** Deletes an injection (its history row only; no stock accounting). */
export async function deleteInjection(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM injection_logs WHERE id = ?;", [id]);
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
