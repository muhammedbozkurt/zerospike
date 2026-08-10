import React from "react";
import { Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { AnimatedNumber } from "./AnimatedNumber";
import { TABULAR, THEME, glow as glowShadow } from "../lib/theme/tokens";
import { upper } from "../lib/upper";

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
  /** Render `suffix` BEFORE the value. Turkish puts the percent sign first, so a
   *  percentage tile has to be able to flip it (see lib/format pctParts). */
  suffixFirst?: boolean;
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
  suffixFirst = false,
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
  const suffixNode = suffix ? (
    <Text
      className={`text-mut text-sm font-semibold mb-1 ${suffixFirst ? "mr-1" : "ml-1"}`}
    >
      {suffix}
    </Text>
  ) : null;
  return (
    <View
      className={glass ? `rounded-2xl p-4 ${className}` : `rounded-2xl bg-glass border border-hair p-4 ${className}`}
      style={[
        glass
          ? { backgroundColor: THEME.glass, borderWidth: 1, borderColor: THEME.border }
          : undefined,
        glass && glowColor ? glowShadow(glowColor, 26, 0.4, "fill") : undefined,
        style,
      ]}
    >
      <View className="flex-row items-center mb-1">
        {icon ? (
          <Ionicons name={icon} size={13} color={THEME.muted} style={{ marginRight: 5 }} />
        ) : null}
        <Text
          className="text-[11px] font-semibold tracking-wider text-mut"
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.75}
        >
          {upper(label)}
        </Text>
      </View>

      <View className="flex-row items-end">
        {suffixFirst ? suffixNode : null}
        {display !== undefined ? (
          <Text
            style={[{ color: valueColor }, TABULAR, { flexShrink: 1 }]}
            className="text-3xl font-extrabold"
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
          >
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
          <Text
            style={[{ color: valueColor }, TABULAR, { flexShrink: 1 }]}
            className="text-3xl font-extrabold"
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
          >
            {value !== undefined ? (format ? format(value) : value.toFixed(decimals)) : "-"}
          </Text>
        )}
        {suffixFirst ? null : suffixNode}
      </View>

      {sparkline ? <View className="mt-2">{sparkline}</View> : null}
      {footnote ? (
        <Text
          className="text-mut text-[11px] mt-1"
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
        >
          {footnote}
        </Text>
      ) : null}
    </View>
  );
}
