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
 *
 * Build 93 QA: "once a discount screen has been seen (accepted OR declined) it
 * does not come back for 7 days, at most 2 in a lifetime" must hold across app
 * launches and across every entry (paywall exit, day-7, winback), not only
 * inside one process. The session flag is therefore backed by a PERSISTED date:
 * `lastShownAt` is stamped the moment a discount screen is about to open
 * (stampDownsellOffered for the paywall exit, the existing record for day-7,
 * markWinbackShown for the winback), and the cool-off below reads it whatever
 * the count is.
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
 * Whether the persisted last-shown date is old enough. No date at all means no
 * discount screen was ever stamped. A date in the future (clock moved back)
 * reads as "not yet": the safe direction for a discount screen is to wait.
 */
export function downsellCooldownElapsed(lastShownAt: number | null, now: number): boolean {
  return lastShownAt === null || now - lastShownAt >= DOWNSELL_REARM_MS;
}

/**
 * A stored date in the future (the clock was moved forward, then back) would
 * keep the window shut for as long as the skew. Reading it as "now" caps the
 * wait at one window from the moment it is noticed; the service persists the
 * clamped value so the cap does not slide.
 */
export function clampLastShownAt(state: DownsellState, now: number): DownsellState {
  if (state.lastShownAt !== null && state.lastShownAt > now) {
    return { ...state, lastShownAt: now };
  }
  return state;
}

/**
 * The lifetime cap and re-arm cool-off, independent of the trigger: at most
 * DOWNSELL_MAX_SHOWS shows ever, and none within DOWNSELL_REARM_MS of the last
 * stamped screen (whether it was accepted, declined, or only opened). A counted
 * show without a date cannot prove its cool-off, so it blocks.
 */
export function canShowDownsell(state: DownsellState, now: number): boolean {
  if (state.count >= DOWNSELL_MAX_SHOWS) return false;
  if (state.count > 0 && state.lastShownAt === null) return false;
  return downsellCooldownElapsed(state.lastShownAt, now);
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
 * Stamps the persisted last-shown date WITHOUT spending a lifetime show: used
 * when a discount screen is about to open but its offer is not yet confirmed a
 * second time (paywall exit), and by the winback, which keeps its own
 * once-ever flag instead of the shared two-show cap.
 */
export function applyDownsellStamp(
  state: DownsellState,
  trigger: DownsellTrigger,
  now: number
): DownsellState {
  return { ...state, lastShownAt: now, lastTrigger: trigger };
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

/** What the user holds right now, read fresh from the store. */
export interface EntitlementNow {
  isPro: boolean;
  /** A running free trial. */
  trialActive: boolean;
  /** The one-off lifetime purchase. */
  lifetime: boolean;
}

/**
 * Any active trial, subscription or lifetime means a discount on the annual
 * plan is never shown. Each flag blocks on its own: a store that reports the
 * trial or the lifetime without the pro flag (or the reverse) must still block.
 */
export function entitlementBlocksDownsell(e: EntitlementNow): boolean {
  return e.isPro || e.trialActive || e.lifetime;
}

export interface DownsellEligibilityInput {
  state: DownsellState;
  now: number;
  /** Any discount screen (any trigger) already opened in this app process. */
  sessionTaken: boolean;
  entitlement: EntitlementNow;
  /** Onboarding not finished yet (the first-run flow). */
  onboardingIncomplete: boolean;
  /** Confirmed against the store offerings, never assumed. */
  hasRealDiscount: boolean;
}

/**
 * The full shared rule in one place, for tests and as the specification the
 * staged callers (paywall exit, day-7, winback) each apply in their own order
 * so the cheap local checks run before the store round trips.
 */
export function downsellEligible(i: DownsellEligibilityInput): boolean {
  if (entitlementBlocksDownsell(i.entitlement)) return false;
  if (i.onboardingIncomplete) return false;
  if (i.sessionTaken) return false;
  if (!i.hasRealDiscount) return false;
  return canShowDownsell(i.state, i.now);
}

export interface PaywallExitDeps {
  isScreenshotMode(): boolean;
  session: SessionOfferFlag;
  getState(): Promise<DownsellState>;
  getOffer(): Promise<{ hasRealDiscount: boolean }>;
  /** Fresh entitlement read, so a purchase that completed after the screen
   *  last rendered is never offered a discount on itself. */
  entitlementNow(): Promise<EntitlementNow>;
  /** True until onboarding has been completed: never a discount before that. */
  onboardingIncomplete(): Promise<boolean>;
  /** Persists the last-shown date when the decision is "downsell", so the
   *  7-day cool-off survives a relaunch even if the screen is closed before it
   *  records its own show. Best effort: a failure must not block the offer. */
  markOffered(now: number): Promise<void>;
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
    if (await deps.onboardingIncomplete()) {
      if (reserved) deps.session.release();
      return "exit";
    }
    if (entitlementBlocksDownsell(await deps.entitlementNow())) {
      if (reserved) deps.session.release();
      return "exit";
    }
    const offer = await deps.getOffer();
    if (!shouldOfferDownsellOnPaywallExit({ ...base, state, now, hasRealDiscount: offer.hasRealDiscount })) {
      if (reserved) deps.session.release();
      return "exit";
    }
    try {
      await deps.markOffered(now);
    } catch {
      // The session slot still holds; only the cross-launch date is lost.
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
  // Set when a purchase starts while a decision is still in flight: the decision
  // then navigates nowhere (the purchase owns the screen's exit).
  let abandoned = false;

  /** Shared tail of a decision that is dropped because a purchase took over. */
  async function settleAbandoned(decision: PaywallExitDecision): Promise<void> {
    // A reserved session slot with no screen opening is handed back.
    if (decision === "downsell") deps.session.release();
    exiting = false;
    abandoned = false;
  }

  const controller = {
    /** True from the moment a close or cancel has taken the lock until the
     *  screen has left (or, for a cancel with nothing to show, until it stays).
     *  The paywall refuses a purchase press while this is true. */
    isExiting: () => exiting,
    /** A purchase has begun: a decision still pending must not navigate. */
    abandonPendingExit(): void {
      if (exiting) abandoned = true;
    },
    /** `onAccepted` runs synchronously once this call has taken the lock, so
     *  per-exit side effects (analytics) fire once, not once per tap. */
    async requestExit(
      input: { plan: string; isPro: boolean },
      onAccepted?: () => void
    ): Promise<void> {
      if (exiting) return;
      exiting = true;
      abandoned = false;
      onAccepted?.();
      const decision = await decidePaywallExit(deps, input);
      if (abandoned) return settleAbandoned(decision);
      if (decision === "downsell") nav.openDownsell();
      else nav.closePaywall();
    },
    /**
     * A store sheet the user cancelled. Only a "downsell" decision leaves the
     * paywall; "exit" means the paywall STAYS, the lock is released and the
     * button returns to normal (cancelling a purchase is not closing the
     * paywall, and not a reason to throw the user off it).
     */
    async requestAfterCancel(input: { plan: string; isPro: boolean }): Promise<void> {
      if (exiting) return;
      exiting = true;
      abandoned = false;
      const decision = await decidePaywallExit(deps, input);
      if (abandoned) return settleAbandoned(decision);
      if (decision === "downsell") nav.openDownsell();
      else exiting = false;
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
