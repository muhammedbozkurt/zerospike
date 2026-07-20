import React from "react";
import { Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { AnimatedNumber } from "./AnimatedNumber";
import { COLORS, TABULAR } from "../lib/theme/tokens";

interface StatCardProps {
  /** Small caption above/below the value. */
  label: string;
  /** Numeric value to count up to (use with `format`/`decimals`), OR pass a
   *  pre-formatted string via `display` when the value isn't a plain number. */
  value?: number;
  display?: string;
  decimals?: number;
  format?: (n: number) => string;
  suffix?: string;
  /** Animate the value on mount (default true when `value` is numeric). */
  animate?: boolean;
  /** Accent color for the value (e.g. a glucose-language color). */
  accent?: string;
  /** Optional leading icon (Ionicons name). */
  icon?: keyof typeof Ionicons.glyphMap;
  /** Optional sparkline / mini-chart rendered under the value. */
  sparkline?: React.ReactNode;
  /** Optional secondary line (context, e.g. "from 42 readings"). */
  footnote?: string;
  style?: StyleProp<ViewStyle>;
  className?: string;
}

/**
 * A compact stat tile: big number + small label, optionally with a leading
 * icon, a sparkline, and a footnote. Shared across the dashboard "this week"
 * row, Insights, and (in string form) the doctor report - one visual language.
 */
export function StatCard({
  label,
  value,
  display,
  decimals = 0,
  format,
  suffix,
  animate = true,
  accent,
  icon,
  sparkline,
  footnote,
  style,
  className = "",
}: StatCardProps) {
  const valueColor = accent ?? COLORS.textPrimary;
  return (
    <View
      className={`rounded-2xl bg-zinc-900 border border-zinc-800 p-4 ${className}`}
      style={style}
    >
      <View className="flex-row items-center mb-1">
        {icon ? (
          <Ionicons name={icon} size={13} color={COLORS.textMuted} style={{ marginRight: 5 }} />
        ) : null}
        <Text
          className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500"
          numberOfLines={1}
        >
          {label}
        </Text>
      </View>

      <View className="flex-row items-end">
        {display !== undefined ? (
          <Text style={[{ color: valueColor }, TABULAR]} className="text-3xl font-extrabold">
            {display}
          </Text>
        ) : value !== undefined && animate ? (
          <AnimatedNumber
            value={value}
            decimals={decimals}
            format={format}
            className="text-3xl font-extrabold"
            style={{ color: valueColor }}
          />
        ) : (
          <Text style={[{ color: valueColor }, TABULAR]} className="text-3xl font-extrabold">
            {value !== undefined ? (format ? format(value) : value.toFixed(decimals)) : "-"}
          </Text>
        )}
        {suffix ? (
          <Text className="text-zinc-500 text-sm font-semibold mb-1 ml-1">{suffix}</Text>
        ) : null}
      </View>

      {sparkline ? <View className="mt-2">{sparkline}</View> : null}
      {footnote ? (
        <Text className="text-zinc-500 text-[11px] mt-1" numberOfLines={1}>
          {footnote}
        </Text>
      ) : null}
    </View>
  );
}
