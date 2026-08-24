import React, { useEffect, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";

import { Segmented } from "./ui";
import { Stepper } from "./Stepper";
import { GradientCTA } from "./rich/GradientCTA";
import {
  clampPostMealMinutes,
  POST_MEAL_MAX_MINUTES,
  POST_MEAL_MIN_MINUTES,
} from "../lib/postMealTimer";
import { HIT_TARGET, THEME, glow } from "../lib/theme/tokens";

/** The chip row. Covers the ordinary cases in one tap; the saved preference's
 *  own list plus 180, which is the length the fixed list cannot express and the
 *  most common reason to reach for this sheet at all. */
const PRESETS = [60, 90, 120, 150, 180] as const;

/** How far one press of the custom stepper moves. Coarse enough to sweep the
 *  whole range without a keyboard, fine enough to land on a real choice. */
const CUSTOM_STEP = 15;

/**
 * "How long?" - a one-off length for THIS post-meal countdown (2.3.0's K2-C).
 *
 * Deliberately a sheet and not a screen: the decision is a single number, and
 * the dashboard behind it is the context. Same Modal language as
 * components/ReminderEditSheet.tsx.
 *
 * What it does NOT do is change the saved preference: the timer this starts is
 * a one-off, the 60/90/120/150 setting in Settings > Notifications stays
 * exactly as it was, and the copy under the title says so.
 */
export function PostMealDurationSheet({
  visible,
  defaultMinutes,
  onClose,
  onStart,
}: {
  visible: boolean;
  /** Where the sheet opens - the user's saved window, so the fastest path is
   *  still "the usual length". */
  defaultMinutes: number;
  onClose: () => void;
  /** Called with an already-clamped whole number of minutes. */
  onStart: (minutes: number) => void;
}) {
  const { t } = useTranslation();
  const [minutes, setMinutes] = useState(() => clampPostMealMinutes(defaultMinutes));
  const [customOpen, setCustomOpen] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const start = clampPostMealMinutes(defaultMinutes);
    setMinutes(start);
    // Defensive: today the caller always passes the saved window, which is
    // always one of the chips, so this opens closed. A length the chips cannot
    // show would otherwise present a row with nothing highlighted and no
    // visible way to see the number it is actually about.
    setCustomOpen(!PRESETS.some((p) => p === start));
  }, [visible, defaultMinutes]);

  const activeChip = PRESETS.find((p) => p === minutes);

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
              numberOfLines={1}
              style={{ color: THEME.ink, fontSize: 17, fontWeight: "800", flexShrink: 1 }}
            >
              {t("dashboard.postMealCustomTitle")}
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
            {t("dashboard.postMealCustomHint")}
          </Text>

          <Segmented
            options={PRESETS.map((m) => ({
              value: String(m),
              label: t("settings.minutes", { n: m }),
            }))}
            value={activeChip != null ? String(activeChip) : ""}
            onChange={(v) => {
              setMinutes(clampPostMealMinutes(Number(v)));
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
              {t("dashboard.postMealCustomOther")}
            </Text>
          </Pressable>

          {customOpen ? (
            <View className="mt-1 mb-2">
              <Stepper
                value={minutes}
                onChange={(v) => setMinutes(clampPostMealMinutes(v))}
                step={CUSTOM_STEP}
                min={POST_MEAL_MIN_MINUTES}
                max={POST_MEAL_MAX_MINUTES}
                // The standalone minutes unit the insights screen already
                // carries in all nine languages - no second word for one unit.
                suffix={t("insights.minShort")}
                accessibilityLabel={t("dashboard.postMealCustomTitle")}
              />
            </View>
          ) : null}

          <GradientCTA
            label={t("dashboard.postMealCustomStart")}
            onPress={() => onStart(clampPostMealMinutes(minutes))}
            style={{ marginTop: 14 }}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}
