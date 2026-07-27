import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform, Pressable, SectionList, Switch, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";

import { useApp } from "../../lib/store/AppContext";
import { getJournal, JournalEntry, GlucoseEntry, InjectionEntry, MealEntry } from "../../lib/db/journal";
import { activeInsulin } from "../../lib/iob";
import { computeMealResponse } from "../../lib/mealResponse";
import { targetBandFor } from "../../lib/agpChart";
import { isConfigured as spikeConfigured } from "../../lib/ai/spikeClient";
import { isScreenshotMode } from "../../lib/screenshotMode";
import { insulinModeShowsBolus, insulinModeUsesInsulin } from "../../lib/insulinMode";
import {
  addSugarLog,
  updateSugarLog,
  deleteSugarLog,
  deleteMealLog,
} from "../../lib/db/logs";
import { deleteInjection } from "../../lib/db/injections";
import { captureDeletion } from "../../lib/db/undo";
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
import {
  importHealthGlucose,
  writeGlucoseToHealthIfEnabled,
  deleteGlucoseFromHealth,
  type SyncResult,
} from "../../lib/services/health";
import { consecutiveLogDays } from "../../lib/insights";
import { noteLogAndMaybeReview } from "../../lib/services/review";
import { logEvent } from "../../lib/analytics";

const CGM_KEY = "zerospike.cgmSync";
// Shown once to an existing free user who had auto-sync on before it became Pro.
const HEALTH_PRO_NOTICE_KEY = "zerospike.healthProNoticeShown";
// One-time discoverability hint: journal rows can be tapped to edit.
const EDIT_HINT_KEY = "zerospike.editHintDismissed";
// One-time tip shown after the first meal timer: the countdown also appears on
// the lock screen / Dynamic Island (points at the widget guide).
const WIDGET_TIP_KEY = "zerospike.widgetTipDismissed";
// Name the health source explicitly in the UI (App Review guideline 2.5.1).
const HEALTH_NAME = Platform.OS === "ios" ? "Apple Health" : "Health Connect";
import { JournalItem } from "../../components/JournalItem";
import { QuickAddSheet } from "../../components/QuickAddSheet";
import { useUndoBatch } from "../../components/useUndoBatch";
import { GlucoseInputSheet } from "../../components/GlucoseInputSheet";
import { InjectionEditSheet } from "../../components/InjectionEditSheet";
import { ProfileSwitcher } from "../../components/ProfileSwitcher";
import { useFeedback } from "../../components/Feedback";
import { StatCard } from "../../components/StatCard";
import { Sparkline } from "../../components/Sparkline";
import { SegmentedStat } from "../../components/ui";
import { EmptyState } from "../../components/EmptyState";
import Animated from "react-native-reanimated";
import { listEntering, PressableScale } from "../../lib/theme/motion";
import { RICH_BY_STATUS, THEME, TABULAR, RADIUS } from "../../lib/theme/tokens";
import {
  AppBackground,
  GlassCard,
  GlucoseRing,
  GlucoseChip,
  GradientCTA,
  IconTile,
} from "../../components/rich";
import { formatDateKey, formatTime, relativeDay, num } from "../../lib/format";
import {
  formatGlucose,
  glucoseUnitLabel,
  glucoseToDisplay,
  classifyGlucose,
  STATUS_COLOR,
} from "../../lib/glucose";
import { hapticSuccess, hapticWarning, hapticSelect } from "../../lib/haptics";
import { upper } from "../../lib/upper";


