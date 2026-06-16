import React, { useCallback, useEffect, useState } from "react";
import { FlatList, Platform, Pressable, Switch, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
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
import { importHealthGlucose, type SyncResult } from "../../lib/services/health";

const CGM_KEY = "zerospike.cgmSync";
// Name the health source explicitly in the UI (App Review guideline 2.5.1).
const HEALTH_NAME = Platform.OS === "ios" ? "Apple Health" : "Health Connect";
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
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    if (!activeProfile) return;
    setEntries(await getJournal(activeProfile.id, lang, 300));
  }, [activeProfile, lang]);

  useEffect(() => {
    load();
  }, [load, dataVersion]);

  // Restore the persisted sync preference, and silently re-sync on open so new
  // Health readings keep flowing in without re-toggling the switch.
  useEffect(() => {
    (async () => {
      const saved = (await AsyncStorage.getItem(CGM_KEY)) === "true";
      setCgmOn(saved);
      if (saved && activeProfile) runSync(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProfile?.id]);

  function describeSync(res: SyncResult): { msg: string; tone: "success" | "info" } {
    if (res.status === "unavailable")
      return { msg: t("dashboard.healthUnavailable"), tone: "info" };
    if (res.status === "denied")
      return { msg: t("dashboard.healthDenied"), tone: "info" };
    if (res.status === "error")
      return { msg: t("dashboard.healthError"), tone: "info" };
    if (res.inserted > 0)
      return { msg: t("dashboard.imported", { n: res.inserted }), tone: "success" };
    if (res.read > 0)
      return { msg: t("dashboard.healthUpToDate"), tone: "info" };
    return { msg: t("dashboard.healthNoData"), tone: "info" };
  }

  // Pulls from Health. `announce` shows a toast (off for the silent open-sync).
  async function runSync(announce: boolean) {
    if (!activeProfile || syncing) return;
    setSyncing(true);
    try {
      const res = await importHealthGlucose(activeProfile.id);
      if (res.inserted > 0) bumpData();
      if (announce) {
        const { msg, tone } = describeSync(res);
        toast(msg, tone);
      }
    } finally {
      setSyncing(false);
    }
  }

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
    await AsyncStorage.setItem(CGM_KEY, next ? "true" : "false");
    if (next) await runSync(true);
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

      {/* CGM / Sensor toggle — tap the row (while on) to sync again */}
      <Pressable
        onPress={() => cgmOn && runSync(true)}
        disabled={!cgmOn || syncing}
        className="rounded-2xl bg-zinc-900 border border-zinc-800 p-4 mb-4 flex-row items-center active:bg-zinc-800"
      >
        <View className="w-10 h-10 rounded-full bg-brand/10 items-center justify-center mr-3">
          <Ionicons name="pulse-outline" size={20} color="#22d3ee" />
        </View>
        <View className="flex-1">
          <Text className="text-zinc-100 font-semibold">
            {HEALTH_NAME}
          </Text>
          <Text className="text-zinc-500 text-xs">
            {syncing
              ? t("dashboard.syncing")
              : cgmOn
                ? t("dashboard.cgmOnTapToSync")
                : t("dashboard.cgmSubtitle")}
          </Text>
        </View>
        {cgmOn && !syncing ? (
          <Ionicons
            name="refresh"
            size={18}
            color="#52525b"
            style={{ marginRight: 10 }}
          />
        ) : null}
        <Switch
          value={cgmOn}
          onValueChange={toggleCgm}
          trackColor={{ true: "#22d3ee", false: "#3f3f46" }}
          thumbColor="#fafafa"
        />
      </Pressable>

      {/* Insights (Pro) entry */}
      <Pressable
        onPress={() => router.push("/insights")}
        className="rounded-2xl bg-zinc-900 border border-zinc-800 p-4 mb-4 flex-row items-center active:bg-zinc-800"
      >
        <View className="w-10 h-10 rounded-full bg-brand/10 items-center justify-center mr-3">
          <Ionicons name="stats-chart" size={20} color="#22d3ee" />
        </View>
        <View className="flex-1">
          <Text className="text-zinc-100 font-semibold">{t("insights.title")}</Text>
          <Text className="text-zinc-500 text-xs">{t("insights.cardSub")}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#52525b" />
      </Pressable>

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
          paddingBottom: 110,
        }}
        showsVerticalScrollIndicator={false}
      />

      {/* Fast loggers — bottom, one-handed reach */}
      <View
        className="absolute left-0 right-0 bottom-0 px-4 pt-2 bg-black border-t border-zinc-900"
        style={{ paddingBottom: 10 }}
      >
        <View className="flex-row gap-3">
          <Pressable
            onPress={() => openLogger("fasting")}
            className="flex-1 flex-row items-center justify-center rounded-2xl bg-zinc-900 border border-zinc-800 active:bg-zinc-800 py-3 px-2"
          >
            <Ionicons name="sunny-outline" size={18} color="#22d3ee" />
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              className="text-zinc-100 font-semibold ml-2 text-sm"
            >
              {t("dashboard.quickFasting")}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => openLogger("post_meal_2h")}
            className="flex-1 flex-row items-center justify-center rounded-2xl bg-zinc-900 border border-zinc-800 active:bg-zinc-800 py-3 px-2"
          >
            <Ionicons name="time-outline" size={18} color="#f59e0b" />
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              className="text-zinc-100 font-semibold ml-2 text-sm"
            >
              {t("dashboard.quickPostMeal")}
            </Text>
          </Pressable>
        </View>
      </View>

      <GlucoseInputSheet
        visible={sheetOpen}
        initialPeriod={initialPeriod}
        unit={activeProfile?.glucose_unit ?? "mgdl"}
        onClose={() => setSheetOpen(false)}
        onSubmit={submitGlucose}
      />
    </View>
  );
}
