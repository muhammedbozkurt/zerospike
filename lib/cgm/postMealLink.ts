import AsyncStorage from "@react-native-async-storage/async-storage";

import { getCgmMode, isCgmModeActive, type CgmMode } from "./state";

/**
 * The 2-hour value of a meal, taken from the sensor instead of asked for.
 *
 * When the user starts the post-meal countdown in sensor mode, no measurement
 * reminder is armed. Once the window has closed, the sensor reading nearest the
 * target (within 15 minutes) is tagged as that meal's 2-hour value, the same
 * tag a hand-entered 2-hour reading carries (lib/mealResponse.ts reads it by
 * time). Health writes sensor data hours late, so an entry waits until a
 * reading exists; the next import completes it. This only reports what was
 * measured and never raises a notification.
 */

export const POST_MEAL_LINK_KEY = "zerospike.cgmPostMealPending";
export const POST_MEAL_LINK_TOLERANCE_MS = 15 * 60_000;
export const POST_MEAL_LINK_KEEP_MS = 24 * 60 * 60_000;

export interface PendingPostMealLink {
  startedAt: number;
  targetAt: number;
}

export interface CgmReadingLite {
  id: string;
  logged_at: string;
  glucose_level_mgdl: number;
}

export type PostMealLinkOutcome =
  | { kind: "matched"; reading: CgmReadingLite }
  | { kind: "pending" }
  | { kind: "expired" };

export function postMealLinkKey(profileId: string): string {
  return `${POST_MEAL_LINK_KEY}.${profileId}`;
}

/** Placeholders: profile_id, from (ISO), to (ISO). Reads idx_sugar_cgm. */
export const POST_MEAL_READINGS_SQL =
  "SELECT id, logged_at, glucose_level_mgdl FROM sugar_logs WHERE profile_id = ? AND is_cgm = 1 AND logged_at >= ? AND logged_at <= ? ORDER BY logged_at ASC;";

/** Placeholders: id, profile_id. A tag the user chose is never overwritten. */
export const POST_MEAL_TAG_SQL =
  "UPDATE sugar_logs SET period_tag = 'post_meal_2h' WHERE id = ? AND profile_id = ? AND period_tag = 'unset';";

/** Nearest reading to the target inside the tolerance; the earlier one on a tie. */
export function pickPostMealReading(
  targetAt: number,
  readings: readonly CgmReadingLite[]
): CgmReadingLite | null {
  let best: CgmReadingLite | null = null;
  let bestGap = Infinity;
  let bestAt = Infinity;
  for (const r of readings) {
    const at = new Date(r.logged_at).getTime();
    if (!Number.isFinite(at)) continue;
    const gap = Math.abs(at - targetAt);
    if (gap > POST_MEAL_LINK_TOLERANCE_MS) continue;
    if (gap < bestGap || (gap === bestGap && at < bestAt)) {
      best = r;
      bestGap = gap;
      bestAt = at;
    }
  }
  return best;
}

/** Decides only once the tolerance window is complete, so a closer reading
 *  still on its way cannot be passed over. */
export function evaluatePostMealLink(
  link: PendingPostMealLink,
  readings: readonly CgmReadingLite[],
  now: number
): PostMealLinkOutcome {
  if (now < link.targetAt + POST_MEAL_LINK_TOLERANCE_MS) return { kind: "pending" };
  const reading = pickPostMealReading(link.targetAt, readings);
  if (reading) return { kind: "matched", reading };
  if (now > link.targetAt + POST_MEAL_LINK_KEEP_MS) return { kind: "expired" };
  return { kind: "pending" };
}

function parsePending(raw: unknown): PendingPostMealLink[] {
  if (typeof raw !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: PendingPostMealLink[] = [];
    for (const v of parsed) {
      const o = v as { startedAt?: unknown; targetAt?: unknown } | null;
      if (
        o &&
        typeof o.startedAt === "number" &&
        typeof o.targetAt === "number" &&
        Number.isFinite(o.startedAt) &&
        Number.isFinite(o.targetAt)
      ) {
        out.push({ startedAt: o.startedAt, targetAt: o.targetAt });
      }
    }
    return out;
  } catch {
    return [];
  }
}

export async function listPendingLinks(profileId: string): Promise<PendingPostMealLink[]> {
  try {
    return parsePending(await AsyncStorage.getItem(postMealLinkKey(profileId)));
  } catch {
    return [];
  }
}

async function writePending(profileId: string, links: PendingPostMealLink[]): Promise<void> {
  if (links.length === 0) await AsyncStorage.removeItem(postMealLinkKey(profileId));
  else await AsyncStorage.setItem(postMealLinkKey(profileId), JSON.stringify(links));
}

export async function addPendingLink(
  profileId: string,
  link: PendingPostMealLink
): Promise<void> {
  const links = await listPendingLinks(profileId);
  if (links.some((l) => l.startedAt === link.startedAt)) return;
  await writePending(profileId, [...links, link]);
}

export async function removePendingLink(profileId: string, startedAt: number): Promise<void> {
  const links = await listPendingLinks(profileId);
  const next = links.filter((l) => l.startedAt !== startedAt);
  if (next.length !== links.length) await writePending(profileId, next);
}

export interface PostMealLinkDeps {
  getMode: (profileId: string) => Promise<CgmMode>;
  readReadings: (profileId: string, fromIso: string, toIso: string) => Promise<CgmReadingLite[]>;
  applyLink: (profileId: string, reading: CgmReadingLite) => Promise<void>;
}

const defaultDeps: PostMealLinkDeps = {
  getMode: getCgmMode,
  readReadings: async (profileId, fromIso, toIso) => {
    const { getDb } = await import("../db/index");
    const db = await getDb();
    return db.getAllAsync<CgmReadingLite>(POST_MEAL_READINGS_SQL, [profileId, fromIso, toIso]);
  },
  applyLink: async (profileId, reading) => {
    const { getDb } = await import("../db/index");
    const db = await getDb();
    await db.runAsync(POST_MEAL_TAG_SQL, [reading.id, profileId]);
  },
};

const inFlight = new Map<string, Promise<number>>();

/**
 * Completes every waiting link whose window has closed and whose reading is in
 * the database. Does nothing for a profile that is not in a sensor mode (its
 * entries are kept). Never schedules anything. Returns how many were linked.
 */
export function resolvePendingPostMealLinks(
  profileId: string,
  now: number = Date.now(),
  deps: PostMealLinkDeps = defaultDeps
): Promise<number> {
  const running = inFlight.get(profileId);
  if (running) return running;
  const job = (async () => {
    try {
      if (!isCgmModeActive(await deps.getMode(profileId))) return 0;
      let linked = 0;
      for (const link of await listPendingLinks(profileId)) {
        if (now < link.targetAt + POST_MEAL_LINK_TOLERANCE_MS) continue;
        const readings = await deps.readReadings(
          profileId,
          new Date(link.targetAt - POST_MEAL_LINK_TOLERANCE_MS).toISOString(),
          new Date(link.targetAt + POST_MEAL_LINK_TOLERANCE_MS).toISOString()
        );
        const outcome = evaluatePostMealLink(link, readings, now);
        if (outcome.kind === "matched") {
          await deps.applyLink(profileId, outcome.reading);
          await removePendingLink(profileId, link.startedAt);
          linked++;
        } else if (outcome.kind === "expired") {
          await removePendingLink(profileId, link.startedAt);
        }
      }
      return linked;
    } catch {
      return 0;
    } finally {
      inFlight.delete(profileId);
    }
  })();
  inFlight.set(profileId, job);
  return job;
}
