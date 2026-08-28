import { useCallback, useState } from "react";
import { Platform } from "react-native";
import { useFocusEffect } from "expo-router";

import { getHealthConnectStatus, hasHealthProvider, type HealthConnectStatus } from "./health";

/**
 * Shared "is Health actually usable on THIS device" gate. hasHealthProvider()
 * alone only says the platform/build HAS a provider wired up, not that Health
 * Connect is installed/usable on this specific Android device - showing a
 * surface (dashboard card, paywall bullet) that promises Health sync while it
 * is "unavailable" oversells a feature the device cannot deliver. iOS has no
 * such gate: it resolves once, immediately, to available.
 *
 * Re-checked on every focus (not just mount): the two ways out of a bad
 * status - the Play Store update, or the device Settings permission screen -
 * both send the user away from the app and back, so a stale status here would
 * keep hiding/showing the wrong thing after they already fixed it.
 *
 * Used by both the dashboard (app/(tabs)/index.tsx) and the paywall
 * (app/paywall.tsx); each mount runs its own focus-triggered check, so a
 * module-level cache seeds every mount after the first with the last known
 * status instead of the pessimistic Android default, without changing what
 * is re-checked on focus.
 */
let cachedStatus: { status: HealthConnectStatus; loaded: boolean } | null =
  Platform.OS === "android" ? null : { status: "available", loaded: true };

export function useHealthAvailable(): boolean {
  const [hcStatus, setHcStatus] = useState<HealthConnectStatus>(
    cachedStatus?.status ?? (Platform.OS === "android" ? "unavailable" : "available")
  );
  const [hcStatusLoaded, setHcStatusLoaded] = useState(
    cachedStatus?.loaded ?? Platform.OS !== "android"
  );
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "android") return;
      let alive = true;
      void getHealthConnectStatus().then((status) => {
        cachedStatus = { status, loaded: true };
        if (!alive) return;
        setHcStatus(status);
        setHcStatusLoaded(true);
      });
      return () => {
        alive = false;
      };
    }, [])
  );
  return (
    hasHealthProvider() &&
    (Platform.OS !== "android" || (hcStatusLoaded && hcStatus !== "unavailable"))
  );
}
