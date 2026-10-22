import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { OverlayModal as Modal } from "./OverlayModal";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";

import type { GlucoseUnit, LogTag, PeriodTag } from "../lib/db/types";
import type { GlucoseStatus, TargetProfile } from "../lib/glucose";
import {
  classifyGlucose,
  formatGlucose,
  glucoseFromDisplay,
  glucoseToDisplay,
  glucoseUnitLabel,
  statusLabelKey,
  VERY_HIGH_MGDL,
} from "../lib/glucose";
import { keyboardOverlapPx } from "../lib/sheetLayout";
import { measureHostInWindow } from "../lib/measureHost";
import { TagPicker } from "./TagPicker";
import { InlineDateTimePicker } from "./InlineDateTimePicker";
import { formatTime, num, relativeDay } from "../lib/format";
import {
  GLUCOSE_INPUT_CEILING,
  glucoseAboveCeiling,
  hasDecimalSeparator,
  parseDecimalText,
  parseWholeText,
  sanitizeNumberText,
} from "../lib/numberInput";
import { readNumericInput } from "../lib/numericField";
import {
  GLUCOSE_SHEET_MAX_CHARS,
  glucoseSheetBounds,
  glucoseSheetValueState,
} from "../lib/glucoseSheetInput";
import { withAlpha } from "./rich/GlassCard";
import { ELEVATION, INPUT_TEXT, RADIUS, RICH_BY_STATUS, SPACE, TABULAR, THEME, glow } from "../lib/theme/tokens";
import { GlucoseChip } from "./rich/GlucoseChip";
import { HEALTH_NAME } from "../lib/services/health";
import { GradientCTA } from "./rich/GradientCTA";
import { Button, Chip, Row, Txt } from "./ui";
import { useLayout } from "../lib/useLayout";
import { dialogCardStyle, sheetBoxStyle } from "../lib/tabletLayout";
import { FeedbackHost, useFeedback } from "./Feedback";
import { useEntryGuardConfirm } from "./useEntryGuardConfirm";

/** Below this much room left over, the sheet drops into its compact type and
 *  spacing so the hero, the pills and Save all still fit above the keyboard. */
const COMPACT_BELOW = 520;

const PERIODS: PeriodTag[] = [
  "fasting",
  "pre_meal",
  "post_meal_2h",
  "bedtime",
  "manual",
];

/** The stored reading being corrected (structurally matches SugarLog and the
 *  journal's GlucoseEntry, so either can be passed straight in). */
export interface GlucoseEditTarget {
  id: string;
  glucose_level_mgdl: number;
  period_tag: PeriodTag;
  logged_at: string;
  tags: LogTag[];
  /** Apple Health sample this reading is mirrored to, when the user opted in
   *  (schema v10). Optional: only used to decide whether the delete confirm's
   *  second line (journal.deleteHealthNote) applies - a caller that omits it
   *  (structurally still a valid GlucoseEntry/SugarLog) just never sees that
   *  line, which is the safe default. */
  healthkit_uuid?: string | null;
}

interface Props {
  visible: boolean;
  initialPeriod?: PeriodTag;
  unit?: GlucoseUnit;
  /** The profile's own range, so the live status matches the rest of the app. */
  profile?: Partial<TargetProfile>;
  /** When set, the sheet opens prefilled to correct this existing reading. */
  edit?: GlucoseEditTarget | null;
  /** value is in mg/dL (already converted from the display unit).
   *  loggedAt is null when the user left the time untouched ("now"). */
  onClose: () => void;
  onSubmit: (
    value: number,
    period: PeriodTag,
    tags: LogTag[],
    loggedAt: Date | null
  ) => void;
  /** Destructive "Delete" action (2.3.1 P4), EDIT mode only: confirms first
   *  (with a second line when `edit.healthkit_uuid` is set), then fires with
   *  the entry being edited so the caller can run the same undo-toast delete
   *  every other surface uses. Left undefined, or with no `edit` target, no
   *  delete button is drawn - a fresh (not yet saved) entry has nothing to
   *  delete. */
  onDelete?: (target: GlucoseEditTarget) => void;
}

/**
 * The glucose-entry sheet, built to the mockup's B04 composition: a radial cyan
 * wash behind a glass sheet, one enormous glowing numeral that takes its color
 * from the live classification, the period as a row of pill buttons under it,
 * and a single gradient CTA. Detail controls (time, context tags) sit below the
 * hero, so the first thing on screen is always the number being entered.
 */
