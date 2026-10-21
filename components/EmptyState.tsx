import React from "react";
import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { THEME } from "../lib/theme/tokens";
import { FadeSlideIn } from "../lib/theme/motion";
import { Button } from "./ui";

interface EmptyStateProps {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  /** One quiet line saying what this place will show once there is data. */
  hint?: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Optional quiet second action under the primary one. */
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  /** Faded sample (EmptyExample) above the icon. */
  preview?: React.ReactNode;
  compact?: boolean;
}

/**
 * One consistent empty state for every list/section and every tab's first-use
 * screen: a faint icon, a title, an optional subtitle, an optional "what you
 * will see" hint and an optional primary action. Fades in (snaps under Reduce
 * Motion) so an empty screen still feels intentional, not broken.
 */
export function EmptyState({
  icon = "sparkles-outline",
  title,
  subtitle,
  hint,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  preview,
  compact = false,
}: EmptyStateProps) {
  return (
    <FadeSlideIn>
      <View className={`items-center ${compact ? "py-8" : "py-14"} px-6`}>
        {preview ? <View className="self-stretch mb-6">{preview}</View> : null}
        <View className="w-16 h-16 rounded-full bg-glass border border-hair items-center justify-center mb-4">
          <Ionicons name={icon} size={28} color={THEME.textMuted} />
        </View>
        <Text className="text-ink text-base font-semibold text-center">{title}</Text>
        {subtitle ? (
          <Text className="text-mut text-sm text-center mt-1.5 leading-5">{subtitle}</Text>
        ) : null}
        {hint ? (
          <Text className="text-mut text-xs text-center mt-3 leading-4">{hint}</Text>
        ) : null}
        {actionLabel && onAction ? (
          <View className="mt-5">
            <Button label={actionLabel} onPress={onAction} />
          </View>
        ) : null}
        {secondaryActionLabel && onSecondaryAction ? (
          <View className="mt-2">
            <Button label={secondaryActionLabel} onPress={onSecondaryAction} variant="tertiary" />
          </View>
        ) : null}
      </View>
    </FadeSlideIn>
  );
}

export interface ExampleRow {
  label: string;
  /** Filled share of the bar, 0..1. */
  fill: number;
}

interface EmptyExampleProps {
  /** The "Example" tag, so the faded card is never read as the user's data. */
  tag: string;
  rows?: readonly ExampleRow[];
  /** Column heights 0..1 for a small bar sketch under the rows. */
  bars?: readonly number[];
}

const BAR_AREA_H = 44;

/**
 * A faded silhouette of the card that will appear once data exists. Purely
 * decorative and hidden from screen readers; the "Example" tag keeps it from
 * passing as real numbers. Colors come from the theme classes only.
 */
export function EmptyExample({ tag, rows = [], bars = [] }: EmptyExampleProps) {
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      pointerEvents="none"
      className="rounded-2xl bg-glass border border-hair p-3.5"
      style={{ opacity: 0.55 }}
    >
      <View className="flex-row justify-end mb-2">
        <View className="rounded-full border border-hair px-2 py-0.5">
          <Text className="text-mut text-xs font-semibold">{tag}</Text>
        </View>
      </View>
      {rows.map((r) => (
        <View key={r.label} className="mb-2.5">
          <Text className="text-mut text-xs mb-1" numberOfLines={1}>
            {r.label}
          </Text>
          <View className="h-2 rounded-full bg-hair overflow-hidden">
            <View
              className="h-2 rounded-full bg-brand"
              style={{ width: `${Math.round(Math.max(0, Math.min(1, r.fill)) * 100)}%` }}
            />
          </View>
        </View>
      ))}
      {bars.length > 0 ? (
        <View
          className="flex-row items-end justify-between mt-1"
          style={{ height: BAR_AREA_H }}
        >
          {bars.map((h, i) => (
            <View
              key={i}
              className="rounded-sm bg-brand"
              style={{ width: 14, height: Math.max(4, Math.round(Math.min(1, h) * BAR_AREA_H)) }}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}
