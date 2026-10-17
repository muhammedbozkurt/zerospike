import React from "react";
import { I18nManager, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { AppBackground } from "./rich";
import { withAlpha } from "./rich/GlassCard";
import { ScreenHeader } from "./ScreenHeader";
import { GLUCOSE_RICH, THEME } from "../lib/theme/tokens";
import { keyboardAwareScrollProps } from "../lib/keyboard";
import { useLayout } from "../lib/useLayout";
import { DirIcon } from "./DirIcon";

/**
 * The settings list row: a tinted icon plate, a label, and an optional value /
 * custom right node / chevron. Shared by the Settings hub and every sub-page so
 * the rows read identically wherever they moved to (R7.3 hub split).
 */
export function Row({
  icon,
  label,
  sub,
  value,
  onPress,
  onLongPress,
  danger,
  right,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  /** One quiet line under the label (e.g. "next: today 22:00"). Optional, so
   *  every existing caller renders exactly as before. */
  sub?: string;
  value?: string;
  onPress?: () => void;
  onLongPress?: () => void;
  danger?: boolean;
  right?: React.ReactNode;
}) {
  // RTL: label's flex-1 box relies on LTR-left-aligned slack space to keep it
  // clear of `value` - ml-3/mr-1 sit at the icon and chevron edges, not at
  // this boundary, and RN's row mirroring cannot fix that because textAlign
  // never auto-swaps (see components/form.tsx). Without this, label glues
  // straight onto value under RTL ("<label>22:00"). Writing marginLeft here
  // (RN auto-flips it to a physical marginRight under RTL, same trick as
  // InjectionBodyMap's side badges) adds the missing gap only when it is
  // actually missing, so LTR stays pixel-identical.
  const rtl = I18nManager.isRTL;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={!onPress && !onLongPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={label}
      className={`flex-row items-center bg-glass border border-hair rounded-2xl px-3 py-3 mb-2 ${
        onPress ? "active:opacity-80" : ""
      }`}
      // Floor, not a fixed height: a short single-line row keeps this exact
      // height (icon plate 36 + the 12/12 vertical padding), so every plain
      // row in a list still lines up - but a long DE/FR label is allowed to
      // wrap to a second line under it instead of being clipped.
      style={{ minHeight: 60 }}
    >
      <View
        className="w-9 h-9 rounded-xl items-center justify-center"
        style={{ backgroundColor: withAlpha(danger ? GLUCOSE_RICH.low : THEME.accent, 0.14) }}
      >
        <Ionicons name={icon} size={18} color={danger ? GLUCOSE_RICH.low : THEME.accent} />
      </View>
      <View className="flex-1 ml-3">
        <Text
          className="text-[15px] font-semibold"
          style={{ color: danger ? GLUCOSE_RICH.low : THEME.text }}
          numberOfLines={2}
        >
          {label}
        </Text>
        {sub ? (
          <Text className="text-mut text-[12px] mt-0.5" numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text
          className="text-mut text-[13px] mr-1 font-medium"
          style={rtl ? { marginLeft: 8 } : undefined}
          numberOfLines={2}
        >
          {value}
        </Text>
      ) : null}
      {right ?? (onPress ? <DirIcon name="chevron-forward" size={18} color={THEME.textMuted} /> : null)}
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
}: {
  title: string;
  children: React.ReactNode;
  overlay?: React.ReactNode;
  /** OPT-IN (ZS-L2): when true, the scroll body's content container grows to
   *  fill the available height and, on a wide screen (tablet), centers its
   *  children vertically - a short list (e.g. reminders) then fills a tall
   *  iPad frame instead of sticking to the top. Off by default, so every
   *  other settings sub-page keeps its exact top-aligned, natural-height
   *  layout. */
  fillHeight?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isWide } = useLayout();
  return (
    <AppBackground>
      <View className="flex-1" style={{ paddingTop: insets.top }}>
        <ScreenHeader
          title={title}
          // A settings page can be reached by deep link with no history behind
          // it (a widget, a notification, an alarm's "Open"); back() would then
          // do nothing and strand the user on a leaf page.
          onBack={() =>
            router.canGoBack() ? router.back() : router.replace("/(tabs)/settings")
          }
        />
        <ScrollView
          {...keyboardAwareScrollProps}
          contentContainerStyle={{
            padding: 16,
            paddingBottom: insets.bottom + 32,
            ...(fillHeight ? { flexGrow: 1 } : null),
            ...(fillHeight && isWide ? { justifyContent: "center" } : null),
          }}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
        {overlay}
      </View>
    </AppBackground>
  );
}
