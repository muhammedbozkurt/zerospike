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
  id?: string;
  glucose_level_mgdl: number;
  logged_at: string;
}

export interface GlucoseSuggestion {
  /** The stored row, so a save that still shows its value can attach to it
   *  instead of writing the same measurement a second time. */
  id: string | null;
  mgdl: number;
  loggedAt: string;
}

/** Milliseconds until a reading stops being offered (0 when it already has). */
export function offerExpiresInMs(loggedAt: string, now: Date): number {
  const at = new Date(loggedAt).getTime();
  if (!Number.isFinite(at)) return 0;
  return Math.max(0, at + RECENT_GLUCOSE_WINDOW_MINUTES * 60_000 - now.getTime() + 1000);
}

/**
 * Whether the number in the glucose field IS the offered reading: the field
 * shows the reading in the profile's unit (a mmol/L screen rounds to one
 * decimal), so equality is judged on that shown number. Only then does a save
 * use the stored mg/dL value and its row.
 */
export function fieldIsOffer(
  typed: number | null,
  offerShown: number | null
): boolean {
  return typed != null && offerShown != null && typed === offerShown;
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
  let best: { id: string | null; mgdl: number; loggedAt: string; at: number } | null = null;
  for (const log of logs) {
    const at = new Date(log.logged_at).getTime();
    if (!Number.isFinite(at)) continue;
    const age = nowMs - at;
    if (age < 0 || age > limitMs) continue;
    const v = log.glucose_level_mgdl;
    if (!Number.isFinite(v) || v < OFFER_MIN_MGDL || v > OFFER_MAX_MGDL) continue;
    if (!best || at > best.at) best = { id: log.id ?? null, mgdl: v, loggedAt: log.logged_at, at };
  }
  return best ? { id: best.id, mgdl: best.mgdl, loggedAt: best.loggedAt } : null;
}