export default function DashboardScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ sheet?: string }>();
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
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [showWidgetTip, setShowWidgetTip] = useState(false);
  // Journal: session-only kind filter + page size (grows on scroll). Stats below
  // still read the full loaded feed, so filtering/paging never skews them.
  const [filter, setFilter] = useState<"all" | "glucose" | "meal" | "injection">("all");
  const [journalLimit, setJournalLimit] = useState(50);
  // Post-meal reminder countdown: end time (epoch ms) of the pending nudge, and
  // a tick that drives the live label. Armed by the button OR the automatic
  // schedule paths (both persist the end time in the service).
  const [postMealEnd, setPostMealEnd] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  // Full post-meal window (min) so the compact card's progress bar can show how
  // much of it has elapsed. Loaded from prefs (90/120/150); 120 is the default.
  const [postMealWindowMin, setPostMealWindowMin] = useState(120);

  const refreshPostMealTimer = useCallback(async () => {
    setPostMealEnd(await getPostMealTimerEnd());
    setPostMealWindowMin((await getNotificationPrefs()).postMealMinutes);
  }, []);

  const load = useCallback(async () => {
    if (!activeProfile) return;
    // Load a stats-safe floor (weekly/today/hero read the full feed) that also
    // grows as the paginated journal list is scrolled past it.
    const loadLimit = Math.max(300, journalLimit + 50);
    const feed = await getJournal(activeProfile.id, lang, loadLimit);
    setEntries(feed);
    setSampleActive(await isSampleActive(activeProfile.id));
    // Refresh the shared live-surface snapshot (next reminder + last glucose)
    // so the notification/Live Activity/widget/watch layer reads current data.
    void syncLiveData(activeProfile.id, activeProfile.glucose_unit ?? "mgdl");
  }, [activeProfile, lang, journalLimit]);

  useEffect(() => {
    load();
  }, [load, dataVersion]);

  // Deep-link from a reminder tap (app/_layout.tsx routes the notification here
  // with a `sheet` param): open the glucose sheet on the requested period, then
  // clear the param so returning to this tab later doesn't reopen it.
  useEffect(() => {
    const s = params.sheet;
    if (!s || !activeProfile) return;
    setEditGlucose(null);
    setInitialPeriod(s === "post_meal_2h" ? "post_meal_2h" : "fasting");
    setSheetOpen(true);
    router.setParams({ sheet: "" });
  }, [params.sheet, activeProfile, router]);

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
  // Fraction of the post-meal window already elapsed (fills the compact bar).
  const postMealProgress = postMealArmed
    ? Math.min(1, Math.max(0, 1 - (postMealEnd - nowTick) / (postMealWindowMin * 60_000)))
    : 0;

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
      // First timer: tell the user the countdown also shows on the lock screen.
      try {
        if ((await AsyncStorage.getItem(WIDGET_TIP_KEY)) !== "true") {
          setShowWidgetTip(true);
        }
      } catch {
        // best-effort tip
      }
    } else {
      toast(t("dashboard.toklukNeedsPerm"), "info");
    }
  }

  async function dismissWidgetTip() {
    setShowWidgetTip(false);
    try {
      await AsyncStorage.setItem(WIDGET_TIP_KEY, "true");
    } catch {
      // best-effort tip
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
    const addedSugar = await addSugarLog({
      profile_id: activeProfile.id,
      glucose_level_mgdl: value,
      period_tag: period,
      tags,
      logged_at: loggedAt ? loggedAt.toISOString() : undefined,
    });
    // Opt-in Apple Health mirror (H1); no-op unless the user enabled it.
    void writeGlucoseToHealthIfEnabled(addedSugar);
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

  // "I started eating" timer running: let the user cancel it in place.
  async function cancelEatingTimer() {
    await cancelPostMealTimer();
    setPostMealEnd(null);
    hapticWarning();
  }

  // Delete immediately (no blocking confirm) with a 6-second, accumulating undo
  // (shared useUndoBatch: consecutive deletes collapse into one "N deleted"
  // toast). Each snapshot restores the entry with every linked row it took with
  // it (a meal's calculator bolus, etc. - see captureDeletion).
  const deleteEntryWithUndo = useUndoBatch(bumpData);

  async function deleteWithUndo(entry: JournalEntry) {
    const snap = await captureDeletion(entry.kind, entry.id);
    await deleteEntryWithUndo(snap, async () => {
      if (entry.kind === "glucose") {
        // H3: revoke the mirrored Apple Health sample (best-effort) when the local
        // reading is deleted (undo included - undo re-adds without a mirror).
        void deleteGlucoseFromHealth(await deleteSugarLog(entry.id));
      } else if (entry.kind === "injection") await deleteInjection(entry.id);
      else await deleteMealLog(entry.id);
    });
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

  // Meal rows with a computable response (lib/mealResponse.ts) get a small
  // additive chevron (JournalItem) that opens it instead of the edit flow.
  // Recomputed from the already-loaded feed — no extra query.
  const mealResponseIds = useMemo(() => {
    if (!activeProfile) return new Set<string>();
    const readings = entries.filter((e): e is GlucoseEntry => e.kind === "glucose");
    const meals = entries.filter((e): e is MealEntry => e.kind === "meal");
    const ids = new Set<string>();
    for (const meal of meals) {
      if (computeMealResponse(meal, readings, activeProfile)) ids.add(meal.id);
    }
    return ids;
  }, [entries, activeProfile]);

  function openMealResponse(entry: JournalEntry) {
    router.push({ pathname: "/meal-response", params: { mealId: entry.id } });
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
            void deleteWithUndo(entry);
          },
        },
      ],
    });
  }

  // Journal display: apply the kind filter, page to journalLimit, group by day.
  const JOURNAL_PAGE = 50;
  const filteredEntries =
    filter === "all" ? entries : entries.filter((e) => e.kind === filter);
  const displayEntries = filteredEntries.slice(0, journalLimit);
  const journalSections: { title: string; data: JournalEntry[] }[] = [];
  {
    const byKey = new Map<string, JournalEntry[]>();
    for (const e of displayEntries) {
      const key = formatDateKey(e.logged_at);
      let arr = byKey.get(key);
      if (!arr) {
        arr = [];
        byKey.set(key, arr);
        journalSections.push({
          title: relativeDay(e.logged_at, {
            today: t("common.today"),
            yesterday: t("common.yesterday"),
          }),
          data: arr,
        });
      }
      arr.push(e);
    }
  }

  const FILTER_CHIPS: { key: typeof filter; label: string }[] = [
    { key: "all", label: t("dashboard.filterAll") },
    { key: "glucose", label: t("dashboard.quickAddGlucose") },
    { key: "meal", label: t("dashboard.quickAddFood") },
    { key: "injection", label: t("dashboard.quickAddInjection") },
  ];

  const Header = (
    <View className="pb-2">
      <View className="flex-row items-center justify-between mb-4">
        <Text style={{ color: THEME.ink, fontSize: 24, fontWeight: "800" }}>
          {t("common.today")}
        </Text>
        <View className="flex-row items-center" style={{ gap: 10 }}>
          {/* Spike's entry point only exists when the function URL is actually
              configured. A visible button that opens a dead end is worse than
              no button; see lib/ai/spikeClient.ts. K4: also shown in store-
              screenshot mode, where spike.tsx renders a mock chat with no
              backend. */}
          {spikeConfigured || isScreenshotMode() ? (
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
                fontSize: 11,
                letterSpacing: 1.3,
                fontWeight: "800",
              }}
            >
              {upper(t("dashboard.lastReading"))}
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

      {/* This-week strip: numbers that were computed but never shown (avg, TIR,
          streak) with a small sparkline of the week's readings. One compact row. */}
      {hasWeekData ? (
        <View style={{ marginBottom: 12 }}>
          <View className="flex-row items-center justify-between mb-1.5 px-1">
            <Text style={{ color: THEME.muted, fontSize: 11, fontWeight: "700" }}>
              {t("dashboard.thisWeek")}
            </Text>
            {weekSparkline.length > 1 ? (
              <Sparkline
                data={weekSparkline}
                width={72}
                height={20}
                color={avgColor}
                showLast={false}
                fill={false}
              />
            ) : null}
          </View>
          <SegmentedStat
            items={[
              {
                label: t("insights.avgGlucose"),
                value: weekAvg != null ? formatGlucose(weekAvg, unit) : "—",
                accent: avgColor,
              },
              {
                label: t("insights.timeInRange"),
                value: weekTIR != null ? `${weekTIR}%` : "—",
                accent: tirColor,
              },
              { label: t("dashboard.streakDays"), value: `${logStreak}` },
            ]}
          />
        </View>
      ) : null}

      {/* Post-meal timer: a REAL filled pill button, not text that reads like a
          value. While the timer runs, the same slot shows the countdown + a small
          cancel action. */}
      <GlassCard accent style={{ marginBottom: 12, paddingVertical: 12 }}>
        {postMealArmed && postMealCountdown ? (
          // Active: a compact card — small label, thin elapsed-progress bar, short
          // remaining, cancel. No big sentence that reads like a value.
          <View>
            <View
              className="flex-row items-center justify-between"
              style={{ marginBottom: 10 }}
            >
              <View className="flex-row items-center flex-1" style={{ gap: 8 }}>
                <Ionicons name="time" size={16} color={THEME.accent} />
                <Text
                  style={{ color: THEME.muted, fontSize: 12, fontWeight: "700", flex: 1 }}
                  numberOfLines={1}
                >
                  {t("dashboard.quickPostMeal")}
                </Text>
              </View>
              <View className="flex-row items-center" style={{ gap: 10 }}>
                <Text style={[TABULAR, { color: THEME.accent, fontSize: 15, fontWeight: "800" }]}>
                  {postMealCountdown.seconds
                    ? t("dashboard.postMealCountdownSec", { s: postMealCountdown.value })
                    : t("dashboard.postMealCountdownMin", { m: postMealCountdown.value })}
                </Text>
                <Pressable
                  onPress={cancelEatingTimer}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={t("common.cancel")}
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 15,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: THEME.glass,
                    borderWidth: 1,
                    borderColor: THEME.border,
                  }}
                >
                  <Ionicons name="close" size={15} color={THEME.muted} />
                </Pressable>
              </View>
            </View>
            <View
              style={{ height: 6, borderRadius: 3, backgroundColor: THEME.track, overflow: "hidden" }}
            >
              <View
                style={{
                  height: "100%",
                  width: `${Math.round(postMealProgress * 100)}%`,
                  backgroundColor: THEME.accent,
                  borderRadius: 3,
                }}
              />
            </View>
          </View>
        ) : (
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center flex-1" style={{ gap: 8 }}>
              <Ionicons name="restaurant-outline" size={18} color={THEME.accent} />
              <Text
                style={{ color: THEME.ink, fontSize: 13, fontWeight: "700", flex: 1 }}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.85}
              >
                {t("dashboard.quickPostMeal")}
              </Text>
            </View>
            <PressableScale
              onPress={startedEating}
              accessibilityRole="button"
              accessibilityLabel={t("dashboard.startedEating")}
              style={{
                backgroundColor: THEME.accent,
                borderRadius: RADIUS.full,
                paddingHorizontal: 16,
                paddingVertical: 9,
              }}
            >
              <Text style={{ color: "#00171c", fontWeight: "800", fontSize: 13 }}>
                {t("dashboard.startedEating")}
              </Text>
            </PressableScale>
          </View>
        )}
      </GlassCard>

      {/* One-time tip after the first meal timer: the countdown is also a native
          lock-screen surface. Dismissible; points at the widget guide. */}
      {showWidgetTip ? (
        <View className="rounded-2xl border border-hair bg-glass p-3.5 mb-3 flex-row items-center">
          <Ionicons name="phone-portrait-outline" size={18} color={THEME.accent} />
          <View className="flex-1 ml-2.5">
            <Text style={{ color: THEME.ink, fontSize: 12, fontWeight: "700" }}>
              {t("dashboard.widgetTipTitle")}
            </Text>
            <Pressable
              onPress={() => {
                void dismissWidgetTip();
                router.push("/widget-guide");
              }}
              hitSlop={6}
            >
              <Text style={{ color: THEME.accent, fontSize: 11, marginTop: 2 }}>
                {t("dashboard.widgetTipCta")}
              </Text>
            </Pressable>
          </View>
          <Pressable
            onPress={dismissWidgetTip}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t("common.close")}
          >
            <Ionicons name="close" size={16} color={THEME.muted} />
          </Pressable>
        </View>
      ) : null}

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

      <Text className="text-xs font-semibold tracking-wider text-mut mb-2">
        {upper(t("dashboard.history"))}
      </Text>

      {/* Journal kind filter (session-only) */}
      {entries.length > 0 ? (
        <View className="flex-row mb-2" style={{ gap: 6 }}>
          {FILTER_CHIPS.map((c) => {
            const on = filter === c.key;
            return (
              <Pressable
                key={c.key}
                onPress={() => {
                  hapticSelect();
                  setFilter(c.key);
                  setJournalLimit(50);
                }}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={c.label}
                className={`rounded-full px-3 py-1.5 border ${
                  on ? "bg-brand border-brand" : "bg-glass border-hair"
                }`}
              >
                <Text
                  className={`text-xs font-semibold ${on ? "text-black" : "text-mut"}`}
                >
                  {c.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

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
      <SectionList
        sections={journalSections}
        keyExtractor={(e) => `${e.kind}-${e.id}`}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => (
          <Text className="text-[11px] font-semibold tracking-wider text-mut mt-3 mb-1.5">
            {upper(section.title)}
          </Text>
        )}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (displayEntries.length < filteredEntries.length)
            setJournalLimit((l) => l + JOURNAL_PAGE);
        }}
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
                hasResponse={item.kind === "meal" && mealResponseIds.has(item.id)}
                onOpenResponse={openMealResponse}
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
        style={{ paddingBottom: 10 }}
      >
        <GradientCTA
          label={`＋ ${t("dashboard.addRecord")}`}
          onPress={() => setQuickAddOpen(true)}
        />
      </View>

      <QuickAddSheet
        visible={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
        showInjection={insulinModeUsesInsulin(activeProfile?.insulin_mode)}
        onGlucose={() => openLogger("fasting")}
        onFood={() => router.navigate("/(tabs)/food")}
        onInjection={() =>
          router.navigate({ pathname: "/(tabs)/injection", params: { compose: "1" } })
        }
      />

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
