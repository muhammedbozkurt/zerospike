import React from "react";
import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

/** Permanent, visible medical disclaimer banner (Settings + onboarding). */
export function DisclaimerBanner({ full = false }: { full?: boolean }) {
  const { t } = useTranslation();
  return (
    <View className="flex-row items-start rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
      <Ionicons name="medical-outline" size={18} color="#f59e0b" />
      <View className="flex-1 ml-3">
        <Text className="text-amber-300 font-semibold text-sm mb-0.5">
          {t("disclaimer.title")}
        </Text>
        <Text className="text-amber-200/80 text-xs leading-5">
          {full ? t("disclaimer.body") : t("disclaimer.short")}
        </Text>
      </View>
    </View>
  );
}
