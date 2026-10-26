/**
 * Where a just-saved injection will (not) show: the History list opens on a
 * day-and-count window, the map on a day window and the rotation-cycle stamp.
 */

/** Whether the History slice and fetch limit must grow so the saved row is in
 *  it. `newerCount` is the number of stored rows logged after the saved one. */
export function historyPlanForSaved(opts: {
  loggedAtIso: string;
  now: number;
  newerCount: number;
  currentLimit: number;
  days: number;
  max: number;
  page: number;
}): { expand: boolean; limit: number } {
  const { loggedAtIso, now, newerCount, currentLimit, days, max, page } = opts;
  const tooOld = new Date(loggedAtIso).getTime() < now - days * 86_400_000;
  const beyondFirstPage = newerCount >= max;
  const limit = newerCount < currentLimit ? currentLimit : newerCount + page;
  return { expand: tooOld || beyondFirstPage, limit };
}

/** The map tab (front/back) it opens on: the first candidate that is set, in
 *  priority order. A remount after a save used to fall back to "front", so a
 *  buttock record looked missing until the back tab was opened by hand. */
export function pickInitialSurface<S extends string>(
  order: ReadonlyArray<S | null | undefined>,
  fallback: S
): S {
  for (const s of order) if (s) return s;
  return fallback;
}

/** Mirrors getSiteUsageHistory: the window start is the later of N days ago and
 *  the cycle stamp. A record logged before it is stored but not on the map. */
export function outsideMapWindow(
  loggedAtIso: string,
  now: number,
  windowDays: number,
  cycleStart: string | null
): boolean {
  const windowSince = now - windowDays * 86_400_000;
  const cycle = cycleStart ? new Date(cycleStart).getTime() : -Infinity;
  const since = Math.max(windowSince, cycle);
  return new Date(loggedAtIso).getTime() < since;
}
