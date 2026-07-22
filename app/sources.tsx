import React from "react";
import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { AppBackground, GlassCard } from "../components/rich";
import { ScreenHeader } from "../components/ScreenHeader";
import { FeedbackHost } from "../components/Feedback";
import { THEME } from "../lib/theme/tokens";

/**
 * Medical information sources (App Store Guideline 1.4.1).
 *
 * Rebuilt to the mockup's "Bilimsel kaynaklar" composition: a back header, one
 * line of framing copy, then a stack of individual citation cards - each with
 * its source title, what it covers, and the destination in the accent color.
 * The formula explanation keeps its own card at the top, because the citations
 * only mean something next to the arithmetic they back.
 *
 * Links are to authoritative, language-neutral health organisations and stay
 * the same across all app languages.
 */
const REFERENCES: { label: string; org: string; url: string; host: string }[] = [
  {
    org: "American Diabetes Association (ADA)",
    label: "Diabetes management & treatment",
    url: "https://diabetes.org/",
    host: "diabetes.org",
  },
  {
    org: "American Diabetes Association (ADA)",
    label: "Understanding carbohydrates & carb counting",
    url: "https://diabetes.org/food-nutrition/understanding-carbs",
    host: "diabetes.org",
  },
  {
    org: "NIDDK, National Institutes of Health (NIH)",
    label: "Managing diabetes (insulin & carbohydrates)",
    url: "https://www.niddk.nih.gov/health-information/diabetes/overview/managing-diabetes",
    host: "niddk.nih.gov",
  },
  {
    org: "Centers for Disease Control and Prevention (CDC)",
    label: "Diabetes & healthy eating (carbohydrates)",
    url: "https://www.cdc.gov/diabetes/healthy-eating/index.html",
    host: "cdc.gov",
  },
  {
    org: "MedlinePlus, National Library of Medicine (NIH)",
    label: "Diabetes medicines & insulin",
    url: "https://medlineplus.gov/diabetesmedicines.html",
    host: "medlineplus.gov",
  },
  {
    org: "Diabetes Care (ADA), Bergenstal et al. 2018",
    label: "Glucose Management Indicator (GMI)",
    url: "https://diabetesjournals.org/care/article/41/11/2275/36593/Glucose-Management-Indicator-GMI-A-New-Term-for",
    host: "diabetesjournals.org",
  },
];

export default function SourcesScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <AppBackground style={{ paddingTop: insets.top }}>
      <ScreenHeader
        title={t("sources.title")}
        onBack={() => router.back()}
        backIcon="close"
        accessibilityLabel={t("common.close")}
      />

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 32 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={{ color: THEME.muted, fontSize: 12, lineHeight: 18, marginBottom: 14 }}>
          {t("sources.intro")}
        </Text>

        {/* The arithmetic, in words */}
        <GlassCard glow style={{ marginBottom: 18 }}>
          <Text style={{ color: THEME.ink, fontWeight: "800", marginBottom: 6 }}>
            {t("sources.methodTitle")}
          </Text>
          <Text style={{ color: THEME.muted, fontSize: 13, lineHeight: 21 }}>
            {t("sources.method")}
          </Text>
          <Text style={{ color: THEME.muted, fontSize: 11, lineHeight: 17, marginTop: 12 }}>
            {t("sources.methodNote")}
          </Text>
          <Text style={{ color: THEME.muted, fontSize: 11, lineHeight: 17, marginTop: 8 }}>
            {t("sources.iobNote")}
          </Text>
        </GlassCard>

        <Text className="text-xs font-semibold uppercase tracking-wider text-mut mb-2">
          {t("sources.listTitle")}
        </Text>

        {/* One card per citation (mockup 07) */}
        {REFERENCES.map((ref) => (
          <Pressable
            key={ref.url}
            onPress={() => Linking.openURL(ref.url)}
            className="active:opacity-80"
            accessibilityRole="link"
          >
            <GlassCard style={{ marginBottom: 8 }}>
              <Text style={{ color: THEME.ink, fontSize: 13, fontWeight: "800" }}>
                {ref.org}
              </Text>
              <Text style={{ color: THEME.muted, fontSize: 11, marginTop: 2 }}>
                {ref.label}
              </Text>
              <View className="flex-row items-center mt-2">
                <Text style={{ color: THEME.accent, fontSize: 11, fontWeight: "700" }}>
                  {ref.host}
                </Text>
                <Ionicons
                  name="chevron-forward"
                  size={12}
                  color={THEME.accent}
                  style={{ marginLeft: 2 }}
                />
              </View>
            </GlassCard>
          </Pressable>
        ))}

        <Text style={{ color: THEME.muted, fontSize: 11, marginTop: 6, paddingHorizontal: 4 }}>
          {t("sources.openHint")}
        </Text>
      </ScrollView>
      <FeedbackHost />
    </AppBackground>
  );
}
