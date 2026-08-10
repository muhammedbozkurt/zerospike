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
  /** Style for a screen's main content column: centered with a max width on
   *  wide screens, untouched (undefined) on phones so narrow renders stay
   *  byte-identical to the shipped layouts. */
  contentColumn: ViewStyle | undefined;
};

export function useLayout(): AppLayout {
  const { width, height } = useWindowDimensions();
  const isWide = Math.min(width, height) >= WIDE_MIN_DP;
  return {
    width,
    height,
    isWide,
    contentColumn: isWide
      ? { width: "100%", maxWidth: CONTENT_MAX_WIDTH, alignSelf: "center" }
      : undefined,
  };
}
