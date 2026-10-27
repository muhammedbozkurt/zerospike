import { useEffect } from "react";
import { AppState } from "react-native";

import { syncNightscoutForeground } from "./services/sourceSync";

/** Foreground refresh rhythm for outside sources. iOS has no background task
 *  for Nightscout, so this plus the pass at launch is all iPhone gets. */
export const SOURCE_POLL_INTERVAL_MS = 5 * 60_000;

/**
 * Pulls Nightscout when the app opens, when it comes back to the foreground and
 * every five minutes while it is in the foreground. The service skips by itself
 * when nothing is connected, the user is not entitled, or a back-off is running,
 * so a tick is cheap (one storage read).
 */
export function useSourcePolling(profileId: string | undefined, isPro: boolean): void {
  useEffect(() => {
    if (!profileId) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const tick = () => {
      void syncNightscoutForeground(profileId, isPro);
    };
    const start = () => {
      if (timer != null) return;
      tick();
      timer = setInterval(tick, SOURCE_POLL_INTERVAL_MS);
    };
    const stop = () => {
      if (timer != null) clearInterval(timer);
      timer = null;
    };
    if (AppState.currentState === "active") start();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") start();
      else stop();
    });
    return () => {
      sub.remove();
      stop();
    };
  }, [profileId, isPro]);
}
