import React, { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";

import { SheetShell } from "./SheetShell";
import { Stepper } from "./Stepper";
import { GradientCTA } from "./rich/GradientCTA";
import { withAlpha } from "./rich/GlassCard";
import {
  clampPostMealLateMinutes,
  startPostMealLate,
  POST_MEAL_WINDOW_MIN,
  POST_MEAL_LATE_MAX_MIN,
} from "../lib/postMealTimer";
import { hapticSelect } from "../lib/haptics";
import { GLUCOSE_RICH, HIT_TARGET, THEME } from "../lib/theme/tokens";

/** How long ago the meal began, as one tap. Short offsets, because this is
 *  for "I forgot to press it" and not for logging yesterday's dinner;
 *  anything longer goes through the custom control. */
const LATE_PRESETS = [5, 10, 15, 20, 30] as const;

/** The late-start custom control's step. Coarse enough to sweep the whole
 *  range without a keyboard, fine enough to land on a real answer. */
const LATE_CUSTOM_STEP = 5;

/**
 * The five late-start offsets, as one row of EQUAL chips.
 *
 * Not the shared Segmented (2.3.0's G17): that one sizes each chip to its own
 * text and wraps, and five content-sized chips add up to more than this
 * sheet's own width leaves - so the last one dropped alone onto a second line.
 * Equal flex-basis puts all five on one line at any width instead of relying
 * on the labels staying short, and the text scales down rather than wrapping
 * in the language where it does not.
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
      {LATE_PRESETS.map((m) => {
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
 * The dashboard card's own "pick a length" pill opens this sheet, which asks
 * exactly ONE question: when did the meal actually start. The countdown
 * itself is never a choice any more - it always runs POST_MEAL_WINDOW_MIN
 * (lib/postMealTimer.ts's own doc comment on that constant); P14 removed the
 * sheet's earlier first section (a typed/preset countdown length) once the
 * card's pill stopped showing a value to edit in the first place.
 *
 * Built on components/SheetShell.tsx (2.3.1's keyboard-avoidance fix): the
 * late-start Stepper's middle is a real TextInput, and SheetShell's own
 * keyboard listeners are field-agnostic (they answer "is a keyboard up", not
 * "which field opened it"), so the sheet still lifts clear of the keyboard
 * exactly as it did with two fields.
 */
export function PostMealDurationSheet({
  visible,
  onClose,
  onStart,
  onAddReading,
}: {
  visible: boolean;
  onClose: () => void;
  /** How many minutes ago the meal began (never past POST_MEAL_LATE_MAX_MIN,
   *  so there is always a window left to arm). The countdown length itself is
   *  always POST_MEAL_WINDOW_MIN. */
  onStart: (minutesAgo: number) => void;
  /** The way out when the window is already over: record the reading now
   *  instead of arming a countdown that has nothing left to count. */
  onAddReading: () => void;
}) {
  const { t } = useTranslation();

  // Resets to the first preset on every open - nothing here is saved.
  const [minutesAgo, setMinutesAgo] = useState<number>(LATE_PRESETS[0]);
  const [lateCustomOpen, setLateCustomOpen] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setMinutesAgo(LATE_PRESETS[0]);
    setLateCustomOpen(false);
  }, [visible]);

  const activeLateChip = LATE_PRESETS.find((p) => p === minutesAgo);
  // Live answer, from the same pure function that will actually arm the timer -
  // so what the sheet promises and what gets scheduled cannot disagree.
  const preview = startPostMealLate({ minutesAgo, now: Date.now() });
  const elapsed = preview.kind === "elapsed";

  return (
    <SheetShell
      visible={visible}
      onClose={onClose}
      title={t("dashboard.postMealLateTitle")}
      closeLabel={t("common.close")}
      footer={
        // One primary action, and it changes with the answer: a window that
        // has already run out has nothing to arm, so the way forward is the
        // reading itself rather than a countdown that would end instantly.
        <GradientCTA
          label={elapsed ? t("dashboard.postMealLateAddReading") : t("dashboard.postMealLateStart")}
          onPress={() => {
            if (elapsed) onAddReading();
            else onStart(clampPostMealLateMinutes(minutesAgo, POST_MEAL_WINDOW_MIN));
          }}
        />
      }
    >
      <Text style={{ color: THEME.muted, fontSize: 12, lineHeight: 17, marginBottom: 14 }}>
        {t("dashboard.postMealLateHint", { n: POST_MEAL_WINDOW_MIN })}
      </Text>

      <LateChips
        value={activeLateChip ?? -1}
        onChange={(m) => {
          setMinutesAgo(clampPostMealLateMinutes(m, POST_MEAL_WINDOW_MIN));
          setLateCustomOpen(false);
        }}
      />

      <Pressable
        onPress={() => setLateCustomOpen((v) => !v)}
        accessibilityRole="button"
        className="flex-row items-center mt-3"
        style={{ minHeight: HIT_TARGET }}
      >
        <Ionicons
          name={lateCustomOpen ? "chevron-down" : "chevron-forward"}
          size={16}
          color={THEME.accent}
        />
        <Text style={{ color: THEME.accent, fontSize: 13, fontWeight: "700", marginLeft: 6 }}>
          {t("dashboard.postMealLateOther")}
        </Text>
      </Pressable>

      {lateCustomOpen ? (
        <View className="mt-1 mb-2">
          <Stepper
            value={minutesAgo}
            onChange={(v) => setMinutesAgo(clampPostMealLateMinutes(v, POST_MEAL_WINDOW_MIN))}
            step={LATE_CUSTOM_STEP}
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
    </SheetShell>
  );
}
