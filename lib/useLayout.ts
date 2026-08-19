import type { ViewStyle } from "react-native";
import { useWindowDimensions } from "react-native";

/** Tablet threshold: shortest side >= 600dp counts as a wide screen (phone
 *  landscape stays "narrow" on purpose; the stretched-phone problem this fixes
 *  only exists on tablets and iPads). */
export const WIDE_MIN_DP = 600;

/** Cap for a single reading/content column on wide screens. */
export const CONTENT_MAX_WIDTH = 680;

export type AppLayout = {
  width: number;
  height: number;
  isWide: boolean;
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
  const isWide = Math.min(width, height) >= WIDE_MIN_DP;
  // Gap that centers a CONTENT_MAX_WIDTH column inside the full window
  // width; independent of `base` so composing base with it never changes
  // where the column sits, only how wide it is.
  const gap = isWide ? Math.max(0, Math.floor((width - CONTENT_MAX_WIDTH) / 2)) : 0;
  const columnPad = (base = 0): ViewStyle => ({
    paddingLeft: base + gap,
    paddingRight: base + gap,
  });
  return { width, height, isWide, columnPad };
}
