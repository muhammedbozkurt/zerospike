/**
 * A reading the user logged a moment ago, offered back to them as a one-tap
 * shortcut on the calculator's glucose field. It is only ever OFFERED: the field
 * stays empty and the calculation ignores it until the user taps it.
 */

/** How old a reading may be and still be offered. */
export const RECENT_GLUCOSE_WINDOW_MINUTES = 15;

/** The range the glucose field accepts (mg/dL); a stored value outside it could
 *  not be typed back, so it is not offered either. */
const OFFER_MIN_MGDL = 20;
const OFFER_MAX_MGDL = 600;

export interface GlucoseLogLike {
  glucose_level_mgdl: number;
  logged_at: string;
}

export interface GlucoseSuggestion {
  mgdl: number;
  loggedAt: string;
}

/**
 * The newest usable reading no older than 15 minutes (15:00 exactly still
 * counts, 15:01 does not). A reading dated in the future is ignored, as is one
 * outside the field's range or with an unreadable timestamp.
 */
export function recentGlucoseSuggestion(
  logs: readonly GlucoseLogLike[] | null | undefined,
  now: Date
): GlucoseSuggestion | null {
  if (!logs || logs.length === 0) return null;
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return null;
  const limitMs = RECENT_GLUCOSE_WINDOW_MINUTES * 60_000;
  let best: { mgdl: number; loggedAt: string; at: number } | null = null;
  for (const log of logs) {
    const at = new Date(log.logged_at).getTime();
    if (!Number.isFinite(at)) continue;
    const age = nowMs - at;
    if (age < 0 || age > limitMs) continue;
    const v = log.glucose_level_mgdl;
    if (!Number.isFinite(v) || v < OFFER_MIN_MGDL || v > OFFER_MAX_MGDL) continue;
    if (!best || at > best.at) best = { mgdl: v, loggedAt: log.logged_at, at };
  }
  return best ? { mgdl: best.mgdl, loggedAt: best.loggedAt } : null;
}
