import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  DOWNSELL_MAX_SHOWS,
  day7LocalGate,
  shouldTriggerDay7,
} from "../day7Downsell";
import {
  DOWNSELL_REARM_MS,
  canShowDownsell,
  applyDownsellShown,
  createPaywallExitController,
  createSessionOfferFlag,
  initialDownsellState,
  normalizeDownsellState,
  paywallExitLocalGate,
  shouldOfferDownsellOnPaywallExit,
  type DownsellState,
  type PaywallExitDeps,
  type PaywallExitNav,
  type DownsellTrigger,
} from "../downsellGate";
import { getDownsellOffer, isPro } from "./purchases";
import { isScreenshotMode } from "../screenshotMode";

/**
 * Downsell / winback show-cap state. A user is offered the discounted first year
 * at most twice in their lifetime, the second only after a 7-day cool-off, and
 * never twice in one app session. The first offer is the paywall exit (annual
 * selected, store purchase cancelled or paywall closed) in the same session.
 * Winback (on losing the entitlement) is separate and shown once.
 *
 * The day-7 offer at the bottom is another entry point into the SAME two
 * lifetime shows, not an extra one.
 *
 * The gate itself (canShowDownsell and friends) lives in ../downsellGate, kept
 * dependency-free so scripts/downsell.test.ts can run it under plain Node;
 * everything is re-exported from here unchanged for existing callers.
 */

export {
  DOWNSELL_MAX_SHOWS,
  DOWNSELL_REARM_MS,
  canShowDownsell,
  applyDownsellShown,
  initialDownsellState,
  paywallExitLocalGate,
  shouldOfferDownsellOnPaywallExit,
  createPaywallExitController,
};
export type { DownsellState, DownsellTrigger };

// ── Persistence ────────────────────────────────────────────────────────────

const DOWNSELL_KEY = "zerospike.downsellState";
const WINBACK_KEY = "zerospike.winbackShown";

export async function getDownsellState(): Promise<DownsellState> {
  try {
    const raw = await AsyncStorage.getItem(DOWNSELL_KEY);
    if (!raw) return initialDownsellState;
    return normalizeDownsellState(JSON.parse(raw));
  } catch {
    return initialDownsellState;
  }
}

// Process-lifetime flag: a new app launch is a new session, which is the
// intended reading of "once per session". Shared by the paywall exit, the
// day-7 offer and the winback so no two discount screens open in one session.
export const sessionOffer = createSessionOfferFlag();

/** Records a downsell show and returns the updated (persisted) state. */
export async function recordDownsellShown(
  trigger: DownsellTrigger,
  now: number
): Promise<DownsellState> {
  sessionOffer.reserve();
  const next = applyDownsellShown(await getDownsellState(), trigger, now);
  try {
    await AsyncStorage.setItem(DOWNSELL_KEY, JSON.stringify(next));
  } catch {
    // best-effort persistence
  }
  return next;
}

export async function winbackAlreadyShown(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(WINBACK_KEY)) === "true";
  } catch {
    return false;
  }
}

export async function markWinbackShown(): Promise<void> {
  try {
    await AsyncStorage.setItem(WINBACK_KEY, "true");
  } catch {
    // best-effort
  }
}

// ── Day-7 offer ────────────────────────────────────────────────────────────

const DAY7_ANCHOR_KEY = "zerospike.downsellDay7AnchorAt";
const DAY7_SHOWN_KEY = "zerospike.downsellDay7Shown";

/**
 * The day-7 anchor. completeOnboarding (lib/store/AppContext) records no
 * timestamp of its own, so the anchor is stamped lazily the first time this
 * gate runs - the first dashboard focus after onboarding, which trails the real
 * end by minutes at most. An install that was ALREADY onboarded before this
 * version is anchored at its first run instead, so it waits a full 7 days from
 * there rather than firing an offer on the update. Either way the anchor only
 * ever makes the gate later, never earlier.
 */
async function getDay7Anchor(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(DAY7_ANCHOR_KEY);
    if (raw) return Number(raw);
    const now = Date.now();
    await AsyncStorage.setItem(DAY7_ANCHOR_KEY, String(now));
    return now;
  } catch {
    return Date.now();
  }
}

async function day7AlreadyTriggered(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(DAY7_SHOWN_KEY)) === "true";
  } catch {
    return false;
  }
}

/**
 * Whether the once-per-lifetime day-7 offer is due now. Safe to call on every
 * dashboard focus: the free local half of the rule is evaluated first, so the
 * entitlement and offering round trips are only paid for on the one day the
 * answer can still turn out to be yes.
 */
export async function shouldShowDay7Downsell(): Promise<boolean> {
  // Never let a discount sheet land in the middle of a store capture.
  if (isScreenshotMode()) return false;
  if (sessionOffer.isReserved()) return false;
  const state = await getDownsellState();
  const local = {
    onboardedAtMs: await getDay7Anchor(),
    now: Date.now(),
    shownCount: state.count,
    alreadyTriggered: await day7AlreadyTriggered(),
    // X10: the shared re-arm cooldown applies here too.
    lastShownAt: state.lastShownAt,
    rearmMs: DOWNSELL_REARM_MS,
  };
  if (!day7LocalGate(local)) return false;
  const proNow = await isPro();
  // No point pricing an offer for someone who already holds the entitlement.
  const hasRealDiscount = proNow ? false : (await getDownsellOffer()).hasRealDiscount;
  if (!shouldTriggerDay7({ ...local, isPro: proNow, hasRealDiscount })) return false;
  // Taken here, after the awaits, so a paywall exit that reserved the slot in
  // the meantime wins and this offer simply waits for another day.
  return sessionOffer.reserve();
}

/**
 * Spends the single day-7 slot AND one of the shared lifetime shows, so this
 * trigger can never push a user past DOWNSELL_MAX_SHOWS. Call it right before
 * navigating, the same way the paywall records its own show.
 */
export async function markDay7DownsellShown(now: number = Date.now()): Promise<void> {
  try {
    await AsyncStorage.setItem(DAY7_SHOWN_KEY, "true");
  } catch {
    // best-effort
  }
  await recordDownsellShown("day7", now);
}

/** Real wiring of the paywall-exit decision (store, storage, session flag). */
export const paywallExitDeps: PaywallExitDeps = {
  isScreenshotMode,
  session: sessionOffer,
  getState: getDownsellState,
  getOffer: getDownsellOffer,
  now: () => Date.now(),
};

export function newPaywallExitController(nav: PaywallExitNav) {
  return createPaywallExitController(paywallExitDeps, nav);
}
