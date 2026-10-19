import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import { HIT_TARGET, RADIUS, SPACE, TABULAR, THEME } from "../lib/theme/tokens";
import { RIPPLE_ALPHA } from "../lib/theme/uiPrimitives";
import { Txt } from "./ui";
import { withAlpha } from "./rich/GlassCard";
import { hapticSelect } from "../lib/haptics";
import { num } from "../lib/format";
import {
  fieldShowsValue,
  nextInvalidKeys,
  readStepperText,
  resolveStepperBlur,
  shouldRevertOnUnmount,
  sanitizeStepperText,
  stepStepperValue,
} from "../lib/stepperInput";
import type { StepperRead } from "../lib/stepperInput";

interface StepperProps {
  value: number;
  onChange: (v: number) => void;
  /**
   * Called only on a transition. An empty or out-of-range field reports false
   * (and onChange is not called for it); a valid edit, a +/- press, blur and
   * unmount report true again.
   */
  onValidityChange?: (valid: boolean) => void;
  /**
   * When the field unmounts while invalid, report the value it had on focus
   * through onChange. For screens whose state is persisted (or consumed by a
   * footer outside the scroll area) without a blur ever happening. Leave it off
   * where unmount must not overwrite a default (onboarding "not sure").
   */
  revertOnUnmount?: boolean;
  /** Tells a screen why the field is invalid ("empty" or out of "range"), null when valid. */
  onInvalidKindChange?: (kind: null | "empty" | "range") => void;
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
  /**
   * "row" (default) is the bordered -/value/+ strip used everywhere in the app.
   * "hero" is the onboarding composition: two round buttons around one very
   * large value, for a step whose ONLY job is that single number.
   */
  variant?: "row" | "hero";
  /** Row variant only: "lg" widens the two buttons and the whole strip, for a
   *  form field that is the focus of its own onboarding step. */
  size?: "md" | "lg";
}

/** Round button + value metrics of the "hero" composition. */
const HERO_BTN = 60;
const HERO_VALUE = 64;
/** Row variant, "lg": the wider button cell the onboarding form asks for. */
const WIDE_BTN = 56;

