import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { AppBackground } from "./rich";
import { withAlpha } from "./rich/GlassCard";
import { ScreenHeader } from "./ScreenHeader";
import { GLUCOSE_RICH, THEME } from "../lib/theme/tokens";
import { keyboardAwareScrollProps } from "../lib/keyboard";

/**
 * The settings list row: a tinted icon plate, a label, and an optional value /
 * custom right node / chevron. Shared by the Settings hub and every sub-page so
 * the rows read identically wherever they moved to (R7.3 hub split).
 */
export function Row({
  icon,
  label,
  value,
  onPress,
  danger,
  right,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
  right?: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
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
      <Text
        className="flex-1 ml-3 text-[15px] font-semibold"
        style={{ color: danger ? GLUCOSE_RICH.low : THEME.ink }}
        numberOfLines={2}
      >
        {label}
      </Text>
      {value ? (
        <Text className="text-mut text-[13px] mr-1 font-medium" numberOfLines={2}>
          {value}
        </Text>
      ) : null}
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={18} color={THEME.muted} /> : null)}
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
        <Ionicons name={icon} size={16} color={THEME.muted} />
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
}: {
  title: string;
  children: React.ReactNode;
  overlay?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return (
    <AppBackground>
      <View className="flex-1" style={{ paddingTop: insets.top }}>
        <ScreenHeader title={title} onBack={() => router.back()} />
        <ScrollView
          {...keyboardAwareScrollProps}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
        {overlay}
      </View>
    </AppBackground>
  );
}
