/**
 * Pure geometry for a keyboard-aware bottom sheet (components/SheetShell.tsx).
 * No react-native import here on purpose: this file has to be importable from
 * a plain Node/tsx test (scripts/sheetLayout.test.ts) without a RN runtime.
 *
 * The bug this fixes: a Modal that is bottom-aligned (`justifyContent:
 * "flex-end"`) and sized off the raw window height has no idea the keyboard
 * is up, so once a field inside it is focused the keyboard overlays the
 * bottom of the sheet - including whatever CTA sits there. Fixing that means
 * the sheet's available height has to be measured AGAINST the keyboard
 * (`windowHeight - keyboardHeight`), not against the raw window.
 */

export interface SheetLayoutInput {
  /** Dimensions/useWindowDimensions height. */
  windowHeight: number;
  /** 0 = keyboard closed. */
  keyboardHeight: number;
  /** Safe area bottom inset. */
  insetBottom: number;
  /** Safe area top inset (status bar, cutout). The sheet never grows into it.
   *  Default 0, which is the old behaviour. */
  insetTop?: number;
  /** Measured content height (e.g. ScrollView's onContentSizeChange). */
  contentHeight: number;
  /** Fraction of the available height the sheet may occupy. Default 0.9. */
  maxHeightRatio?: number;
  /** Floor the sheet may shrink to before we stop clamping. Default 220. */
  minVisible?: number;
}

export interface SheetLayoutResult {
  /** maxHeight for the sheet container. */
  sheetMaxHeight: number;
  /** Bottom padding for the content area. */
  paddingBottom: number;
  /** Whether the measured content no longer fits inside sheetMaxHeight. */
  scrolls: boolean;
  /** Whether the sheet's own action row can be inside the visible area
   *  (false only in the degenerate case where there is no visible area at
   *  all - a real overflow is handled by `scrolls`, not by hiding the
   *  action). */
  actionVisible: boolean;
}

const DEFAULT_MAX_HEIGHT_RATIO = 0.9;
const DEFAULT_MIN_VISIBLE = 220;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

export function sheetLayout(input: SheetLayoutInput): SheetLayoutResult {
  const maxHeightRatio = input.maxHeightRatio ?? DEFAULT_MAX_HEIGHT_RATIO;
  const minVisible = input.minVisible ?? DEFAULT_MIN_VISIBLE;

  // Never negative, even for a degenerate keyboardHeight > windowHeight.
  const available = Math.max(0, input.windowHeight - input.keyboardHeight - (input.insetTop ?? 0));

  const sheetMaxHeight =
    available <= minVisible ? available : clamp(available * maxHeightRatio, minVisible, available);

  // The keyboard already occupies the strip the safe-area inset would have
  // covered, so the two are never added together.
  const paddingBottom = input.keyboardHeight > 0 ? 16 : input.insetBottom + 16;

  const scrolls = input.contentHeight + paddingBottom > sheetMaxHeight;

  const actionVisible = sheetMaxHeight > 0 && available > 0;

  return { sheetMaxHeight, paddingBottom, scrolls, actionVisible };
}

/**
 * Regression oracle: what the OLD bottom-sheet math produced. The sheet sat
 * flush to the bottom, sized off the raw window (never the keyboard), so its
 * height was `min(contentHeight + insetBottom + 16, windowHeight * 0.9)` and
 * the keyboard simply covered whatever that height did not leave clear.
 * Returns the number of px of the sheet the keyboard used to cover.
 */
export function legacySheetBottomOverflowPx(input: SheetLayoutInput): number {
  const legacyHeight = Math.min(input.contentHeight + input.insetBottom + 16, input.windowHeight * 0.9);
  const clearAboveKeyboard = input.windowHeight - legacyHeight;
  return Math.max(0, input.keyboardHeight - clearAboveKeyboard);
}

/**
 * How far a bottom-aligned container still has to lift to clear the keyboard.
 * Measured against the real overlap (container bottom vs keyboard top, both in
 * window coordinates) instead of assuming the window was or was not resized:
 * Android with adjustResize shrinks the window itself (overlap 0), while an
 * edge-to-edge window does not resize at all and the keyboard simply covers
 * the bottom of the sheet, Save included.
 */
export function keyboardOverlapPx(input: { containerBottom: number; keyboardTop: number }): number {
  const overlap = input.containerBottom - input.keyboardTop;
  return Number.isFinite(overlap) && overlap > 0 ? Math.round(overlap) : 0;
}

/**
 * Rendered height of a bottom sheet. `fit` (SheetShell's default) hugs the
 * content: title row + measured content + footer + bottom padding, capped at
 * sheetMaxHeight, so a two-button confirm opens as a short card. `fit: false`
 * is the opt-out for a sheet that should always take the full allowance
 * (a picker whose list length changes while it is open).
 */
export function sheetFitHeight(
  input: SheetLayoutInput & { chromeHeight?: number; fit?: boolean }
): number {
  const { sheetMaxHeight, paddingBottom } = sheetLayout(input);
  if (input.fit === false) return sheetMaxHeight;
  const chrome = input.chromeHeight ?? 0;
  return Math.min(sheetMaxHeight, Math.max(0, input.contentHeight + chrome + paddingBottom));
}
