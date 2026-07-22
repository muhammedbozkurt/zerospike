import React from "react";
import { Text, TextInput, View } from "react-native";
import Svg, { Line, Rect } from "react-native-svg";

import { GLUCOSE_RICH, RADIUS, TABULAR, THEME, glow } from "../lib/theme/tokens";
import { GlassCard, withAlpha } from "./rich/GlassCard";

/**
 * The target-range editor: the mockup's B02 "target band" card rebuilt as a real
 * control. A target is a RANGE, not a single ceiling (that is how glycemic
 * targets are actually stated), so the control edits both ends at once and draws
 * the band it describes, with the two numbers under it.
 *
 * Values are in the caller's DISPLAY unit; this component never converts. It
 * reports raw text so the caller can parse, clamp and store on its own terms -
 * clamping while someone is still typing steals their keystrokes.
 */
export function RangeInput({
  label,
  hint,
  unit,
  minText,
  maxText,
  onChangeMin,
  onChangeMax,
  onBlur,
  /** Axis the band is drawn against, in the same display unit. */
  axisMin,
  axisMax,
  invalid,
  invalidMessage,
  outOfBoundsMessage,
  bounds,
  minLabel,
  maxLabel,
  decimals = false,
}: {
  label: string;
  hint?: string;
  unit: string;
  minText: string;
  maxText: string;
  onChangeMin: (v: string) => void;
  onChangeMax: (v: string) => void;
  /** Fired when either end loses focus - the caller's cue to validate + store. */
  onBlur?: () => void;
  axisMin: number;
  axisMax: number;
  invalid?: boolean;
  invalidMessage?: string;
  /** Message shown when a value is outside `bounds` (in the display unit). */
  outOfBoundsMessage?: string;
  /** Accepted values, in the same display unit. A value outside them is
   *  REPORTED, never silently rewritten: quietly storing 300 when someone typed
   *  400 leaves the screen showing a number the database does not hold. */
  bounds?: { min: number; max: number };
  minLabel: string;
  maxLabel: string;
  decimals?: boolean;
}) {
  const lo = parseFloat(minText.replace(",", "."));
  const hi = parseFloat(maxText.replace(",", "."));
  const span = Math.max(1, axisMax - axisMin);
  const pct = (v: number) =>
    Math.max(0, Math.min(100, ((v - axisMin) / span) * 100));
  const hasBand = Number.isFinite(lo) && Number.isFinite(hi) && lo < hi;
  const outOfBounds =
    bounds != null &&
    ((Number.isFinite(lo) && (lo < bounds.min || lo > bounds.max)) ||
      (Number.isFinite(hi) && (hi < bounds.min || hi > bounds.max)));
  const showsError = invalid === true || outOfBounds;
  const x1 = hasBand ? pct(lo) : 0;
  const x2 = hasBand ? pct(hi) : 0;

  function sanitize(s: string): string {
    return decimals
      ? s.replace(/[^0-9.,]/g, "").replace(/(\..*)\./g, "$1")
      : s.replace(/[^0-9]/g, "");
  }

  return (
    <GlassCard
      glow={hasBand && !showsError ? GLUCOSE_RICH.target : undefined}
      style={{ marginBottom: 12 }}
    >
      <Text
        style={{
          color: THEME.muted,
          fontSize: 9,
          letterSpacing: 1.3,
          textTransform: "uppercase",
          fontWeight: "800",
        }}
      >
        {label}
      </Text>

      {/* The band itself: the number pair made visible */}
      <View style={{ height: 42, marginTop: 10 }}>
        <Svg width="100%" height="100%" viewBox="0 0 100 42" preserveAspectRatio="none">
          <Rect x="0" y="16" width="100" height="10" rx="3" fill={THEME.track} />
          {hasBand ? (
            <>
              <Rect
                x={x1}
                y={8}
                width={Math.max(0.5, x2 - x1)}
                height={26}
                rx={2}
                fill={withAlpha(GLUCOSE_RICH.target, 0.22)}
              />
              <Line x1={x1} y1={0} x2={x1} y2={42} stroke={GLUCOSE_RICH.target} strokeWidth={1.2} />
              <Line x1={x2} y1={0} x2={x2} y2={42} stroke={GLUCOSE_RICH.target} strokeWidth={1.2} />
            </>
          ) : null}
        </Svg>
      </View>

      {/* The two ends, editable */}
      <View className="flex-row mt-2" style={{ gap: 10 }}>
        <End
          label={minLabel}
          value={minText}
          onChange={(v) => onChangeMin(sanitize(v))}
          onBlur={onBlur}
          unit={unit}
          decimals={decimals}
          invalid={showsError}
        />
        <End
          label={maxLabel}
          value={maxText}
          onChange={(v) => onChangeMax(sanitize(v))}
          onBlur={onBlur}
          unit={unit}
          decimals={decimals}
          invalid={showsError}
        />
      </View>

      {hint ? (
        <Text style={{ color: THEME.muted, fontSize: 11, marginTop: 8, lineHeight: 16 }}>
          {hint}
        </Text>
      ) : null}
      {showsError ? (
        <Text style={{ color: GLUCOSE_RICH.low, fontSize: 11, marginTop: 6 }}>
          {outOfBounds && outOfBoundsMessage
            ? outOfBoundsMessage
            : invalidMessage}
        </Text>
      ) : null}
    </GlassCard>
  );
}

function End({
  label,
  value,
  onChange,
  onBlur,
  unit,
  decimals,
  invalid,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  unit: string;
  decimals: boolean;
  invalid?: boolean;
}) {
  return (
    <View
      className="flex-1"
      style={[
        {
          borderRadius: RADIUS.md,
          borderWidth: 1,
          borderColor: invalid ? withAlpha(GLUCOSE_RICH.low, 0.5) : THEME.border,
          backgroundColor: THEME.glass,
          paddingHorizontal: 12,
          paddingVertical: 8,
        },
        invalid ? glow(GLUCOSE_RICH.low, 10, 0.3) : undefined,
      ]}
    >
      <Text style={{ color: THEME.muted, fontSize: 10, fontWeight: "700" }}>{label}</Text>
      <View className="flex-row items-baseline">
        <TextInput
          value={value}
          onChangeText={onChange}
          onBlur={onBlur}
          keyboardType={decimals ? "decimal-pad" : "number-pad"}
          maxLength={decimals ? 5 : 3}
          style={[
            TABULAR,
            {
              color: THEME.ink,
              fontSize: 20,
              fontWeight: "800",
              paddingVertical: 2,
              flex: 1,
            },
          ]}
        />
        <Text style={{ color: THEME.muted, fontSize: 11 }}>{unit}</Text>
      </View>
    </View>
  );
}
