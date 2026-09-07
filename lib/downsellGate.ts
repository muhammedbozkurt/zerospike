/**
 * The general (non-day7) downsell show-cap gate, kept pure and
 * dependency-free for the same reason lib/day7Downsell.ts already is:
 * lib/services/downsell.ts imports AsyncStorage, which does not exist under
 * plain Node, so scripts/downsell.test.ts can only exercise the rule if it
 * lives somewhere free of that import. lib/services/downsell.ts re-exports
 * everything here; the rest of the app keeps importing from there.
 *
 * 2.3.4: the 24 Ağu - 7 Eyl iOS window showed 17 paywall views, 16 of them
 * followed immediately by a downsell, all 16 dismissed, 0 trials - the
 * downsell was firing on the very first paywall close, before the user had
 * shown any real hesitation. canShowDownsell now also requires the paywall to
 * have been closed at least DOWNSELL_MIN_DISMISSALS times AND at least
 * DOWNSELL_FIRST_SHOW_DELAY_MS to have passed since the first of those closes,
 * on top of the existing two-lifetime-shows cascade (DOWNSELL_MAX_SHOWS /
 * DOWNSELL_REARM_MS), which is unchanged.
 */
import { DOWNSELL_MAX_SHOWS } from "./day7Downsell";

export { DOWNSELL_MAX_SHOWS };
export const DOWNSELL_REARM_MS = 7 * 24 * 60 * 60 * 1000;
/** Paywall must be closed this many times before a downsell can ever show. */
export const DOWNSELL_MIN_DISMISSALS = 2;
/** ...and this long must have passed since the FIRST of those closes. */
export const DOWNSELL_FIRST_SHOW_DELAY_MS = 24 * 60 * 60 * 1000;

// 2.3.4: onboarding no longer hands off to the paywall (app/onboarding.tsx
// goes straight to the dashboard), so no caller ever sets "onboarding" here
// anymore - dropped from the union.
export type DownsellTrigger = "inapp" | "winback" | "day7";

export interface DownsellState {
  /** Times the discounted downsell itself has been shown (lifetime cap). */
  count: number;
  lastShownAt: number | null;
  lastTrigger: DownsellTrigger | null;
  /** Times the PAYWALL has been closed (an explicit dismiss or a cancelled
   *  purchase) - distinct from `count` above. 0 on a state persisted before
   *  2.3.4, which is exactly the "never closed under this rule" reading. */
  dismissCount: number;
  /** When the first of those closes happened; null on a pre-2.3.4 state. */
  firstDismissAt: number | null;
}

export const initialDownsellState: DownsellState = {
  count: 0,
  lastShownAt: null,
  lastTrigger: null,
  dismissCount: 0,
  firstDismissAt: null,
};

/**
 * Whether the discounted downsell may be shown again. An old-shaped state
 * (dismissCount/firstDismissAt missing, normalised to 0/null by
 * getDownsellState) always reads as "not yet" here rather than throwing -
 * the very next real dismiss starts counting it forward.
 */
export function canShowDownsell(state: DownsellState, now: number): boolean {
  if (state.dismissCount < DOWNSELL_MIN_DISMISSALS) return false;
  if (state.firstDismissAt === null) return false;
  if (now - state.firstDismissAt < DOWNSELL_FIRST_SHOW_DELAY_MS) return false;
  if (state.count >= DOWNSELL_MAX_SHOWS) return false;
  if (state.count === 0) return true;
  return state.lastShownAt !== null && now - state.lastShownAt >= DOWNSELL_REARM_MS;
}

export function applyDownsellShown(
  state: DownsellState,
  trigger: DownsellTrigger,
  now: number
): DownsellState {
  return { ...state, count: state.count + 1, lastShownAt: now, lastTrigger: trigger };
}

/** Records a paywall close (dismiss or cancelled purchase). `firstDismissAt`
 *  is stamped only once, by the first close ever seen. */
export function applyPaywallDismissed(state: DownsellState, now: number): DownsellState {
  return {
    ...state,
    dismissCount: state.dismissCount + 1,
    firstDismissAt: state.firstDismissAt ?? now,
  };
}
