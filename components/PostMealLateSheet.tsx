import React, { useEffect, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";

import { Stepper } from "./Stepper";
import { GradientCTA } from "./rich/GradientCTA";
import {
  clampPostMealLateMinutes,
  startPostMealLate,
  POST_MEAL_LATE_MAX_MIN,
  POST_MEAL_WINDOW_MIN,
} from "../lib/postMealTimer";
import { hapticSelect } from "../lib/haptics";
import { GLUCOSE_RICH, HIT_TARGET, THEME, glow } from "../lib/theme/tokens";
import { withAlpha } from "./rich/GlassCard";

/** How long ago the meal began, as one tap. Short offsets, because this is for
 *  "I forgot to press it" and not for logging yesterday's dinner; anything
 *  longer goes through the custom control. */
const PRESETS = [5, 10, 15, 20, 30] as const;

/** The custom control's step. Coarse enough to sweep the whole range without a
 *  keyboard, fine enough to land on a real answer. */
const CUSTOM_STEP = 5;

/**
 * The five offsets, as one row of EQUAL chips.
 *
 * Not the shared Segmented (2.3.0's G17): that one sizes each chip to its own
 * text and wraps, and five content-sized chips add up to more than a 375pt
 * screen leaves inside this sheet - so the last one dropped alone onto a second
 * line. Equal flex-basis puts all five on one line at any width instead of
 * relying on the labels staying short, and the text scales down rather than
 * wrapping in the language where it does not.
 */
function LateChips({
  value,
  onChange,
}: {
  value: number;
  onChange: (minutes: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <View className="flex-row" style={{ gap: 6 }}>
      {PRESETS.map((m) => {
        const active = m === value;
        const label = t("dashboard.postMealLateChip", { n: m });
        return (
          <Pressable
            key={m}
            onPress={() => {
              if (!active) hapticSelect();
              onChange(m);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={label}
            className={`flex-1 rounded-full items-center justify-center border ${
              active ? "bg-brand border-brand" : "bg-glass border-hair"
            }`}
            style={{ paddingVertical: 8, paddingHorizontal: 2, minHeight: 36 }}
          >
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
              className={`text-sm font-medium ${active ? "text-black" : "text-mut"}`}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * "When did you start eating?" (2.3.0's G15).
 *
 * The post-meal window is a fixed two hours and nothing offers to change it.
 * What DOES need an answer is the common miss: the user ate, forgot to tap, and
 * remembers twenty minutes later. Starting a fresh two-hour countdown then
 * would put the check twenty minutes past where it belongs, so this asks how
 * long ago the meal began and the countdown is armed for what is LEFT of the
 * window, with its start moment backdated to the meal itself.
 *
 * Same Modal language as components/ReminderEditSheet.tsx.
 */
export function PostMealLateSheet({
  visible,
  onClose,
  onStart,
  onAddReading,
}: {
  visible: boolean;
  onClose: () => void;
  /** Called with a clamped whole number of minutes ago (never past
   *  POST_MEAL_LATE_MAX_MIN, so the caller always has a window to arm). */
  onStart: (minutesAgo: number) => void;
  /** The way out when the window is already over: record the reading now
   *  instead of arming a countdown that has nothing left to count. */
  onAddReading: () => void;
}) {
  const { t } = useTranslation();
  const [minutesAgo, setMinutesAgo] = useState<number>(PRESETS[0]);
  const [customOpen, setCustomOpen] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setMinutesAgo(PRESETS[0]);
    setCustomOpen(false);
  }, [visible]);

  const activeChip = PRESETS.find((p) => p === minutesAgo);
  // Live answer, from the same pure function that will actually arm the timer -
  // so what the sheet promises and what gets scheduled cannot disagree.
  const preview = startPostMealLate({ minutesAgo, now: Date.now() });
  const elapsed = preview.kind === "elapsed";

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.72)" }}
        onPress={onClose}
      >
        <Pressable
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
              paddingTop: 8,
              paddingBottom: 20,
            },
            glow(THEME.accent, 30, 0.3),
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          <View className="items-center mb-1.5">
            <View
              style={{ width: 38, height: 4, borderRadius: 9, backgroundColor: THEME.border }}
            />
          </View>

          <View className="flex-row items-center justify-between mb-1">
            <Text
              numberOfLines={2}
              style={{ color: THEME.ink, fontSize: 17, fontWeight: "800", flexShrink: 1 }}
            >
              {t("dashboard.postMealLateTitle")}
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={t("common.close")}
              className="p-1"
            >
              <Ionicons name="close" size={22} color={THEME.muted} />
            </Pressable>
          </View>
          <Text style={{ color: THEME.muted, fontSize: 12, lineHeight: 17, marginBottom: 14 }}>
            {t("dashboard.postMealLateHint", { n: POST_MEAL_WINDOW_MIN })}
          </Text>

          <LateChips
            value={activeChip ?? -1}
            onChange={(m) => {
              setMinutesAgo(clampPostMealLateMinutes(m));
              setCustomOpen(false);
            }}
          />

          <Pressable
            onPress={() => setCustomOpen((v) => !v)}
            accessibilityRole="button"
            className="flex-row items-center mt-3"
            style={{ minHeight: HIT_TARGET }}
          >
            <Ionicons
              name={customOpen ? "chevron-down" : "chevron-forward"}
              size={16}
              color={THEME.accent}
            />
            <Text
              style={{ color: THEME.accent, fontSize: 13, fontWeight: "700", marginLeft: 6 }}
            >
              {t("dashboard.postMealLateOther")}
            </Text>
          </Pressable>

          {customOpen ? (
            <View className="mt-1 mb-2">
              <Stepper
                value={minutesAgo}
                onChange={(v) => setMinutesAgo(clampPostMealLateMinutes(v))}
                step={CUSTOM_STEP}
                min={0}
                max={POST_MEAL_LATE_MAX_MIN}
                // The standalone minutes unit the insights screen already
                // carries in all nine languages - no second word for one unit.
                suffix={t("insights.minShort")}
                accessibilityLabel={t("dashboard.postMealLateTitle")}
              />
            </View>
          ) : null}

          {elapsed ? (
            <View
              className="rounded-xl px-3 py-2.5 mt-3"
              style={{
                borderWidth: 1,
                borderColor: withAlpha(GLUCOSE_RICH.high, 0.3),
                backgroundColor: withAlpha(GLUCOSE_RICH.high, 0.1),
              }}
            >
              <Text style={{ color: THEME.ink, fontSize: 12, lineHeight: 18 }}>
                {t("dashboard.postMealLatePassed", { n: POST_MEAL_WINDOW_MIN })}
              </Text>
            </View>
          ) : null}

          {/* One primary action, and it changes with the answer: a window that
              has already run out has nothing to arm, so the way forward is the
              reading itself rather than a countdown that would end instantly. */}
          <GradientCTA
            label={
              elapsed
                ? t("dashboard.postMealLateAddReading")
                : t("dashboard.postMealLateStart")
            }
            onPress={() =>
              elapsed ? onAddReading() : onStart(clampPostMealLateMinutes(minutesAgo))
            }
            style={{ marginTop: 14 }}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}
