/**
 * The general (non-day7) downsell show-cap gate, kept pure and
 * dependency-free for the same reason lib/day7Downsell.ts already is:
 * lib/services/downsell.ts imports AsyncStorage, which does not exist under
 * plain Node, so scripts/downsell.test.ts can only exercise the rule if it
 * lives somewhere free of that import. lib/services/downsell.ts re-exports
 * everything here; the rest of the app keeps importing from there.
 *
 * 2.4: the 2.3.4 rule (paywall closed twice, 24h after the first close) made the
 * offer unreachable in the first session, and since onboarding no longer ends on
 * a paywall there was no other first-session entry. The rule is now: a user on
 * the paywall with the ANNUAL plan selected who cancels the store purchase or
 * closes the paywall gets the discounted offer in the SAME session, once, when a
 * real store discount exists. Afterwards the 7-day cool-off and the lifetime cap
 * of DOWNSELL_MAX_SHOWS apply unchanged.
 */
import { DOWNSELL_MAX_SHOWS } from "./day7Downsell";

export { DOWNSELL_MAX_SHOWS };
export const DOWNSELL_REARM_MS = 7 * 24 * 60 * 60 * 1000;

// Onboarding no longer hands off to the paywall (app/onboarding.tsx goes
// straight to the dashboard), so no caller ever sets "onboarding" here.
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
 * The lifetime cap and re-arm cool-off, independent of the trigger: at most
 * DOWNSELL_MAX_SHOWS shows ever, the second only DOWNSELL_REARM_MS after the
 * first.
 */
export function canShowDownsell(state: DownsellState, now: number): boolean {
  if (state.count >= DOWNSELL_MAX_SHOWS) return false;
  if (state.count === 0) return true;
  return state.lastShownAt !== null && now - state.lastShownAt >= DOWNSELL_REARM_MS;
}

export interface PaywallExitInput {
  state: DownsellState;
  now: number;
  /** The plan selected on the paywall at the moment of the exit. */
  plan: string;
  isPro: boolean;
  /** Any downsell (any trigger) already opened since the app process started. */
  shownThisSession: boolean;
  /** Confirmed against the store offerings, never assumed. */
  hasRealDiscount: boolean;
}

/**
 * Local half of the paywall-exit rule (everything except the store lookup), so
 * the offerings round trip is only paid for once this is true.
 */
export function paywallExitLocalGate(
  i: Omit<PaywallExitInput, "hasRealDiscount">
): boolean {
  if (i.isPro) return false;
  if (i.plan !== "annual") return false;
  if (i.shownThisSession) return false;
  return canShowDownsell(i.state, i.now);
}

/**
 * Whether a paywall exit (store purchase cancelled, or the paywall closed via
 * X / back / swipe) should open the discounted offer instead of just leaving.
 */
export function shouldOfferDownsellOnPaywallExit(i: PaywallExitInput): boolean {
  return paywallExitLocalGate(i) && i.hasRealDiscount;
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
