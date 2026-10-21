/**
 * Pure tablet geometry: when a screen goes two-column, which blocks live in
 * which column (natural heights, fixed gap, one outer scroll), and how wide a
 * sheet is.
 * No react-native import on purpose: the layout is tested from plain Node
 * (scripts/tabletLayout.test.ts) and drawn by scripts/tabletLayoutRender.ts
 * from these same functions, so the picture cannot drift from the app.
 */

/** Shortest window side (dp) from which a screen counts as a tablet. */
export const WIDE_MIN_DP = 600;

/** Window width (dp) from which a wide screen goes two-column: 699 stays one
 *  column, 700 is two. Android 7in portrait (600) is therefore one column. */
export const TWO_COL_MIN_DP = 700;

/** Gutter inside each column (card shadows stay inside the scroll area). */
export const COLUMN_GUTTER = 16;

/** Readable cap for one column's content, excluding the gutters. */
export const COLUMN_CONTENT_MAX = 560;

/** Widest the two-column body gets; wider windows centre it. */
export const TWO_COL_MAX_WIDTH = 2 * (COLUMN_CONTENT_MAX + COLUMN_GUTTER * 2);

export function isWideScreen(width: number, height: number): boolean {
  return Math.min(width, height) >= WIDE_MIN_DP;
}

export function isTwoColumn(width: number, height: number): boolean {
  return isWideScreen(width, height) && width >= TWO_COL_MIN_DP;
}

/** Outer width of one of the two columns (gutters included). */
export function columnWidth(width: number): number {
  return Math.min(width, TWO_COL_MAX_WIDTH) / 2;
}

/** Content width inside a column (gutters removed). */
export function columnContentWidth(width: number): number {
  return Math.max(0, columnWidth(width) - COLUMN_GUTTER * 2);
}

export type HomeBlockId =
  | "hero"
  | "week"
  | "journal"
  | "postMeal"
  | "widgetTip"
  | "spike"
  | "context"
  | "basal"
  | "quick"
  | "setup";

/** Fixed vertical gap between the cards of a tablet column. Equals SPACE.md,
 *  the bottom margin every dashboard card already carries. */
export const TABLET_CARD_GAP = 12;

/** Dashboard on a tablet. Left: the ring and week boxes, then the daily flow.
 *  Right: the post-meal counter, tips, context strip (IOB, reminder), basal,
 *  and the Insights / Health tiles. Both columns sit in ONE outer scroll view
 *  and every card keeps its natural height: no card is stretched past its
 *  content and the columns are not forced to end at the same height. */
export const HOME_LEFT: readonly HomeBlockId[] = ["hero", "week", "journal"];

export const HOME_RIGHT: readonly HomeBlockId[] = [
  "postMeal",
  "widgetTip",
  "spike",
  "context",
  "basal",
  "quick",
  "setup",
];

export type StackResult = {
  /** Top offset of each block, same order as the input. */
  tops: number[];
  /** Total height of the stack (last bottom edge, no trailing gap). */
  total: number;
};

/**
 * Top-aligned stack with a fixed gap: block i starts where block i-1 ended
 * plus `gap`. Heights are the blocks' natural heights and are never changed.
 */
export function stackColumn(heights: readonly number[], gap: number = TABLET_CARD_GAP): StackResult {
  const tops: number[] = [];
  let y = 0;
  heights.forEach((h, i) => {
    if (i > 0) y += gap;
    tops.push(y);
    y += h;
  });
  return { tops, total: y };
}

/** Widest a bottom sheet gets on a tablet. */
export const SHEET_MAX_WIDTH = 560;

/** Air kept on each side of a sheet that is narrower than its cap. */
export const SHEET_EDGE_MARGIN = 16;

/** Tallest a tablet sheet whose height does not follow its content gets. A
 *  full-screen iPad sheet is a 560-wide strip nobody can read. */
export const TABLET_SHEET_MAX_HEIGHT = 900;

export function sheetWidth(windowWidth: number, margin: number = SHEET_EDGE_MARGIN, max: number = SHEET_MAX_WIDTH): number {
  return Math.max(0, Math.min(max, windowWidth - margin * 2));
}

/**
 * Container style for a sheet: centred, capped width on a tablet, undefined on
 * a phone (which keeps the full-width sheet it always had).
 */
export function sheetBoxStyle(
  windowWidth: number,
  isWide: boolean
): { width: number; alignSelf: "center" } | undefined {
  return isWide ? { width: sheetWidth(windowWidth), alignSelf: "center" } : undefined;
}

/**
 * Tallest a sheet may be so it stays inside the visible area: the window less
 * the status bar / cutout on top and the home indicator / nav bar below, less
 * a little air. On a tablet the ratio cap is also bounded by
 * TABLET_SHEET_MAX_HEIGHT when the sheet's height is not content-driven.
 */
export function sheetVisibleHeight(
  windowHeight: number,
  insetTop: number,
  insetBottom: number,
  air = 8
): number {
  return Math.max(0, windowHeight - insetTop - insetBottom - air);
}

export function tabletSheetHeight(
  windowHeight: number,
  insetTop: number,
  insetBottom: number,
  ratio: number,
  isWide: boolean
): number {
  const visible = sheetVisibleHeight(windowHeight, insetTop, insetBottom);
  const byRatio = Math.min(windowHeight * ratio, visible);
  return isWide ? Math.min(byRatio, TABLET_SHEET_MAX_HEIGHT) : byRatio;
}
