import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  DOWNSELL_MAX_SHOWS,
  day7LocalGate,
  shouldTriggerDay7,
} from "../day7Downsell";
import { getDownsellOffer, isPro } from "./purchases";
import { isScreenshotMode } from "../screenshotMode";

/**
 * Downsell / winback show-cap state. Ported from the Statura cascade: a user is
 * offered the discounted first year at most twice in their lifetime. The first
 * offer is the onboarding-end paywall dismiss; an in-app dismiss re-arms it once,
 * but only after a 7-day cool-off. Winback (on losing the entitlement) is
 * separate and shown once.
 *
 * The day-7 offer at the bottom is a third entry point into the SAME two
 * lifetime shows, not an extra one.
 */

export { DOWNSELL_MAX_SHOWS };
export const DOWNSELL_REARM_MS = 7 * 24 * 60 * 60 * 1000;

export type DownsellTrigger = "onboarding" | "inapp" | "winback" | "day7";

export interface DownsellState {
  count: number;
  lastShownAt: number | null;
  lastTrigger: DownsellTrigger | null;
}

export const initialDownsellState: DownsellState = {
  count: 0,
  lastShownAt: null,
  lastTrigger: null,
};

/**
 * Whether the discounted downsell may be shown again. The first offer is always
 * allowed. After that it re-arms only once, and only after the cool-off, so a
 * single user never sees the downsell more than DOWNSELL_MAX_SHOWS times.
 */
export function canShowDownsell(state: DownsellState, now: number): boolean {
  if (state.count >= DOWNSELL_MAX_SHOWS) return false;
  if (state.count === 0) return true;
  return state.lastShownAt !== null && now - state.lastShownAt >= DOWNSELL_REARM_MS;
}

export function applyDownsellShown(
  state: DownsellState,
  trigger: DownsellTrigger,
  now: number
): DownsellState {
  return { count: state.count + 1, lastShownAt: now, lastTrigger: trigger };
}

// ── Persistence ────────────────────────────────────────────────────────────

const DOWNSELL_KEY = "zerospike.downsellState";
const WINBACK_KEY = "zerospike.winbackShown";

export async function getDownsellState(): Promise<DownsellState> {
  try {
    const raw = await AsyncStorage.getItem(DOWNSELL_KEY);
    if (!raw) return initialDownsellState;
    const parsed = JSON.parse(raw);
    return {
      count: Number(parsed.count) || 0,
      lastShownAt: parsed.lastShownAt ?? null,
      lastTrigger: parsed.lastTrigger ?? null,
    };
  } catch {
    return initialDownsellState;
  }
}

/** Records a downsell show and returns the updated (persisted) state. */
export async function recordDownsellShown(
  trigger: DownsellTrigger,
  now: number
): Promise<DownsellState> {
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
  return shouldTriggerDay7({ ...local, isPro: proNow, hasRealDiscount });
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
