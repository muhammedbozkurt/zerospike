import React, { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { useApp } from "../../lib/store/AppContext";
import { getJournal, JournalEntry } from "../../lib/db/journal";
import { addSugarLog, deleteSugarLog, deleteMealLog } from "../../lib/db/logs";
import type { PeriodTag } from "../../lib/db/types";
import { canAddLog } from "../../lib/guardrails";
import { schedulePostMealReminder } from "../../lib/services/notifications";
import { importHealthGlucose } from "../../lib/services/health";
import { JournalItem } from "../../components/JournalItem";
import { GlucoseInputSheet } from "../../components/GlucoseInputSheet";
import { ProfileSwitcher } from "../../components/ProfileSwitcher";
import { useFeedback } from "../../components/Feedback";
import { formatDateKey } from "../../lib/format";

export default function DashboardScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { activeProfile, isProUser, dataVersion, bumpData, lang } = useApp();
  const { toast, confirm } = useFeedback();

  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [initialPeriod, setInitialPeriod] = useState<PeriodTag>("fasting");
  const [cgmOn, setCgmOn] = useState(false);

  const load = useCallback(async () => {
    if (!activeProfile) return;
    setEntries(await getJournal(activeProfile.id, lang, 300));
  }, [activeProfile, lang]);

  useEffect(() => {
    load();
  }, [load, dataVersion]);

  const todayCarbs = entries
    .filter(
      (e) =>
        e.kind === "meal" &&
        formatDateKey(e.logged_at) === formatDateKey(new Date().toISOString())
    )
    .reduce((sum, e) => sum + (e.kind === "meal" ? e.calculated_carbs_g : 0), 0);

  async function openLogger(period: PeriodTag) {
    if (!activeProfile) return;
    const allowed = await canAddLog(activeProfile.id, isProUser);
    if (!allowed) {
      router.push({ pathname: "/paywall", params: { reason: "logs" } });
      return;
    }
    setInitialPeriod(period);
    setSheetOpen(true);
  }

  async function submitGlucose(value: number, period: PeriodTag) {
    if (!activeProfile) return;
    setSheetOpen(false);
    await addSugarLog({
      profile_id: activeProfile.id,
      glucose_level_mgdl: value,
      period_tag: period,
    });
    // Per spec: a fasting/pre-meal reading schedules the 2-hour post-meal nudge.
    if (period === "fasting" || period === "pre_meal") {
      await schedulePostMealReminder();
    }
    bumpData();
  }

  async function toggleCgm(next: boolean) {
    setCgmOn(next);
    if (next && activeProfile) {
      const count = await importHealthGlucose(activeProfile.id);
      bumpData();
      toast(
        count > 0
          ? t("dashboard.imported", { n: count })
          : t("dashboard.importedNone"),
        count > 0 ? "success" : "info"
      );
    }
  }

  async function confirmDelete(entry: JournalEntry) {
    const ok = await confirm({
      message: t("journal.deleteEntry"),
      confirmLabel: t("common.delete"),
      destructive: true,
    });
    if (!ok) return;
    if (entry.kind === "glucose") await deleteSugarLog(entry.id);
    else await deleteMealLog(entry.id);
    bumpData();
  }

  const Header = (
    <View className="pb-2">
      <View className="flex-row items-center justify-between mb-5">
        <View>
          <Text className="text-zinc-500 text-sm">{t("dashboard.greeting")}</Text>
          <Text className="text-zinc-50 text-2xl font-bold">
            {t("dashboard.title")}
          </Text>
        </View>
        <ProfileSwitcher />
      </View>

      {/* Daily carbohydrate progress */}
      <View className="rounded-2xl bg-zinc-900 border border-zinc-800 p-4 mb-3">
        <View className="flex-row items-center justify-between mb-2">
          <Text className="text-zinc-400 text-sm">{t("dashboard.dailyCarbs")}</Text>
          <Text className="text-zinc-200 text-sm font-semibold">
            {t("dashboard.dailyCarbsOf", {
              current: Math.round(todayCarbs),
              target: activeProfile?.daily_carb_target_g ?? 0,
            })}
          </Text>
        </View>
        <View className="h-2 rounded-full bg-zinc-800 overflow-hidden">
          <View
            className="h-2 rounded-full bg-brand"
            style={{
              width: `${Math.min(
                100,
                activeProfile
                  ? (todayCarbs / Math.max(1, activeProfile.daily_carb_target_g)) *
                      100
                  : 0
              )}%`,
            }}
          />
        </View>
      </View>

      {/* CGM / Sensor toggle */}
      <View className="rounded-2xl bg-zinc-900 border border-zinc-800 p-4 mb-4 flex-row items-center">
        <View className="w-10 h-10 rounded-full bg-brand/10 items-center justify-center mr-3">
          <Ionicons name="hardware-chip-outline" size={20} color="#22d3ee" />
        </View>
        <View className="flex-1">
          <Text className="text-zinc-100 font-semibold">
            {t("dashboard.cgmTitle")}
          </Text>
          <Text className="text-zinc-500 text-xs">
            {cgmOn ? t("dashboard.cgmOn") : t("dashboard.cgmSubtitle")}
          </Text>
        </View>
        <Switch
          value={cgmOn}
          onValueChange={toggleCgm}
          trackColor={{ true: "#22d3ee", false: "#3f3f46" }}
          thumbColor="#fafafa"
        />
      </View>

      <Text className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
        {t("dashboard.history")}
      </Text>
    </View>
  );

  return (
    <View className="flex-1 bg-black" style={{ paddingTop: insets.top }}>
      <FlatList
        data={entries}
        keyExtractor={(e) => `${e.kind}-${e.id}`}
        ListHeaderComponent={Header}
        renderItem={({ item }) =>
          activeProfile ? (
            <JournalItem
              entry={item}
              profile={activeProfile}
              onLongPress={confirmDelete}
            />
          ) : null
        }
        ListEmptyComponent={
          <View className="items-center py-12">
            <Ionicons name="document-text-outline" size={40} color="#3f3f46" />
            <Text className="text-zinc-600 text-center mt-3 px-8">
              {t("dashboard.empty")}
            </Text>
          </View>
        }
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: 180,
        }}
        showsVerticalScrollIndicator={false}
      />

      {/* Fast loggers — bottom half, one-handed reach */}
      <View
        className="absolute left-0 right-0 bottom-0 px-4 pt-3 bg-black border-t border-zinc-900"
        style={{ paddingBottom: insets.bottom + 12 }}
      >
        <View className="flex-row gap-3">
          <Pressable
            onPress={() => openLogger("fasting")}
            className="flex-1 rounded-2xl bg-zinc-900 border border-zinc-800 active:bg-zinc-800 p-4 items-center"
          >
            <Ionicons name="sunny-outline" size={22} color="#22d3ee" />
            <Text className="text-zinc-100 font-semibold mt-1.5 text-center">
              {t("dashboard.quickFasting")}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => openLogger("post_meal_2h")}
            className="flex-1 rounded-2xl bg-zinc-900 border border-zinc-800 active:bg-zinc-800 p-4 items-center"
          >
            <Ionicons name="time-outline" size={22} color="#f59e0b" />
            <Text className="text-zinc-100 font-semibold mt-1.5 text-center">
              {t("dashboard.quickPostMeal")}
            </Text>
          </Pressable>
        </View>
      </View>

      <GlucoseInputSheet
        visible={sheetOpen}
        initialPeriod={initialPeriod}
        onClose={() => setSheetOpen(false)}
        onSubmit={submitGlucose}
      />
    </View>
  );
}
