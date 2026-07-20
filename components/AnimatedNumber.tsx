import React from "react";
import { Text } from "react-native";
import type { TextProps, TextStyle, StyleProp } from "react-native";

import { useCountUp } from "../lib/theme/motion";
import { TABULAR } from "../lib/theme/tokens";

interface AnimatedNumberProps extends Omit<TextProps, "children" | "style"> {
  /** Target value (in the display unit already). */
  value: number;
  /** Decimal places to animate/show (default 0). Values are counted on a scaled
   *  integer so the tween stays smooth, then divided back. */
  decimals?: number;
  /** Format the settled numeric value into the visible string (default: fixed). */
  format?: (n: number) => string;
  prefix?: string;
  suffix?: string;
  /** Count-up duration in ms. */
  duration?: number;
  /** Fires once when the count lands (e.g. a confirming haptic). */
  onSettle?: () => void;
  style?: StyleProp<TextStyle>;
  className?: string;
}

/**
 * A number that counts up from 0 to `value` on mount, using tabular figures so
 * the digits never shift width mid-tween. Snaps instantly under Reduce Motion
 * (handled inside useCountUp). Pair with the app type scale for the big hero
 * stats (average, TIR, streak).
 */
export function AnimatedNumber({
  value,
  decimals = 0,
  format,
  prefix = "",
  suffix = "",
  duration,
  onSettle,
  style,
  className,
  ...rest
}: AnimatedNumberProps) {
  const scale = Math.pow(10, decimals);
  const counted = useCountUp(Math.round(value * scale), duration, onSettle);
  const n = counted / scale;
  const text = format ? format(n) : n.toFixed(decimals);

  return (
    <Text style={[TABULAR, style]} className={className} {...rest}>
      {prefix}
      {text}
      {suffix}
    </Text>
  );
}
