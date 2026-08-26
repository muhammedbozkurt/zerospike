import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  InputAccessoryView,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  type KeyboardEvent as RNKeyboardEvent,
  type TextInputProps,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { sheetLayout, type SheetLayoutResult } from "../lib/sheetLayout";
import { keyboardAwareScrollProps } from "../lib/keyboard";
import { THEME, glow } from "../lib/theme/tokens";

/**
 * Shared shell for every bottom-aligned Modal (`justifyContent: "flex-end"`).
 * Fixes the class of bug the old post-meal "I started late" sheet had (since
 * folded into components/PostMealDurationSheet.tsx): a sheet sized off the raw
 * window, with no keyboard avoidance, so a focused field near the bottom (and
 * the CTA below it) end up hidden behind the keyboard.
 *
 * Deliberately NOT KeyboardAvoidingView: on Android the activity is already
 * `adjustResize`, so stacking a KeyboardAvoidingView on top double-shrinks;
 * on iOS its own timing/heuristics are not the same measured height this
 * shell needs to hand to lib/sheetLayout.ts. Both platforms instead measure
 * the keyboard themselves and animate two things: how much the whole sheet
 * lifts off the screen bottom (by the keyboard's own height, mirroring what
 * KeyboardAvoidingView's "padding" behavior would have done), and the
 * sheet's own maxHeight/content padding (from sheetLayout()).
 */

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface SheetShellProps {
  visible: boolean;
  onClose: () => void;
  /** Title row; when omitted, no title/close row is drawn (the caller owns
   *  its own way to close, e.g. a backdrop tap or its own header). */
  title?: string;
  /** i18n-sourced (t("common.close")); also used as the backdrop's a11y label. */
  closeLabel: string;
  maxHeightRatio?: number;
  children: React.ReactNode;
  /** Pinned to the sheet's bottom, outside the scrolling content. */
  footer?: React.ReactNode;
  testID?: string;
}

const ANDROID_KEYBOARD_ANIM_MS = 180;
const IOS_KEYBOARD_ANIM_FALLBACK_MS = 250;

