import { Platform, type ScrollViewProps } from "react-native";

/**
 * Keyboard behaviour for a form whose action row scrolls with its content.
 *
 * Why not KeyboardAvoidingView: `behavior="padding"` shrinks the container, but
 * nothing then scrolls the focused input into the smaller viewport, so a field
 * near the bottom of a long form stays under the keyboard. That was the bug.
 *
 * iOS: `automaticallyAdjustKeyboardInsets` lets UIKit both inset the content
 * and scroll the first responder into view. Combining it with a
 * KeyboardAvoidingView would compensate twice, so these screens use one or the
 * other, never both.
 *
 * Android: the activity is `windowSoftInputMode="adjustResize"`, so the window
 * shrinks and RN's ScrollView scrolls the focused child into view on its own.
 * `automaticallyAdjustKeyboardInsets` is an iOS prop and is ignored here. A
 * KeyboardAvoidingView with `behavior="height"` would shrink a second time.
 *
 * `keyboardShouldPersistTaps` keeps the first tap on a button working while the
 * keyboard is up, instead of spending it on dismissing the keyboard.
 *
 * Screens whose action row is pinned OUTSIDE the scroll container (onboarding)
 * or that have no scroll container at all (the glucose sheet, the profile
 * dialog) still need a KeyboardAvoidingView: there is nothing to scroll.
 */
export const keyboardAwareScrollProps: Pick<
  ScrollViewProps,
  | "keyboardShouldPersistTaps"
  | "automaticallyAdjustKeyboardInsets"
  | "keyboardDismissMode"
> = {
  keyboardShouldPersistTaps: "handled",
  automaticallyAdjustKeyboardInsets: true,
  // "interactive" (drag the keyboard down) is iOS-only; Android gets on-drag.
  keyboardDismissMode: Platform.OS === "ios" ? "interactive" : "on-drag",
};
