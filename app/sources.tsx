import React from "react";
import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { FeedbackHost } from "../components/Feedback";

/**
 * Medical information sources (App Store Guideline 1.4.1).
 *
 * Lists the publicly available clinical references behind the carb-counting and
 * insulin-estimation methods, plus a plain-language description of the formulas.
 * Reached from Settings → "Medical information & sources" and from the
 * calculator's dose card, so the citations are easy for the user to find.
 *
 * Links are to authoritative, language-neutral health organisations and stay
 * the same across all app languages.
 */
const REFERENCES: { label: string; org: string; url: string }[] = [
  {
    org: "American Diabetes Association (ADA)",
    label: "Diabetes management & treatment",
    url: "https://diabetes.org/",
  },
  {
    org: "American Diabetes Association (ADA)",
    label: "Understanding carbohydrates & carb counting",
    url: "https://diabetes.org/food-nutrition/understanding-carbs",
  },
  {
    org: "NIDDK, National Institutes of Health (NIH)",
    label: "Managing diabetes (insulin & carbohydrates)",
    url: "https://www.niddk.nih.gov/health-information/diabetes/overview/managing-diabetes",
  },
  {
    org: "Centers for Disease Control and Prevention (CDC)",
    label: "Diabetes & healthy eating (carbohydrates)",
    url: "https://www.cdc.gov/diabetes/healthy-eating/index.html",
  },
  {
    org: "MedlinePlus, National Library of Medicine (NIH)",
    label: "Diabetes medicines & insulin",
    url: "https://medlineplus.gov/diabetesmedicines.html",
  },
  {
    org: "Diabetes Care (ADA), Bergenstal et al. 2018",
    label: "Glucose Management Indicator (GMI)",
    url: "https://diabetesjournals.org/care/article/41/11/2275/36593/Glucose-Management-Indicator-GMI-A-New-Term-for",
  },
];

export default function SourcesScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View className="flex-1 bg-zinc-950">
      <View className="flex-1" style={{ paddingTop: insets.top }}>
        {/* Header */}
        <View className="flex-row items-center justify-between px-4 py-3 border-b border-zinc-900">
          <Text className="text-zinc-50 text-lg font-bold flex-1" numberOfLines={1}>
            {t("sources.title")}
          </Text>
          <Pressable onPress={() => router.back()} hitSlop={10} className="p-1">
            <Ionicons name="close" size={24} color="#a1a1aa" />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}
          showsVerticalScrollIndicator={false}
        >
          <Text className="text-zinc-300 leading-6 mb-6">{t("sources.intro")}</Text>

          {/* Formula explanation */}
          <View className="rounded-2xl bg-zinc-900 border border-zinc-800 p-4 mb-6">
            <Text className="text-zinc-100 font-semibold mb-2">
              {t("sources.methodTitle")}
            </Text>
            <Text className="text-zinc-400 leading-6">{t("sources.method")}</Text>
            <Text className="text-zinc-500 leading-5 text-xs mt-3">
              {t("sources.methodNote")}
            </Text>
            <Text className="text-zinc-500 leading-5 text-xs mt-2">
              {t("sources.iobNote")}
            </Text>
          </View>

          {/* References list */}
          <Text className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
            {t("sources.listTitle")}
          </Text>
          <View className="rounded-2xl bg-zinc-900 border border-zinc-800 overflow-hidden">
            {REFERENCES.map((ref, i) => (
              <Pressable
                key={ref.url}
                onPress={() => Linking.openURL(ref.url)}
                className={`flex-row items-center p-4 active:bg-zinc-800 ${
                  i > 0 ? "border-t border-zinc-800" : ""
                }`}
              >
                <View className="flex-1 pr-3">
                  <Text className="text-zinc-100 font-medium">{ref.label}</Text>
                  <Text className="text-zinc-500 text-xs mt-0.5">{ref.org}</Text>
                </View>
                <Ionicons name="open-outline" size={18} color="#52525b" />
              </Pressable>
            ))}
          </View>
          <Text className="text-zinc-600 text-xs mt-2 px-1">
            {t("sources.openHint")}
          </Text>
        </ScrollView>
      </View>
      <FeedbackHost />
    </View>
  );
}
