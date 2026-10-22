/**
 * Pure layout decisions for Dynamic Type / Android font scale. No
 * react-native import, so scripts/fontScaleLayout.test.ts runs in plain Node.
 *
 * Contract: at fontScale 1.0 every helper returns the value the layout had
 * before large-text support existed (store screenshots are taken at 1.0).
 */

/** App-wide cap on the OS text-size multiplier (Apple Larger Text asks for at
 *  least 200%). iOS AX5 would reach ~3.1 and Android system settings stop at
 *  2.0; the cap is a single number so it can be raised after simulator QA. */
export const MAX_FONT_SCALE = 2.0;

/** Caps for critical geometric elements that must not follow the full app cap.
 *  A call site passes one of these as maxFontSizeMultiplier. */
export const FONT_CAP = {
  /** Bottom tab labels, small pills and status badges (fixed-size containers). */
  badge: 1.35,
  /** Numbers drawn inside rings, donuts and the injection map. */
  ringNumber: 1.5,
  /** Chips and segmented pills: wrap-capable but their row must stay compact. */
  chip: 1.6,
  /** Caption under a ring number (e.g. "5 Messungen"): must stay inside the ring. */
  ringCaption: 1.2,
} as const;

/** Above this scale side-by-side label + control pairs stack vertically. */
export const STACK_AT_SCALE = 1.5;

/** Above this scale grids drop to a single column. */
export const SINGLE_COLUMN_AT_SCALE = 1.5;

/** The scale the UI actually renders at: the OS value clamped to [1, MAX]. */
export function effectiveFontScale(osScale: number, cap: number = MAX_FONT_SCALE): number {
  if (!Number.isFinite(osScale) || osScale < 1) return 1;
  return Math.min(osScale, cap);
}

/** True once the text is large enough that layouts need to adapt. */
export function isLargeText(osScale: number): boolean {
  return effectiveFontScale(osScale) > STACK_AT_SCALE;
}

/** Direction for a label + control pair: row at normal sizes, column when large. */
export function rowDirectionFor(osScale: number): "row" | "column" {
  return effectiveFontScale(osScale) > STACK_AT_SCALE ? "column" : "row";
}

/** Same as rowDirectionFor but honours RTL: row-reverse stays row-reverse. */
export function pairDirectionFor(osScale: number, rtl = false): "row" | "row-reverse" | "column" {
  if (effectiveFontScale(osScale) > STACK_AT_SCALE) return "column";
  return rtl ? "row-reverse" : "row";
}

/** Number of grid columns: `columns` at normal sizes, 1 when large. */
export function gridColumnsFor(osScale: number, columns: number): number {
  return effectiveFontScale(osScale) > SINGLE_COLUMN_AT_SCALE ? 1 : columns;
}

/** Height floor that grows with the text. Exactly `base` at scale 1, so a
 *  fixed `height: base` becomes `minHeight: scaledMinHeight(base, scale)`
 *  without moving a pixel at the default size. */
export function scaledMinHeight(base: number, osScale: number, cap: number = MAX_FONT_SCALE): number {
  return Math.round(base * effectiveFontScale(osScale, cap));
}

/** A size that should follow the text (icon plates next to text, line boxes). */
export function scaledSize(base: number, osScale: number, cap: number = MAX_FONT_SCALE): number {
  return Math.round(base * effectiveFontScale(osScale, cap));
}

/** numberOfLines for body copy: unlimited (undefined) once the text is large,
 *  the original limit otherwise. */
export function linesFor(osScale: number, normalLines: number): number | undefined {
  return effectiveFontScale(osScale) > STACK_AT_SCALE ? undefined : normalLines;
}

/** Text props that force a single/limited line or shrink-to-fit. */
export interface TextClampProps {
  numberOfLines?: number;
  adjustsFontSizeToFit?: boolean;
  minimumFontScale?: number;
  maxFontSizeMultiplier?: number | null;
}

/**
 * At large text a line limit or shrink-to-fit defeats the setting (the user
 * asked for bigger glyphs; ellipsis hides content and iOS/Android shrink it
 * back, Android sometimes clipping silently). So above STACK_AT_SCALE the
 * limit is dropped and the text wraps. A call site that passes its own
 * maxFontSizeMultiplier has declared fixed geometry (badge, ring number,
 * pill) and keeps its limits. Returns `props` itself when nothing changes, so
 * at the default size the wrapper allocates nothing.
 */
export function relaxTextProps<T extends TextClampProps>(props: T, osScale: number): T {
  if (effectiveFontScale(osScale) <= STACK_AT_SCALE) return props;
  if (props.maxFontSizeMultiplier != null) return props;
  if (
    props.numberOfLines === undefined &&
    props.adjustsFontSizeToFit === undefined &&
    props.minimumFontScale === undefined
  ) {
    return props;
  }
  return { ...props, numberOfLines: undefined, adjustsFontSizeToFit: undefined, minimumFontScale: undefined };
}

/**
 * Max height of an in-tree overlay sheet (not an RN Modal). `legacy` is the
 * window-based cap the sheet always had, so whenever the measured host is at
 * least as tall as that cap allows (every phone at the default text size) the
 * result is unchanged. A host shorter than the window (tab bar grown by large
 * text) lowers the cap so the sheet's top edge stays under the status bar:
 * the inset is counted once, together with the keyboard.
 */
export function overlaySheetMaxHeight(input: {
  windowHeight: number;
  hostHeight: number;
  keyboardH: number;
  insetTop: number;
}): number {
  const { windowHeight, hostHeight, keyboardH, insetTop } = input;
  const legacy = Math.min(windowHeight * 0.92, windowHeight - keyboardH - insetTop - 8);
  if (!(hostHeight > 0)) return legacy;
  return Math.max(0, Math.min(legacy, hostHeight - keyboardH - insetTop - 8));
}

/** Style merged into a centred header title that sits between a leading plate
 *  and a trailing spacer. flexShrink lets the wrapped title give way instead
 *  of running off the right edge. Empty at the default size (no pixel moves). */
export function calcHeaderTitleStyle(osScale: number): { flexShrink?: number; textAlign?: "center"; marginHorizontal?: number } {
  if (effectiveFontScale(osScale) <= STACK_AT_SCALE) return {};
  return { flexShrink: 1, textAlign: "center", marginHorizontal: 8 };
}

/** Extra px a one-line control of `linePx` gains at this scale (0 at 1.0): the
 *  floating "add record" button grows with its label, and the scroll content
 *  must clear the taller bar. */
export function ctaLineExtra(osScale: number, linePx: number = 24): number {
  return scaledSize(linePx, osScale) - linePx;
}

/** The scroll-hint chevron overlays content, so it is dropped once large text
 *  makes every screen overflow and the overlay would cover text. */
export function scrollHintAllowed(osScale: number): boolean {
  return effectiveFontScale(osScale) <= STACK_AT_SCALE;
}
