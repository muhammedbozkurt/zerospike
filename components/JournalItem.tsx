import React from "react";
import { Image, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import type { JournalEntry } from "../lib/db/journal";
import type { UserProfile } from "../lib/db/types";
import {
  classifyGlucose,
  STATUS_COLOR,
  GlucoseStatus,
  formatGlucose,
  glucoseUnitLabel,
} from "../lib/glucose";
import { formatTime } from "../lib/format";
import { num } from "../lib/format";

const STATUS_BORDER_COLOR: Record<GlucoseStatus, string> = {
  normal: "#10b981",
  elevated: "#f59e0b",
  high: "#f43f5e",
};

interface Props {
  entry: JournalEntry;
  profile: UserProfile;
  onLongPress?: (entry: JournalEntry) => void;
  onPress?: (entry: JournalEntry) => void;
}

export function JournalItem({ entry, profile, onLongPress, onPress }: Props) {
  const { t } = useTranslation();

  if (entry.kind === "glucose") {
    const status = classifyGlucose(
      entry.glucose_level_mgdl,
      entry.period_tag,
      profile
    );
    const color = STATUS_COLOR[status];
    return (
      <Pressable
        onPress={() => onPress?.(entry)}
        onLongPress={() => onLongPress?.(entry)}
        className="flex-row items-center rounded-2xl bg-zinc-900 border border-zinc-800 mb-2.5 overflow-hidden"
        style={{ borderLeftWidth: 4, borderLeftColor: STATUS_BORDER_COLOR[status] }}
      >
        <View className="p-3.5 flex-1 flex-row items-center">
          <View
            className="w-10 h-10 rounded-full items-center justify-center mr-3"
            style={{ backgroundColor: `${color}22` }}
          >
            <Ionicons name="water-outline" size={20} color={color} />
          </View>
          <View className="flex-1">
            <Text className="text-zinc-400 text-xs">
              {t(`period.${entry.period_tag}`)}
              {entry.source === "health" ? " · CGM" : ""}
            </Text>
            <View className="flex-row items-baseline">
              <Text className="text-2xl font-bold" style={{ color }}>
                {formatGlucose(entry.glucose_level_mgdl, profile.glucose_unit)}
              </Text>
              <Text className="text-zinc-500 text-xs ml-1">
                {glucoseUnitLabel(profile.glucose_unit)}
              </Text>
            </View>
          </View>
          <Text className="text-zinc-500 text-xs">
            {formatTime(entry.logged_at)}
          </Text>
        </View>
      </Pressable>
    );
  }

  // meal entry
  return (
    <Pressable
      onPress={() => onPress?.(entry)}
      onLongPress={() => onLongPress?.(entry)}
      className="flex-row items-center rounded-2xl bg-zinc-900 border border-zinc-800 mb-2.5 overflow-hidden"
      style={{ borderLeftWidth: 4, borderLeftColor: "#64748b" }}
    >
      <View className="p-3.5 flex-1 flex-row items-center">
        {entry.photo_uri_local ? (
          <Image
            source={{ uri: entry.photo_uri_local }}
            className="w-10 h-10 rounded-lg mr-3"
          />
        ) : (
          <View className="w-10 h-10 rounded-full items-center justify-center mr-3 bg-slate-500/15">
            <Ionicons name="restaurant-outline" size={20} color="#94a3b8" />
          </View>
        )}
        <View className="flex-1">
          <Text className="text-zinc-100 font-semibold" numberOfLines={1}>
            {entry.display_name}
          </Text>
          <Text className="text-zinc-400 text-xs">
            {Math.round(entry.portion_g)} {t("common.grams")} ·{" "}
            {t("journal.carbsLabel", {
              carbs: num(Math.round(entry.calculated_carbs_g * 10) / 10),
            })}{" "}
            · {t("journal.doseLabel", { dose: num(entry.insulin_dose_units) })}
          </Text>
          {entry.personal_note ? (
            <Text className="text-zinc-500 text-xs italic mt-0.5" numberOfLines={1}>
              “{entry.personal_note}”
            </Text>
          ) : null}
        </View>
        <Text className="text-zinc-500 text-xs">
          {formatTime(entry.logged_at)}
        </Text>
      </View>
    </Pressable>
  );
}
