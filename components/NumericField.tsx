import React, { useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import { HIT_TARGET, INPUT_TEXT, RADIUS, SPACE, TABULAR, THEME } from "../lib/theme/tokens";
import { RIPPLE_ALPHA } from "../lib/theme/uiPrimitives";
import { withAlpha } from "./rich/GlassCard";
import { Txt } from "./ui";
import { hapticSelect } from "../lib/haptics";
import { num } from "../lib/format";
import {
  numericError,
  numericValid,
  readNumeric,
  stepIsBlocked,
  stepNumeric,
} from "../lib/numericField";

export interface NumericFieldProps {
  /** The committed number, or null while the field is empty or refused. Never a
   *  suggestion: the field starts empty unless the user already has a value. */
  value: number | null;
  /** Called with a number inside [min, max], or null for anything else. */
  onChange: (v: number | null) => void;
  decimals: number;
  min?: number;
  max?: number;
  /** Shows the - / + buttons and sets how far one press moves. */
  step?: number;
  /** Increment while a button is held down. */
  longStep?: number;
  /** An empty field counts as invalid (onValidityChange reports false). */
  required?: boolean;
  placeholder?: string;
  /** The unit, shown at the end of the field. */
  suffix?: string;
  accessibilityLabel: string;
  maxLength?: number;
  /** Fires when the field loses focus, after its text has settled. */
  onBlur?: () => void;
  /** Called only on a transition. Empty (when required) and out-of-range text
   *  report false; a valid edit, a button press and unmount report true. */
  onValidityChange?: (valid: boolean) => void;
  /** Colours the typed number (the glucose field tints it by status). */
  valueColor?: string;
  style?: StyleProp<ViewStyle>;
}

function fmt(v: number, decimals: number): string {
  if (decimals <= 0) return String(Math.round(v));
  return num(v);
}

/**
 * The app's one number field: a bordered box with the unit at its end, a numeric
 * keyboard, and optional - / + buttons. It accepts digits and ONE separator
 * (a comma or a dot, "7,5" and "7.5" are the same value); letters are dropped
 * as they are typed. The parent only ever receives a number inside [min, max]
 * (or null), exactly what the field shows, and a short message under the box
 * says why a value is refused. It never fills itself: empty stays empty until
 * the user types or presses a button.
 */
export function NumericField({
  value,
  onChange,
  decimals,
  min,
  max,
  step,
  longStep,
  required = false,
  placeholder,
  suffix,
  accessibilityLabel,
  maxLength,
  onBlur,
  onValidityChange,
  valueColor,
  style,
}: NumericFieldProps) {
  const { t } = useTranslation();
  const [text, setText] = useState(value == null ? "" : fmt(value, decimals));
  const [focused, setFocused] = useState(false);
  const [blurred, setBlurred] = useState(false);
  const [kind, setKind] = useState<"ok" | "empty" | "below" | "above">(
    value == null ? "empty" : "ok"
  );
  const typingRef = useRef(false);
  const valueRef = useRef(value);
  valueRef.current = value;
  const validRef = useRef(true);
  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cfg = { min, max, decimals, step: step ?? 1, longStep, onChange, onValidityChange, required };
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;

  function reportValidity(k: typeof kind) {
    const valid = numericValid(k, cfgRef.current.required);
    if (valid !== validRef.current) {
      validRef.current = valid;
      cfgRef.current.onValidityChange?.(valid);
    }
  }

  useEffect(() => {
    if (typingRef.current) return;
    setText(value == null ? "" : fmt(value, decimals));
    const k = value == null ? "empty" : "ok";
    setKind(k);
    reportValidity(k);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, decimals]);

  useEffect(
    () => () => {
      if (holdRef.current) clearTimeout(holdRef.current);
      if (!validRef.current) cfgRef.current.onValidityChange?.(true);
    },
    []
  );

  function onText(raw: string) {
    typingRef.current = true;
    setBlurred(false);
    const r = readNumeric(raw, { min, max, decimals });
    setText(r.text);
    setKind(r.kind);
    reportValidity(r.kind);
    onChange(r.value);
  }

  function onBlurText() {
    typingRef.current = false;
    setFocused(false);
    setBlurred(true);
    // A good number is written back in the locale's own form ("5." -> "5");
    // a refused one stays visible next to its message until it is corrected.
    if (kind === "ok" && valueRef.current != null) {
      setText(fmt(valueRef.current, decimals));
    }
    onBlur?.();
  }

  const stepCfg = { min, max, decimals, step: step ?? 1 };

  function press(dir: 1 | -1, by?: number) {
    const c = cfgRef.current;
    const current = valueRef.current;
    const next = stepNumeric(current, dir, { ...stepCfg, step: by ?? c.step });
    if (next == null || next === current) return;
    typingRef.current = false;
    setBlurred(false);
    setText(fmt(next, decimals));
    setKind("ok");
    valueRef.current = next;
    reportValidity("ok");
    c.onChange(next);
    hapticSelect();
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
      press(dir, c.longStep ?? c.step);
      speed = Math.max(60, speed - 45);
      holdRef.current = setTimeout(tick, speed);
    };
    holdRef.current = setTimeout(tick, speed);
  }

  const err = numericError(kind, { blurred, required });
  const bothBounds = min != null && max != null;
  const errorText =
    err === "below" || err === "above"
      ? bothBounds
        ? t("numeric.range", {
            min: fmt(min as number, decimals),
            max: fmt(max as number, decimals),
            unit: suffix ?? "",
          }).trim()
        : null
      : err === "required"
        ? t("numeric.required")
        : null;
  const invalid = errorText != null;
  const valueText = suffix ? `${text} ${suffix}` : text;
  const hint = errorText ?? t("common.tapToEdit");
  const decLabel = `${t("common.decrease")}, ${accessibilityLabel}`;
  const incLabel = `${t("common.increase")}, ${accessibilityLabel}`;
  const committed = value;

  const stepButton = (dir: 1 | -1, icon: keyof typeof Ionicons.glyphMap, label: string) => {
    const blocked = stepIsBlocked(committed, dir, stepCfg);
    return (
      <Pressable
        onPress={() => press(dir)}
        onLongPress={() => startHold(dir)}
        onPressOut={stopHold}
        delayLongPress={280}
        disabled={blocked}
        hitSlop={4}
        android_ripple={{ color: withAlpha(THEME.accent, RIPPLE_ALPHA), foreground: true }}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={{ text: valueText }}
        accessibilityState={{ disabled: blocked }}
        style={{
          width: HIT_TARGET,
          minHeight: HIT_TARGET,
          alignItems: "center",
          justifyContent: "center",
          opacity: blocked ? 0.35 : 1,
        }}
      >
        <Ionicons name={icon} size={20} color={THEME.accent} />
      </Pressable>
    );
  };

  return (
    <View style={style}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          minHeight: HIT_TARGET,
          borderRadius: RADIUS.md,
          borderWidth: 1,
          borderColor: invalid
            ? THEME.warning
            : focused
              ? withAlpha(THEME.accent, 0.75)
              : THEME.border,
          backgroundColor: THEME.surface,
          overflow: "hidden",
        }}
      >
        {step != null ? stepButton(-1, "remove", decLabel) : null}
        <TextInput
          value={text}
          onChangeText={onText}
          onFocus={() => setFocused(true)}
          onBlur={onBlurText}
          keyboardType={decimals > 0 ? "decimal-pad" : "number-pad"}
          returnKeyType="done"
          maxLength={maxLength}
          placeholder={placeholder}
          placeholderTextColor={withAlpha(THEME.textMuted, 0.7)}
          selectTextOnFocus
          accessibilityLabel={accessibilityLabel}
          accessibilityValue={{ text: valueText }}
          accessibilityHint={hint}
          style={[
            TABULAR,
            INPUT_TEXT,
            {
              flex: 1,
              minWidth: 0,
              color: valueColor ?? THEME.text,
              fontSize: 18,
              fontWeight: "700",
              textAlign: "center",
              textAlignVertical: "center",
              paddingVertical: 0,
              paddingHorizontal: SPACE.sm,
              height: HIT_TARGET - 2,
            },
          ]}
        />
        {suffix ? (
          <Txt
            kind="caption"
            tone="muted"
            numberOfLines={2}
            style={{
              fontWeight: "600",
              flexShrink: 1,
              maxWidth: "38%",
              marginEnd: step != null ? 0 : SPACE.md,
            }}
          >
            {suffix}
          </Txt>
        ) : null}
        {step != null ? stepButton(1, "add", incLabel) : null}
      </View>
      {errorText ? (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={{ color: THEME.warning, fontSize: 12, lineHeight: 17, marginTop: SPACE.xs }}
        >
          {errorText}
        </Text>
      ) : null}
    </View>
  );
}
