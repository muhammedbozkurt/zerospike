import React from "react";
import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { COLORS } from "../lib/theme/tokens";
import { FadeSlideIn } from "../lib/theme/motion";
import { Button } from "./ui";

interface EmptyStateProps {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
}

/**
 * One consistent empty state for every list/section: a faint icon, a title, an
 * optional subtitle and an optional primary action. Fades in (snaps under
 * Reduce Motion) so an empty screen still feels intentional, not broken.
 */
export function EmptyState({
  icon = "sparkles-outline",
  title,
  subtitle,
  actionLabel,
  onAction,
  compact = false,
}: EmptyStateProps) {
  return (
    <FadeSlideIn>
      <View className={`items-center ${compact ? "py-8" : "py-14"} px-6`}>
        <View className="w-16 h-16 rounded-full bg-glass border border-hair items-center justify-center mb-4">
          <Ionicons name={icon} size={28} color={COLORS.textFaint} />
        </View>
        <Text className="text-zinc-200 text-base font-semibold text-center">{title}</Text>
        {subtitle ? (
          <Text className="text-zinc-500 text-sm text-center mt-1.5 leading-5">{subtitle}</Text>
        ) : null}
        {actionLabel && onAction ? (
          <View className="mt-5">
            <Button label={actionLabel} onPress={onAction} />
          </View>
        ) : null}
      </View>
    </FadeSlideIn>
  );
}
