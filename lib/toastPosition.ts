/**
 * Where the toast sits, as a distance from the bottom of the window. Pure: the
 * host feeds it the measured values. The toast lives at the bottom so it never
 * covers the top-bar buttons (profile, help, SOS) that a stray tap would hit
 * while the Undo window is open.
 */

/** Tab bar content heights of React Navigation's bottom tabs (excluding the home-indicator inset). */
export const TAB_BAR_HEIGHT = 49;
export const TAB_BAR_HEIGHT_COMPACT = 32;
/** Space between the toast and whatever it rests on. */
export const TOAST_GAP = 12;

const TAB_ROUTES: readonly string[] = ["/", "/food", "/injection", "/settings"];

/** True on the four routes that render the bottom tab bar (expo-router strips the (tabs) group). */
export function isTabRoute(pathname: string): boolean {
  const clean = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return TAB_ROUTES.includes(clean);
}

/** The bar uses its short landscape form on iPhone only. */
export function tabBarHeightFor(opts: { insetBottom: number; compact: boolean }): number {
  return (opts.compact ? TAB_BAR_HEIGHT_COMPACT : TAB_BAR_HEIGHT) + opts.insetBottom;
}

export function toastBottomOffset(opts: {
  platform: "ios" | "android";
  insetBottom: number;
  tabBarVisible: boolean;
  compactTabBar: boolean;
  /** Part of the window the keyboard covers, 0 when closed or floating. */
  keyboardHeight: number;
}): number {
  // iOS keeps the window full height under the keyboard, so the toast is lifted
  // by the keyboard (which also hides the tab bar). Android resizes the window
  // (adjustResize): the keyboard is already outside the overlay.
  if (opts.platform === "ios" && opts.keyboardHeight > 0) {
    return opts.keyboardHeight + TOAST_GAP;
  }
  if (opts.tabBarVisible) {
    return tabBarHeightFor({ insetBottom: opts.insetBottom, compact: opts.compactTabBar }) + TOAST_GAP;
  }
  return opts.insetBottom + TOAST_GAP;
}
