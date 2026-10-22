import type { ViewStyle } from "react-native";
import { useWindowDimensions } from "react-native";

import { TWO_COL_MIN_DP, WIDE_MIN_DP, isDialogSheet, isTwoColumn, isWideScreen } from "./tabletLayout";

export { WIDE_MIN_DP, TWO_COL_MIN_DP };

/** Cap for a single reading/content column on wide screens. */
export const CONTENT_MAX_WIDTH = 680;

export type AppLayout = {
  width: number;
  height: number;
  isWide: boolean;
  /** isWide AND window width >= TWO_COL_MIN_DP. */
  isTwoCol: boolean;
  /** Tablet sheets are centred dialogs here (lib/tabletLayout.ts isDialogSheet). */
  isDialog: boolean;
  /**
   * Horizontal padding that centers a max-width content column on wide
   * screens and collapses to the caller's own `base` inset on phones, so a
   * screen's existing horizontal padding (paddingHorizontal / padding) can
   * be replaced by this alone instead of composed with it.
   *
   * PADDING, not margin: Fabric on RN 0.86 drops margins set on
   * ScrollView/FlatList contentContainerStyle while RTL is active (measured
   * on iPad: a 680-wide + symmetric-margin column pinned to the physical
   * right edge, 736px left / 32px right). Padding on the same containers is
   * honored in both directions, so centering is done with padding only.
   * Left and right are always set to the SAME number, so RTL's left/right
   * swap (if any) is a no-op by construction.
   *
   * Always returns a concrete style (never undefined) so it is safe to
   * spread or place anywhere in a style array without an `?? {}` guard.
   */
  columnPad: (base?: number) => ViewStyle;
};

export function useLayout(): AppLayout {
  const { width, height } = useWindowDimensions();
  const isWide = isWideScreen(width, height);
  // Gap that centers a CONTENT_MAX_WIDTH column inside the full window
  // width; independent of `base` so composing base with it never changes
  // where the column sits, only how wide it is.
  const gap = isWide ? Math.max(0, Math.floor((width - CONTENT_MAX_WIDTH) / 2)) : 0;
  const columnPad = (base = 0): ViewStyle => ({
    paddingLeft: base + gap,
    paddingRight: base + gap,
  });
  const isTwoCol = isTwoColumn(width, height);
  const isDialog = isWide && isDialogSheet(width, height);
  return { width, height, isWide, isTwoCol, isDialog, columnPad };
}
