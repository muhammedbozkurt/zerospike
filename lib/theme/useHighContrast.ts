import { useEffect, useState } from "react";
import { AccessibilityInfo, Platform } from "react-native";

import { highContrastEventFor } from "./highContrastPalette";

/** True while the system Increase Contrast / high contrast text setting is on. */
export function useHighContrast(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const event = highContrastEventFor(Platform.OS);
    if (!event) return;
    let alive = true;
    const query =
      event === "darkerSystemColorsChanged"
        ? AccessibilityInfo.isDarkerSystemColorsEnabled
        : AccessibilityInfo.isHighTextContrastEnabled;
    void query()
      .then((v) => {
        if (alive) setOn(v);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener(event, (v) => {
      if (alive) setOn(v);
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return on;
}
