import React from "react";
import { Image, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import type { JournalEntry } from "../lib/db/journal";
import type { LogTag, UserProfile } from "../lib/db/types";
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
  low: "#3b82f6",
  normal: "#10b981",
  elevated: "#f59e0b",
  high: "#f43f5e",
};

function TagBadges({ tags }: { tags: LogTag[] }) {
  const { t } = useTranslation();
  if (tags.length === 0) return null;
  return (
    <View className="flex-row flex-wrap mt-1">
      {tags.map((tag) => (
        <View
          key={tag}
          className="rounded-full bg-brand/10 border border-brand/20 px-1.5 py-0.5 mr-1 mb-0.5"
        >
          <Text className="text-brand text-[10px] font-medium">
            {t(`tags.${tag}`)}
          </Text>
        </View>
      ))}
    </View>
  );
}

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
              {status === "low" ? (
                // A hypo must read as a LOW, never like a high — distinct
                // label + cold color so it is never mistaken for hyperglycemia.
                <View
                  className="ml-2 rounded-full px-1.5 py-0.5"
                  style={{ backgroundColor: `${color}22` }}
                >
                  <Text className="text-[10px] font-bold" style={{ color }}>
                    {t("journal.lowBadge")}
                  </Text>
                </View>
              ) : null}
            </View>
            <TagBadges tags={entry.tags} />
          </View>
          <Text className="text-zinc-500 text-xs">
            {formatTime(entry.logged_at)}
          </Text>
        </View>
      </Pressable>
    );
  }

  if (entry.kind === "injection") {
    const meta = [
      entry.dose_units != null
        ? `${num(entry.dose_units)} ${t("common.units")}`
        : null,
      entry.pen_name,
    ]
      .filter(Boolean)
      .join(" · ");
    return (
      <Pressable
        onPress={() => onPress?.(entry)}
        onLongPress={() => onLongPress?.(entry)}
        className="flex-row items-center rounded-2xl bg-zinc-900 border border-zinc-800 mb-2.5 overflow-hidden"
        style={{ borderLeftWidth: 4, borderLeftColor: "#22d3ee" }}
      >
        <View className="p-3.5 flex-1 flex-row items-center">
          <View className="w-10 h-10 rounded-full items-center justify-center mr-3 bg-brand/10">
            <Ionicons name="medkit-outline" size={20} color="#22d3ee" />
          </View>
          <View className="flex-1">
            <Text className="text-zinc-100 font-semibold" numberOfLines={1}>
              {t(`injectionSite.${entry.site}`)}
            </Text>
            {meta ? <Text className="text-zinc-400 text-xs">{meta}</Text> : null}
            {entry.note ? (
              <Text className="text-zinc-500 text-xs italic mt-0.5" numberOfLines={1}>
                {`“${entry.note}”`}
              </Text>
            ) : null}
            <TagBadges tags={entry.tags} />
          </View>
          <Text className="text-zinc-500 text-xs">{formatTime(entry.logged_at)}</Text>
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
          <TagBadges tags={entry.tags} />
        </View>
        <Text className="text-zinc-500 text-xs">
          {formatTime(entry.logged_at)}
        </Text>
      </View>
    </Pressable>
  );
}
