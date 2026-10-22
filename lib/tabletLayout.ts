import { dialogHeights } from "./sheetLayout";

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

/** Fixed vertical gap between the cards of a tablet column. Equals SPACE.md,
 *  the bottom margin every dashboard card already carries. */
export const TABLET_CARD_GAP = 12;

/** Height guesses used until the real blocks are measured (onLayout). */
export const HOME_BLOCK_ESTIMATE = 140;
export const JOURNAL_HEAD_FOOT_ESTIMATE = 126;
export const JOURNAL_ROW_ESTIMATE = 62;

export function estimateJournalHeight(rows: number): number {
  return JOURNAL_HEAD_FOOT_ESTIMATE + Math.max(0, rows) * JOURNAL_ROW_ESTIMATE;
}

/** Height of a stack: sum of the blocks plus `gap` between non-empty blocks. */
export function stackHeight(heights: readonly number[], gap: number = 0): number {
  let total = 0;
  let count = 0;
  for (const h of heights) {
    if (h <= 0) continue;
    total += h;
    count++;
  }
  return total + gap * Math.max(0, count - 1);
}

export type HomeSplit = {
  /** How many of the movable blocks (from the start) go to the left column. */
  leftCount: number;
  left: number;
  right: number;
  /** |left - right| / max(left, right), 0 when both are empty. */
  imbalance: number;
};

/** A kept split is only replaced when the best one gains more than this (pt):
 *  stops blocks hopping columns for a few points of data-driven height change. */
export const SPLIT_HYSTERESIS = 24;

/**
 * Dashboard on a tablet: two columns inside ONE outer scroll view, every card
 * at its natural height, nothing stretched. The blocks keep their phone
 * reading order: the first `leftCount` of `movable` fill the left column, the
 * rest continue at the top of the right column, and the journal panel (one
 * connected container, never cut) closes the right column. `leftCount` is the
 * cut that makes the two column heights closest; `current` (the cut in use) is
 * kept unless the best one is better by more than `hysteresis`.
 * Measured heights already include each card's own bottom margin, so the app
 * passes gap 0; the model and the tests pass TABLET_CARD_GAP.
 */
export function splitHomeColumns(
  movable: readonly number[],
  journal: number,
  opts: { gap?: number; current?: number; hysteresis?: number } = {}
): HomeSplit {
  const gap = opts.gap ?? 0;
  const at = (k: number): HomeSplit => {
    const left = stackHeight(movable.slice(0, k), gap);
    const right = stackHeight([...movable.slice(k), journal], gap);
    const hi = Math.max(left, right);
    return { leftCount: k, left, right, imbalance: hi > 0 ? Math.abs(left - right) / hi : 0 };
  };
  let best = at(0);
  for (let k = 1; k <= movable.length; k++) {
    const c = at(k);
    if (Math.abs(c.left - c.right) < Math.abs(best.left - best.right)) best = c;
  }
  const cur = opts.current;
  if (cur != null && cur >= 0 && cur <= movable.length) {
    const kept = at(cur);
    const slack = opts.hysteresis ?? SPLIT_HYSTERESIS;
    if (Math.abs(kept.left - kept.right) - Math.abs(best.left - best.right) <= slack) return kept;
  }
  return best;
}

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

/** Widest a bottom sheet gets on a tablet narrower than TWO_COL_MIN_DP. */
export const SHEET_MAX_WIDTH = 560;

/** Air kept on each side of a sheet that is narrower than its cap. */
export const SHEET_EDGE_MARGIN = 16;

/** Tallest a tablet bottom sheet whose height does not follow its content gets
 *  (600 to 699 dp wide tablets; wider ones use the centred dialog). */
export const TABLET_SHEET_MAX_HEIGHT = 900;

/** Centred dialog sheet (window width >= TWO_COL_MIN_DP): width band. */
export const DIALOG_MIN_WIDTH = 560;
export const DIALOG_MAX_WIDTH = 680;
export const DIALOG_WIDTH_RATIO = 0.6;
export const DIALOG_RADIUS = 26;

export function sheetWidth(windowWidth: number, margin: number = SHEET_EDGE_MARGIN, max: number = SHEET_MAX_WIDTH): number {
  return Math.max(0, Math.min(max, windowWidth - margin * 2));
}

/** A tablet sheet becomes a centred dialog from 700 dp window width. */
export function isDialogSheet(windowWidth: number, windowHeight: number): boolean {
  return isTwoColumn(windowWidth, windowHeight);
}

/** 60% of the window, kept inside 560..680 and never closer than 16 to an edge. */
export function dialogWidth(windowWidth: number): number {
  const wanted = Math.min(DIALOG_MAX_WIDTH, Math.max(DIALOG_MIN_WIDTH, Math.round(windowWidth * DIALOG_WIDTH_RATIO)));
  return Math.max(0, Math.min(wanted, windowWidth - SHEET_EDGE_MARGIN * 2));
}

/** Card inside a frame-only box (sheetBoxStyle surface false): closes the
 *  bottom corners and fills a minimum height the frame forces. */
export const dialogCardStyle = {
  borderRadius: DIALOG_RADIUS,
  borderBottomWidth: 1,
  flexGrow: 1,
} as const;

export type SheetBoxStyle = {
  width: number;
  alignSelf: "center";
  marginTop?: "auto";
  marginBottom?: "auto";
  minHeight?: number;
  maxHeight?: number;
  borderRadius?: number;
  borderWidth?: number;
};

/**
 * Container style for a sheet: undefined on a phone (full-width bottom sheet
 * as it always was). On a tablet:
 *  - window height not given: the old centred-width bottom sheet (560 cap);
 *  - window >= 700 wide and the height given: a centred dialog, 560..680 wide,
 *    50%..85% of the window tall (auto margins centre it inside the usual
 *    flex-end host, so no host change is needed; that host's keyboard padding
 *    keeps it centred in the room above the keyboard), rounded all round.
 *    `availableHeight` is the sheet's own keyboard and top-inset aware room;
 *    the dialog max never exceeds it less DIALOG_CLEARANCE. `surface: false`
 *    skips the radius and border for a box that is only a frame (the card
 *    inside it draws its own).
 */
export function sheetBoxStyle(
  windowWidth: number,
  isWide: boolean,
  windowHeight?: number,
  availableHeight?: number,
  surface: boolean = true
): SheetBoxStyle | undefined {
  if (!isWide) return undefined;
  if (windowHeight == null || !isDialogSheet(windowWidth, windowHeight)) {
    return { width: sheetWidth(windowWidth), alignSelf: "center" };
  }
  const { minHeight, maxHeight } = dialogHeights(windowHeight, availableHeight);
  return {
    width: dialogWidth(windowWidth),
    alignSelf: "center",
    marginTop: "auto",
    marginBottom: "auto",
    minHeight,
    maxHeight,
    ...(surface ? { borderRadius: DIALOG_RADIUS, borderWidth: 1 } : null),
  };
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
