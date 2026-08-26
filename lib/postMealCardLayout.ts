/**
 * Pure geometry for the post-meal card's duration-chip row (2.3.1's card
 * redesign). No react-native import here on purpose, same reason as
 * lib/sheetLayout.ts: this has to be importable from a plain Node/tsx test
 * (scripts/postMealCardLayout.test.ts) without a RN runtime, and it is the
 * device QA finding "the card is cramped and overflows on small screens" made
 * verifiable rather than eyeballed.
 *
 * A chip's width is estimated from its label length rather than measured (RN
 * text metrics need a live renderer), so this is deliberately a conservative
 * ESTIMATE: real Text layout can come in a little narrower for common glyphs.
 * `charWidth`'s default is tuned to the 13pt/700 chip label this backs, wide
 * enough that a layout this predicts as fitting really does.
 */

export interface ChipRowInput {
  /** The card's inner width (px) the chip row has to lay out inside. */
  containerWidth: number;
  /** Dynamic Type scale, 1.0 .. MAX_FONT_SCALE (lib/theme/fontScale.ts caps
   *  it at 1.3). */
  fontScale: number;
  /** Chip labels, in layout order (used only for their length). */
  labels: string[];
  /** Horizontal gap between chips. Default 8. */
  gap?: number;
  /** Chip's own horizontal padding (both sides combined counted via *2 below
   *  is NOT assumed - pass the total, i.e. paddingHorizontal * 2). Default 12,
   *  meaning 12px on each side (24 total). */
  hPadding?: number;
  /** Average glyph width at 13pt/700, unscaled. Default 7.4. */
  charWidth?: number;
  /** Floor every chip's own width may not shrink below (HIT_TARGET). Default 44. */
  minTouch?: number;
}

export interface ChipRowResult {
  /** How many chips the FIRST row holds before wrapping (>= 1). */
  perRow: number;
  /** How many rows the whole set wraps onto. */
  rows: number;
  /** Each chip's estimated width, in label order. */
  chipWidths: number[];
  /** True when no single chip is wider than the container - the thing that
   *  would truncate/clip regardless of wrapping. */
  fits: boolean;
  /** How many px the widest chip exceeds the container by, 0 when it fits. */
  overflowPx: number;
}

const DEFAULT_GAP = 8;
const DEFAULT_H_PADDING = 12;
const DEFAULT_CHAR_WIDTH = 7.4;
const DEFAULT_MIN_TOUCH = 44;

function chipWidth(
  label: string,
  fontScale: number,
  hPadding: number,
  charWidth: number,
  minTouch: number
): number {
  const textWidth = label.length * charWidth * fontScale;
  return Math.max(minTouch, textWidth + 2 * hPadding);
}

/**
 * Lays chips out sequentially, left to right, wrapping to a new row whenever
 * the next chip (plus the gap before it) would not fit in what is left of the
 * current row - the same rule RN's `flexWrap: "wrap"` applies.
 */
export function chipRowLayout(input: ChipRowInput): ChipRowResult {
  const gap = input.gap ?? DEFAULT_GAP;
  const hPadding = input.hPadding ?? DEFAULT_H_PADDING;
  const charWidth = input.charWidth ?? DEFAULT_CHAR_WIDTH;
  const minTouch = input.minTouch ?? DEFAULT_MIN_TOUCH;
  const containerWidth = input.containerWidth;

  const chipWidths = input.labels.map((label) =>
    chipWidth(label, input.fontScale, hPadding, charWidth, minTouch)
  );

  let rows = chipWidths.length > 0 ? 1 : 0;
  let rowWidth = 0;
  let perRow = 0;
  let firstRowPerRow = 0;
  let firstRowDone = false;

  for (const w of chipWidths) {
    const withGap = rowWidth === 0 ? w : rowWidth + gap + w;
    if (rowWidth !== 0 && withGap > containerWidth) {
      // Wraps: start a fresh row with this chip.
      if (!firstRowDone) {
        firstRowPerRow = perRow;
        firstRowDone = true;
      }
      rows += 1;
      rowWidth = w;
      perRow = 1;
    } else {
      rowWidth = withGap;
      perRow += 1;
    }
  }
  if (!firstRowDone) firstRowPerRow = perRow;

  const widest = chipWidths.length > 0 ? Math.max(...chipWidths) : 0;
  const overflowPx = Math.max(0, widest - containerWidth);
  const fits = overflowPx === 0;

  return { perRow: firstRowPerRow, rows, chipWidths, fits, overflowPx };
}

/**
 * Whether the full-width primary CTA's own label survives at the given
 * container width and Dynamic Type scale, using the same conservative glyph
 * estimate as chipRowLayout (15pt/800, so a wider default charWidth). The
 * button itself never shrinks the text (no adjustsFontSizeToFit - see
 * CLAUDE.md) or truncates below one line, so this is what actually decides
 * whether the label reads in full.
 */
export function ctaFits(
  containerWidth: number,
  label: string,
  fontScale: number,
  opts?: { hPadding?: number; charWidth?: number }
): boolean {
  const hPadding = opts?.hPadding ?? 20;
  const charWidth = opts?.charWidth ?? 8.2;
  const textWidth = label.length * charWidth * fontScale;
  return textWidth + 2 * hPadding <= containerWidth;
}
