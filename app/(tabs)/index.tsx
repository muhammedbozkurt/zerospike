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
import { targetBandFor } from "../../lib/agpChart";
import { isConfigured as spikeConfigured } from "../../lib/ai/spikeClient";
import { insulinModeShowsBolus } from "../../lib/insulinMode";
import {
  addSugarLog,
  updateSugarLog,
  deleteSugarLog,
  deleteMealLog,
} from "../../lib/db/logs";
import { deleteInjection } from "../../lib/db/injections";
import { loadDemoData, clearProfileData } from "../../lib/db/demo";
import { markSampleActive, clearSampleFlag, isSampleActive } from "../../lib/sampleData";
import type { LogTag, PeriodTag } from "../../lib/db/types";
import {
  schedulePostMealReminder,
  startPostMealTimer,
  scheduleLowFollowup,
  getPostMealTimerEnd,
  cancelPostMealTimer,
} from "../../lib/services/notifications";
import { formatPostMealRemaining } from "../../lib/postMealTimer";
import { getNotificationPrefs } from "../../lib/services/notificationPrefs";
import { syncLiveData } from "../../lib/services/liveData";
import { importHealthGlucose, type SyncResult } from "../../lib/services/health";
import { consecutiveLogDays } from "../../lib/insights";
import { noteLogAndMaybeReview } from "../../lib/services/review";
import { logEvent } from "../../lib/analytics";

const CGM_KEY = "zerospike.cgmSync";
// Shown once to an existing free user who had auto-sync on before it became Pro.
const HEALTH_PRO_NOTICE_KEY = "zerospike.healthProNoticeShown";
// One-time discoverability hint: journal rows can be tapped to edit.
const EDIT_HINT_KEY = "zerospike.editHintDismissed";
// Name the health source explicitly in the UI (App Review guideline 2.5.1).
const HEALTH_NAME = Platform.OS === "ios" ? "Apple Health" : "Health Connect";
import { JournalItem } from "../../components/JournalItem";
import { GlucoseInputSheet } from "../../components/GlucoseInputSheet";
import { InjectionEditSheet } from "../../components/InjectionEditSheet";
import { ProfileSwitcher } from "../../components/ProfileSwitcher";
import { useFeedback } from "../../components/Feedback";
import { StatCard } from "../../components/StatCard";
import { Sparkline } from "../../components/Sparkline";
import { SegmentedStat } from "../../components/ui";
import { EmptyState } from "../../components/EmptyState";
import Animated from "react-native-reanimated";
import { listEntering } from "../../lib/theme/motion";
import { RICH_BY_STATUS, THEME, TABULAR } from "../../lib/theme/tokens";
import {
  AppBackground,
  GlassCard,
  GlucoseRing,
  GlucoseChip,
  GradientCTA,
  IconTile,
} from "../../components/rich";
import { formatDateKey, formatTime, num } from "../../lib/format";
import {
  formatGlucose,
  glucoseUnitLabel,
  glucoseToDisplay,
  classifyGlucose,
  STATUS_COLOR,
} from "../../lib/glucose";
import { hapticSuccess, hapticWarning } from "../../lib/haptics";


