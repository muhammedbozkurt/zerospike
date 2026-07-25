import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { AppBackground } from "./rich";
import { withAlpha } from "./rich/GlassCard";
import { ScreenHeader } from "./ScreenHeader";
import { GLUCOSE_RICH, THEME } from "../lib/theme/tokens";

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
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={label}
      className="flex-row items-center bg-glass border border-hair rounded-2xl px-3 py-3 mb-2 active:opacity-80"
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
      >
        {label}
      </Text>
      {value ? <Text className="text-mut text-[13px] mr-1 font-medium">{value}</Text> : null}
      {right ?? (onPress ? <Ionicons name="chevron-forward" size={18} color={THEME.muted} /> : null)}
    </Pressable>
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
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
        {overlay}
      </View>
    </AppBackground>
  );
}
