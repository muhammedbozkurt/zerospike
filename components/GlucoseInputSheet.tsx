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
  Text,
  TextInput,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";

import type { GlucoseUnit, LogTag, PeriodTag } from "../lib/db/types";
import { glucoseFromDisplay, glucoseToDisplay, glucoseUnitLabel } from "../lib/glucose";
import { Button, Segmented } from "./ui";
import { TagPicker } from "./TagPicker";
import { InlineDateTimePicker } from "./InlineDateTimePicker";
import { formatTime, relativeDay } from "../lib/format";

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

export function GlucoseInputSheet({
  visible,
  initialPeriod = "fasting",
  unit = "mgdl",
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

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* A bottom sheet has nothing to scroll into view, so it lifts as a whole.
          This is the case KeyboardAvoidingView is for; the scroll-container
          screens use automaticallyAdjustKeyboardInsets instead (lib/keyboard.ts). */}
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1"
      >
        <Pressable className="flex-1 bg-black/70 justify-end" onPress={onClose}>
          {/* Capped at the lifted container's height: on a small phone the sheet
              is taller than what the keyboard leaves, and Save would otherwise
              be pushed off the top with no way to reach it. */}
          <Animated.View style={{ transform: [{ translateY }], maxHeight: "100%" }}>
            <Pressable
              className="rounded-t-3xl bg-zinc-950 border-t border-x border-zinc-800 px-5 pt-3"
              onPress={(e) => e.stopPropagation()}
            >
              <View {...pan.panHandlers}>
                <View className="items-center mb-2 py-1">
                  <View className="w-10 h-1 rounded-full bg-zinc-700" />
                </View>
                <View className="flex-row items-center justify-between mb-4">
                  <Text className="text-zinc-50 text-xl font-bold">
                    {edit ? t("calculator.editTitle") : t("dashboard.logGlucose")}
                  </Text>
                  <Pressable onPress={onClose} hitSlop={12} className="p-1">
                    <Ionicons name="close" size={24} color="#71717a" />
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
                contentContainerStyle={{ paddingBottom: 32 }}
              >
                <Text className="text-sm font-medium text-zinc-400 mb-2">
                  {t("dashboard.selectPeriod")}
                </Text>
                <Segmented
                  options={PERIODS.map((p) => ({ value: p, label: t(`period.${p}`) }))}
                  value={period}
                  onChange={setPeriod}
                  className="mb-5"
                />

                <View className="flex-row items-end justify-center mb-6">
                  <TextInput
                    value={value}
                    onChangeText={onType}
                    keyboardType={mmol ? "decimal-pad" : "number-pad"}
                    autoFocus
                    placeholder={mmol ? "6.1" : "110"}
                    placeholderTextColor="#3f3f46"
                    className="text-6xl font-bold text-zinc-50 text-center min-w-[120px]"
                    maxLength={mmol ? 4 : 3}
                  />
                  <Text className="text-zinc-500 text-lg mb-3 ml-2">
                    {glucoseUnitLabel(unit)}
                  </Text>
                </View>

                {/* When the reading was taken (date + time, never in the future) */}
                <Text className="text-sm font-medium text-zinc-400 mb-1.5">
                  {t("calculator.loggedTime")}
                </Text>
                <Pressable
                  onPress={() => {
                    Keyboard.dismiss();
                    setTimePickerOpen((v) => !v);
                  }}
                  className="flex-row items-center rounded-xl bg-zinc-800/80 border border-zinc-700 px-4 py-3 mb-5"
                >
                  <Ionicons name="time-outline" size={16} color="#a1a1aa" />
                  <Text className="text-zinc-50 ml-2">
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

                <TagPicker value={tags} onChange={setTags} className="mb-5" />

                <Button
                  label={t("common.save")}
                  size="lg"
                  disabled={!valid}
                  onPress={submit}
                />
              </ScrollView>
            </Pressable>
          </Animated.View>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
