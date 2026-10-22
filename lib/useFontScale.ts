import { useWindowDimensions } from "react-native";

import { MAX_FONT_SCALE, effectiveFontScale } from "./layoutForFontScale";

/** The text scale the UI renders at (OS setting clamped to the app cap). 1 at
 *  the default size, so `scale > 1` guards keep default layouts untouched. */
export function useFontScale(cap: number = MAX_FONT_SCALE): number {
  const { fontScale } = useWindowDimensions();
  return effectiveFontScale(fontScale, cap);
}
