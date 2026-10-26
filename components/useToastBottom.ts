import { useEffect, useState } from "react";
import { Keyboard, Platform, useWindowDimensions } from "react-native";
import { usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { isTabRoute, toastBottomOffset } from "../lib/toastPosition";

/** Part of the window the iOS keyboard covers; always 0 on Android, which resizes the window instead. */
function useKeyboardCover(windowHeight: number): number {
  const [cover, setCover] = useState(0);
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    const frame = Keyboard.addListener("keyboardWillChangeFrame", (e) => {
      setCover(Math.max(0, Math.round(windowHeight - e.endCoordinates.screenY)));
    });
    const hide = Keyboard.addListener("keyboardWillHide", () => setCover(0));
    return () => {
      frame.remove();
      hide.remove();
    };
  }, [windowHeight]);
  return cover;
}

/** Distance of the toast from the window bottom: above the tab bar, the keyboard or the safe area. */
export function useToastBottom(): number {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const pathname = usePathname();
  const keyboardHeight = useKeyboardCover(height);
  return toastBottomOffset({
    platform: Platform.OS === "ios" ? "ios" : "android",
    insetBottom: insets.bottom,
    tabBarVisible: isTabRoute(pathname),
    compactTabBar: Platform.OS === "ios" && !Platform.isPad && width > height,
    keyboardHeight,
  });
}
