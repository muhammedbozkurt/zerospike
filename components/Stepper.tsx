import React, { useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import { HIT_TARGET, RADIUS, TABULAR, THEME } from "../lib/theme/tokens";
import { withAlpha } from "./rich/GlassCard";
import { hapticSelect } from "../lib/haptics";
import { num } from "../lib/format";
import { parseDecimalText, sanitizeNumberText } from "../lib/numberInput";

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
 *
 * Tap-to-type fix: the middle used to be a bare TextInput inside a baseline-
 * aligned row, so its touch area was only its own ~24pt line box while the cell
 * around it was 44pt tall and as wide as the row allowed. Every tap outside
 * that line box - which is most of a value area people aim at - hit dead space
 * and no keyboard appeared. The middle is now a press target in its own right
 * that focuses the field, the field is a visible chip rather than a bare label,
 * and it is centre-aligned instead of baseline-aligned so nothing sits off the
 * cell's own box.
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
  const { t } = useTranslation();
  // Refs keep the held-repeat timer reading fresh values without re-arming.
  const valueRef = useRef(value);
  valueRef.current = value;
  const cfg = { step, longStep, min, max, decimals, onChange };
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;

  const [text, setText] = useState(fmt(value, decimals));
  const editingRef = useRef(false);
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
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
      // Also update the text directly: while the field is focused the value
      // effect is deliberately suppressed (editingRef), so without this a +/-
      // press during editing would change the stored dose but not the display.
      setText(fmt(v, c.decimals));
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
    const cleaned = sanitizeNumberText(s, decimals > 0);
    setText(cleaned);
    const parsed = parseDecimalText(cleaned);
    if (parsed != null) {
      let v = parsed;
      if (max != null) v = Math.min(max, v);
      if (min != null) v = Math.max(min, v);
      onChange(v);
    }
  }

  function onBlurText() {
    editingRef.current = false;
    setFocused(false);
    setText(fmt(valueRef.current, decimals));
  }

  // What this control currently reads, so the two buttons and the field all
  // announce the same thing (they used to announce "<label> -" and a bare number).
  const valueText = suffix ? `${text} ${suffix}` : text;

  const btn = (dir: 1 | -1, icon: keyof typeof Ionicons.glyphMap, label: string) => (
    <Pressable
      onPress={() => apply(dir * step)}
      onLongPress={() => startHold(dir)}
      onPressOut={stopHold}
      delayLongPress={280}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityValue={{ text: valueText }}
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
    >
      {btn(
        -1,
        "remove",
        [t("common.decrease"), accessibilityLabel].filter(Boolean).join(", ")
      )}
      <Cell
        // The whole cell is the tap target, not just the glyphs inside it, so a
        // tap anywhere in the value area opens the keyboard.
        onPress={editable ? () => inputRef.current?.focus() : undefined}
        accessible={false}
        style={{
          flex: 1,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 5,
          borderLeftWidth: 1,
          borderRightWidth: 1,
          borderColor: THEME.border,
          minHeight: HIT_TARGET,
          paddingHorizontal: 6,
          paddingVertical: 4,
        }}
      >
        {editable ? (
          <TextInput
            ref={inputRef}
            value={text}
            onChangeText={onText}
            onFocus={() => {
              editingRef.current = true;
              setFocused(true);
            }}
            onBlur={onBlurText}
            keyboardType={decimals > 0 ? "decimal-pad" : "number-pad"}
            returnKeyType="done"
            selectTextOnFocus
            // The label lived on the wrapping View, which is not `accessible`, so
            // it was never announced: the field read out as a bare number.
            accessibilityLabel={accessibilityLabel}
            accessibilityValue={{ text: valueText }}
            accessibilityHint={t("common.tapToEdit")}
            style={[
              TABULAR,
              {
                color: THEME.ink,
                fontSize: 20,
                fontWeight: "800",
                textAlign: "center",
                // Sized off the current text: a controlled TextInput does not
                // grow while typing, so a fixed 58pt clipped "10,5" to "10,".
                width: Math.max(58, text.length * 14 + 20),
                flexShrink: 1,
                height: HIT_TARGET - 12,
                paddingVertical: 0,
                paddingHorizontal: 8,
                // Android adds font padding inside a fixed height and top-aligns
                // the text; without these the digits clip against the chip.
                includeFontPadding: false,
                textAlignVertical: "center",
                // Visible affordance: the typed value is an input, not a label.
                borderRadius: RADIUS.sm,
                borderWidth: 1,
                borderColor: withAlpha(THEME.accent, focused ? 0.75 : 0.3),
                backgroundColor: withAlpha(THEME.accent, focused ? 0.14 : 0.06),
              },
            ]}
          />
        ) : (
          <Text
            style={[TABULAR, { color: THEME.ink, fontSize: 20, fontWeight: "800" }]}
            accessibilityLabel={
              accessibilityLabel ? `${accessibilityLabel}, ${valueText}` : valueText
            }
          >
            {text}
          </Text>
        )}
        {suffix ? (
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
            style={{ color: THEME.muted, fontSize: 12, fontWeight: "600", flexShrink: 1 }}
          >
            {suffix}
          </Text>
        ) : null}
      </Cell>
      {btn(
        1,
        "add",
        [t("common.increase"), accessibilityLabel].filter(Boolean).join(", ")
      )}
    </View>
  );
}

function fmt(v: number, decimals: number): string {
  if (decimals <= 0) return String(Math.round(v));
  return num(v);
}

/**
 * The value cell. A press target when the value is typeable (a tap anywhere in
 * it focuses the field), a plain box when it is read-only, so a display-only
 * stepper never advertises an interaction it does not have.
 *
 * Module level, not inline: the two branches keep stable component types, so
 * toggling focus never remounts the TextInput out from under the keyboard.
 */
function Cell({
  onPress,
  accessible,
  style,
  children,
}: {
  onPress?: () => void;
  accessible?: boolean;
  style: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  if (!onPress) {
    return (
      <View style={style} accessible={accessible}>
        {children}
      </View>
    );
  }
  return (
    <Pressable onPress={onPress} accessible={accessible} style={style}>
      {children}
    </Pressable>
  );
}
