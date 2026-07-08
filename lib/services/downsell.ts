import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Downsell / winback show-cap state. Ported from the Statura cascade: a user is
 * offered the discounted first year at most twice in their lifetime. The first
 * offer is the onboarding-end paywall dismiss; an in-app dismiss re-arms it once,
 * but only after a 7-day cool-off. Winback (on losing the entitlement) is
 * separate and shown once.
 */

export const DOWNSELL_MAX_SHOWS = 2;
export const DOWNSELL_REARM_MS = 7 * 24 * 60 * 60 * 1000;

export type DownsellTrigger = "onboarding" | "inapp" | "winback";

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
