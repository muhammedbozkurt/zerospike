import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";

import { HIDDEN_FROM_A11Y } from "./a11y";

/**
 * Icon-font glyphs are private-use characters that a screen reader reads out
 * as text. Every icon in the app is decorative (the row, button or tile next to
 * it carries the label), so hide the glyph for the whole family once, here,
 * instead of on ~250 call sites. Class components still honour defaultProps
 * under React 19.
 */
type WithDefaults = { defaultProps?: Record<string, unknown> };

for (const family of [Ionicons, MaterialCommunityIcons] as unknown as WithDefaults[]) {
  family.defaultProps = { ...family.defaultProps, ...HIDDEN_FROM_A11Y };
}
