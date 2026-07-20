import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { AppBackgroundFill } from "../components/rich";
import { useTranslation } from "react-i18next";

import { INJECTION_STEPS } from "../lib/data/injectionGuide";
import { FeedbackHost } from "../components/Feedback";
import { THEME, glow } from "../lib/theme/tokens";

/**
 * General injection-technique guide (free, available to everyone).
 *
 * Static educational content from lib/data/injectionGuide.ts, rendered with the
 * Sources screen pattern. A prominent medical disclaimer sits at the top; every
 * step defers to the user's care team and contains no doses, products or
 * personal instructions.
 */
export default function InjectionGuideScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View className="flex-1">
      <AppBackgroundFill />
      <View className="flex-1" style={{ paddingTop: insets.top }}>
        {/* Header */}
        <View className="flex-row items-center justify-between px-4 py-3 border-b border-zinc-900">
          <Text className="text-zinc-50 text-lg font-bold flex-1" numberOfLines={1}>
            {t("injectionGuide.screenTitle")}
          </Text>
          <Pressable onPress={() => router.back()} hitSlop={10} className="p-1">
            <Ionicons name="close" size={24} color="#a1a1aa" />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Glowing hero visual */}
          <View className="items-center mb-5">
            <View
              className="w-20 h-20 rounded-3xl items-center justify-center"
              style={[
                { backgroundColor: "rgba(46,230,255,0.12)", borderWidth: 1, borderColor: "rgba(46,230,255,0.28)" },
                glow(THEME.accent, 40, 0.55),
              ]}
            >
              <Ionicons name="medkit" size={40} color={THEME.accent} />
            </View>
          </View>

          {/* Prominent medical disclaimer */}
          <View className="flex-row items-start rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 mb-5">
            <Ionicons name="medical-outline" size={18} color="#f59e0b" />
            <View className="flex-1 ml-3">
              <Text className="text-amber-300 font-semibold text-sm mb-0.5">
                {t("disclaimer.title")}
              </Text>
              <Text className="text-amber-200/80 text-xs leading-5">
                {t("injectionGuide.disclaimer")}
              </Text>
            </View>
          </View>

          {/* Numbered steps */}
          {INJECTION_STEPS.map((step, i) => (
            <View
              key={step.titleKey}
              className="flex-row rounded-2xl bg-glass border border-hair p-4 mb-3"
            >
              <View className="w-9 h-9 rounded-full bg-brand/10 items-center justify-center mr-3">
                <Ionicons
                  name={step.icon as keyof typeof Ionicons.glyphMap}
                  size={18}
                  color="#2ee6ff"
                />
              </View>
              <View className="flex-1">
                <View className="flex-row items-center mb-1">
                  <Text className="text-brand text-xs font-bold mr-2">{i + 1}</Text>
                  <Text className="text-zinc-100 font-semibold flex-1">
                    {t(step.titleKey)}
                  </Text>
                </View>
                <Text className="text-zinc-400 text-sm leading-5">
                  {t(step.bodyKey)}
                </Text>
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
      <FeedbackHost />
    </View>
  );
}
