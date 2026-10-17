import React from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import { hapticSelect } from "../lib/haptics";
import { RADIUS, TABULAR, THEME } from "../lib/theme/tokens";
import { withAlpha } from "./rich/GlassCard";
import type { DayBucket, ReminderPreset } from "../lib/reminderPresets";

/**
 * The ready-made measurement layout, as a PREVIEW: nothing here writes
 * anything. The rows are drawn, any line can be removed first, and the caller
 * owns both the "Set up this plan" action (lib/services/reminderPlan.ts) and
 * the "Not now" one next to it.
 *
 * Shared by the onboarding step and by the second-profile setup screen so the
 * two cannot drift - see the note in lib/services/reminderPlan.ts. Onboarding
 * puts its CTA in the quiz footer and profile setup puts it inside the card, so
 * only the LIST is shared here; the action is not.
 *
 * No diabetes type is ever named on this surface, and no frequency is ever
 * framed as advice - see lib/reminderPresets.ts.
 */

/**
 * A preset row's REAL name, from the part of the day its time falls in (see
 * dayBucketOf). Written into the row, not derived at read time: the user can
 * rename it afterwards like any other reminder, and a language change must not
 * silently rewrite a name they have since made their own - the same rule the
 * screenshot seed's custom row already follows.
 */
export function usePresetLabel(): (bucket: DayBucket) => string {
  const { t } = useTranslation();
  return (bucket: DayBucket) => {
    switch (bucket) {
      case "morning":
        return t("reminders.presetMorning");
      case "lateMorning":
        return t("reminders.presetLateMorning");
      case "midday":
        return t("reminders.presetMidday");
      case "afternoon":
        return t("reminders.presetAfternoon");
      case "evening":
        return t("reminders.presetEvening");
      case "night":
      default:
        return t("reminders.presetNight");
    }
  };
}

export function ReminderPlanPreview({
  rows,
  onRemove,
  alarmKitAvailable,
}: {
  rows: ReminderPreset[];
  onRemove: (time: string) => void;
  /** The alarm framing only appears where AlarmKit exists (iOS 26+); anywhere
   *  else the reminder is a notification and saying otherwise would be a
   *  promise the OS cannot keep. */
  alarmKitAvailable: boolean;
}) {
  const { t } = useTranslation();
  const presetLabel = usePresetLabel();

  return (
    <>
      {rows.map((preset) => (
        <View
          key={preset.time}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 14,
            minHeight: 58,
            paddingHorizontal: 16,
            paddingVertical: 14,
            marginBottom: 12,
            borderRadius: RADIUS.lg,
            borderWidth: 1,
            borderColor: THEME.border,
            backgroundColor: THEME.surface,
          }}
        >
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 11,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: withAlpha(THEME.accent, 0.1),
            }}
          >
            <Ionicons name="water-outline" size={20} color={THEME.accent} />
          </View>
          <Text
            style={{ color: THEME.text, fontSize: 15, lineHeight: 21, flex: 1 }}
            numberOfLines={1}
          >
            {presetLabel(preset.bucket)}
          </Text>
          <Text style={[TABULAR, { color: THEME.text, fontSize: 16, fontWeight: "700" }]}>
            {preset.time}
          </Text>
          <Pressable
            onPress={() => {
              hapticSelect();
              onRemove(preset.time);
            }}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={t("onboarding.planRemoveA11y")}
            style={{
              width: 28,
              height: 28,
              borderRadius: RADIUS.full,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: THEME.surfaceInset,
            }}
          >
            <Ionicons name="close" size={14} color={THEME.textMuted} />
          </Pressable>
        </View>
      ))}
      {alarmKitAvailable && rows.length > 0 ? (
        <Text className="text-mut text-sm leading-5 mt-2">
          {t("onboarding.alarmNote")}
        </Text>
      ) : null}
    </>
  );
}
