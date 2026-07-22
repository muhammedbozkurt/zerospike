import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";

import type { GlucoseUnit, LogTag, PeriodTag } from "../lib/db/types";
import type { GlucoseStatus, TargetProfile } from "../lib/glucose";
import {
  classifyGlucose,
  glucoseFromDisplay,
  glucoseToDisplay,
  glucoseUnitLabel,
} from "../lib/glucose";
import { TagPicker } from "./TagPicker";
import { InlineDateTimePicker } from "./InlineDateTimePicker";
import { formatTime, relativeDay } from "../lib/format";
import { RADIUS, RICH_BY_STATUS, TABULAR, THEME, glow } from "../lib/theme/tokens";
import { GlucoseChip } from "./rich/GlucoseChip";
import { GradientCTA } from "./rich/GradientCTA";
import { PressableScale } from "../lib/theme/motion";

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
}: Props) {
  const { t, i18n } = useTranslation();
  const [value, setValue] = useState("");
  const [period, setPeriod] = useState<PeriodTag>(initialPeriod);
  const [tags, setTags] = useState<LogTag[]>([]);
  // null keeps the "log it as of now" default; a Date is an explicit pick.
  const [loggedAt, setLoggedAt] = useState<Date | null>(null);
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const translateY = useRef(new Animated.Value(0)).current;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const mmol = unit === "mmol";
  const minD = mmol ? 0.5 : 1;
  const maxD = mmol ? 50 : 900;

  useEffect(() => {
    if (visible) {
      if (edit) {
        setValue(String(glucoseToDisplay(edit.glucose_level_mgdl, unit)));
        setPeriod(edit.period_tag);
        setTags(edit.tags);
        setLoggedAt(new Date(edit.logged_at));
      } else {
        setValue("");
        setPeriod(initialPeriod);
        setTags([]);
        setLoggedAt(null);
      }
      setTimePickerOpen(false);
      translateY.setValue(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initialPeriod, edit?.id]);

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
          Animated.timing(translateY, {
            toValue: 700,
            duration: 180,
            useNativeDriver: true,
          }).start(() => closeRef.current());
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

  function onType(s: string) {
    const clean = mmol
      ? s.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1")
      : s.replace(/[^0-9]/g, "");
    setValue(clean);
  }

  function submit() {
    const num = parseFloat(value);
    if (!Number.isFinite(num) || num < minD || num > maxD) return;
    onSubmit(glucoseFromDisplay(num, unit), period, tags, loggedAt);
  }

  const valid = (() => {
    const n = parseFloat(value);
    return Number.isFinite(n) && n >= minD && n <= maxD;
  })();

  // Live status for the big number. It runs the SAME classification the journal
  // and dashboard use, against the same profile range and period, so the colour
  // the user sees while typing is the colour the saved entry gets. Never the
  // sole cue: the numeral and a labelled chip always accompany it.
  const mgdlNow = valid ? glucoseFromDisplay(parseFloat(value), unit) : null;
  const liveStatus: GlucoseStatus | null =
    mgdlNow == null ? null : classifyGlucose(mgdlNow, period, profile ?? {});
  const numColor = liveStatus ? RICH_BY_STATUS[liveStatus] : THEME.ink;

  function statusLabel(status: GlucoseStatus): string {
    switch (status) {
      case "normal":
        return t("insights.inRange");
      case "low":
        return t("insights.low");
      case "veryHigh":
        return t("insights.veryHigh");
      default:
        return t("insights.high");
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* A bottom sheet has nothing to scroll into view, so it lifts as a whole.
          This is the case KeyboardAvoidingView is for; the scroll-container
          screens use automaticallyAdjustKeyboardInsets instead (lib/keyboard.ts). */}
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1"
      >
        <Pressable
          style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.72)" }}
          onPress={onClose}
        >
          {/* Capped at the lifted container's height: on a small phone the sheet
              is taller than what the keyboard leaves, and Save would otherwise
              be pushed off the top with no way to reach it. */}
          <Animated.View style={{ transform: [{ translateY }], maxHeight: "100%" }}>
            <Pressable
              onPress={(e) => e.stopPropagation()}
              style={[
                {
                  borderTopLeftRadius: 26,
                  borderTopRightRadius: 26,
                  borderTopWidth: 1,
                  borderLeftWidth: 1,
                  borderRightWidth: 1,
                  borderColor: THEME.border,
                  backgroundColor: THEME.bg.g1,
                  paddingHorizontal: 18,
                  paddingTop: 10,
                  overflow: "hidden",
                },
                glow(liveStatus ? numColor : THEME.accent, 34, 0.35),
              ]}
            >
              {/* The mockup's bottom radial glow, tinted to the live status. */}
              <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
                <Defs>
                  <RadialGradient id="sheetGlow" cx="50%" cy="118%" rx="110%" ry="55%">
                    <Stop offset="0" stopColor={numColor} stopOpacity={0.22} />
                    <Stop offset="1" stopColor={numColor} stopOpacity={0} />
                  </RadialGradient>
                </Defs>
                <Rect x="0" y="0" width="100%" height="100%" fill="url(#sheetGlow)" />
              </Svg>

              <View {...pan.panHandlers}>
                <View className="items-center py-1 mb-1">
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
                  <Text style={{ color: THEME.ink, fontSize: 17, fontWeight: "800" }}>
                    {edit ? t("calculator.editTitle") : t("dashboard.logGlucose")}
                  </Text>
                  <Pressable onPress={onClose} hitSlop={12} style={{ width: 28, alignItems: "flex-end" }}>
                    <Ionicons name="close" size={22} color={THEME.muted} />
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
                contentContainerStyle={{ paddingBottom: 30, paddingTop: 12 }}
              >
                {/* Hero: the numeral is the screen. */}
                <View className="items-center">
                  <TextInput
                    value={value}
                    onChangeText={onType}
                    keyboardType={mmol ? "decimal-pad" : "number-pad"}
                    autoFocus
                    placeholder={mmol ? "6.1" : "110"}
                    placeholderTextColor="rgba(137,163,176,0.4)"
                    style={[
                      TABULAR,
                      {
                        color: numColor,
                        fontSize: 56,
                        lineHeight: 64,
                        fontWeight: "800",
                        textAlign: "center",
                        minWidth: 150,
                        textShadowColor: valid ? `${numColor}99` : "transparent",
                        textShadowRadius: 26,
                      },
                    ]}
                    maxLength={mmol ? 4 : 3}
                  />
                  <Text style={{ color: THEME.muted, fontSize: 12, marginTop: -4 }}>
                    {glucoseUnitLabel(unit)}
                  </Text>
                  <View style={{ minHeight: 26, marginTop: 8 }}>
                    {liveStatus ? (
                      <GlucoseChip status={liveStatus} label={statusLabel(liveStatus)} />
                    ) : null}
                  </View>
                </View>

                {/* The fixed clinical class gets one line of neutral, general
                    information. No diagnosis, no treatment, no instruction. */}
                {liveStatus === "veryHigh" ? (
                  <View
                    className="rounded-2xl px-3.5 py-3 mt-3"
                    style={{
                      borderWidth: 1,
                      borderColor: `${RICH_BY_STATUS.veryHigh}4d`,
                      backgroundColor: `${RICH_BY_STATUS.veryHigh}1a`,
                    }}
                  >
                    <Text
                      style={{
                        color: RICH_BY_STATUS.veryHigh,
                        fontSize: 12,
                        fontWeight: "800",
                        marginBottom: 2,
                      }}
                    >
                      {t("glucose.veryHighTitle")}
                    </Text>
                    <Text style={{ color: THEME.ink, fontSize: 12, lineHeight: 18, opacity: 0.85 }}>
                      {t("glucose.veryHighNote")}
                    </Text>
                  </View>
                ) : null}

                {/* Period as pill buttons, the mockup's row of small CTAs. */}
                <View className="flex-row flex-wrap justify-center mt-5" style={{ gap: 6 }}>
                  {PERIODS.map((p) => {
                    const on = p === period;
                    return (
                      <PressableScale
                        key={p}
                        onPress={() => setPeriod(p)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                        style={[
                          {
                            borderRadius: RADIUS.md,
                            paddingHorizontal: 12,
                            paddingVertical: 9,
                            borderWidth: 1,
                            borderColor: on ? THEME.accent : THEME.border,
                            backgroundColor: on ? "rgba(46,230,255,0.16)" : THEME.glass,
                          },
                          on ? glow(THEME.accent, 12, 0.4) : undefined,
                        ]}
                      >
                        <Text
                          style={{
                            color: on ? THEME.accent : THEME.muted,
                            fontSize: 12,
                            fontWeight: "700",
                          }}
                        >
                          {t(`period.${p}`)}
                        </Text>
                      </PressableScale>
                    );
                  })}
                </View>

                {/* When the reading was taken (date + time, never in the future) */}
                <Pressable
                  onPress={() => {
                    Keyboard.dismiss();
                    setTimePickerOpen((v) => !v);
                  }}
                  className="flex-row items-center mt-5"
                  style={{
                    borderRadius: RADIUS.md,
                    borderWidth: 1,
                    borderColor: THEME.border,
                    backgroundColor: THEME.glass,
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                  }}
                >
                  <Ionicons name="time-outline" size={16} color={THEME.muted} />
                  <Text style={{ color: THEME.ink, marginLeft: 8, fontSize: 13 }}>
                    {relativeDay((loggedAt ?? new Date()).toISOString(), {
                      today: t("common.today"),
                      yesterday: t("common.yesterday"),
                    })}
                    {" · "}
                    {formatTime((loggedAt ?? new Date()).toISOString())}
                  </Text>
                </Pressable>
                <InlineDateTimePicker
                  visible={timePickerOpen}
                  value={loggedAt ?? new Date()}
                  max={new Date()}
                  locale={i18n.language}
                  onChange={setLoggedAt}
                  onClose={() => setTimePickerOpen(false)}
                />

                <TagPicker value={tags} onChange={setTags} className="mt-4 mb-5" />

                <GradientCTA label={t("common.save")} disabled={!valid} onPress={submit} />
              </ScrollView>
            </Pressable>
          </Animated.View>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
