/**
 * The Dynamic Island + lock-screen Live Activity constants of
 * targets/widget/PostMealActivity.swift and WidgetColors.swift, as plain data.
 * No React / RN imports on purpose: scripts/scWidgetsIsland.test.ts reads the
 * Swift source and fails when any value here drifts from it.
 */

/** WidgetPalette.islandAccent / islandInk / islandMuted (WidgetColors.swift);
 *  the island is always black, so these never follow the system appearance.
 *  Contrast on #000000: accent 10.31:1, ink 17.5:1, muted 7.6:1. */
export const ISLAND_TONES = {
  black: "#000000", // theme-ok: Swift island ground, fixed
  accent: "#22c7e0", // theme-ok: Swift islandAccent (= DARK.accentFill)
  ink: "#eaf6fa", // theme-ok: Swift islandInk
  muted: "#89a3b0", // theme-ok: Swift islandMuted
} as const;

export type Weight = "600" | "700" | "500";

/** compactLeading / compactTrailing: SF Symbol "timer" + the countdown, no title. */
export const ISLAND_COMPACT = {
  w: 126,
  h: 37,
  padX: 12,
  iconSize: 13,
  iconWeight: "600" as Weight,
  timeSize: 13,
  timeWeight: "600" as Weight,
  timeMaxW: 54,
};

/** minimal: the lone "timer" glyph. */
export const ISLAND_MINIMAL = {
  size: 37,
  iconSize: 13,
  iconWeight: "600" as Weight,
};

/** DynamicIslandExpandedRegion leading / center / trailing / bottom. */
export const ISLAND_EXPANDED = {
  h: 83,
  padX: 16,
  padTop: 10,
  rowToPill: 6,
  padBottom: 8,
  badge: 30,
  badgeCorner: 10,
  badgeGlyph: 14,
  badgeAlpha: 0.18,
  titleSize: 12,
  titleWeight: "600" as Weight,
  timeSize: 17,
  timeWeight: "700" as Weight,
  timeMinW: 72,
  pillValueSize: 14,
  pillValueWeight: "700" as Weight,
  pillUnitSize: 10,
  pillUnitWeight: "500" as Weight,
  pillPadX: 9,
  pillPadY: 5,
  pillGap: 4,
  pillFillAlpha: 0.06,
  pillStrokeAlpha: 0.1,
};

/** The lock-screen banner HStack. `naturalH` = padY * 2 + badge: the card at
 *  scale 1; every size below is multiplied by height / naturalH. */
export const LIVE_CARD = {
  gap: 12,
  padX: 14,
  padY: 12,
  badge: 38,
  badgeCorner: 12,
  badgeGlyph: 17,
  badgeAlpha: 0.18,
  titleSize: 10,
  titleWeight: "700" as Weight,
  timeSize: 22,
  timeWeight: "700" as Weight,
  timeMaxW: 96,
  naturalH: 62,
};