/**
 * A shared - value + stepper. Two 44pt buttons that also repeat (accelerating)
 * while held, with a keyboard-editable value in the middle, so a number never
 * REQUIRES the keyboard: dose, carbs, portion and ratio fields all drive off
 * this one control. The +/- buttons step by `step` and clamp to [min, max]; a
 * typed value is committed exactly as written (up to `decimals` places), and
 * empty or out-of-range text is never committed.
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
  onValidityChange,
  revertOnUnmount,
  onInvalidKindChange,
  step = 1,
  longStep,
  min,
  max,
  decimals = 0,
  suffix,
  editable = true,
  accessibilityLabel,
  style,
  variant = "row",
  size = "md",
}: StepperProps) {
  const { t } = useTranslation();
  // Refs keep the held-repeat timer reading fresh values without re-arming.
  const valueRef = useRef(value);
  valueRef.current = value;
  const cfg = { step, longStep, min, max, decimals, onChange, onValidityChange, revertOnUnmount, onInvalidKindChange };
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;

  const [text, setText] = useState(fmt(value, decimals));
  const textRef = useRef(text);
  const editingRef = useRef(false);
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  const [invalidKind, setInvalidKind] = useState<null | "empty" | "range">(null);
  // The value the field had when it was focused: blur returns to it when the
  // typed text is not a usable number.
  const baselineRef = useRef(value);
  const validRef = useRef(true);

  function showText(s: string) {
    textRef.current = s;
    setText(s);
  }

  function setValidity(read: StepperRead) {
    const valid = read.kind === "ok";
    setInvalidKind(valid ? null : read.kind === "empty" ? "empty" : "range");
    if (valid !== validRef.current) {
      validRef.current = valid;
      cfgRef.current.onValidityChange?.(valid);
    }
  }

  function emit(v: number) {
    valueRef.current = v;
    cfgRef.current.onChange(v);
  }

  useEffect(() => {
    if (!editingRef.current) {
      showText(fmt(value, decimals));
    } else if (!fieldShowsValue(textRef.current, value, { min, max, decimals })) {
      showText(fmt(value, decimals));
      baselineRef.current = value;
      setValidity({ kind: "ok", value });
    }
  }, [value, decimals]);

  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // onChange only on explicit opt-in: unmounting must not overwrite a default
  // the screen just set (onboarding "not sure"); validity is always released.
  useEffect(
    () => () => {
      stopHold();
      if (!validRef.current) {
        if (
          cfgRef.current.revertOnUnmount &&
          shouldRevertOnUnmount(false, baselineRef.current, valueRef.current)
        ) {
          cfgRef.current.onChange(baselineRef.current);
        }
        cfgRef.current.onValidityChange?.(true);
        cfgRef.current.onInvalidKindChange?.(null);
      }
    },
    []
  );

  function apply(delta: number) {
    const c = cfgRef.current;
    // A stale invalid entry hides a fragment in valueRef; step from what the
    // field had when focused instead.
    const from = validRef.current ? valueRef.current : baselineRef.current;
    const v = stepStepperValue(from, delta, c);
    // The text is rewritten even when v is unchanged: a stale invalid entry
    // ("999") plus a press must land on a value the field really shows.
    showText(fmt(v, c.decimals));
    setValidity({ kind: "ok", value: v });
    baselineRef.current = v;
    if (v !== valueRef.current) {
      emit(v);
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
    const cleaned = sanitizeStepperText(s, decimals);
    showText(cleaned);
    const read = readStepperText(cleaned, { min, max, decimals });
    setValidity(read);
    if (read.kind === "ok") emit(read.value);
  }

  function onBlurText() {
    editingRef.current = false;
    setFocused(false);
    const read = readStepperText(textRef.current, { min, max, decimals });
    const r = resolveStepperBlur(read, baselineRef.current, valueRef.current);
    if (r.emit) emit(r.value);
    showText(fmt(valueRef.current, decimals));
    setValidity({ kind: "ok", value: valueRef.current });
  }

  useEffect(() => {
    cfgRef.current.onInvalidKindChange?.(invalidKind);
  }, [invalidKind]);

  const outOfRange = invalidKind === "range";
  const fieldHint =
    outOfRange && min != null && max != null
      ? t("settings.rangeOutOfBounds", { min: fmt(min, decimals), max: fmt(max, decimals) })
      : t("common.tapToEdit");

  // What this control currently reads, so the two buttons and the field all
  // announce the same thing (they used to announce "<label> -" and a bare number).
  const valueText = suffix ? `${text} ${suffix}` : text;
  const decLabel = [t("common.decrease"), accessibilityLabel].filter(Boolean).join(", ");
  const incLabel = [t("common.increase"), accessibilityLabel].filter(Boolean).join(", ");
  const wide = size === "lg";
  const cellSize = wide ? WIDE_BTN : HIT_TARGET;

  /** The press behaviour both compositions share: tap steps once, hold repeats. */
  const pressProps = (dir: 1 | -1, label: string) => ({
    onPress: () => apply(dir * step),
    onLongPress: () => startHold(dir),
    onPressOut: stopHold,
    delayLongPress: 280,
    hitSlop: 6,
    android_ripple: { color: withAlpha(THEME.accent, RIPPLE_ALPHA), foreground: true },
    accessibilityRole: "button" as const,
    accessibilityLabel: label,
    accessibilityValue: { text: valueText },
  });

  const btn = (dir: 1 | -1, icon: keyof typeof Ionicons.glyphMap, label: string) => (
    <Pressable
      {...pressProps(dir, label)}
      style={{
        width: cellSize,
        height: cellSize,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Ionicons name={icon} size={wide ? 22 : 20} color={THEME.accent} />
    </Pressable>
  );

  if (variant === "hero") {
    // The plus is the "primary" side (a fresh step starts at its default and
    // most users only ever raise it), so it carries the accent fill.
    const heroBtn = (
      dir: 1 | -1,
      icon: keyof typeof Ionicons.glyphMap,
      label: string,
      primary: boolean
    ) => (
      <Pressable
        {...pressProps(dir, label)}
        style={{
          width: HERO_BTN,
          height: HERO_BTN,
          borderRadius: RADIUS.full,
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          borderWidth: 1,
          borderColor: primary ? withAlpha(THEME.accent, 0.4) : THEME.border,
          backgroundColor: primary ? withAlpha(THEME.accent, 0.12) : THEME.surface,
        }}
      >
        <Ionicons name={icon} size={24} color={THEME.accent} />
      </Pressable>
    );

    return (
      <View
        style={[
          { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: SPACE.lg },
          style,
        ]}
      >
        {heroBtn(-1, "remove", decLabel, false)}
        <View style={{ alignItems: "center", minWidth: 120, flexShrink: 1 }}>
          {/* flex-end, not baseline: a TextInput's baseline is not reliable
              across platforms, so the unit is nudged up by hand instead.
              minWidth: 0 is what lets this row actually shrink inside the hero
              budget; without it a long suffix (mmol/L) pushes past the buttons
              before the suffix ellipsizes. */}
          <View style={{ flexDirection: "row", alignItems: "flex-end", flexShrink: 1, minWidth: 0 }}>
            {editable ? (
              <TextInput
                ref={inputRef}
                value={text}
                onChangeText={onText}
                onFocus={() => {
                  editingRef.current = true;
                  baselineRef.current = valueRef.current;
                  setFocused(true);
                }}
                onBlur={onBlurText}
                keyboardType={decimals > 0 ? "decimal-pad" : "number-pad"}
                returnKeyType="done"
                selectTextOnFocus
                accessibilityLabel={accessibilityLabel}
                accessibilityValue={{ text: valueText }}
                accessibilityHint={fieldHint}
                style={[
                  TABULAR,
                  {
                    color: THEME.text,
                    fontSize: HERO_VALUE,
                    fontWeight: "800",
                    textAlign: "center",
                    // Sized off the current text (a controlled TextInput does
                    // not grow while typing) and allowed to shrink, so a long
                    // value can never push the two buttons off a phone.
                    width: Math.max(90, text.length * 30 + 14),
                    flexShrink: 1,
                    paddingVertical: 0,
                    paddingHorizontal: 0,
                    // No lineHeight on purpose: iOS clips glyphs against a
                    // fixed line box (see INPUT_TEXT in lib/theme/tokens).
                    includeFontPadding: false,
                  },
                ]}
              />
            ) : (
              <Txt
                style={[
                  TABULAR,
                  { fontSize: HERO_VALUE, lineHeight: HERO_VALUE + 8, fontWeight: "800" },
                ]}
                accessibilityLabel={
                  accessibilityLabel ? `${accessibilityLabel}, ${valueText}` : valueText
                }
              >
                {text}
              </Txt>
            )}
            {suffix ? (
              <Txt
                kind="subtitle"
                tone="muted"
                numberOfLines={1}
                style={{
                  marginLeft: SPACE.sm,
                  marginBottom: SPACE.md,
                  flexShrink: 1,
                  minWidth: 0,
                }}
              >
                {suffix}
              </Txt>
            ) : null}
          </View>
          {/* The value's own underline: this is a typeable field, and at this
              size a bordered chip would fight the number for attention. */}
          <View
            style={{
              width: 96,
              height: 3,
              borderRadius: RADIUS.full,
              marginTop: SPACE.xs,
              backgroundColor: outOfRange ? THEME.warning : withAlpha(THEME.accent, focused ? 0.9 : 0.5),
            }}
          />
        </View>
        {heroBtn(1, "add", incLabel, true)}
      </View>
    );
  }

  return (
    <View
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          borderRadius: wide ? RADIUS.lg : RADIUS.md,
          borderWidth: 1,
          borderColor: THEME.border,
          backgroundColor: THEME.surface,
          overflow: "hidden",
        },
        style,
      ]}
    >
      {btn(-1, "remove", decLabel)}
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
          gap: SPACE.xs,
          borderLeftWidth: 1,
          borderRightWidth: 1,
          borderColor: THEME.border,
          minHeight: cellSize,
          paddingHorizontal: SPACE.xs,
          paddingVertical: SPACE.xs,
        }}
      >
        {editable ? (
          <TextInput
            ref={inputRef}
            value={text}
            onChangeText={onText}
            onFocus={() => {
              editingRef.current = true;
              baselineRef.current = valueRef.current;
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
            accessibilityHint={fieldHint}
            style={[
              TABULAR,
              {
                color: THEME.text,
                fontSize: 20,
                fontWeight: "800",
                textAlign: "center",
                // Sized off the current text: a controlled TextInput does not
                // grow while typing, so a fixed 58pt clipped "10,5" to "10,".
                width: Math.max(58, text.length * 14 + 20),
                flexShrink: 1,
                height: cellSize - 12,
                paddingVertical: 0,
                paddingHorizontal: 8,
                // Android adds font padding inside a fixed height and top-aligns
                // the text; without these the digits clip against the chip.
                includeFontPadding: false,
                textAlignVertical: "center",
                // Visible affordance: the typed value is an input, not a label.
                borderRadius: wide ? 10 : RADIUS.sm,
                borderWidth: 1,
                borderColor: outOfRange
                  ? THEME.warning
                  : withAlpha(THEME.accent, focused ? 0.75 : 0.3),
                backgroundColor: withAlpha(THEME.accent, focused ? 0.14 : 0.06),
              },
            ]}
          />
        ) : (
          <Txt
            style={[TABULAR, { fontSize: 20, lineHeight: 26, fontWeight: "800" }]}
            accessibilityLabel={
              accessibilityLabel ? `${accessibilityLabel}, ${valueText}` : valueText
            }
          >
            {text}
          </Txt>
        )}
        {suffix ? (
          <Txt
            kind="caption"
            tone="muted"
            numberOfLines={1}
            style={{ fontWeight: "600", flexShrink: 1, minWidth: 0 }}
          >
            {suffix}
          </Txt>
        ) : null}
      </Cell>
      {btn(1, "add", incLabel)}
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

/**
 * Screen-side aggregation of Stepper validity: give each Stepper
 * `onValidityChange={reporter("key")}` and gate the save/continue action on
 * `allValid`.
 */
export function useStepperValidity(): {
  allValid: boolean;
  reporter: (key: string) => (valid: boolean) => void;
} {
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(() => new Set());
  const reporter = useCallback(
    (key: string) => (valid: boolean) => setInvalid((p) => nextInvalidKeys(p, key, valid)),
    []
  );
  return { allValid: invalid.size === 0, reporter };
}
