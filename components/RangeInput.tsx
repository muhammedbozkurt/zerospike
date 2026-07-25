import React, { useRef, useState } from "react";
import { PanResponder, Text, TextInput, View } from "react-native";

import { GLUCOSE_RICH, RADIUS, TABULAR, THEME, glow, HIT_TARGET } from "../lib/theme/tokens";
import { GlassCard, withAlpha } from "./rich/GlassCard";
import { hapticSelect } from "../lib/haptics";
import { upper } from "../lib/upper";

/**
 * The target-range editor: a real dual-thumb slider. A target is a RANGE, not a
 * single ceiling (that is how glycemic targets are actually stated), so the control
 * edits both ends at once and draws the band it describes, with the two numbers
 * under it.
 *
 * R10 rebuild: a clean View-based track (pill rail + filled band + two round
 * handles), each handle a 44pt draggable with a live value bubble and a haptic tick
 * per step. Typing still moves the handles; only the end that is out of bounds turns
 * red (never both).
 *
 * BUGFIX (R10): the handle used to be a component defined INSIDE render, so every
 * drag step re-created its type and React remounted it mid-gesture - the pan
 * responder terminated after ONE step, capping a whole drag at +-1 step (+-5 mg/dL).
 * The handles are now plain inline Views (a render helper, not a component), so the
 * gesture survives the re-renders a drag causes and the full range is reachable.
 *
 * Values are in the caller's DISPLAY unit; this component never converts. It reports
 * raw text so the caller can parse, clamp and store on its own terms.
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
  /** Fired when either end loses focus / a drag ends - validate + store cue. */
  onBlur?: () => void;
  axisMin: number;
  axisMax: number;
  invalid?: boolean;
  invalidMessage?: string;
  outOfBoundsMessage?: string;
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

  const loOut =
    bounds != null && Number.isFinite(lo) && (lo < bounds.min || lo > bounds.max);
  const hiOut =
    bounds != null && Number.isFinite(hi) && (hi < bounds.min || hi > bounds.max);
  // Per-end colouring: only the end that is actually out of bounds turns red. An
  // order error (lo >= hi) is a relationship, so it colours both.
  const orderInvalid = invalid === true;
  const loInvalid = !!loOut || (orderInvalid && !hiOut);
  const hiInvalid = !!hiOut || (orderInvalid && !loOut);
  const showsError = orderInvalid || !!loOut || !!hiOut;
  const bandColor = showsError ? GLUCOSE_RICH.low : GLUCOSE_RICH.target;
  const x1 = hasBand ? pct(lo) : 0;
  const x2 = hasBand ? pct(hi) : 0;

  function sanitize(s: string): string {
    return decimals
      ? s.replace(/[^0-9.,]/g, "").replace(/(\..*)\./g, "$1")
      : s.replace(/[^0-9]/g, "");
  }

  // ── Drag support ────────────────────────────────────────────────────────
  const step = decimals ? 0.1 : 5;
  const minBound = bounds?.min ?? axisMin;
  const maxBound = bounds?.max ?? axisMax;
  const fmtVal = (v: number) =>
    decimals ? (Math.round(v * 10) / 10).toFixed(1) : String(Math.round(v));

  const trackWRef = useRef(0);
  const [dragging, setDragging] = useState<null | "lo" | "hi">(null);
  const startValRef = useRef(0);
  const lastValRef = useRef<number | null>(null);
  // Everything the responder needs, refreshed each render so a unit switch (which
  // changes span/step/bounds) is picked up without re-arming the responder.
  const env = { span, step, decimals, minBound, maxBound, onChangeMin, onChangeMax, onBlur, lo, hi };
  const envRef = useRef(env);
  envRef.current = env;

  const makeResponder = (which: "lo" | "hi") =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // Keep the gesture even as the parent re-renders on each value change.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        const e = envRef.current;
        setDragging(which);
        startValRef.current = which === "lo" ? e.lo : e.hi;
        lastValRef.current = null;
      },
      onPanResponderMove: (_evt, g) => {
        const e = envRef.current;
        const w = trackWRef.current || 1;
        let v = startValRef.current + (g.dx / w) * e.span;
        v = Math.round(v / e.step) * e.step;
        if (e.decimals) v = Math.round(v * 10) / 10;
        if (which === "lo") v = Math.max(e.minBound, Math.min(v, e.hi - e.step));
        else v = Math.min(e.maxBound, Math.max(v, e.lo + e.step));
        if (lastValRef.current !== v) {
          lastValRef.current = v;
          hapticSelect();
          (which === "lo" ? e.onChangeMin : e.onChangeMax)(fmtVal(v));
        }
      },
      onPanResponderRelease: () => {
        setDragging(null);
        envRef.current.onBlur?.();
      },
      onPanResponderTerminate: () => {
        setDragging(null);
        envRef.current.onBlur?.();
      },
    });

  const loResponder = useRef(makeResponder("lo")).current;
  const hiResponder = useRef(makeResponder("hi")).current;

  // A render HELPER, not a component: the returned host Views keep a stable type
  // across renders, so the pan responder is never remounted mid-drag (see BUGFIX).
  const thumb = (
    which: "lo" | "hi",
    at: number,
    value: number,
    responder: typeof loResponder
  ) => (
    <View
      key={which}
      {...responder.panHandlers}
      style={{
        position: "absolute",
        left: `${at}%`,
        top: 0,
        bottom: 0,
        width: HIT_TARGET,
        marginLeft: -HIT_TARGET / 2,
        alignItems: "center",
        justifyContent: "center",
      }}
      accessibilityRole="adjustable"
      accessibilityLabel={which === "lo" ? minLabel : maxLabel}
      accessibilityValue={{ now: value }}
    >
      {dragging === which ? (
        <View
          style={{
            position: "absolute",
            top: -6,
            backgroundColor: bandColor,
            borderRadius: RADIUS.sm,
            paddingHorizontal: 8,
            paddingVertical: 3,
          }}
        >
          <Text style={[TABULAR, { color: "#04121a", fontSize: 12, fontWeight: "800" }]}>
            {fmtVal(value)}
          </Text>
        </View>
      ) : null}
      <View
        style={[
          {
            width: 26,
            height: 26,
            borderRadius: 13,
            backgroundColor: THEME.ink,
            borderWidth: 3,
            borderColor: bandColor,
          },
          dragging === which
            ? glow(bandColor, 12, 0.7)
            : { shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 4 },
        ]}
      />
    </View>
  );

  return (
    <GlassCard
      glow={hasBand && !showsError ? GLUCOSE_RICH.target : undefined}
      style={{ marginBottom: 12 }}
    >
      <Text
        style={{
          color: THEME.muted,
          fontSize: 11,
          letterSpacing: 1.3,
          fontWeight: "800",
        }}
      >
        {upper(label)}
      </Text>

      {/* The rail + filled band + two draggable handles */}
      <View
        style={{ height: HIT_TARGET, marginTop: 12, justifyContent: "center" }}
        onLayout={(e) => {
          trackWRef.current = e.nativeEvent.layout.width;
        }}
      >
        {/* rail */}
        <View
          style={{
            height: 8,
            borderRadius: 4,
            backgroundColor: THEME.track,
            overflow: "hidden",
          }}
        >
          {/* filled band between the two ends */}
          {hasBand ? (
            <View
              style={{
                position: "absolute",
                left: `${x1}%`,
                width: `${Math.max(0.5, x2 - x1)}%`,
                top: 0,
                bottom: 0,
                backgroundColor: bandColor,
              }}
            />
          ) : null}
        </View>
        {/* handles (inline host Views - never remount mid-drag) */}
        {hasBand ? thumb("lo", x1, lo, loResponder) : null}
        {hasBand ? thumb("hi", x2, hi, hiResponder) : null}
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
          invalid={loInvalid}
        />
        <End
          label={maxLabel}
          value={maxText}
          onChange={(v) => onChangeMax(sanitize(v))}
          onBlur={onBlur}
          unit={unit}
          decimals={decimals}
          invalid={hiInvalid}
        />
      </View>

      {hint ? (
        <Text style={{ color: THEME.muted, fontSize: 11, marginTop: 8, lineHeight: 16 }}>
          {hint}
        </Text>
      ) : null}
      {showsError ? (
        <Text style={{ color: GLUCOSE_RICH.low, fontSize: 11, marginTop: 6 }}>
          {(loOut || hiOut) && outOfBoundsMessage ? outOfBoundsMessage : invalidMessage}
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
