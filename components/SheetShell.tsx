import React, { useCallback, useMemo, useState } from "react";
import {
  Animated,
  InputAccessoryView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  type TextInputProps,
} from "react-native";
import { OverlayModal as Modal } from "./OverlayModal";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { sheetFrame, type SheetLayoutResult } from "../lib/sheetLayout";
import { useSheetKeyboard } from "../lib/useSheetKeyboard";
import { keyboardAwareScrollProps } from "../lib/keyboard";
import { THEME, glow } from "../lib/theme/tokens";
import { useLayout } from "../lib/useLayout";
import { sheetBoxStyle } from "../lib/tabletLayout";

export const SCRIM = "rgba(0,0,0,0.72)"; // theme-ok

/**
 * Shared shell for every bottom-aligned Modal (`justifyContent: "flex-end"`).
 * Fixes the class of bug the old post-meal "I started late" sheet had (since
 * folded into components/PostMealDurationSheet.tsx): a sheet sized off the raw
 * window, with no keyboard avoidance, so a focused field near the bottom (and
 * the CTA below it) end up hidden behind the keyboard.
 *
 * Deliberately NOT KeyboardAvoidingView: it would wrap the title row too, and
 * stacking it on a window the platform already resized double-shrinks. The
 * host (lib/useSheetKeyboard.ts) lifts the whole sheet by the MEASURED overlap
 * with the keyboard, the sheet's maxHeight shrinks by that same amount (and by
 * insets.top once, lib/sheetLayout.ts sheetFrame), and only the body below the
 * title row scrolls. Title and close button therefore never move.
 */

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface SheetShellProps {
  visible: boolean;
  onClose: () => void;
  /** Title row; when omitted, no title/close row is drawn (the caller owns
   *  its own way to close). The backdrop is hidden from the accessibility
   *  tree, so screen readers close via the title row's X or the escape gesture. */
  title?: string;
  /** i18n-sourced (t("common.close")); labels the title row's close button. */
  closeLabel: string;
  maxHeightRatio?: number;
  /** Default true: the sheet hugs its content (maxHeight only caps it), so a
   *  confirm or a short pick opens as a short card. False pins it at the full
   *  allowance (lib/sheetLayout.ts sheetFitHeight) for content that grows. */
  fit?: boolean;
  children: React.ReactNode;
  /** Pinned to the sheet's bottom, outside the scrolling content. */
  footer?: React.ReactNode;
  testID?: string;
  /** Fires once the Modal is really on screen (RN Modal onShow). */
  onShown?: () => void;
}

export function SheetShell({
  visible,
  onClose,
  title,
  closeLabel,
  maxHeightRatio,
  fit = true,
  children,
  footer,
  testID,
  onShown,
}: SheetShellProps): React.ReactElement {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { isWide, width: layoutWidth } = useLayout();
  const [contentHeight, setContentHeight] = useState(0);

  // lift animates the host's paddingBottom so the sheet never renders under
  // the keyboard; it is the MEASURED overlap, not the keyboard's own height.
  const { hostRef, onHostLayout, hostHeight, liftDomain, liftAnim, keyboardOpen } = useSheetKeyboard(visible);

  const closedLayout = useMemo<SheetLayoutResult>(
    () =>
      sheetFrame({
        hostHeight,
        windowHeight,
        lift: 0,
        keyboardOpen: keyboardOpen && liftDomain === 0,
        insetBottom: insets.bottom,
        insetTop: insets.top,
        contentHeight,
        maxHeightRatio,
      }),
    [hostHeight, windowHeight, keyboardOpen, liftDomain, insets.bottom, insets.top, contentHeight, maxHeightRatio],
  );
  const openLayout = useMemo<SheetLayoutResult>(
    () =>
      sheetFrame({
        hostHeight,
        windowHeight,
        lift: liftDomain,
        keyboardOpen: true,
        insetBottom: insets.bottom,
        insetTop: insets.top,
        contentHeight,
        maxHeightRatio,
      }),
    [hostHeight, windowHeight, liftDomain, insets.bottom, insets.top, contentHeight, maxHeightRatio],
  );

  const sheetMaxHeightAnim =
    liftDomain > 0
      ? liftAnim.interpolate({
          inputRange: [0, liftDomain],
          outputRange: [closedLayout.sheetMaxHeight, openLayout.sheetMaxHeight],
          extrapolate: "clamp",
        })
      : closedLayout.sheetMaxHeight;
  const contentPaddingBottomAnim =
    liftDomain > 0
      ? liftAnim.interpolate({
          inputRange: [0, liftDomain],
          outputRange: [closedLayout.paddingBottom, openLayout.paddingBottom],
          extrapolate: "clamp",
        })
      : closedLayout.paddingBottom;

  const onContentSizeChange = useCallback((_w: number, h: number) => setContentHeight(h), []);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} onShow={onShown}>
      <View ref={hostRef} collapsable={false} onLayout={onHostLayout} style={{ flex: 1 }}>
      <AnimatedPressable
        style={{
          flex: 1,
          justifyContent: "flex-end",
          backgroundColor: SCRIM,
          paddingBottom: liftAnim,
        }}
        onPress={onClose}
        accessible={false}
        focusable={false}
        accessibilityViewIsModal
        onAccessibilityEscape={onClose}
      >
        <AnimatedPressable
          testID={testID}
          onPress={(e) => e.stopPropagation()}
          accessible={false}
          focusable={false}
          importantForAccessibility="auto"
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
            fit ? { maxHeight: sheetMaxHeightAnim } : { height: sheetMaxHeightAnim },
            sheetBoxStyle(layoutWidth, isWide),
          ]}
        >
          <View className="items-center mb-1.5">
            <View style={{ width: 38, height: 4, borderRadius: 9, backgroundColor: THEME.border }} />
          </View>

          {title ? (
            <View className="flex-row items-center justify-between mb-1">
              <Text
                numberOfLines={2}
                style={{ color: THEME.text, fontSize: 17, fontWeight: "800", flexShrink: 1 }}
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
                <Ionicons name="close" size={22} color={THEME.textMuted} />
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
      </View>
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
          backgroundColor: THEME.surfaceRaised,
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
