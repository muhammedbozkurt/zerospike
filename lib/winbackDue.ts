/**
 * When the one-time win-back is owed and when it may open. Pure so the rules are
 * tested without the app root: a lapse makes it due, Pro coming back before it
 * opened (a restore in Settings, a late renewal) cancels it, and it never opens
 * for someone who is Pro, which would also spend the one-time offer.
 */
export type WinbackTransition = "lost" | "regained" | "none";

/** `prev` is the previous Pro value (null before the first read). */
export function winbackTransition(prev: boolean | null, isPro: boolean): WinbackTransition {
  if (prev === true && !isPro) return "lost";
  if (isPro) return "regained";
  return "none";
}

export function winbackMayOpen(s: {
  ready: boolean;
  due: boolean;
  home: boolean;
  isPro: boolean;
}): boolean {
  return s.ready && s.due && s.home && !s.isPro;
}
