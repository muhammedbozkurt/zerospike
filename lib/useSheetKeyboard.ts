import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Easing, Keyboard, Platform, type KeyboardEvent, type LayoutChangeEvent, type View } from "react-native";

import { measureHostInWindow } from "./measureHost";
import { keyboardOverlapPx } from "./sheetLayout";

const ANDROID_ANIM_MS = 180;
const IOS_ANIM_FALLBACK_MS = 250;

/**
 * Keyboard state for a bottom sheet whose host is a full-screen box inside a
 * Modal. The lift is the MEASURED overlap between the host's bottom and the
 * keyboard's top, so it is right whether the platform shrank the window
 * (overlap 0) or left it alone (edge-to-edge, keyboard simply covers it) and
 * is never added on top of an avoiding view. Attach `hostRef` and `onHostLayout`
 * to the host and give it `paddingBottom: liftAnim`; no KeyboardAvoidingView.
 */
export function useSheetKeyboard(visible: boolean) {
  const hostRef = useRef<View>(null);
  const liftAnim = useRef(new Animated.Value(0)).current;
  const [lift, setLift] = useState(0);
  // Last non-zero lift: lets a closing animation interpolate against the
  // height it is animating away from.
  const [liftDomain, setLiftDomain] = useState(0);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [hostHeight, setHostHeight] = useState(0);
  const keyboardTopRef = useRef<number | null>(null);
  const fallbackHeightRef = useRef(0);

  const apply = useCallback(
    (px: number, duration: number) => {
      setLift(px);
      if (px > 0) setLiftDomain(px);
      Animated.timing(liftAnim, {
        toValue: px,
        duration,
        easing: Easing.out(Easing.ease),
        useNativeDriver: false,
      }).start();
    },
    [liftAnim],
  );

  const recompute = useCallback(
    (duration: number) => {
      const top = keyboardTopRef.current;
      if (top === null) {
        if (fallbackHeightRef.current > 0) apply(fallbackHeightRef.current, duration);
        else apply(0, duration);
        return;
      }
      const requested = measureHostInWindow(hostRef, ({ y, height }) => {
        apply(keyboardOverlapPx({ containerBottom: y + height, keyboardTop: top }), duration);
      });
      if (!requested) apply(fallbackHeightRef.current, duration);
    },
    [apply],
  );

  useEffect(() => {
    if (!visible) {
      keyboardTopRef.current = null;
      fallbackHeightRef.current = 0;
      liftAnim.setValue(0);
      setLift(0);
      setLiftDomain(0);
      setKeyboardOpen(false);
      return;
    }
    const ios = Platform.OS === "ios";
    const subShow = Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", (e: KeyboardEvent) => {
      const h = e?.endCoordinates?.height ?? 0;
      if (h <= 0) return;
      const screenY = e?.endCoordinates?.screenY ?? 0;
      keyboardTopRef.current = screenY > 0 ? screenY : null;
      fallbackHeightRef.current = h;
      setKeyboardOpen(true);
      const duration = ios ? e.duration || IOS_ANIM_FALLBACK_MS : ANDROID_ANIM_MS;
      if (ios) recompute(duration);
      else requestAnimationFrame(() => recompute(duration));
    });
    const subHide = Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", (e: KeyboardEvent) => {
      keyboardTopRef.current = null;
      fallbackHeightRef.current = 0;
      setKeyboardOpen(false);
      apply(0, ios ? e?.duration || IOS_ANIM_FALLBACK_MS : ANDROID_ANIM_MS);
    });
    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, [visible, liftAnim, apply, recompute]);

  const onHostLayout = useCallback(
    (e: LayoutChangeEvent) => {
      setHostHeight(e.nativeEvent.layout.height);
      // A platform resize lands after keyboardDidShow: re-measure against it.
      if (keyboardTopRef.current !== null) recompute(0);
    },
    [recompute],
  );

  return { hostRef, onHostLayout, hostHeight, lift, liftDomain, liftAnim, keyboardOpen };
}
