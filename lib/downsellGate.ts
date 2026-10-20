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
  /** Legacy (2.3.4 rule). No longer written or read by the gate; kept so a
   *  state persisted by 2.3.4 round-trips unchanged. */
  dismissCount: number;
  /** Legacy, see dismissCount. */
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

/**
 * Normalises whatever JSON.parse produced from storage into a DownsellState.
 * Fields absent on an old-shaped blob (pre-2.3.4) read as their initial value,
 * and anything unparseable reads as the initial state; never throws.
 */
export function normalizeDownsellState(parsed: unknown): DownsellState {
  if (parsed === null || typeof parsed !== "object") return initialDownsellState;
  const p = parsed as Record<string, unknown>;
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const trigger = p.lastTrigger;
  return {
    count: Number(p.count) || 0,
    lastShownAt: num(p.lastShownAt),
    lastTrigger:
      trigger === "inapp" || trigger === "winback" || trigger === "day7" ? trigger : null,
    dismissCount: Number(p.dismissCount) || 0,
    firstDismissAt: num(p.firstDismissAt),
  };
}

// ── One discount screen per session ────────────────────────────────────────

export interface SessionOfferFlag {
  /** Takes the session slot; false when it is already taken. Synchronous, so
   *  two concurrent callers can never both get true. */
  reserve(): boolean;
  /** Gives the slot back (the offer turned out not to exist). */
  release(): void;
  isReserved(): boolean;
}

export function createSessionOfferFlag(): SessionOfferFlag {
  let taken = false;
  return {
    reserve() {
      if (taken) return false;
      taken = true;
      return true;
    },
    release() {
      taken = false;
    },
    isReserved: () => taken,
  };
}

// ── Paywall exit decision ──────────────────────────────────────────────────

export interface PaywallExitDeps {
  isScreenshotMode(): boolean;
  session: SessionOfferFlag;
  getState(): Promise<DownsellState>;
  getOffer(): Promise<{ hasRealDiscount: boolean }>;
  /** Fresh entitlement read, so a purchase that completed after the screen
   *  last rendered is never offered a discount on itself. */
  isProNow(): Promise<boolean>;
  now(): number;
}

export type PaywallExitDecision = "downsell" | "exit";

/**
 * Decides what a paywall exit does. The session slot is reserved BEFORE the
 * awaits, so two overlapping exits cannot both pass; it is handed back when
 * the rule says no or the store has no real discount. On "downsell" the slot
 * stays taken (the lifetime show itself is recorded by the downsell screen
 * once it has confirmed the discount).
 */
export async function decidePaywallExit(
  deps: PaywallExitDeps,
  input: { plan: string; isPro: boolean }
): Promise<PaywallExitDecision> {
  if (input.isPro || deps.isScreenshotMode()) return "exit";
  const reserved = deps.session.reserve();
  const base = { plan: input.plan, isPro: input.isPro, shownThisSession: !reserved };
  try {
    const state = await deps.getState();
    const now = deps.now();
    if (!paywallExitLocalGate({ ...base, state, now })) {
      if (reserved) deps.session.release();
      return "exit";
    }
    if (await deps.isProNow()) {
      if (reserved) deps.session.release();
      return "exit";
    }
    const offer = await deps.getOffer();
    if (!shouldOfferDownsellOnPaywallExit({ ...base, state, now, hasRealDiscount: offer.hasRealDiscount })) {
      if (reserved) deps.session.release();
      return "exit";
    }
    return "downsell";
  } catch {
    if (reserved) deps.session.release();
    return "exit";
  }
}

export interface PaywallExitNav {
  closePaywall(): void;
  openDownsell(): void;
}

/**
 * Re-entrancy guard around decidePaywallExit: an X tap, a back gesture and a
 * cancelled purchase can all land within the same offer lookup, and only the
 * first may navigate. Meant to live for one paywall screen instance.
 */
export function createPaywallExitController(
  deps: PaywallExitDeps,
  nav: PaywallExitNav,
  /** True while a purchase or restore is being processed. */
  isBlocked: () => boolean = () => false
) {
  let exiting = false;
  const controller = {
    /** `onAccepted` runs synchronously once this call has taken the lock, so
     *  per-exit side effects (analytics) fire once, not once per tap. */
    async requestExit(
      input: { plan: string; isPro: boolean },
      onAccepted?: () => void
    ): Promise<void> {
      if (exiting) return;
      exiting = true;
      onAccepted?.();
      const decision = await decidePaywallExit(deps, input);
      if (decision === "downsell") nav.openDownsell();
      else nav.closePaywall();
    },
    /** A close the user asked for (X, back, swipe): ignored while blocked.
     *  A cancelled purchase uses requestExit directly, as it IS the blocker. */
    async requestUserClose(
      input: { plan: string; isPro: boolean },
      onAccepted?: () => void
    ): Promise<void> {
      if (isBlocked()) return;
      await controller.requestExit(input, onAccepted);
    },
  };
  return controller;
}
