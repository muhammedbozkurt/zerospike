import { useCallback, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import { startMinuteTick } from "./minuteClock";

/**
 * A counter that moves once a minute while the screen is focused and the app is
 * in the foreground. Put it in the dependency list of anything derived from the
 * clock (active insulin decay, "today" at midnight). Refreshes at once on focus.
 */
export function useMinuteClock(): number {
  const [tick, setTick] = useState(0);
  useFocusEffect(
    useCallback(() => {
      setTick((n) => n + 1);
      return startMinuteTick(() => setTick((n) => n + 1), AppState);
    }, [])
  );
  return tick;
}
