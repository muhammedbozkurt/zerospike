import { useSyncExternalStore } from "react";
import { AccessibilityInfo, Platform } from "react-native";

import { createFlagStore } from "./flagStore";
import { highContrastEventFor } from "./highContrastPalette";

// Module cache like useReducedMotion: the first read is async, and a hook that
// started at false made every high-contrast user mount the routed tree twice.
const store = createFlagStore(false);
const FIRST_READ_TIMEOUT_MS = 1000;

const event = highContrastEventFor(Platform.OS);
if (!event) {
  store.markReady();
} else {
  const query =
    event === "darkerSystemColorsChanged"
      ? AccessibilityInfo.isDarkerSystemColorsEnabled
      : AccessibilityInfo.isHighTextContrastEnabled;
  void query()
    .then((v) => store.set(!!v))
    .catch(() => store.markReady());
  setTimeout(() => store.markReady(), FIRST_READ_TIMEOUT_MS);
  AccessibilityInfo.addEventListener(event, (v) => store.set(!!v));
}

/** True while the system Increase Contrast / high contrast text setting is on. */
export function useHighContrast(): boolean {
  return useSyncExternalStore(store.subscribe, store.getValue, store.getValue);
}

/** False until the first OS reading arrived (or failed): the theme provider
 *  renders nothing until then so the tree mounts once with the right tokens. */
export function useHighContrastReady(): boolean {
  return useSyncExternalStore(store.subscribe, store.isReady, store.isReady);
}
