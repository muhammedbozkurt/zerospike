import React from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { LOG_TAGS } from "../lib/db/types";
import type { LogTag } from "../lib/db/types";
import { hapticSelect } from "../lib/haptics";

/**
 * Optional multi-select context tags (Exercise, Illness, Stress…). Shared by the
 * glucose / meal / injection logging screens. Descriptive context only.
 */
export function TagPicker({
  value,
  onChange,
  className = "",
}: {
  value: LogTag[];
  onChange: (tags: LogTag[]) => void;
  className?: string;
}) {
  const { t } = useTranslation();

  const toggle = (tag: LogTag) => {
    hapticSelect();
    onChange(
      value.includes(tag) ? value.filter((x) => x !== tag) : [...value, tag]
    );
  };

  return (
    <View className={className}>
      <Text className="text-sm font-medium text-zinc-400 mb-1.5">
        {t("tags.label")}
      </Text>
      <View className="flex-row flex-wrap gap-2">
        {LOG_TAGS.map((tag) => {
          const active = value.includes(tag);
          return (
            <Pressable
              key={tag}
              onPress={() => toggle(tag)}
              className={`rounded-full border px-3 py-1.5 ${
                active
                  ? "border-brand bg-brand/10"
                  : "border-zinc-700 bg-zinc-800/60"
              }`}
            >
              <Text
                className={`text-sm ${active ? "text-brand font-medium" : "text-zinc-300"}`}
              >
                {t(`tags.${tag}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
