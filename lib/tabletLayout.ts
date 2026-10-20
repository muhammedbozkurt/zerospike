/**
 * Pure tablet geometry: when a screen goes two-column, which blocks live in
 * which column, how the shorter column is filled, and how wide a sheet is.
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

export type ColumnBlock = {
  id: HomeBlockId;
  /** Share of the column's spare height this block takes (flex-grow). 0 keeps
   *  the block at its natural height. */
  grow: number;
};

/** Dashboard on a tablet. Left: the ring and week boxes, then the daily flow
 *  (the journal list scrolls the whole column). Right: the post-meal counter,
 *  tips, context strip (IOB, reminder), basal, and the Insights / Health
 *  tiles. The blocks that carry a grow weight are boxed cards; they stretch
 *  so a short right column fills the viewport instead of leaving a dead band
 *  under it. Weights favour the tiles, whose content reads fine when tall. */
export const HOME_LEFT: readonly ColumnBlock[] = [
  { id: "hero", grow: 0 },
  { id: "week", grow: 0 },
  { id: "journal", grow: 0 },
];

export const HOME_RIGHT: readonly ColumnBlock[] = [
  { id: "postMeal", grow: 1.2 },
  { id: "widgetTip", grow: 0 },
  { id: "spike", grow: 0 },
  { id: "context", grow: 0.8 },
  { id: "basal", grow: 0 },
  { id: "quick", grow: 2 },
  { id: "setup", grow: 0.6 },
];

export function homeGrow(id: HomeBlockId): number {
  const hit = HOME_RIGHT.find((b) => b.id === id);
  return hit ? hit.grow : 0;
}

export type StackedBlock = { id: string; height: number; grow: number };

export type FillResult = {
  /** Final height per block, same order as the input. */
  heights: number[];
  /** Spare height nobody could take (only when no block grows). */
  leftover: number;
};

/**
 * Flexbox's spare-space rule for one column: after the natural heights and
 * the gaps between blocks, the remaining viewport height is shared among the
 * blocks in proportion to their grow weight. A column already taller than the
 * viewport gets no extra (it scrolls). This is the same arithmetic the native
 * flexGrow does, so the render tool and the app agree.
 */
export function fillColumn(blocks: readonly StackedBlock[], available: number, gap: number): FillResult {
  const natural = blocks.reduce((sum, b) => sum + b.height, 0) + gap * Math.max(0, blocks.length - 1);
  const spare = Math.max(0, available - natural);
  const totalGrow = blocks.reduce((sum, b) => sum + b.grow, 0);
  if (spare === 0 || totalGrow === 0) {
    return { heights: blocks.map((b) => b.height), leftover: spare };
  }
  return {
    heights: blocks.map((b) => b.height + (spare * b.grow) / totalGrow),
    leftover: 0,
  };
}

/**
 * Order-preserving two-column split that minimises the height difference.
 * Returns how many leading blocks go left. Used where the blocks have no
 * fixed home (the food tab); the dashboard's split is the fixed HOME_* above.
 */
export function balancedSplit(heights: readonly number[]): number {
  const total = heights.reduce((s, h) => s + h, 0);
  let acc = 0;
  let best = 0;
  let bestDiff = total;
  for (let i = 0; i <= heights.length; i++) {
    const diff = Math.abs(total - acc * 2);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
    if (i < heights.length) acc += heights[i];
  }
  return best;
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
