import React, { useEffect, useRef, useState } from "react";
import { Animated, I18nManager, PanResponder, Pressable, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "expo-router";
import { useTranslation } from "react-i18next";

import { ELEVATION, GLUCOSE_RICH, RADIUS, TABULAR, THEME, glow } from "../lib/theme/tokens";
import { GlassCard, withAlpha } from "./rich/GlassCard";
import { hapticSelect } from "../lib/haptics";
import { upper } from "../lib/upper";
import { useLayout } from "../lib/useLayout";
import { parseDecimalText, sanitizeNumberText } from "../lib/numberInput";

/**
 * The target-range editor: a dual-thumb band picker with two typeable ends.
 *
 * Layout, top to bottom: the caption, ONE large readout of the range as it
 * currently stands ("80-130 mg/dL"), the rail, and the two ends as large tap
 * targets that open the numeric keyboard. The rail paints the band the values
 * describe - below the low end, the band itself, above the high end - purely as
 * a picture of what was entered. It states nothing about what a value means and
 * recommends nothing.
 *
 * Nothing here refuses input. Typing an end past its bounds, or a low end above
 * the high end, leaves the value exactly as typed and adds a descriptive line;
 * the caller decides whether to persist. Values are in the caller's DISPLAY
 * unit and are reported back as raw text, so this component never converts.
 *
 * Geometry note: thumb centres map onto `trackW - THUMB` and are offset by half
 * a thumb, so value-to-position stays linear and a thumb at either extreme sits
 * flush inside the rail instead of hanging over the edge.
 */

const THUMB = 22;
const RAIL_H = 10;
/** The rail's touch band. Kept at the 44pt minimum so the thumbs stay easy to
 *  grab without the card growing a strip of empty space. */
const TRACK_H = 44;

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
  const { columnPad } = useLayout();
  const navigation = useNavigation();

  /** The low thumb can sit inside the native back-swipe zone, so a horizontal
   *  thumb drag used to double as an interactive pop and slid the whole screen.
   *  The stack gesture is parked only while a drag is actually in flight. */
  function setScreenGesture(enabled: boolean) {
    try {
      navigation.setOptions({ gestureEnabled: enabled });
    } catch {
      // outside a stack screen there is nothing to park
    }
  }

  const lo = parseDecimalText(minText) ?? NaN;
  const hi = parseDecimalText(maxText) ?? NaN;
  const span = Math.max(1, axisMax - axisMin);
  const bothSet = Number.isFinite(lo) && Number.isFinite(hi);
  const hasBand = bothSet && lo < hi;

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
  const errorText = showsError
    ? (loOut || hiOut) && outOfBoundsMessage
      ? outOfBoundsMessage
      : invalidMessage
    : undefined;
  const bandColor = showsError ? GLUCOSE_RICH.low : GLUCOSE_RICH.target;

  function sanitize(s: string): string {
    return sanitizeNumberText(s, decimals === true);
  }

  // ── Drag support ────────────────────────────────────────────────────────
  const step = decimals ? 0.1 : 5;
  const minBound = bounds?.min ?? axisMin;
  const maxBound = bounds?.max ?? axisMax;
  const fmtVal = (v: number) =>
    decimals ? (Math.round(v * 10) / 10).toFixed(1) : String(Math.round(v));

  const [trackW, setTrackW] = useState(0);
  const [dragging, setDragging] = useState<null | "lo" | "hi">(null);
  const draggingRef = useRef<null | "lo" | "hi">(null);
  draggingRef.current = dragging;
  const usable = Math.max(1, trackW - THUMB);
  const usableRef = useRef(usable);
  usableRef.current = usable;

  const clamp01 = (p: number) => Math.max(0, Math.min(1, p));
  const posOf = (v: number) => THUMB / 2 + clamp01((v - axisMin) / span) * usable;

  const startValRef = useRef(0);
  const lastValRef = useRef<number | null>(null);
  // Everything the responders need, refreshed each render so a unit switch
  // (which changes span/step/bounds) is picked up without re-arming them.
  const env = {
    span,
    step,
    decimals,
    axisMin,
    minBound,
    maxBound,
    onChangeMin,
    onChangeMax,
    onBlur,
    lo,
    hi,
  };
  const envRef = useRef(env);
  envRef.current = env;

  /** One clamp for drags, rail taps and accessibility nudges alike. */
  function settle(which: "lo" | "hi", raw: number): number {
    const e = envRef.current;
    let v = Math.round(raw / e.step) * e.step;
    if (e.decimals) v = Math.round(v * 10) / 10;
    if (which === "lo") {
      const ceiling = Number.isFinite(e.hi) ? e.hi - e.step : e.maxBound;
      v = Math.max(e.minBound, Math.min(v, ceiling));
    } else {
      const floor = Number.isFinite(e.lo) ? e.lo + e.step : e.minBound;
      v = Math.min(e.maxBound, Math.max(v, floor));
    }
    return e.decimals ? Math.round(v * 10) / 10 : v;
  }

  function emit(which: "lo" | "hi", v: number) {
    if (lastValRef.current === v) return;
    lastValRef.current = v;
    hapticSelect();
    (which === "lo" ? envRef.current.onChangeMin : envRef.current.onChangeMax)(
      fmtVal(v)
    );
  }

  const makeThumbResponder = (which: "lo" | "hi") =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // Keep the gesture even as the parent re-renders on each value change.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        const e = envRef.current;
        setScreenGesture(false);
        setDragging(which);
        startValRef.current = which === "lo" ? e.lo : e.hi;
        lastValRef.current = null;
      },
      onPanResponderMove: (_evt, g) => {
        const e = envRef.current;
        // The rail itself mirrors under RTL (posOf's `left` gets auto-swapped),
        // but g.dx is a raw physical-screen delta with no notion of that flip.
        // Negate it so dragging toward the rail's physical right still moves
        // the value the way the now-mirrored thumb visually promises.
        const dx = I18nManager.isRTL ? -g.dx : g.dx;
        emit(
          which,
          settle(which, startValRef.current + (dx / usableRef.current) * e.span)
        );
      },
      onPanResponderRelease: () => {
        setScreenGesture(true);
        setDragging(null);
        envRef.current.onBlur?.();
      },
      onPanResponderTerminate: () => {
        setScreenGesture(true);
        setDragging(null);
        envRef.current.onBlur?.();
      },
    });

  const loResponder = useRef(makeThumbResponder("lo")).current;
  const hiResponder = useRef(makeThumbResponder("hi")).current;

  /**
   * The keyboard/screen-reader path for the same two ends. `adjustable`
   * promises "swipe up or down to change this", so the actions have to exist
   * and land on exactly the drag arithmetic, one-step separation included.
   */
  const nudge = (which: "lo" | "hi", direction: 1 | -1) => {
    const e = envRef.current;
    const current = which === "lo" ? e.lo : e.hi;
    if (!Number.isFinite(current)) return;
    const v = settle(which, current + direction * e.step);
    if (v === current) return;
    lastValRef.current = null;
    emit(which, v);
    e.onBlur?.();
  };

  // The lift on the thumb being dragged: transform only, so it runs on the UI
  // thread and never competes with the value updates the gesture is emitting.
  const loLift = useRef(new Animated.Value(1)).current;
  const hiLift = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.spring(loLift, {
      toValue: dragging === "lo" ? 1.18 : 1,
      useNativeDriver: true,
      damping: 18,
      stiffness: 260,
      mass: 0.6,
    }).start();
    Animated.spring(hiLift, {
      toValue: dragging === "hi" ? 1.18 : 1,
      useNativeDriver: true,
      damping: 18,
      stiffness: 260,
      mass: 0.6,
    }).start();
  }, [dragging, loLift, hiLift]);

  // A render HELPER, not a component: the returned host Views keep a stable
  // type across renders, so a pan responder is never remounted mid-drag.
  const thumb = (
    which: "lo" | "hi",
    value: number,
    responder: typeof loResponder,
    lift: Animated.Value
  ) => (
    <View
      key={which}
      {...responder.panHandlers}
      // The visible thumb is 22pt; the slop brings the grab area to 44pt wide.
      hitSlop={{ top: 6, bottom: 6, left: 11, right: 11 }}
      style={{
        position: "absolute",
        left: posOf(value) - THUMB / 2,
        top: 0,
        bottom: 0,
        width: THUMB,
        alignItems: "center",
        justifyContent: "center",
      }}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={`${label}, ${which === "lo" ? minLabel : maxLabel}`}
      accessibilityValue={{
        now: value,
        min: minBound,
        max: maxBound,
        text: `${fmtVal(value)} ${unit}`,
      }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "increment") nudge(which, 1);
        else if (event.nativeEvent.actionName === "decrement") nudge(which, -1);
      }}
    >
      {/* No drag bubble on purpose: the big readout above the rail is the live
          value display, and a bubble here covered it while adjusting. */}
      <Animated.View
        style={[
          {
            width: THUMB,
            height: THUMB,
            borderRadius: THUMB / 2,
            backgroundColor: THEME.text,
            borderWidth: 3,
            borderColor: bandColor,
            transform: [{ scale: lift }],
          },
          dragging === which
            ? glow(bandColor, 14, 0.75, "shadowless")
            : {
                ...ELEVATION.card,
              },
        ]}
      />
    </View>
  );

  const loX = bothSet ? posOf(lo) : 0;
  const hiX = bothSet ? posOf(hi) : 0;
  // The stretch above the high end reads as a ramp rather than one flat block:
  // yellow nearest the band, amber at the far end.
  const aboveW = Math.max(0, trackW - hiX);

  return (
    <GlassCard
      glow={hasBand && !showsError ? GLUCOSE_RICH.target : undefined}
      radius={RADIUS.xl}
      style={[{ marginBottom: 12, paddingVertical: 14 }, columnPad(14)]}
    >
      <Text
        style={{
          color: THEME.textMuted,
          fontSize: 11,
          letterSpacing: 1.3,
          fontWeight: "800",
        }}
      >
        {upper(label)}
      </Text>

      {/* The range as it stands right now, in one readable line. */}
      <View
        className="flex-row items-baseline"
        style={{ marginTop: 6 }}
        accessible
        accessibilityLabel={`${label}. ${minLabel} ${minText || "-"} ${unit}. ${maxLabel} ${maxText || "-"} ${unit}`}
      >
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
          style={[
            TABULAR,
            {
              color: showsError ? GLUCOSE_RICH.low : THEME.text,
              fontSize: 21,
              lineHeight: 25,
              fontWeight: "800",
              flexShrink: 1,
            },
          ]}
        >
          {minText || "-"}
          <Text style={{ color: THEME.textMuted, fontWeight: "700" }}>-</Text>
          {maxText || "-"}
        </Text>
        <Text
          numberOfLines={1}
          style={{ color: THEME.textMuted, fontSize: 12, marginLeft: 7, flexShrink: 0 }}
        >
          {unit}
        </Text>
      </View>

      {/* Rail: below-band, band, above-band. A picture of the entered values.
          Deliberately NOT tappable: a tap that teleported the nearer end made
          near-miss grabs feel broken. Adjusting is thumbs or typing only. */}
      <View
        style={{ height: TRACK_H, marginTop: 8, justifyContent: "center" }}
        onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}
      >
        <View
          style={{
            height: RAIL_H,
            borderRadius: RAIL_H / 2,
            backgroundColor: THEME.track,
            overflow: "hidden",
          }}
        >
          {bothSet && trackW > 0 ? (
            <>
              <View
                style={{
                  position: "absolute",
                  left: 0,
                  width: Math.max(0, loX),
                  top: 0,
                  bottom: 0,
                  backgroundColor: withAlpha(GLUCOSE_RICH.low, 0.22),
                }}
              />
              <View
                style={{
                  position: "absolute",
                  left: hiX,
                  width: aboveW * 0.5,
                  top: 0,
                  bottom: 0,
                  backgroundColor: withAlpha(GLUCOSE_RICH.high, 0.18),
                }}
              />
              <View
                style={{
                  position: "absolute",
                  left: hiX + aboveW * 0.5,
                  width: aboveW * 0.5,
                  top: 0,
                  bottom: 0,
                  backgroundColor: withAlpha(GLUCOSE_RICH.wellAbove, 0.3),
                }}
              />
            </>
          ) : null}
          {hasBand && trackW > 0 ? (
            <View
              style={{
                position: "absolute",
                left: loX,
                width: Math.max(2, hiX - loX),
                top: 0,
                bottom: 0,
                backgroundColor: bandColor,
              }}
            />
          ) : null}
        </View>

        {/* Both thumbs render even when the ends are the wrong way round, so an
            out-of-order range can still be dragged back into shape. */}
        {bothSet && trackW > 0 ? thumb("lo", lo, loResponder, loLift) : null}
        {bothSet && trackW > 0 ? thumb("hi", hi, hiResponder, hiLift) : null}
      </View>

      {/* Axis ends, so the rail's scale is readable without dragging it. */}
      <View className="flex-row justify-between" style={{ marginTop: -2, marginBottom: 10 }}>
        <Text style={[TABULAR, { color: THEME.textMuted, fontSize: 10 }]}>
          {fmtVal(axisMin)}
        </Text>
        <Text style={[TABULAR, { color: THEME.textMuted, fontSize: 10 }]}>
          {fmtVal(axisMax)}
        </Text>
      </View>

      {/* The two ends, typeable */}
      <View className="flex-row" style={{ gap: 10 }}>
        <End
          label={minLabel}
          value={minText}
          onChange={(v) => onChangeMin(sanitize(v))}
          onBlur={onBlur}
          unit={unit}
          decimals={decimals}
          invalid={loInvalid}
          errorText={errorText}
        />
        <End
          label={maxLabel}
          value={maxText}
          onChange={(v) => onChangeMax(sanitize(v))}
          onBlur={onBlur}
          unit={unit}
          decimals={decimals}
          invalid={hiInvalid}
          errorText={errorText}
        />
      </View>

      {hint ? (
        <Text style={{ color: THEME.textMuted, fontSize: 11, marginTop: 10, lineHeight: 16 }}>
          {hint}
        </Text>
      ) : null}
      {errorText ? (
        <Text
          style={{ color: GLUCOSE_RICH.low, fontSize: 11, marginTop: 8, lineHeight: 16 }}
          accessibilityRole="alert"
        >
          {errorText}
        </Text>
      ) : null}
    </GlassCard>
  );
}

