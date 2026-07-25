import React, { useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { HIT_TARGET, RADIUS, TABULAR, THEME } from "../lib/theme/tokens";
import { hapticSelect } from "../lib/haptics";
import { num } from "../lib/format";

interface StepperProps {
  value: number;
  onChange: (v: number) => void;
  /** Increment for a single tap. */
  step?: number;
  /** Increment while the button is held down (accelerated repeat). */
  longStep?: number;
  min?: number;
  max?: number;
  /** Decimal places shown / accepted (0 = integer, 1 = 0.5u doses / portions). */
  decimals?: number;
  suffix?: string;
  /** Whether the middle value can also be typed on the keyboard (default true). */
  editable?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * A shared - value + stepper. Two 44pt buttons that also repeat (accelerating)
 * while held, with a keyboard-editable value in the middle, so a number never
 * REQUIRES the keyboard: dose, carbs, portion and ratio fields all drive off
 * this one control. Values snap to `step` and clamp to [min, max].
 */
export function Stepper({
  value,
  onChange,
  step = 1,
  longStep,
  min,
  max,
  decimals = 0,
  suffix,
  editable = true,
  accessibilityLabel,
  style,
}: StepperProps) {
  // Refs keep the held-repeat timer reading fresh values without re-arming.
  const valueRef = useRef(value);
  valueRef.current = value;
  const cfg = { step, longStep, min, max, decimals, onChange };
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;

  const [text, setText] = useState(fmt(value, decimals));
  const editingRef = useRef(false);
  useEffect(() => {
    if (!editingRef.current) setText(fmt(value, decimals));
  }, [value, decimals]);

  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => stopHold(), []);

  function apply(delta: number) {
    const c = cfgRef.current;
    const q = c.decimals > 0 ? Math.pow(10, c.decimals) : 1;
    let v = Math.round((valueRef.current + delta) * q) / q;
    if (c.max != null) v = Math.min(c.max, v);
    if (c.min != null) v = Math.max(c.min, v);
    if (v !== valueRef.current) {
      valueRef.current = v;
      c.onChange(v);
      hapticSelect();
    }
  }

  function stopHold() {
    if (holdRef.current) {
      clearTimeout(holdRef.current);
      holdRef.current = null;
    }
  }

  function startHold(dir: 1 | -1) {
    stopHold();
    let speed = 320;
    const tick = () => {
      const c = cfgRef.current;
      apply(dir * (c.longStep ?? c.step));
      speed = Math.max(60, speed - 45);
      holdRef.current = setTimeout(tick, speed);
    };
    holdRef.current = setTimeout(tick, speed);
  }

  function onText(s: string) {
    editingRef.current = true;
    const cleaned =
      decimals > 0
        ? s.replace(/[^0-9.,]/g, "").replace(/(\..*)\./g, "$1")
        : s.replace(/[^0-9]/g, "");
    setText(cleaned);
    const parsed = parseFloat(cleaned.replace(",", "."));
    if (Number.isFinite(parsed)) {
      let v = parsed;
      if (max != null) v = Math.min(max, v);
      if (min != null) v = Math.max(min, v);
      onChange(v);
    }
  }

  function onBlurText() {
    editingRef.current = false;
    setText(fmt(valueRef.current, decimals));
  }

  const btn = (dir: 1 | -1, icon: keyof typeof Ionicons.glyphMap, label: string) => (
    <Pressable
      onPress={() => apply(dir * step)}
      onLongPress={() => startHold(dir)}
      onPressOut={stopHold}
      delayLongPress={280}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        width: HIT_TARGET,
        height: HIT_TARGET,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Ionicons name={icon} size={20} color={THEME.accent} />
    </Pressable>
  );

  return (
    <View
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          borderRadius: RADIUS.md,
          borderWidth: 1,
          borderColor: THEME.border,
          backgroundColor: THEME.glass,
          overflow: "hidden",
        },
        style,
      ]}
      accessibilityLabel={accessibilityLabel}
    >
      {btn(-1, "remove", `${accessibilityLabel ?? ""} -`)}
      <View
        style={{
          flex: 1,
          flexDirection: "row",
          alignItems: "baseline",
          justifyContent: "center",
          gap: 4,
          borderLeftWidth: 1,
          borderRightWidth: 1,
          borderColor: THEME.border,
          minHeight: HIT_TARGET,
          paddingVertical: 6,
        }}
      >
        {editable ? (
          <TextInput
            value={text}
            onChangeText={onText}
            onBlur={onBlurText}
            keyboardType={decimals > 0 ? "decimal-pad" : "number-pad"}
            selectTextOnFocus
            style={[
              TABULAR,
              {
                color: THEME.ink,
                fontSize: 20,
                fontWeight: "800",
                textAlign: "center",
                minWidth: 44,
                paddingVertical: 0,
              },
            ]}
          />
        ) : (
          <Text style={[TABULAR, { color: THEME.ink, fontSize: 20, fontWeight: "800" }]}>
            {text}
          </Text>
        )}
        {suffix ? (
          <Text style={{ color: THEME.muted, fontSize: 12, fontWeight: "600" }}>
            {suffix}
          </Text>
        ) : null}
      </View>
      {btn(1, "add", `${accessibilityLabel ?? ""} +`)}
    </View>
  );
}

function fmt(v: number, decimals: number): string {
  if (decimals <= 0) return String(Math.round(v));
  return num(v);
}
