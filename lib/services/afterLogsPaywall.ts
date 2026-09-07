import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * One-shot AsyncStorage gate for the "first value" paywall (2.3.4, see
 * lib/afterLogsPaywall.ts for the pure trigger rule). Three states, not a
 * boolean, because a plain "not yet shown" cannot tell a brand-new account
 * that just reached AFTER_LOGS_THRESHOLD from a pre-2.3.4 install that
 * already had a long history the first time this code ever runs for it:
 *
 *  - missing: never armed. armAfterLogsPaywall only runs from
 *    completeOnboarding (lib/store/AppContext.tsx), which a pre-2.3.4 install
 *    already called - once - on an OLDER version, so it never runs again on
 *    update. Reading "missing" while already onboarded is therefore exactly
 *    that install; it is grandfathered (marked shown, never displayed) the
 *    first time the dashboard checks.
 *  - armed: written by completeOnboarding for every onboarding finished on
 *    2.3.4+, from log count 0. Evaluated normally against
 *    AFTER_LOGS_THRESHOLD from here on.
 *  - shown: the one-shot has been spent (paywall shown, or grandfathered).
 */
const KEY = "zerospike.afterLogsPaywallState";
type StoredState = "armed" | "shown";
export type AfterLogsPaywallGate = "armed" | "grandfather" | "done";

/** Called once, from completeOnboarding, for every onboarding finished on
 *  2.3.4+. Never re-arms a flag that has already been spent (defensive only -
 *  completeOnboarding runs once per account in practice). */
export async function armAfterLogsPaywall(): Promise<void> {
  try {
    const existing = await AsyncStorage.getItem(KEY);
    if (existing === "shown") return;
    await AsyncStorage.setItem(KEY, "armed" as StoredState);
  } catch {
    // best-effort; a failed write here at worst grandfathers this account
  }
}

/** Spends the one-shot - call BEFORE navigating, same pattern as the other
 *  one-time flags in this app (markAlarmTourSeen, markWinbackShown). */
export async function markAfterLogsPaywallShown(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, "shown" as StoredState);
  } catch {
    // best-effort
  }
}

/** Never throws: an unreadable flag reads "done", so a storage failure can
 *  never turn this into a paywall that fires on every dashboard focus. */
export async function getAfterLogsPaywallGate(): Promise<AfterLogsPaywallGate> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw === "shown") return "done";
    if (raw === "armed") return "armed";
    return "grandfather";
  } catch {
    return "done";
  }
}
