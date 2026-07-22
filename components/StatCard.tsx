import React from "react";
import { Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { AnimatedNumber } from "./AnimatedNumber";
import { TABULAR, THEME, glow as glowShadow } from "../lib/theme/tokens";

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
  /** Midnight Monitor glass surface: a translucent fill with a light border and
   *  an optional colour-matched glow. Off by default (a plain tile). */
  glass?: boolean;
  /** Color-matched glow (only meaningful with `glass`); `true` uses the accent. */
  glow?: boolean | string;
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
  glass = false,
  glow = false,
  style,
  className = "",
}: StatCardProps) {
  const valueColor = accent ?? THEME.ink;
  const glowColor = glow === true ? THEME.accent : typeof glow === "string" ? glow : undefined;
  return (
    <View
      className={glass ? `rounded-2xl p-4 ${className}` : `rounded-2xl bg-glass border border-hair p-4 ${className}`}
      style={[
        glass
          ? { backgroundColor: THEME.glass, borderWidth: 1, borderColor: THEME.border }
          : undefined,
        glass && glowColor ? glowShadow(glowColor, 26, 0.4) : undefined,
        style,
      ]}
    >
      <View className="flex-row items-center mb-1">
        {icon ? (
          <Ionicons name={icon} size={13} color={THEME.muted} style={{ marginRight: 5 }} />
        ) : null}
        <Text
          className="text-[11px] font-semibold uppercase tracking-wider text-mut"
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
          <Text className="text-mut text-sm font-semibold mb-1 ml-1">{suffix}</Text>
        ) : null}
      </View>

      {sparkline ? <View className="mt-2">{sparkline}</View> : null}
      {footnote ? (
        <Text className="text-mut text-[11px] mt-1" numberOfLines={1}>
          {footnote}
        </Text>
      ) : null}
    </View>
  );
}