export default function DashboardScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { activeProfile, isProUser, dataVersion, bumpData, lang } = useApp();
  const { toast, confirm, actionSheet } = useFeedback();

  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editGlucose, setEditGlucose] = useState<GlucoseEntry | null>(null);
  const [editInjection, setEditInjection] = useState<InjectionEntry | null>(null);
  const [showEditHint, setShowEditHint] = useState(false);
  const [initialPeriod, setInitialPeriod] = useState<PeriodTag>("fasting");
  const [cgmOn, setCgmOn] = useState(false);
  const [syncing, setSyncing] = useState(false);
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
    const feed = await getJournal(activeProfile.id, lang, 300);
    setEntries(feed);
    setSampleActive(await isSampleActive(activeProfile.id));
    // Refresh the shared live-surface snapshot (next reminder + last glucose)
    // so the notification/Live Activity/widget/watch layer reads current data.
    void syncLiveData(activeProfile.id, activeProfile.glucose_unit ?? "mgdl");
  }, [activeProfile, lang]);

  useEffect(() => {
    load();
  }, [load, dataVersion]);

  // Tap-to-edit is invisible until you know it: show a dismissible one-time
  // hint above the journal until the user closes it.
  useEffect(() => {
    (async () => {
      try {
        setShowEditHint((await AsyncStorage.getItem(EDIT_HINT_KEY)) !== "true");
      } catch {
        // best-effort hint
      }
    })();
  }, []);

  async function dismissEditHint() {
    setShowEditHint(false);
    try {
      await AsyncStorage.setItem(EDIT_HINT_KEY, "true");
    } catch {
      // best-effort hint
    }
  }

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

  // Hero ring: the most recent glucose reading in its status color (Midnight
  // Monitor). Decorative sweep only - the value + period label carry the reading.
  const lastGlucose = entries.find(
    (e): e is GlucoseEntry => e.kind === "glucose"
  );
  const lastStatus =
    lastGlucose && activeProfile
      ? classifyGlucose(lastGlucose.glucose_level_mgdl, lastGlucose.period_tag, activeProfile)
      : null;
  const lastColor = lastStatus ? RICH_BY_STATUS[lastStatus] : THEME.accent;

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
  // Measured against the PROFILE'S band, not a fixed 70-180 rectangle, so this
  // figure agrees with the one on Insights and in the doctor report.
  const weekBand = targetBandFor(activeProfile ?? {});
  const weekTIR = weekReadings
    ? Math.round(
        (weekGlucose.filter(
          (e) =>
            e.kind === "glucose" &&
            e.glucose_level_mgdl >= weekBand.low &&
            e.glucose_level_mgdl <= weekBand.high
        ).length /
          weekReadings) *
          100
      )
    : null;
  const weekInjections = entries.filter(
    (e) => e.kind === "injection" && new Date(e.logged_at).getTime() >= weekAgo
  ).length;
  const hasWeekData = weekReadings > 0 || weekInjections > 0;

  // Weekly-average accent (single glucose color language) + a chronological
  // sparkline of the week's readings for the summary tile.
  const weekSparkline = weekGlucose
    .slice()
    .reverse()
    .map((e) => (e.kind === "glucose" ? e.glucose_level_mgdl : 0));
  const avgColor =
    weekAvg != null && activeProfile
      ? STATUS_COLOR[classifyGlucose(weekAvg, "manual", activeProfile)]
      : THEME.ink;
  const tirColor =
    weekTIR == null
      ? THEME.ink
      : weekTIR >= 70
        ? STATUS_COLOR.normal
        : weekTIR >= 50
          ? STATUS_COLOR.elevated
          : STATUS_COLOR.high;

  // Onboarding said whether this user takes a mealtime insulin at all. When they
  // do not, the insulin apparatus (IOB line here, the whole Injection tab) stays
  // out of the way instead of implying they should be dosing.
  const showsInsulin = insulinModeShowsBolus(activeProfile?.insulin_mode);

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
              : status === "veryHigh"
                ? "feedbackVeryHigh"
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
  // reversible (clears every log on the profile) and only offered when empty.
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

  // Tap = correct the entry, each kind through its own edit flow.
  function openEdit(entry: JournalEntry) {
    if (entry.kind === "meal") {
      router.push({ pathname: "/calculator", params: { mealLogId: entry.id } });
    } else if (entry.kind === "glucose") {
      setEditGlucose(entry);
      setSheetOpen(true);
    } else {
      setEditInjection(entry);
    }
  }

  // Long press = edit/delete menu (the built-in cancel row closes it).
  function onEntryLongPress(entry: JournalEntry) {
    actionSheet({
      actions: [
        {
          label: t("common.edit"),
          icon: "create-outline",
          onPress: () => openEdit(entry),
        },
        {
          label: t("common.delete"),
          icon: "trash-outline",
          destructive: true,
          onPress: () => {
            void confirmDelete(entry);
          },
        },
      ],
    });
  }

  const Header = (
    <View className="pb-2">
      <View className="flex-row items-center justify-between mb-4">
        <Text style={{ color: THEME.ink, fontSize: 24, fontWeight: "800" }}>
          {t("common.today")}
        </Text>
        <View className="flex-row items-center" style={{ gap: 10 }}>
          {/* Spike's entry point only exists when the function URL is actually
              configured. A visible button that opens a dead end is worse than
              no button; see lib/ai/spikeClient.ts. */}
          {spikeConfigured ? (
            <Pressable
              onPress={() => router.push("/spike")}
              hitSlop={8}
              accessibilityLabel={t("spike.title")}
            >
              <IconTile icon="sparkles" size={32} radius={10} />
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => router.push("/sos")}
            hitSlop={8}
            accessibilityLabel={t("sos.title")}
          >
            <IconTile icon="medical" size={32} radius={10} tint="#ff7a8a" />
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
          <Ionicons name="flask-outline" size={18} color="#2ee6ff" />
          <Text className="text-brand text-sm font-medium flex-1 ml-2.5">
            {t("dashboard.sampleActive")}
          </Text>
          <Text className="text-brand text-xs underline">
            {t("dashboard.sampleClear")}
          </Text>
        </Pressable>
      ) : null}

      {/* Hero: most recent reading as the signature glucose ring */}
      {lastGlucose ? (
        <GlassCard glow={lastColor} style={{ paddingVertical: 14, marginBottom: 12 }}>
          <View className="flex-row items-center justify-between px-1 mb-1">
            <Text
              style={{
                color: THEME.muted,
                fontSize: 9,
                letterSpacing: 1.3,
                textTransform: "uppercase",
                fontWeight: "800",
              }}
            >
              {t("dashboard.lastReading")}
            </Text>
            {lastStatus ? (
              <GlucoseChip
                status={lastStatus}
                label={
                  lastStatus === "normal"
                    ? t("insights.inRange")
                    : lastStatus === "low"
                      ? t("insights.low")
                      : lastStatus === "veryHigh"
                        ? t("insights.veryHigh")
                        : t("insights.high")
                }
              />
            ) : null}
          </View>
          <View className="items-center">
            <GlucoseRing
              value={lastGlucose.glucose_level_mgdl}
              display={formatGlucose(lastGlucose.glucose_level_mgdl, unit)}
              caption={`${glucoseUnitLabel(unit)} · ${formatTime(lastGlucose.logged_at)}`}
              color={lastColor}
              size={152}
            />
          </View>
        </GlassCard>
      ) : null}

      {/* Active post-meal timer card (mockup B03: accent card + time) */}
      <GlassCard accent style={{ marginBottom: 12, paddingVertical: 12 }}>
        <Pressable
          onPress={postMealArmed ? undefined : startedEating}
          disabled={postMealArmed}
          accessibilityState={{ disabled: postMealArmed }}
        >
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center" style={{ gap: 8 }}>
              <Ionicons
                name={postMealArmed ? "time" : "restaurant-outline"}
                size={18}
                color={THEME.accent}
              />
              <Text style={{ color: THEME.ink, fontSize: 13, fontWeight: "700" }}>
                {t("dashboard.quickPostMeal")}
              </Text>
            </View>
            <Text style={[TABULAR, { color: THEME.accent, fontSize: 18, fontWeight: "800" }]}>
              {postMealCountdown
                ? postMealCountdown.seconds
                  ? t("dashboard.postMealCountdownSec", { s: postMealCountdown.value })
                  : t("dashboard.postMealCountdownMin", { m: postMealCountdown.value })
                : t("dashboard.startedEating")}
            </Text>
          </View>
        </Pressable>
      </GlassCard>

      {/* Active insulin (IOB): a compact contextual line, only when working and
          only for users who actually take a mealtime insulin. */}
      {iob > 0 && showsInsulin ? (
        <View className="flex-row items-center justify-center mb-3" style={{ gap: 6 }}>
          <Ionicons name="hourglass-outline" size={12} color={THEME.accent} />
          <Text style={{ color: THEME.muted, fontSize: 11 }}>
            {t("dashboard.activeInsulin")}: {num(iob)} {t("common.units")}
          </Text>
        </View>
      ) : null}

      <Text className="text-xs font-semibold uppercase tracking-wider text-mut mb-2">
        {t("dashboard.history")}
      </Text>

      {/* One-time tap-to-edit discoverability hint */}
      {showEditHint && entries.length > 0 ? (
        <View className="flex-row items-center rounded-xl border border-hair bg-glass px-3 py-2.5 mb-2">
          <Ionicons name="create-outline" size={14} color={THEME.accent} />
          <Text className="text-mut text-xs ml-2 flex-1">
            {t("journal.editHint")}
          </Text>
          <Pressable
            onPress={dismissEditHint}
            hitSlop={10}
            accessibilityLabel={t("common.close")}
          >
            <Ionicons name="close" size={16} color={THEME.muted} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );

  return (
    <AppBackground style={{ paddingTop: insets.top }}>
      <FlatList
        data={entries}
        keyExtractor={(e) => `${e.kind}-${e.id}`}
        ListHeaderComponent={Header}
        ListFooterComponent={
          <View className="mt-3" style={{ gap: 8 }}>
            {/* Secondary utilities, demoted below the mockup's core composition */}
            <Pressable
              onPress={() => router.push("/insights")}
              className="rounded-2xl bg-glass border border-hair p-3.5 flex-row items-center active:opacity-80"
            >
              <IconTile icon="stats-chart" size={30} radius={10} style={{ marginRight: 12 }} />
              <View className="flex-1">
                <Text style={{ color: THEME.ink, fontWeight: "700", fontSize: 13 }}>{t("insights.title")}</Text>
                <Text style={{ color: THEME.muted, fontSize: 11 }}>{t("insights.cardSub")}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={THEME.muted} />
            </Pressable>

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
                className="rounded-2xl bg-glass border border-hair p-3.5 flex-row items-center active:opacity-80"
              >
                <IconTile icon="pulse" size={30} radius={10} style={{ marginRight: 12 }} />
                <View className="flex-1">
                  <Text style={{ color: THEME.ink, fontWeight: "700", fontSize: 13 }}>{HEALTH_NAME}</Text>
                  <Text style={{ color: THEME.muted, fontSize: 11 }}>
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
                  <Switch
                    value={cgmOn}
                    onValueChange={toggleCgm}
                    trackColor={{ true: THEME.accent, false: THEME.border }}
                    thumbColor={THEME.ink}
                  />
                ) : (
                  <View className="rounded-full bg-brand px-2 py-0.5">
                    <Text className="text-black text-[10px] font-bold">{t("common.pro")}</Text>
                  </View>
                )}
              </Pressable>
            ) : null}

            {entries.length > 0 ? (
              <View className="flex-row items-start rounded-xl border border-amber-500/25 bg-amber-500/10 px-3.5 py-3">
                <Ionicons name="medical-outline" size={15} color="#f59e0b" />
                <Text className="text-amber-200/80 text-xs leading-4 ml-2.5 flex-1">
                  {t("disclaimer.short")}
                </Text>
              </View>
            ) : null}
          </View>
        }
        renderItem={({ item, index }) =>
          activeProfile ? (
            <Animated.View entering={listEntering.delay(Math.min(index, 8) * 40)}>
              <JournalItem
                entry={item}
                profile={activeProfile}
                onPress={openEdit}
                onLongPress={onEntryLongPress}
              />
            </Animated.View>
          ) : null
        }
        ListEmptyComponent={
          <View className="items-center py-12">
            <Ionicons name="document-text-outline" size={40} color={THEME.muted} />
            <Text className="text-mut text-center mt-3 px-8">
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

      {/* Bottom CTA (mockup B03: single "add record") */}
      <View
        className="absolute left-0 right-0 bottom-0 px-4 pt-2"
        style={{ paddingBottom: 10, backgroundColor: "rgba(8,14,20,0.82)", borderTopWidth: 1, borderTopColor: THEME.border }}
      >
        <GradientCTA
          label={`＋ ${t("dashboard.addRecord")}`}
          onPress={() => openLogger("fasting")}
        />
      </View>

      <GlucoseInputSheet
        visible={sheetOpen}
        initialPeriod={initialPeriod}
        unit={activeProfile?.glucose_unit ?? "mgdl"}
        profile={activeProfile ?? undefined}
        edit={editGlucose}
        onClose={() => {
          setSheetOpen(false);
          setEditGlucose(null);
        }}
        onSubmit={submitGlucose}
      />

      <InjectionEditSheet
        visible={editInjection != null}
        injection={editInjection}
        onClose={() => setEditInjection(null)}
        onSaved={() => {
          setEditInjection(null);
          bumpData();
        }}
      />
    </AppBackground>
  );
}
