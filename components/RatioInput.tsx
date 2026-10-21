import React, { useEffect, useRef, useState } from "react";
import { TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { HIT_TARGET, RADIUS, SPACE, TABULAR, THEME } from "../lib/theme/tokens";
import { withAlpha } from "./rich/GlassCard";
import { Txt } from "./ui";
import { num } from "../lib/format";
import { readStepperText, sanitizeStepperText } from "../lib/stepperInput";

interface RatioInputProps {
  /** The committed number, or null while the field is empty. Never a suggestion. */
  value: number | null;
  /** A usable in-range number, or null when the text is empty or out of range. */
  onChange: (v: number | null) => void;
  min: number;
  max: number;
  decimals: number;
  suffix?: string;
  accessibilityLabel?: string;
}

/**
 * A number field that starts EMPTY. The calculator's ratios are the user's own
 * numbers, so unlike Stepper there is no starting value to nudge up or down:
 * the field holds nothing until the user types it.
 */
export function RatioInput({
  value,
  onChange,
  min,
  max,
  decimals,
  suffix,
  accessibilityLabel,
}: RatioInputProps) {
  const { t } = useTranslation();
  const [text, setText] = useState(value == null ? "" : num(value));
  const [focused, setFocused] = useState(false);
  const [outOfRange, setOutOfRange] = useState(false);
  const typingRef = useRef(false);

  useEffect(() => {
    if (typingRef.current) return;
    setText(value == null ? "" : num(value));
    setOutOfRange(false);
  }, [value]);

  function onText(raw: string) {
    typingRef.current = true;
    const cleaned = sanitizeStepperText(raw, decimals);
    setText(cleaned);
    const read = readStepperText(cleaned, { min, max, decimals });
    setOutOfRange(read.kind === "below" || read.kind === "above");
    onChange(read.kind === "ok" ? read.value : null);
  }

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        borderRadius: RADIUS.md,
        borderWidth: 1,
        borderColor: outOfRange ? THEME.warning : THEME.border,
        backgroundColor: THEME.surface,
        minHeight: HIT_TARGET,
        paddingHorizontal: SPACE.sm,
        gap: SPACE.xs,
      }}
    >
      <TextInput
        value={text}
        onChangeText={onText}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          typingRef.current = false;
          setFocused(false);
          setText(value == null ? "" : num(value));
          setOutOfRange(false);
        }}
        keyboardType={decimals > 0 ? "decimal-pad" : "number-pad"}
        returnKeyType="done"
        selectTextOnFocus
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={
          outOfRange
            ? t("settings.rangeOutOfBounds", { min: num(min), max: num(max) })
            : t("common.tapToEdit")
        }
        style={[
          TABULAR,
          {
            flex: 1,
            minWidth: 0,
            color: THEME.text,
            fontSize: 20,
            fontWeight: "800",
            textAlign: "center",
            height: HIT_TARGET - 12,
            paddingVertical: 0,
            paddingHorizontal: 8,
            includeFontPadding: false,
            textAlignVertical: "center",
            borderRadius: RADIUS.sm,
            borderWidth: 1,
            borderColor: outOfRange ? THEME.warning : withAlpha(THEME.accent, focused ? 0.75 : 0.3),
            backgroundColor: withAlpha(THEME.accent, focused ? 0.14 : 0.06),
          },
        ]}
      />
      {suffix ? (
        <Txt kind="caption" tone="muted" numberOfLines={2} style={{ fontWeight: "600", flexShrink: 1, maxWidth: "45%" }}>
          {suffix}
        </Txt>
      ) : null}
    </View>
  );
}