export function SheetShell({
  visible,
  onClose,
  title,
  closeLabel,
  maxHeightRatio,
  children,
  footer,
  testID,
}: SheetShellProps): React.ReactElement {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [contentHeight, setContentHeight] = useState(0);

  // Raw measured keyboard height, animated. Doubles as the outer backdrop's
  // lift (paddingBottom) so the sheet itself never renders under the
  // keyboard's strip, whatever platform draws it.
  const keyboardAnim = useRef(new Animated.Value(0)).current;
  // The domain used to interpolate keyboardAnim into sheetLayout()'s output:
  // the last non-zero keyboard height seen, so a CLOSING animation (target
  // 0) still interpolates against the height it is animating away from.
  const [keyboardDomain, setKeyboardDomain] = useState(0);

  useEffect(() => {
    if (!visible) {
      keyboardAnim.setValue(0);
      setKeyboardDomain(0);
      return;
    }
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const animateTo = (toValue: number, duration: number) => {
      Animated.timing(keyboardAnim, {
        toValue,
        duration,
        easing: Easing.out(Easing.ease),
        useNativeDriver: false,
      }).start();
    };

    const onShow = (e: RNKeyboardEvent) => {
      const h = e?.endCoordinates?.height ?? 0;
      if (h <= 0) return;
      setKeyboardDomain(h);
      animateTo(h, Platform.OS === "ios" ? e.duration || IOS_KEYBOARD_ANIM_FALLBACK_MS : ANDROID_KEYBOARD_ANIM_MS);
    };
    const onHide = (e: RNKeyboardEvent) => {
      animateTo(0, Platform.OS === "ios" ? e?.duration || IOS_KEYBOARD_ANIM_FALLBACK_MS : ANDROID_KEYBOARD_ANIM_MS);
    };

    const subShow = Keyboard.addListener(showEvent, onShow);
    const subHide = Keyboard.addListener(hideEvent, onHide);
    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, [visible, keyboardAnim]);

  const closedLayout = useMemo<SheetLayoutResult>(
    () =>
      sheetLayout({
        windowHeight,
        keyboardHeight: 0,
        insetBottom: insets.bottom,
        contentHeight,
        maxHeightRatio,
      }),
    [windowHeight, insets.bottom, contentHeight, maxHeightRatio],
  );
  const openLayout = useMemo<SheetLayoutResult>(
    () =>
      sheetLayout({
        windowHeight,
        keyboardHeight: keyboardDomain,
        insetBottom: insets.bottom,
        contentHeight,
        maxHeightRatio,
      }),
    [windowHeight, insets.bottom, contentHeight, maxHeightRatio, keyboardDomain],
  );

  const sheetMaxHeightAnim =
    keyboardDomain > 0
      ? keyboardAnim.interpolate({
          inputRange: [0, keyboardDomain],
          outputRange: [closedLayout.sheetMaxHeight, openLayout.sheetMaxHeight],
          extrapolate: "clamp",
        })
      : closedLayout.sheetMaxHeight;
  const contentPaddingBottomAnim =
    keyboardDomain > 0
      ? keyboardAnim.interpolate({
          inputRange: [0, keyboardDomain],
          outputRange: [closedLayout.paddingBottom, openLayout.paddingBottom],
          extrapolate: "clamp",
        })
      : closedLayout.paddingBottom;

  const onContentSizeChange = useCallback((_w: number, h: number) => setContentHeight(h), []);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <AnimatedPressable
        style={{
          flex: 1,
          justifyContent: "flex-end",
          backgroundColor: "rgba(0,0,0,0.72)",
          paddingBottom: keyboardAnim,
        }}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={closeLabel}
      >
        <AnimatedPressable
          testID={testID}
          onPress={(e) => e.stopPropagation()}
          style={[
            {
              borderTopLeftRadius: 26,
              borderTopRightRadius: 26,
              borderTopWidth: 1,
              borderLeftWidth: 1,
              borderRightWidth: 1,
              borderColor: THEME.border,
              backgroundColor: THEME.bg.g1,
              paddingHorizontal: 18,
              paddingTop: 8,
            },
            glow(THEME.accent, 30, 0.3),
            { maxHeight: sheetMaxHeightAnim },
          ]}
        >
          <View className="items-center mb-1.5">
            <View style={{ width: 38, height: 4, borderRadius: 9, backgroundColor: THEME.border }} />
          </View>

          {title ? (
            <View className="flex-row items-center justify-between mb-1">
              <Text
                numberOfLines={2}
                style={{ color: THEME.ink, fontSize: 17, fontWeight: "800", flexShrink: 1 }}
              >
                {title}
              </Text>
              <Pressable
                onPress={onClose}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel={closeLabel}
                className="p-1"
              >
                <Ionicons name="close" size={22} color={THEME.muted} />
              </Pressable>
            </View>
          ) : null}

          <ScrollView
            {...keyboardAwareScrollProps}
            // This shell measures and drives the keyboard itself; letting
            // iOS also auto-inset/scroll the responder would compensate
            // twice.
            automaticallyAdjustKeyboardInsets={false}
            style={{ flexShrink: 1 }}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={onContentSizeChange}
          >
            {children}
          </ScrollView>

          {footer ? <View style={{ paddingTop: 10 }}>{footer}</View> : null}

          <Animated.View style={{ height: contentPaddingBottomAnim }} />
        </AnimatedPressable>
      </AnimatedPressable>
    </Modal>
  );
}

/** iOS number pads have no "done" key of their own; Android's does. */
export const SHEET_NUMBER_INPUT_PROPS: Pick<TextInputProps, "keyboardType" | "returnKeyType" | "inputMode"> = {
  keyboardType: Platform.OS === "ios" ? "number-pad" : "numeric",
  returnKeyType: "done",
  inputMode: "numeric",
};

/**
 * iOS-only "Done" bar above a number-pad keyboard (Android already has a
 * return key for this, via SHEET_NUMBER_INPUT_PROPS.returnKeyType). Pair
 * with `inputAccessoryViewID={nativeID}` on the TextInput.
 */
export function KeyboardDoneBar({
  nativeID,
  label,
  onDone,
}: {
  nativeID: string;
  label: string;
  onDone: () => void;
}): React.ReactElement | null {
  if (Platform.OS !== "ios") return null;
  return (
    <InputAccessoryView nativeID={nativeID}>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "flex-end",
          backgroundColor: THEME.sheet,
          paddingHorizontal: 14,
          paddingVertical: 8,
          borderTopWidth: 1,
          borderTopColor: THEME.border,
        }}
      >
        <Pressable onPress={onDone} hitSlop={10} accessibilityRole="button" accessibilityLabel={label}>
          <Text style={{ color: THEME.accent, fontSize: 16, fontWeight: "700" }}>{label}</Text>
        </Pressable>
      </View>
    </InputAccessoryView>
  );
}
