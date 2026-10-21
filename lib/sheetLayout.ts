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
  /** Whether a keyboard is up at all. Defaults to keyboardHeight > 0. It is
   *  separate because an Android window that adjustResize already shrank has a
   *  keyboard up and a lift of 0: the keyboard still covers the strip the
   *  bottom inset would have padded, so the inset must not be added again. */
  keyboardOpen?: boolean;
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
  const keyboardOpen = input.keyboardOpen ?? input.keyboardHeight > 0;
  const paddingBottom = keyboardOpen ? 16 : input.insetBottom + 16;

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

export interface SheetFrameInput {
  /** Measured height of the full-size host the sheet is anchored to (onLayout).
   *  0 until measured, then windowHeight is used. */
  hostHeight: number;
  windowHeight: number;
  /** px the host lifts the sheet off its bottom edge (keyboardOverlapPx). */
  lift: number;
  keyboardOpen: boolean;
  insetTop: number;
  insetBottom: number;
  contentHeight: number;
  maxHeightRatio?: number;
}

export interface SheetFrame extends SheetLayoutResult {
  /** Distance from the host's top edge to the sheet's top edge when the sheet
   *  takes its full allowance. The title row sits just under it, so this must
   *  stay >= insetTop or the title and the close button slide under the status
   *  bar. */
  sheetTop: number;
}

/**
 * The one place the status-bar inset and the keyboard are counted. The host is
 * the full-screen box inside the Modal, the sheet sits at its bottom edge, and:
 *  - the keyboard is subtracted ONCE, as `lift` (the measured overlap, so a
 *    window the platform already resized contributes 0 instead of a second
 *    full keyboard height);
 *  - insetTop is subtracted ONCE, from the host height, never again inside the
 *    sheet's own padding.
 */
export function sheetFrame(input: SheetFrameInput): SheetFrame {
  const host = input.hostHeight > 0 ? input.hostHeight : input.windowHeight;
  const layout = sheetLayout({
    windowHeight: host,
    keyboardHeight: input.lift,
    keyboardOpen: input.keyboardOpen,
    insetBottom: input.insetBottom,
    insetTop: input.insetTop,
    contentHeight: input.contentHeight,
    maxHeightRatio: input.maxHeightRatio,
  });
  return { ...layout, sheetTop: host - input.lift - layout.sheetMaxHeight };
}
