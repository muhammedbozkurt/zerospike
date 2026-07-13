import React, { useCallback, useEffect, useState } from "react";
import { AppState, FlatList, Platform, Pressable, Switch, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { useApp } from "../../lib/store/AppContext";
import { getJournal, JournalEntry, GlucoseEntry, InjectionEntry } from "../../lib/db/journal";
import { activeInsulin } from "../../lib/iob";
import {
  addSugarLog,
  updateSugarLog,
  deleteSugarLog,
  deleteMealLog,
} from "../../lib/db/logs";
import { listPens, deleteInjection } from "../../lib/db/injections";
import { loadDemoData, clearProfileData } from "../../lib/db/demo";
import { markSampleActive, clearSampleFlag, isSampleActive } from "../../lib/sampleData";
import type { InsulinPen, LogTag, PeriodTag } from "../../lib/db/types";
import {
  schedulePostMealReminder,
  startPostMealTimer,
  scheduleLowFollowup,
  getPostMealTimerEnd,
  cancelPostMealTimer,
} from "../../lib/services/notifications";
import { formatPostMealRemaining } from "../../lib/postMealTimer";
import { getNotificationPrefs } from "../../lib/services/notificationPrefs";
import { importHealthGlucose, type SyncResult } from "../../lib/services/health";
import { consecutiveLogDays } from "../../lib/insights";
import { noteLogAndMaybeReview } from "../../lib/services/review";
import { logEvent } from "../../lib/analytics";

const CGM_KEY = "zerospike.cgmSync";
// Shown once to an existing free user who had auto-sync on before it became Pro.
const HEALTH_PRO_NOTICE_KEY = "zerospike.healthProNoticeShown";
// Name the health source explicitly in the UI (App Review guideline 2.5.1).
const HEALTH_NAME = Platform.OS === "ios" ? "Apple Health" : "Health Connect";
import { JournalItem } from "../../components/JournalItem";
import { GlucoseInputSheet } from "../../components/GlucoseInputSheet";
import { ProfileSwitcher } from "../../components/ProfileSwitcher";
import { useFeedback } from "../../components/Feedback";
import { formatDateKey, num } from "../../lib/format";
import { formatGlucose, glucoseUnitLabel, classifyGlucose } from "../../lib/glucose";
import { hapticSuccess, hapticWarning } from "../../lib/haptics";

function WeekStat({ value, label }: { value: string; label: string }) {
  return (
    <View className="items-center flex-1">
      <Text className="text-zinc-50 text-lg font-bold">{value}</Text>
      <Text
        className="text-zinc-500 text-[10px] mt-0.5 text-center"
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}

export default function DashboardScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { activeProfile, isProUser, dataVersion, bumpData, lang } = useApp();
  const { toast, confirm, actionSheet } = useFeedback();

  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editGlucose, setEditGlucose] = useState<GlucoseEntry | null>(null);
  const [initialPeriod, setInitialPeriod] = useState<PeriodTag>("fasting");
  const [cgmOn, setCgmOn] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [activePens, setActivePens] = useState<InsulinPen[]>([]);
  const [sampleActive, setSampleActive] = useState(false);
  const [loadingSample, setLoadingSample] = useState(false);
  // Post-meal reminder countdown: end time (epoch ms) of the pending nudge, and
  // a tick that drives the live label. Armed by the button OR the automatic
  // schedule paths (both persist the end time in the service).
  const [postMealEnd, setPostMealEnd] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const refreshPostMealTimer = useCallback(async () => {
    setPostMealEnd(await getPostMealTimerEnd());
  }, []);

  const load = useCallback(async () => {
    if (!activeProfile) return;
    const [feed, pens] = await Promise.all([
      getJournal(activeProfile.id, lang, 300),
      listPens(activeProfile.id, true),
    ]);
    setEntries(feed);
    setActivePens(pens);
    setSampleActive(await isSampleActive(activeProfile.id));
  }, [activeProfile, lang]);

  useEffect(() => {
    load();
  }, [load, dataVersion]);

  // Re-read the persisted post-meal timer whenever the feed changes (a log on
  // this screen or a meal logged elsewhere both bump dataVersion).
  useEffect(() => {
    refreshPostMealTimer();
  }, [refreshPostMealTimer, dataVersion]);

  // Drive the countdown label while armed: 30 s cadence far out, 1 s in the last
  // minute; clears itself (button returns to normal) when the time is reached.
  useEffect(() => {
    if (postMealEnd == null) return;
    let timeoutId: ReturnType<typeof setTimeout>;
    const tick = () => {
      const remaining = postMealEnd - Date.now();
      if (remaining <= 0) {
        setPostMealEnd(null);
        return;
      }
      setNowTick(Date.now());
      timeoutId = setTimeout(tick, remaining <= 60_000 ? 1_000 : 30_000);
    };
    tick();
    return () => clearTimeout(timeoutId);
  }, [postMealEnd]);

  // Coming back to the foreground: re-read the timer (it may have elapsed while
  // backgrounded) and refresh the tick immediately.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        refreshPostMealTimer();
        setNowTick(Date.now());
      }
    });
    return () => sub.remove();
  }, [refreshPostMealTimer]);

  // Restore the persisted sync preference, and silently re-sync on open so new
  // Health readings keep flowing in without re-toggling the switch. Auto-sync is
  // Pro-only now: a free user who had it on keeps their imported data but stops
  // auto-importing, and is told once.
  useEffect(() => {
    // Health/CGM sync is iOS-only (Health Connect was removed for Play policy).
    if (Platform.OS !== "ios") return;
    (async () => {
      const saved = (await AsyncStorage.getItem(CGM_KEY)) === "true";
      if (isProUser) {
        setCgmOn(saved);
        if (saved && activeProfile) runSync(false);
      } else {
        setCgmOn(false);
        if (saved) await maybeShowHealthProNotice();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProfile?.id, isProUser]);

  async function maybeShowHealthProNotice() {
    try {
      if ((await AsyncStorage.getItem(HEALTH_PRO_NOTICE_KEY)) === "true") return;
      await AsyncStorage.setItem(HEALTH_PRO_NOTICE_KEY, "true");
      toast(t("dashboard.healthNowPro"), "info");
    } catch {
      // best-effort notice
    }
  }

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
  // Auto-sync is a Pro feature, so this is the import-path gate as well.
  async function runSync(announce: boolean) {
    if (!activeProfile || syncing || !isProUser) return;
    setSyncing(true);
    try {
      const res = await importHealthGlucose(activeProfile.id);
      if (res.inserted > 0) {
        // One event per sync (not per row) to keep health-import volume sane.
        logEvent("log_added", { kind: "glucose", source: "health" });
        bumpData();
      }
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

  const todayKey = formatDateKey(new Date().toISOString());
  const todayInjections = entries.filter(
    (e) => e.kind === "injection" && formatDateKey(e.logged_at) === todayKey
  ).length;
  const anyInjections = entries.some((e) => e.kind === "injection");
  // Encouraging consistency count ("X days in a row"), never a streak to protect.
  const logStreak = consecutiveLogDays(entries.map((e) => e.logged_at));
  const lowPen = activePens.some((p) => p.remaining_units < 20);
  const minRemaining = activePens.length
    ? Math.min(...activePens.map((p) => p.remaining_units))
    : 0;

  // ── This-week summary (derived from the already-loaded feed) ──────────────
  const unit = activeProfile?.glucose_unit ?? "mgdl";
  const weekAgo = Date.now() - 7 * 86_400_000;
  const weekGlucose = entries.filter(
    (e) => e.kind === "glucose" && new Date(e.logged_at).getTime() >= weekAgo
  );
  const weekReadings = weekGlucose.length;
  const weekAvg = weekReadings
    ? Math.round(
        weekGlucose.reduce(
          (a, e) => a + (e.kind === "glucose" ? e.glucose_level_mgdl : 0),
          0
        ) / weekReadings
      )
    : null;
  const weekTIR = weekReadings
    ? Math.round(
        (weekGlucose.filter(
          (e) =>
            e.kind === "glucose" &&
            e.glucose_level_mgdl >= 70 &&
            e.glucose_level_mgdl <= 180
        ).length /
          weekReadings) *
          100
      )
    : null;
  const weekInjections = entries.filter(
    (e) => e.kind === "injection" && new Date(e.logged_at).getTime() >= weekAgo
  ).length;
  const hasWeekData = weekReadings > 0 || weekInjections > 0;

  // Active insulin still working from recent bolus doses (stacking awareness).
  const iob = activeInsulin(
    entries.filter((e): e is InjectionEntry => e.kind === "injection")
  );

  // Post-meal button: while a reminder is pending it is disabled and shows a
  // live countdown (recomputed from nowTick), otherwise it is the normal CTA.
  const postMealArmed = postMealEnd != null && postMealEnd > nowTick;
  const postMealCountdown = postMealArmed
    ? formatPostMealRemaining(postMealEnd - nowTick)
    : null;

  // Manual logging is unlimited on both tiers now, so there is no gate here.
  function openLogger(period: PeriodTag) {
    if (!activeProfile) return;
    setInitialPeriod(period);
    setSheetOpen(true);
  }

  // "I started eating": arms the post-meal check timer (dedupes with the meal-log
  // auto reminder via a shared notification id).
  async function startedEating() {
    const minutes = await startPostMealTimer();
    if (minutes != null) {
      logEvent("tokluk_timer_started");
      hapticSuccess();
      toast(t("dashboard.toklukSet", { n: minutes }), "success");
      await refreshPostMealTimer();
    } else {
      toast(t("dashboard.toklukNeedsPerm"), "info");
    }
  }

  async function submitGlucose(
    value: number,
    period: PeriodTag,
    tags: LogTag[],
    loggedAt: Date | null
  ) {
    if (!activeProfile) return;
    setSheetOpen(false);

    if (editGlucose) {
      // Correcting an existing reading: no reminders, no review nudge.
      await updateSugarLog(editGlucose.id, {
        glucose_level_mgdl: value,
        period_tag: period,
        tags,
        ...(loggedAt ? { logged_at: loggedAt.toISOString() } : {}),
      });
      setEditGlucose(null);
      logEvent("log_edited", { kind: "glucose" });
      hapticSuccess();
      bumpData();
      return;
    }

    // loggedAt is null when the user left the time untouched ("now"); a
    // backdated reading must not arm/cancel today's timers or nudges.
    const isNow = loggedAt == null;
    await addSugarLog({
      profile_id: activeProfile.id,
      glucose_level_mgdl: value,
      period_tag: period,
      tags,
      logged_at: loggedAt ? loggedAt.toISOString() : undefined,
    });
    logEvent("log_added", { kind: "glucose", source: "manual" });
    void noteLogAndMaybeReview();
    hapticSuccess();
    // Per spec: a fasting/pre-meal reading schedules the 2-hour post-meal nudge,
    // which also arms the countdown button.
    if (isNow && (period === "fasting" || period === "pre_meal")) {
      await schedulePostMealReminder();
      await refreshPostMealTimer();
    }
    // Reflective feedback for a 2-hour post-meal reading: a descriptive note
    // comparing the user's own reading to their own target (never advice).
    if (period === "post_meal_2h") {
      if (isNow) {
        // Early completion: the 2-hour reading is logged, so the pending nudge
        // is no longer needed. Cancel it and clear the countdown.
        await cancelPostMealTimer();
        setPostMealEnd(null);
      }
      const status = classifyGlucose(value, "post_meal_2h", activeProfile);
      const key =
        status === "normal"
          ? "feedbackOnTarget"
          : status === "low"
            ? "feedbackLow"
            : status === "elevated"
              ? "feedbackElevated"
              : "feedbackHigh";
      toast(
        t(`dashboard.${key}`, {
          value: formatGlucose(value, unit),
          unit: glucoseUnitLabel(unit),
        }),
        status === "normal" ? "success" : "info"
      );
    }
    bumpData();
    if (isNow) void maybeOfferLowFollowup(value);
  }

  // Neutral, user-thresholded follow-up: after the user LOGS a low reading, offer
  // (never force) a 15-minute re-measure reminder and a shortcut to reach an
  // emergency contact. No diagnosis, no automatic alert.
  async function maybeOfferLowFollowup(mgdl: number) {
    const prefs = await getNotificationPrefs();
    if (!prefs.lowFollowup || mgdl >= prefs.lowThresholdMgdl) return;
    actionSheet({
      title: t("dashboard.lowFollowTitle", {
        value: formatGlucose(mgdl, unit),
        unit: glucoseUnitLabel(unit),
      }),
      actions: [
        {
          label: t("dashboard.lowFollowRemind"),
          icon: "alarm-outline",
          onPress: async () => {
            const ok = await scheduleLowFollowup();
            toast(
              ok ? t("dashboard.lowFollowSet") : t("dashboard.toklukNeedsPerm"),
              ok ? "success" : "info"
            );
          },
        },
        {
          label: t("dashboard.lowFollowSos"),
          icon: "medical-outline",
          onPress: () => router.push("/sos"),
        },
      ],
    });
  }

  async function toggleCgm(next: boolean) {
    setCgmOn(next);
    await AsyncStorage.setItem(CGM_KEY, next ? "true" : "false");
    if (next) await runSync(true);
  }

  // First-run preview: fill an empty profile with realistic sample data so a
  // new user instantly sees a populated dashboard, Insights and AGP. Fully
  // reversible (clears all logs + pens) and only offered on an empty profile.
  async function loadSample() {
    if (!activeProfile || loadingSample) return;
    setLoadingSample(true);
    try {
      await loadDemoData(activeProfile.id);
      await markSampleActive(activeProfile.id);
      hapticSuccess();
      bumpData();
    } finally {
      setLoadingSample(false);
    }
  }

  async function clearSample() {
    if (!activeProfile) return;
    const ok = await confirm({
      message: t("dashboard.sampleClearConfirm"),
      confirmLabel: t("dashboard.sampleClear"),
      destructive: true,
    });
    if (!ok) return;
    await clearProfileData(activeProfile.id);
    await clearSampleFlag(activeProfile.id);
    hapticWarning();
    bumpData();
  }

  async function confirmDelete(entry: JournalEntry) {
    const ok = await confirm({
      message: t("journal.deleteEntry"),
      confirmLabel: t("common.delete"),
      destructive: true,
    });
    if (!ok) return;
    hapticWarning();
    if (entry.kind === "glucose") await deleteSugarLog(entry.id);
    else if (entry.kind === "injection") await deleteInjection(entry.id);
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
          {logStreak >= 2 ? (
            <View className="flex-row items-center mt-1 self-start rounded-full bg-brand/10 px-2.5 py-0.5">
              <Ionicons name="checkmark-circle-outline" size={12} color="#22d3ee" />
              <Text className="text-brand text-[11px] font-medium ml-1">
                {t("dashboard.consistency", { n: logStreak })}
              </Text>
            </View>
          ) : null}
        </View>
        <View className="flex-row items-center">
          <Pressable
            onPress={() => router.push("/sos")}
            hitSlop={8}
            className="w-9 h-9 rounded-full bg-rose-500/15 items-center justify-center mr-3"
            accessibilityLabel={t("sos.title")}
          >
            <Ionicons name="medical-outline" size={18} color="#fb7185" />
          </Pressable>
          <ProfileSwitcher />
        </View>
      </View>

      {/* Sample-data preview banner (tap to clear and start fresh) */}
      {sampleActive ? (
        <Pressable
          onPress={clearSample}
          className="rounded-2xl border border-brand/30 bg-brand/10 p-3.5 mb-3 flex-row items-center active:opacity-80"
        >
          <Ionicons name="flask-outline" size={18} color="#22d3ee" />
          <Text className="text-brand text-sm font-medium flex-1 ml-2.5">
            {t("dashboard.sampleActive")}
          </Text>
          <Text className="text-brand text-xs underline">
            {t("dashboard.sampleClear")}
          </Text>
        </Pressable>
      ) : null}

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

      {/* Active insulin (IOB) — only when something is still working */}
      {iob > 0 ? (
        <View className="rounded-2xl bg-zinc-900 border border-zinc-800 p-4 mb-3 flex-row items-center">
          <View className="w-10 h-10 rounded-full bg-brand/10 items-center justify-center mr-3">
            <Ionicons name="hourglass-outline" size={20} color="#22d3ee" />
          </View>
          <View className="flex-1">
            <Text className="text-zinc-100 font-semibold">
              {t("dashboard.activeInsulin")}
            </Text>
            <Text className="text-zinc-500 text-xs">
              {t("dashboard.activeInsulinSub")}
            </Text>
          </View>
          <Text className="text-brand text-lg font-bold">
            {num(iob)} {t("common.units")}
          </Text>
        </View>
      ) : null}

      {/* Health auto-sync (iOS only; Health Connect removed for Play policy).
          Pro toggles it, free sees a Pro badge that opens the paywall. */}
      {Platform.OS === "ios" ? (
      <Pressable
        onPress={() => {
          if (!isProUser) {
            hapticWarning();
            router.push({ pathname: "/paywall", params: { reason: "health" } });
            return;
          }
          if (cgmOn) runSync(true);
        }}
        disabled={isProUser && (!cgmOn || syncing)}
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
            {!isProUser
              ? t("dashboard.cgmProHint")
              : syncing
                ? t("dashboard.syncing")
                : cgmOn
                  ? t("dashboard.cgmOnTapToSync")
                  : t("dashboard.cgmSubtitle")}
          </Text>
        </View>
        {isProUser ? (
          <>
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
          </>
        ) : (
          <View className="rounded-full bg-brand px-2 py-0.5">
            <Text className="text-black text-[10px] font-bold">{t("common.pro")}</Text>
          </View>
        )}
      </Pressable>
      ) : null}

      {/* This week summary (free) */}
      <Pressable
        onPress={() =>
          router.push({ pathname: "/insights", params: { window: "7" } })
        }
        className="rounded-2xl bg-zinc-900 border border-zinc-800 p-4 mb-4 active:bg-zinc-800"
      >
        <View className="flex-row items-center justify-between mb-3">
          <Text className="text-zinc-100 font-semibold">
            {t("dashboard.thisWeek")}
          </Text>
          <Ionicons name="chevron-forward" size={18} color="#52525b" />
        </View>
        {hasWeekData ? (
          <View className="flex-row justify-between">
            <WeekStat value={String(weekReadings)} label={t("insights.readings")} />
            <WeekStat
              value={weekAvg == null ? "-" : formatGlucose(weekAvg, unit)}
              label={t("insights.avgGlucose")}
            />
            <WeekStat
              value={weekTIR == null ? "-" : `${weekTIR}%`}
              label={t("insights.timeInRange")}
            />
            <WeekStat
              value={String(weekInjections)}
              label={t("insights.injectionsCount")}
            />
          </View>
        ) : (
          <Text className="text-zinc-500 text-xs">{t("insights.empty")}</Text>
        )}
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

      {/* Injection summary */}
      <Pressable
        onPress={() => router.push("/injection")}
        className="rounded-2xl bg-zinc-900 border border-zinc-800 p-4 mb-4 flex-row items-center active:bg-zinc-800"
      >
        <View className="w-10 h-10 rounded-full bg-brand/10 items-center justify-center mr-3">
          <Ionicons name="medkit-outline" size={20} color="#22d3ee" />
        </View>
        <View className="flex-1">
          <Text className="text-zinc-100 font-semibold">{t("injection.title")}</Text>
          <Text className="text-zinc-500 text-xs">
            {anyInjections || activePens.length > 0
              ? t("dashboard.injectionsToday", { n: todayInjections })
              : t("injection.empty")}
          </Text>
        </View>
        {activePens.length > 0 ? (
          <View className="items-end mr-2">
            <Text className="text-zinc-300 text-xs font-semibold">
              {t("dashboard.pensActive", { n: activePens.length })}
            </Text>
            <View className="flex-row items-center mt-0.5">
              {lowPen ? (
                <Ionicons
                  name="warning-outline"
                  size={12}
                  color="#f59e0b"
                  style={{ marginRight: 3 }}
                />
              ) : null}
              <Text className={`text-xs ${lowPen ? "text-amber-400" : "text-zinc-500"}`}>
                {num(minRemaining)} {t("common.units")}
              </Text>
            </View>
          </View>
        ) : null}
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
        ListFooterComponent={
          entries.length > 0 ? (
            <View className="flex-row items-start rounded-xl border border-amber-500/25 bg-amber-500/10 px-3.5 py-3 mt-3">
              <Ionicons name="medical-outline" size={15} color="#f59e0b" />
              <Text className="text-amber-200/80 text-xs leading-4 ml-2.5 flex-1">
                {t("disclaimer.short")}
              </Text>
            </View>
          ) : null
        }
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
            {!sampleActive ? (
              <Pressable
                onPress={loadSample}
                disabled={loadingSample}
                className="flex-row items-center mt-5 rounded-2xl bg-brand active:bg-brandDark px-5 py-3"
                style={{ opacity: loadingSample ? 0.6 : 1 }}
              >
                <Ionicons name="flask-outline" size={18} color="#000" />
                <Text className="text-black font-semibold ml-2">
                  {t("dashboard.sampleCta")}
                </Text>
              </Pressable>
            ) : null}
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
        {/* "I started eating" arms the post-meal reading timer (free). While
            armed it is disabled and counts down, so it can't be re-pressed. */}
        <Pressable
          onPress={postMealArmed ? undefined : startedEating}
          disabled={postMealArmed}
          accessibilityState={{ disabled: postMealArmed }}
          className={`flex-row items-center justify-center rounded-2xl py-3 mb-2.5 ${
            postMealArmed ? "bg-zinc-800" : "bg-brand active:bg-brandDark"
          }`}
        >
          <Ionicons
            name={postMealArmed ? "time-outline" : "restaurant-outline"}
            size={18}
            color={postMealArmed ? "#71717a" : "#000"}
          />
          <Text
            className={`font-bold ml-2 text-[15px] ${
              postMealArmed ? "text-zinc-400" : "text-black"
            }`}
          >
            {postMealCountdown
              ? postMealCountdown.seconds
                ? t("dashboard.postMealCountdownSec", { s: postMealCountdown.value })
                : t("dashboard.postMealCountdownMin", { m: postMealCountdown.value })
              : t("dashboard.startedEating")}
          </Text>
        </Pressable>

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
        edit={editGlucose}
        onClose={() => {
          setSheetOpen(false);
          setEditGlucose(null);
        }}
        onSubmit={submitGlucose}
      />
    </View>
  );
}
