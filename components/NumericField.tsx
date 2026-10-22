import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Platform, Pressable, Text, TextInput, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import { HIT_TARGET, INPUT_TEXT, RADIUS, SPACE, TABULAR, THEME } from "../lib/theme/tokens";
import { RIPPLE_ALPHA } from "../lib/theme/uiPrimitives";
import { withAlpha } from "./rich/GlassCard";
import { Txt } from "./ui";
import { hapticSelect } from "../lib/haptics";
import { scaledMinHeight } from "../lib/layoutForFontScale";
import { useFontScale } from "../lib/useFontScale";
import { num } from "../lib/format";
import {
  fieldShowsValue,
  numericError,
  numericValid,
  readNumericInput,
  stepAllowed,
  stepIsBlocked,
  stepNumeric,
  type NumericReadKind,
  type NumericReading,
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
  // The reading of whatever the box holds right now. A prop value outside the
  // bounds is shown as what it is (an error), never counted as fine.
  function fromValue(v: number | null): NumericReading {
    if (v == null) return { text: "", kind: "empty", value: null };
    const k: NumericReadKind =
      min != null && v < min ? "below" : max != null && v > max ? "above" : "ok";
    return { text: fmt(v, decimals), kind: k, value: k === "ok" ? v : null };
  }
  const [text, setText] = useState(() => fromValue(value).text);
  const [focused, setFocused] = useState(false);
  const fontScale = useFontScale();
  const [blurred, setBlurred] = useState(() => fromValue(value).kind === "below");
  const [kind, setKind] = useState<NumericReadKind>(() => fromValue(value).kind);
  const typingRef = useRef(false);
  const readingRef = useRef<NumericReading>(fromValue(value));
  const valueRef = useRef(value);
  valueRef.current = value;
  const validRef = useRef(true);
  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cfg = { min, max, decimals, step: step ?? 1, longStep, onChange, onValidityChange, required };
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;

  function show(r: NumericReading) {
    readingRef.current = r;
    setText(r.text);
    setKind(r.kind);
    reportValidity(r.kind);
  }

  function reportValidity(k: NumericReadKind) {
    const valid = numericValid(k, cfgRef.current.required);
    if (valid !== validRef.current) {
      validRef.current = valid;
      cfgRef.current.onValidityChange?.(valid);
    }
  }

  // The parent's value reaches the box unless it is only the echo of what is
  // being typed: a chip, a slider or an offer that sets a different value while
  // the box has focus must replace the text, or the box would show one number
  // and the calculation use another.
  useEffect(() => {
    if (typingRef.current && fieldShowsValue(readingRef.current, value)) return;
    const r = fromValue(value);
    if (r.kind === "below") setBlurred(true);
    show(r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, decimals, min, max]);

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
    const r = readNumericInput(raw, readingRef.current.text, { min, max, decimals });
    show(r);
    onChange(r.value);
  }

  function onBlurText() {
    typingRef.current = false;
    setFocused(false);
    setBlurred(true);
    // A good number is written back in the locale's own form ("5." -> "5");
    // a refused one stays visible next to its message until it is corrected.
    if (readingRef.current.kind === "ok" && valueRef.current != null) {
      show({ text: fmt(valueRef.current, decimals), kind: "ok", value: valueRef.current });
    }
    onBlur?.();
  }

  const stepCfg = { min, max, decimals, step: step ?? 1 };

  /** One - / + press. False when nothing changed (a bound, or refused text). */
  function press(dir: 1 | -1, by?: number): boolean {
    const c = cfgRef.current;
    if (!stepAllowed(readingRef.current.kind, cfgRef.current.required)) return false;
    const current = valueRef.current;
    const next = stepNumeric(current, dir, { ...stepCfg, step: by ?? c.step });
    if (next == null || next === current) return false;
    typingRef.current = false;
    setBlurred(false);
    valueRef.current = next;
    show({ text: fmt(next, decimals), kind: "ok", value: next });
    c.onChange(next);
    hapticSelect();
    return true;
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
      // A tick that changes nothing (a bound was reached) ends the hold.
      if (!press(dir, c.longStep ?? c.step)) {
        stopHold();
        return;
      }
      speed = Math.max(60, speed - 45);
      holdRef.current = setTimeout(tick, speed);
    };
    holdRef.current = setTimeout(tick, speed);
  }

  const err = numericError(kind, { blurred, required });
  const bothBounds = min != null && max != null;
  const wholeOnly = err === "malformed" && decimals <= 0 && /[.,٫]/.test(text);
  const errorText = wholeOnly
    ? t("numeric.integerOnly")
    : err === "below" || err === "above" || err === "malformed"
      ? bothBounds
        ? t("numeric.range", {
            min: fmt(min as number, decimals),
            max: fmt(max as number, decimals),
            unit: suffix ?? "",
          }).trim()
        : t("numeric.required")
      : err === "required"
        ? t("numeric.required")
        : null;
  const invalid = errorText != null;
  const valueText = suffix ? `${text} ${suffix}` : text;
  const hint = errorText ?? t("common.tapToEdit");
  const decLabel = `${t("common.decrease")}, ${accessibilityLabel}`;
  const incLabel = `${t("common.increase")}, ${accessibilityLabel}`;
  const committed = value;

  // VoiceOver does not read a live region, so the message is announced; Android
  // reads the live region itself (announcing there would read it twice).
  useEffect(() => {
    if (errorText && Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(errorText);
  }, [errorText]);

  const stepButton = (dir: 1 | -1, icon: keyof typeof Ionicons.glyphMap, label: string) => {
    const blocked = stepIsBlocked(committed, dir, stepCfg) || !stepAllowed(kind, required);
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
          placeholderTextColor={THEME.placeholder}
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
              minHeight: scaledMinHeight(HIT_TARGET - 2, fontScale),
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
          accessibilityLiveRegion={Platform.OS === "android" ? "polite" : "none"}
          style={{ color: THEME.warning, fontSize: 12, lineHeight: 17, marginTop: SPACE.xs }}
        >
          {errorText}
        </Text>
      ) : null}
    </View>
  );
}