/**
 * One end of the range as a large, obviously-tappable field.
 *
 * The whole box is a press target that focuses the input, not just the glyphs:
 * a bare TextInput is only as tall as its own line box, so most of a field-sized
 * area was dead space that swallowed taps without opening the keyboard.
 */
function End({
  label,
  value,
  onChange,
  onBlur,
  unit,
  decimals,
  invalid,
  errorText,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  unit: string;
  decimals: boolean;
  invalid?: boolean;
  /** The message shown under the card, so the field can announce WHY it is red. */
  errorText?: string;
}) {
  const { t } = useTranslation();
  const ref = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);

  const borderColor = invalid
    ? withAlpha(GLUCOSE_RICH.low, 0.55)
    : focused
      ? withAlpha(THEME.accent, 0.7)
      : THEME.border;

  return (
    <Pressable
      className="flex-1"
      onPress={() => ref.current?.focus()}
      accessible={false}
      style={[
        {
          borderRadius: RADIUS.lg,
          borderWidth: 1,
          borderColor,
          backgroundColor: focused ? withAlpha(THEME.accent, 0.08) : THEME.surface,
          paddingHorizontal: 10,
          paddingTop: 6,
          paddingBottom: 7,
          minHeight: 46,
          justifyContent: "center",
        },
        invalid ? glow(GLUCOSE_RICH.low, 10, 0.3) : undefined,
      ]}
    >
      <View className="flex-row items-center justify-between">
        <Text
          numberOfLines={1}
          style={{ color: THEME.textMuted, fontSize: 10, fontWeight: "700", flexShrink: 1 }}
        >
          {label}
        </Text>
        <Ionicons
          name="keypad-outline"
          size={12}
          color={focused ? THEME.accent : THEME.textMuted}
        />
      </View>
      <View className="flex-row items-baseline" style={{ marginTop: 1 }}>
        <TextInput
          ref={ref}
          value={value}
          onChangeText={onChange}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            onBlur?.();
          }}
          selectTextOnFocus
          keyboardType={decimals ? "decimal-pad" : "number-pad"}
          returnKeyType="done"
          // Wide enough to never refuse a plausible entry; anything past the
          // caller's bounds is described under the card, not blocked here.
          maxLength={decimals ? 5 : 4}
          // The caption above and the unit beside it are siblings, so on their
          // own the field announced as a bare number with no idea what it edits.
          accessibilityLabel={`${label}, ${unit}`}
          accessibilityHint={invalid ? errorText : t("common.tapToEdit")}
          style={[
            TABULAR,
            {
              color: THEME.text,
              fontSize: 17,
              fontWeight: "800",
              padding: 0,
              minHeight: 22,
              flex: 1,
              includeFontPadding: false,
              textAlignVertical: "center",
            },
          ]}
        />
        <Text numberOfLines={1} style={{ color: THEME.textMuted, fontSize: 11, marginLeft: 4 }}>
          {unit}
        </Text>
      </View>
    </Pressable>
  );
}
