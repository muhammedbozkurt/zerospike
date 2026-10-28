import React, { useRef } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { AppBackground } from "./rich";
import { withAlpha } from "./rich/GlassCard";
import { ScreenHeader } from "./ScreenHeader";
import { GLUCOSE_RICH, HIT_TARGET, SPACE, THEME } from "../lib/theme/tokens";
import { RIPPLE_ALPHA } from "../lib/theme/uiPrimitives";
import { keyboardAwareScrollProps } from "../lib/keyboard";
import { useLayout } from "../lib/useLayout";
import { useScrollHint } from "../lib/useScrollHint";
import { hintBottomOffset } from "../lib/scrollHint";
import { ScrollHint } from "./ScrollHint";
import { useScrollToTarget } from "./useScrollToTarget";

/** Settings reading column on tablets: one centred column, never two. */
export const SETTINGS_MAX_WIDTH = 640;
/** At or below this window width (a 600-700dp tablet) the column stays full width. */
export const SETTINGS_COLUMN_MIN_WIDTH = 700;

/**
 * Side gap that centres a SETTINGS_MAX_WIDTH column, 0 on phones and on narrow
 * tablets. Applied as padding, not margin or maxWidth: Fabric drops margins on
 * ScrollView content containers under RTL (see lib/useLayout.ts columnPad).
 */
export function useSettingsGap(): number {
  const { width, isWide } = useLayout();
  if (!isWide || width <= SETTINGS_COLUMN_MIN_WIDTH) return 0;
  return Math.max(0, Math.floor((width - SETTINGS_MAX_WIDTH) / 2));
}

/**
 * The settings list row is the shared ui.Row (icon plate, label, sub, value,
 * chevron). One implementation, so the Settings hub, every sub-page and any
 * other list read identically. `danger` is THEME.danger (the destructive-action
 * color, tuned for contrast on both schemes), not the glucose "low" hue the old
 * settings-only Row used.
 */
export { Row } from "./ui";

/**
 * A tappable notice card (permission denied, exact alarms off, master switch
 * off): the amber tint, one body, and a Android ripple so the whole card reads
 * as pressable. Children carry the text; the caller owns the label.
 */
export function NoticeBanner({
  onPress,
  accessibilityLabel,
  children,
  className = "mb-2",
}: {
  onPress: () => void;
  accessibilityLabel?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      android_ripple={{ color: withAlpha(THEME.text, RIPPLE_ALPHA), foreground: true }}
      className={`rounded-2xl px-4 py-3 active:opacity-80 ${className}`}
      style={{
        borderWidth: 1,
        borderColor: withAlpha(GLUCOSE_RICH.high, 0.3),
        backgroundColor: withAlpha(GLUCOSE_RICH.high, 0.1),
        minHeight: HIT_TARGET,
      }}
    >
      {children}
    </Pressable>
  );
}

/**
 * A sub-control card that sits right under an enabled Row (e.g. the post-meal
 * delay picker under its toggle). Repeats the Row's icon-plate + left-indent
 * so its content lines up with the Row's label instead of sitting flush left.
 */
export function InlineConfigCard({
  icon,
  children,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  children: React.ReactNode;
}) {
  return (
    <View className="flex-row bg-glass border border-hair rounded-2xl px-3 py-3 mb-2">
      <View className="w-9 items-center pt-0.5">
        <Ionicons name={icon} size={16} color={THEME.textMuted} />
      </View>
      <View className="flex-1 ml-3">{children}</View>
    </View>
  );
}

/**
 * A settings SUB-PAGE frame: the app background, a back header, and a scrolling
 * body. Modals (e.g. the date-range picker) are passed as `overlay` so they sit
 * OUTSIDE the scroll view.
 */
export function SettingsScaffold({
  title,
  children,
  overlay,
  fillHeight = false,
  scrollHintId,
  scrollTargetRef,
  scrollToActive = false,
}: {
  /** A child to scroll to once, while `scrollToActive` is true. */
  scrollTargetRef?: React.RefObject<View | null>;
  scrollToActive?: boolean;
  /** Opts this page into the once-per-screen scroll hint (lib/scrollHint). */
  scrollHintId?: string;
  title: string;
  children: React.ReactNode;
  overlay?: React.ReactNode;
  /** OPT-IN (ZS-L2): when true, the scroll body's content container grows to
   *  fill the available height. Children stay top-aligned: centering them
   *  vertically left ~320 pt between the header and the first row on iPad.
   *  Off by default, so every other settings sub-page keeps its natural-height
   *  layout. */
  fillHeight?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const gap = useSettingsGap();
  const scrollHint = useScrollHint(`settings.${scrollHintId ?? "none"}`, scrollHintId != null);
  const scrollRef = useRef(null as ScrollView | null);
  useScrollToTarget(scrollRef, scrollTargetRef, scrollToActive);
  const header = (
    <ScreenHeader
      title={title}
      // A settings page can be reached by deep link with no history behind
      // it (a widget, a notification, an alarm's "Open"); back() would then
      // do nothing and strand the user on a leaf page.
      onBack={() =>
        router.canGoBack() ? router.back() : router.replace("/(tabs)/settings")
      }
    />
  );
  return (
    <AppBackground>
      <View className="flex-1" style={{ paddingTop: insets.top }}>
        {gap > 0 ? (
          <View style={{ paddingLeft: gap, paddingRight: gap }}>{header}</View>
        ) : (
          header
        )}
        <ScrollView
          ref={scrollRef}
          {...keyboardAwareScrollProps}
          contentContainerStyle={{
            padding: SPACE.lg,
            ...(gap > 0
              ? { paddingLeft: SPACE.lg + gap, paddingRight: SPACE.lg + gap }
              : null),
            paddingBottom: insets.bottom + SPACE["2xl"],
            ...(fillHeight ? { flexGrow: 1 } : null),
          }}
          showsVerticalScrollIndicator={false}
          onScroll={scrollHint.onScroll}
          onContentSizeChange={scrollHint.onContentSizeChange}
          onLayout={scrollHint.onLayout}
          scrollEventThrottle={scrollHint.scrollEventThrottle}
        >
          {children}
        </ScrollView>
        <ScrollHint visible={scrollHint.visible} bottomOffset={hintBottomOffset({ insetBottom: insets.bottom })} />
        {overlay}
      </View>
    </AppBackground>
  );
}