export function GlucoseInputSheet({
  visible,
  initialPeriod = "fasting",
  unit = "mgdl",
  profile,
  edit = null,
  onClose,
  onSubmit,
  onDelete,
}: Props) {
  const { t, i18n } = useTranslation();
  const { confirm } = useFeedback();
  const guardEntry = useEntryGuardConfirm();
  const [value, setValue] = useState("");
  const [period, setPeriod] = useState<PeriodTag>(initialPeriod);
  const [tags, setTags] = useState<LogTag[]>([]);
  // null keeps the "log it as of now" default; a Date is an explicit pick.
  const [loggedAt, setLoggedAt] = useState<Date | null>(null);
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const { isWide, isDialog, width: layoutWidth, height: layoutHeight } = useLayout();
  const insets = useSafeAreaInsets();
  const heroRef = useRef<TextInput>(null);
  /** Height actually left for the sheet: the keyboard has already been taken out
   *  of it on both platforms (iOS via the avoiding view's padding, Android via
   *  the modal window's adjustResize), so one measurement drives compact mode
   *  without guessing at keyboard metrics. */
  const [availH, setAvailH] = useState(0);
  const compact = availH > 0 && availH < COMPACT_BELOW;

  // Android's edge-to-edge window is not resized by the keyboard, so Save used
  // to sit underneath it. The lift is the measured overlap, so a device that
  // still resizes the window (overlap 0) is left alone.
  const hostRef = useRef<View>(null);
  const [androidLift, setAndroidLift] = useState(0);
  useEffect(() => {
    if (Platform.OS !== "android" || !visible) {
      setAndroidLift(0);
      return;
    }
    const subShow = Keyboard.addListener("keyboardDidShow", (e) => {
      const keyboardTop = e?.endCoordinates?.screenY ?? 0;
      requestAnimationFrame(() => {
        measureHostInWindow(hostRef, ({ y, height }) => {
          setAndroidLift(keyboardOverlapPx({ containerBottom: y + height, keyboardTop }));
        });
      });
    });
    const subHide = Keyboard.addListener("keyboardDidHide", () => setAndroidLift(0));
    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, [visible]);

  // OFFSCREEN, not 0: the sheet's real height is only known after layout, so it
  // waits out of frame instead of flashing at its final position for a frame.
  const translateY = useRef(new Animated.Value(900)).current;
  const backdrop = useRef(new Animated.Value(0)).current;
  const sheetHRef = useRef(0);
  const appearedRef = useRef(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const mmol = unit === "mmol";
  const { min: minD, max: maxD } = glucoseSheetBounds(unit);

  useEffect(() => {
    if (visible) {
      if (edit) {
        setValue(num(glucoseToDisplay(edit.glucose_level_mgdl, unit)));
        setPasteBad(false);
        setPeriod(edit.period_tag);
        setTags(edit.tags);
        setLoggedAt(new Date(edit.logged_at));
      } else {
        setValue("");
        setPasteBad(false);
        setPeriod(initialPeriod);
        setTags([]);
        setLoggedAt(null);
      }
      setTimePickerOpen(false);
      appearedRef.current = false;
      translateY.setValue(900);
      backdrop.setValue(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initialPeriod, edit?.id]);

  /**
   * The keyboard comes up in the same motion as the sheet: the request goes in
   * as soon as the content mounts, so both animate together instead of the
   * keyboard arriving as a second, separate jump. `onShow` repeats the request
   * as a backstop for platforms where an autofocus inside a modal is dropped.
   */
  const submittedRef = useRef(false);
  useEffect(() => {
    if (!visible) return;
    submittedRef.current = false;
    const id = setTimeout(() => heroRef.current?.focus(), 60);
    return () => clearTimeout(id);
  }, [visible]);

  /** Slide the sheet out first, then hand back to the caller (close or save).
   *  Every exit goes through here, so the sheet never simply blinks away. */
  function animateOut(done: () => void) {
    Keyboard.dismiss();
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: sheetHRef.current || 700,
        duration: 190,
        useNativeDriver: true,
      }),
      Animated.timing(backdrop, {
        toValue: 0,
        duration: 190,
        useNativeDriver: true,
      }),
    ]).start(() => done());
  }

  function animateClose() {
    animateOut(() => closeRef.current());
  }
  const closeSheetRef = useRef(animateClose);
  closeSheetRef.current = animateClose;

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx) * 2,
      onPanResponderGrant: () => Keyboard.dismiss(),
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) translateY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 120 || g.vy > 0.6) {
          closeSheetRef.current();
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            bounciness: 0,
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  // ONE numeric normalizer for every field in the app (lib/numberInput): the
  // comma is a decimal separator, so "5,5" stays 5.5 mmol/L instead of being
  // stripped into 55 - an 18x fictional reading on a comma-decimal keyboard.
  // A paste or a replaced selection goes through the same check as the other
  // number boxes: "-45" and "1e2" are refused (the text stays visible, no
  // value), never quietly turned into 45 or 12. Single typed keys stay lenient.
  const [pasteBad, setPasteBad] = useState(false);
  function onType(s: string) {
    const r = readNumericInput(s, value, { decimals: mmol ? 1 : 0 });
    setValue(r.text);
    setPasteBad(r.kind === "malformed");
  }

  // mg/dL is a whole number: "5,5" stays on screen as typed and reads as an
  // error (never 55), and Save stays shut until it is a whole number.
  const wholeBad = !mmol && hasDecimalSeparator(value);
  const typed = pasteBad ? null : mmol ? parseDecimalText(value) : parseWholeText(value);
  const valueState = glucoseSheetValueState(typed, unit);
  const aboveBad = valueState === "above";
  const belowBad = valueState === "below";

  // Guards the async gap between a Save tap and the guard dialog resolving:
  // submittedRef alone (set only once the guard has already said "go") would
  // let a second tap fire a second checkEntryGuards call, and a second dialog,
  // while the first is still on screen.
  const guardingRef = useRef(false);

  async function submit() {
    if (typed == null || typed < minD || typed > maxD) return;
    // A second Save tap during the 190ms exit would restart the animation and
    // fire onSubmit twice, storing the reading twice.
    if (submittedRef.current || guardingRef.current) return;
    // Captured BEFORE the exit animation: the callback fires a frame later and
    // must save exactly what was on screen when Save was pressed.
    const mgdl = glucoseFromDisplay(typed, unit);
    const p = period;
    const tg = tags;
    const at = loggedAt;

    // Duplicate-entry check (lib/entryGuard.ts), right before the write. In
    // EDIT mode the reading being corrected is its own excludeId, so it never
    // gets flagged as a "recent glucose" duplicate of itself.
    guardingRef.current = true;
    let proceed: boolean;
    try {
      proceed = await guardEntry({
        entryKind: "glucose",
        entryAtIso: at ? at.toISOString() : undefined,
        excludeId: edit?.id ?? null,
      });
    } finally {
      guardingRef.current = false;
    }
    if (!proceed || submittedRef.current) return;
    submittedRef.current = true;
    animateOut(() => onSubmit(mgdl, p, tg, at));
  }

  /** Same confirm dialog as the row's own swipe delete (useJournalRows.tsx's
   *  confirmAndDelete) and the other edit sheets': a plain factual question,
   *  destructive styling, plus a second line when this reading is also
   *  mirrored to Apple Health (journal.deleteHealthNote) - the one case among
   *  the three edit sheets where that line can ever apply. */
  async function handleDelete() {
    if (!edit || !onDelete || submittedRef.current) return;
    const hasHealthNote = edit.healthkit_uuid != null;
    const ok = await confirm({
      message: hasHealthNote
        ? `${t("journal.deleteEntry")}\n\n${t("journal.deleteHealthNote", { health: HEALTH_NAME })}`
        : t("journal.deleteEntry"),
      confirmLabel: t("common.delete"),
      cancelLabel: t("common.cancel"),
      destructive: true,
      icon: "trash-outline",
    });
    if (!ok) return;
    submittedRef.current = true;
    const target = edit;
    animateOut(() => onDelete(target));
  }

  const valid = typed != null && typed >= minD && typed <= maxD;

  // Descriptive, never blocking: the value is still saved exactly as entered.
  const aboveMeterRange = glucoseAboveCeiling(typed, unit);

  // Live status for the big number. It runs the SAME classification the journal
  // and dashboard use, against the same profile range and period, so the colour
  // the user sees while typing is the colour the saved entry gets. Never the
  // sole cue: the numeral and a labelled chip always accompany it.
  const mgdlNow = valid && typed != null ? glucoseFromDisplay(typed, unit) : null;
  const liveStatus: GlucoseStatus | null =
    mgdlNow == null ? null : classifyGlucose(mgdlNow, period, profile ?? {});
  const numColor = liveStatus ? RICH_BY_STATUS[liveStatus] : THEME.text;

  function statusLabel(status: GlucoseStatus): string {
    return t(statusLabelKey(status));
  }

  return (
    <Modal
      visible={visible}
      transparent
      // The slide is driven here instead (native driver, measured height), so
      // the keyboard can rise in the SAME motion as the sheet rather than
      // fighting a platform transition that has its own timing.
      animationType="none"
      onRequestClose={animateClose}
      onShow={() => heroRef.current?.focus()}
    >
      <View className="flex-1">
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: "#000", // theme-ok
              opacity: backdrop.interpolate({
                inputRange: [0, 1],
                outputRange: [0, 0.72],
              }),
            },
          ]}
        />
        {/* A bottom sheet has nothing to scroll into view, so it lifts as a whole.
            This is the case KeyboardAvoidingView is for; the scroll-container
            screens use automaticallyAdjustKeyboardInsets instead (lib/keyboard.ts).
            Inside a Modal the sheet starts at the window's own top, so the
            offset is 0 - anything else double-counts a header that is not there. */}
        <View ref={hostRef} collapsable={false} style={{ flex: 1 }}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={0}
          className="flex-1"
          style={androidLift > 0 ? { paddingBottom: androidLift } : undefined}
        >
          <Pressable
            style={{ flex: 1, justifyContent: "flex-end", paddingTop: insets.top }}
            onPress={animateClose}
            accessible={false}
            focusable={false}
            onLayout={(e) => setAvailH(Math.max(0, e.nativeEvent.layout.height - insets.top))}
          >
            {/* Capped at the lifted container's height: on a small phone the sheet
                is taller than what the keyboard leaves, and Save would otherwise
                be pushed off the top with no way to reach it. */}
            <Animated.View
              style={[
                { transform: [{ translateY }], maxHeight: availH > 0 ? availH : "100%" },
                sheetBoxStyle(layoutWidth, isWide, layoutHeight, availH > 0 ? availH : undefined, false),
              ]}
              onLayout={(e) => {
                const h = e.nativeEvent.layout.height;
                sheetHRef.current = h;
                if (appearedRef.current || h <= 0) return;
                appearedRef.current = true;
                translateY.setValue(h);
                Animated.parallel([
                  Animated.spring(translateY, {
                    toValue: 0,
                    useNativeDriver: true,
                    damping: 26,
                    stiffness: 260,
                    mass: 0.9,
                  }),
                  Animated.timing(backdrop, {
                    toValue: 1,
                    duration: 200,
                    useNativeDriver: true,
                  }),
                ]).start();
              }}
            >
            <Pressable
              onPress={(e) => e.stopPropagation()}
              accessible={false}
              focusable={false}
              importantForAccessibility="auto"
              style={[
                {
                  borderTopLeftRadius: RADIUS["2xl"],
                  borderTopRightRadius: RADIUS["2xl"],
                  borderTopWidth: 1,
                  borderLeftWidth: 1,
                  borderRightWidth: 1,
                  borderColor: THEME.border,
                  backgroundColor: THEME.bg.g1,
                  paddingHorizontal: SPACE.lg,
                  // ONE gap above the grabber; the row below carries the rest.
                  paddingTop: SPACE.sm,
                  overflow: "hidden",
                },
                isDialog
                  ? {
                      ...dialogCardStyle,
                      borderTopLeftRadius: dialogCardStyle.borderRadius,
                      borderTopRightRadius: dialogCardStyle.borderRadius,
                      flexShrink: 1,
                    }
                  : isWide
                    ? {
                        borderBottomLeftRadius: RADIUS["2xl"],
                        borderBottomRightRadius: RADIUS["2xl"],
                        borderBottomWidth: 1,
                        marginBottom: SPACE.xl,
                      }
                    : undefined,
                THEME.scheme === "light"
                  ? ELEVATION.sheet
                  : glow(liveStatus ? numColor : THEME.accent, 34, 0.35),
              ]}
            >
              {/* The mockup's bottom radial glow, tinted to the live status. */}
{THEME.scheme === "dark" ? (
              <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
                <Defs>
                  <RadialGradient id="sheetGlow" cx="50%" cy="118%" rx="110%" ry="55%">
                    <Stop offset="0" stopColor={numColor} stopOpacity={0.22} />
                    <Stop offset="1" stopColor={numColor} stopOpacity={0} />
                  </RadialGradient>
                </Defs>
                <Rect x="0" y="0" width="100%" height="100%" fill="url(#sheetGlow)" />
              </Svg>
) : null}

              <View {...pan.panHandlers}>
                {/* The grabber's own row IS the gap under it; the sheet's
                    paddingTop is the one above. No stacked py + mb. */}
                <View className="items-center" style={{ paddingBottom: SPACE.md }}>
                  <View
                    style={{
                      width: 38,
                      height: 4,
                      borderRadius: 9,
                      backgroundColor: THEME.border,
                    }}
                  />
                </View>
                <View className="flex-row items-center justify-between">
                  <View style={{ width: 28 }} />
                  <Txt kind="subtitle" numberOfLines={2} style={{ flex: 1, textAlign: "center" }}>
                    {edit ? t("calculator.editTitle") : t("dashboard.logGlucose")}
                  </Txt>
                  <Pressable
                    onPress={animateClose}
                    hitSlop={12}
                    accessibilityRole="button"
                    accessibilityLabel={t("common.close")}
                    style={{ width: 28, alignItems: "flex-end" }}
                  >
                    <Ionicons name="close" size={22} color={THEME.textMuted} />
                  </Pressable>
                </View>
              </View>

              {/* flexShrink lets the body give way when space is tight, and then
                  scroll. bounces={false} keeps it from fighting the drag handle. */}
              <ScrollView
                style={{ flexShrink: 1 }}
                bounces={false}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{
                  paddingBottom: compact ? SPACE.lg : SPACE.xl + SPACE.xs,
                  paddingTop: compact ? SPACE.xs : SPACE.md,
                }}
              >
                {/* Hero: the numeral is the screen. On a short phone with the
                    keyboard up it gives back height first, so the pills, the
                    time row and Save stay reachable instead of scrolling away. */}
                <View className="items-center">
                  <TextInput
                    ref={heroRef}
                    value={value}
                    onChangeText={onType}
                    keyboardType={mmol ? "decimal-pad" : "number-pad"}
                    placeholder={mmol ? num(6.1) : "110"}
                    placeholderTextColor={withAlpha(THEME.textMuted, 0.7)}
                    accessibilityLabel={`${edit ? t("calculator.editTitle") : t("dashboard.logGlucose")}, ${glucoseUnitLabel(unit)}`}
                    style={[
                      TABULAR,
                      INPUT_TEXT,
                      {
                        color: numColor,
                        fontSize: compact ? 40 : 56,
                        fontWeight: "800",
                        textAlign: "center",
                        minWidth: 150,
                        paddingVertical: 0,
                        textShadowColor: valid ? `${numColor}99` : "transparent",
                        textShadowRadius: 26,
                      },
                    ]}
                    maxLength={GLUCOSE_SHEET_MAX_CHARS}
                  />
                  <Txt kind="caption" tone="muted" style={{ marginTop: compact ? 0 : -SPACE.xs }}>
                    {glucoseUnitLabel(unit)}
                  </Txt>
                  {wholeBad || pasteBad || aboveBad || belowBad ? (
                    <Txt
                      kind="caption"
                      style={{ color: THEME.warning, marginTop: SPACE.xs }}
                      accessibilityRole="alert"
                    >
                      {wholeBad
                        ? t("numeric.integerOnly")
                        : t("numeric.range", {
                            min: num(minD),
                            max: num(maxD),
                            unit: glucoseUnitLabel(unit),
                          })}
                    </Txt>
                  ) : null}
                  <View style={{ minHeight: 26, marginTop: compact ? SPACE.xs : SPACE.sm }}>
                    {liveStatus ? (
                      <GlucoseChip status={liveStatus} label={statusLabel(liveStatus)} />
                    ) : null}
                  </View>
                </View>

                {/* The fixed clinical class gets one purely descriptive line.
                    No diagnosis, no treatment, no instruction. The threshold is
                    rendered in the profile's own unit, so an mmol user is not
                    shown an mg/dL number they have to convert in their head.
                    aboveMeterRange (past what a consumer meter reports) is a
                    STRICT superset of veryHigh, so the two never need separate
                    boxes: one box, title always veryHighTitle, body swaps to the
                    meter-range note only when the value is past the ceiling. */}
                {liveStatus === "veryHigh" ? (
                  <View
                    className="rounded-2xl"
                    style={{
                      paddingHorizontal: SPACE.md,
                      paddingVertical: SPACE.md,
                      marginTop: SPACE.md,
                      borderWidth: 1,
                      borderColor: `${RICH_BY_STATUS.veryHigh}4d`,
                      backgroundColor: `${RICH_BY_STATUS.veryHigh}1a`,
                    }}
                  >
                    <Txt
                      kind="caption"
                      style={{
                        color: RICH_BY_STATUS.veryHigh,
                        fontWeight: "800",
                        marginBottom: SPACE.xs,
                      }}
                    >
                      {t("glucose.veryHighTitle")}
                    </Txt>
                    <Txt kind="caption" style={{ opacity: 0.85 }}>
                      {aboveMeterRange
                        ? t("glucose.aboveMeterRange", {
                            max: num(GLUCOSE_INPUT_CEILING[unit]),
                            unit: glucoseUnitLabel(unit),
                          })
                        : t("glucose.veryHighNote", {
                            value: formatGlucose(VERY_HIGH_MGDL, unit),
                            unit: glucoseUnitLabel(unit),
                          })}
                    </Txt>
                  </View>
                ) : null}

                {/* Period as pill buttons. A wrapping, centered row: a horizontal scroller
                    clipped the long DE/TR labels at the edge with no cue. */}
                <View
                  style={{
                    marginTop: compact ? SPACE.md : SPACE.lg,
                    flexDirection: "row",
                    flexWrap: "wrap",
                    justifyContent: "center",
                    gap: SPACE.sm,
                  }}
                >
                  {PERIODS.map((p) => (
                    <Chip
                      key={p}
                      label={t(`period.${p}`)}
                      selected={p === period}
                      onPress={() => setPeriod(p)}
                      className="max-w-full"
                    />
                  ))}
                </View>

                {/* When the reading was taken (date + time, never in the future) */}
                <View style={{ marginTop: compact ? SPACE.md : SPACE.lg }}>
                  <Row
                    icon="time-outline"
                    label={`${relativeDay((loggedAt ?? new Date()).toISOString(), {
                      today: t("common.today"),
                      yesterday: t("common.yesterday"),
                    })} · ${formatTime((loggedAt ?? new Date()).toISOString())}`}
                    onPress={() => {
                      Keyboard.dismiss();
                      setTimePickerOpen((v) => !v);
                    }}
                  />
                </View>
                <InlineDateTimePicker
                  visible={timePickerOpen}
                  value={loggedAt ?? new Date()}
                  max={new Date()}
                  locale={i18n.language}
                  onChange={setLoggedAt}
                  onClose={() => setTimePickerOpen(false)}
                />

                <TagPicker
                  value={tags}
                  onChange={setTags}
                  className={compact ? "mt-3 mb-3" : "mt-4 mb-4"}
                />

                <GradientCTA label={t("common.save")} disabled={!valid} onPress={submit} />

                {edit && onDelete ? (
                  <View style={{ marginTop: compact ? SPACE.sm : SPACE.md }}>
                    <Button
                      label={t("common.delete")}
                      variant="destructive"
                      onPress={handleDelete}
                      icon={<Ionicons name="trash-outline" size={16} color={THEME.danger} />}
                    />
                  </View>
                ) : null}
              </ScrollView>
            </Pressable>
            </Animated.View>
          </Pressable>
        </KeyboardAvoidingView>
        </View>
      {/* This sheet is an RN <Modal>, i.e. its own view controller. The
          FeedbackHost a SCREEN renders lives in the screen's controller, which
          is UNDERNEATH this one - so a confirm() raised from here used to be
          painted behind the sheet: invisible, untappable, and the promise it
          returns never settled, which left the action that awaited it hanging.
          Hosts are a stack and only the topmost one paints (lib/feedback.ts
          activeHostId), so mounting one here while the sheet is open puts the
          dialog in the right controller and hands it back to the screen on
          close. Guarded on `visible` so a closed sheet never takes the stack. */}
      {visible ? <FeedbackHost /> : null}
      </View>
    </Modal>
  );
}
