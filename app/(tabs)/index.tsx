import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform, Pressable, SectionList, Switch, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";

import { useApp } from "../../lib/store/AppContext";
import { getJournal, JournalEntry, GlucoseEntry, InjectionEntry, MealEntry, MedEntry } from "../../lib/db/journal";
import { activeInsulinBreakdown } from "../../lib/iob";
import { bolusProfileFor, basalProfileFor, insulinProductById } from "../../lib/insulinCatalog";
import { targetBandFor } from "../../lib/agpChart";
import { isConfigured as spikeConfigured } from "../../lib/ai/spikeClient";
import { isScreenshotMode, useScreenshotAndroidSource } from "../../lib/screenshotMode";
import {
  insulinModeOf,
  insulinModeShowsBasal,
  insulinModeShowsBolus,
  insulinModeUsesInsulin,
} from "../../lib/insulinMode";
import {
  addSugarLog,
  getSugarLog,
  setSugarLogHealthUuid,
} from "../../lib/db/logs";
import { useLayout } from "../../lib/useLayout";
import type { LogTag, PeriodTag, Reminder } from "../../lib/db/types";
import { listReminders } from "../../lib/db/reminders";
import { nextUpcoming, type UpcomingItem } from "../../lib/upcomingReminders";
import {
  getAlarmAuthorizationStatus,
  isAlarmKitAvailable,
} from "../../modules/zerospike-alarmkit";
import {
  startPostMealTimer,
  restartPostMealTimerAt,
  scheduleLowFollowup,
  lowFollowupThresholdMgdl,
  getPostMealTimerState,
  cancelPostMealTimer,
  completePostMealTimer,
  getNotificationPermission,
  noteJournalActivity,
  type PostMealStartOutcome,
} from "../../lib/services/notifications";
import {
  formatPostMealRemaining,
  postMealCardActions,
  postMealElapsedFraction,
  postMealWindowForProfile,
  POST_MEAL_WINDOW_MIN,
  type PostMealCardActions,
  type PostMealTimerWindow,
} from "../../lib/postMealTimer";
import { getNotificationPrefs } from "../../lib/services/notificationPrefs";
import {
  markDay7DownsellShown,
  shouldShowDay7Downsell,
} from "../../lib/services/downsell";
import { syncLiveData } from "../../lib/services/liveData";
import {
  importHealthGlucose,
  writeGlucoseToHealthIfEnabled,
  updateGlucoseInHealth,
  deleteGlucoseFromHealth,
  getHealthWriteEnabled,
  type SyncResult,
} from "../../lib/services/health";
import { consecutiveLogDays } from "../../lib/insights";
import { noteLogAndMaybeReview } from "../../lib/services/review";
import { logCrash, logEvent } from "../../lib/analytics";
import { isWidgetInstalled } from "../../modules/zerospike-live-activity";

// Base keys below are scoped per profile ("<key>.<profileId>") via
// readProfileFlag/writeProfileFlag - each used to be one value for the whole
// device, so a caregiver switching profiles inherited whatever the PREVIOUS
// profile had toggled or dismissed (audit findings A and dismiss-flag leak).
const CGM_KEY = "zerospike.cgmSync";
// Shown once to an existing free user who had auto-sync on before it became Pro.
const HEALTH_PRO_NOTICE_KEY = "zerospike.healthProNoticeShown";
// One-time discoverability hint: journal rows can be tapped to edit.
const EDIT_HINT_KEY = "zerospike.editHintDismissed";
// One-time tip shown after the first meal timer: the countdown also appears on
// the lock screen / Dynamic Island (points at the widget guide).
const WIDGET_TIP_KEY = "zerospike.widgetTipDismissed";

/** Which period a plain "log a glucose reading" action starts on, for the
 *  in-app quick add AND for the widget/notification links that mean the same
 *  thing. One constant so those two can never drift into labelling the same
 *  action differently; the user can change it in the sheet either way. */
const DEFAULT_LOG_PERIOD: PeriodTag = "fasting";
// The first-run guide is gone once anything is logged, but its optional steps
// (Health, widget) are not done yet - this compact row carries them until the
// user closes it.
const FINISH_SETUP_KEY = "zerospike.finishSetupDismissed";

/**
 * Reads a boolean flag now kept per profile. The first read for ANY profile
 * that finds no scoped value yet, but does find the old device-wide one,
 * carries it over to THAT profile and deletes the global key - a one-time,
 * lossless move; every read after that is purely per profile.
 */
async function readProfileFlag(baseKey: string, profileId: string): Promise<boolean> {
  const scopedKey = `${baseKey}.${profileId}`;
  const scoped = await AsyncStorage.getItem(scopedKey);
  if (scoped != null) return scoped === "true";
  const legacy = await AsyncStorage.getItem(baseKey);
  if (legacy == null) return false;
  await AsyncStorage.setItem(scopedKey, legacy);
  await AsyncStorage.removeItem(baseKey);
  return legacy === "true";
}

async function writeProfileFlag(baseKey: string, profileId: string, value: boolean): Promise<void> {
  await AsyncStorage.setItem(`${baseKey}.${profileId}`, value ? "true" : "false");
}
// Name the health source explicitly in the UI (App Review guideline 2.5.1).
const HEALTH_NAME = Platform.OS === "ios" ? "Apple Health" : "Health Connect";
// The dashboard shows a PREVIEW of the journal, not the journal: the last
// couple of days and at most a screenful of rows (JOURNAL_PREVIEW_LIMITS,
// lib/journalSlice.ts). It deliberately does not grow in place - the old "show
// more" kept extending a list inside a page that was already scrolling - and
// hands off to app/journal.tsx instead, where paging has a screen of its own.
// The floating "add record" CTA sits above the tab bar, and the tab bar already
// carries the device's safe-area inset - adding insets.bottom on top of it only
// left a dead band (same correction as the food tab).
const CTA_BOTTOM = 10;
// What the journal has to scroll clear of: the CTA overlay plus a little air.
const CTA_CLEARANCE = CTA_BOTTOM + 100;
import { Tooltip } from "../../components/Tooltip";
import { Skeleton } from "../../components/Skeleton";
import { JournalItem } from "../../components/JournalItem";
import { QuickAddSheet } from "../../components/QuickAddSheet";
import {
  JournalDayHeader,
  JournalDisclaimerNote,
  JournalEmptyFilter,
  JournalFilterChips,
  JournalPanelBottom,
  JournalPanelTop,
  journalPanelSide,
  type JournalFilter,
  type JournalSection,
} from "../../components/JournalPanel";
import { useJournalRows } from "../../components/useJournalRows";
import {
  JOURNAL_PREVIEW_LIMITS,
  nextJournalCut,
} from "../../lib/journalSlice";
import { applyGlucoseCorrection } from "../../lib/services/glucoseEdit";
import { GlucoseInputSheet } from "../../components/GlucoseInputSheet";
import { InjectionEditSheet } from "../../components/InjectionEditSheet";
import { MedEditSheet } from "../../components/MedEditSheet";
import { PostMealLateSheet } from "../../components/PostMealLateSheet";
import { ProfileSwitcher } from "../../components/ProfileSwitcher";
import { useFeedback } from "../../components/Feedback";
import { StatCard } from "../../components/StatCard";
import { Sparkline } from "../../components/Sparkline";
import { Button, SegmentedStat } from "../../components/ui";
import { EmptyState } from "../../components/EmptyState";
import { DirIcon } from "../../components/DirIcon";
import Animated from "react-native-reanimated";
import { listEntering, PressableScale } from "../../lib/theme/motion";
import { RICH_BY_STATUS, GLUCOSE_RICH, THEME, TABULAR, RADIUS } from "../../lib/theme/tokens";
import {
  AppBackground,
  GlassCard,
  GlucoseRing,
  GlucoseChip,
  GradientCTA,
  IconTile,
} from "../../components/rich";
import { formatDate, formatDateKey, formatTime, formatTimeForLang, formatWeekday, relativeDay, num, pct } from "../../lib/format";
import {
  formatGlucose,
  glucoseUnitLabel,
  glucoseToDisplay,
  classifyGlucose,
  STATUS_COLOR,
} from "../../lib/glucose";
import { hapticSuccess, hapticWarning, hapticSelect } from "../../lib/haptics";
import { upper } from "../../lib/upper";


const journalKey = (e: JournalEntry) => `${e.kind}-${e.id}`;

/** No countdown running, so the card is not drawn at all and neither action
 *  applies. A shared constant so the memo below keeps one identity. */
const NO_POST_MEAL_ACTIONS: PostMealCardActions = {
  logMeal: false,
  restart: false,
  restartMealId: null,
};


/**
 * Hero placeholder, shown only while the first feed read is still in flight
 * (before we know whether this is a first run or an existing user). Sized to
 * match the loaded hero card (GlassCard + 152pt ring) so settling into either
 * the real hero or the first-run guide's own ring is a small, single step -
 * not the two-stage "wrong shell then everything shifts" jump this replaces.
 */
function HeroSkeleton() {
  return (
    <GlassCard style={{ paddingVertical: 14, marginBottom: 12 }}>
      <View className="flex-row items-center justify-between px-1 mb-1">
        <Skeleton width={90} height={11} radius={4} />
        <Skeleton width={54} height={18} radius={9} />
      </View>
      <View className="items-center">
        <Skeleton width={152} height={152} radius={76} />
      </View>
    </GlassCard>
  );
}

/** This-week strip placeholder, sized to match the loaded SegmentedStat row. */
function WeekSkeleton() {
  return (
    <View style={{ marginBottom: 12 }}>
      <View className="flex-row items-center justify-between mb-1.5 px-1">
        <Skeleton width={70} height={11} radius={4} />
        <Skeleton width={72} height={20} radius={4} />
      </View>
      <View className="flex-row rounded-2xl bg-glass border border-hair py-3">
        {[0, 1, 2].map((i) => (
          <View
            key={i}
            className="flex-1 items-center px-1"
            style={i > 0 ? { borderLeftWidth: 1, borderLeftColor: THEME.border } : undefined}
          >
            <Skeleton width={40} height={18} radius={4} style={{ marginBottom: 4 }} />
            <Skeleton width={54} height={11} radius={4} />
          </View>
        ))}
      </View>
    </View>
  );
}

export default function DashboardScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ sheet?: string }>();
  const { columnPad } = useLayout();
  const { activeProfile, isProUser, dataVersion, bumpData, lang } = useApp();
  const { toast, confirm, actionSheet } = useFeedback();
  // Store-screenshot only: an Android store frame is captured on the iOS
  // simulator (?scPlatform=android), and the Android build has no health sync at
  // all - so the quick-access row drops the Health card and takes its Android
  // shape. Always false in a normal build (dev + env double lock).
  const androidSourceShot = useScreenshotAndroidSource();
  const showsHealthCard = Platform.OS === "ios" && !androidSourceShot;

  const [entries, setEntries] = useState<JournalEntry[]>([]);
  // The visible journal list only: same window, but with the calculator's own
  // auto-written bolus row (source = 'calculator') filtered out in SQL, so a
  // logged meal no longer shows its dose twice (once on the meal row, once on
  // the injection line right under it). Kept SEPARATE from `entries` above -
  // active insulin, the week strip and the response icons below still read the
  // unfiltered feed, because IOB is computed from every bolus row including
  // this one; only the rendered list itself hides it.
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  // The first feed read has landed. Without it an empty `entries` means both
  // "still loading" and "nothing logged yet", and the first-run guide flashed
  // over an existing user's dashboard for one frame on every cold start.
  const [loaded, setLoaded] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editGlucose, setEditGlucose] = useState<GlucoseEntry | null>(null);
  const [editInjection, setEditInjection] = useState<InjectionEntry | null>(null);
  const [editMed, setEditMed] = useState<MedEntry | null>(null);
  const [showEditHint, setShowEditHint] = useState(false);
  const [showFinishSetup, setShowFinishSetup] = useState(false);
  const [initialPeriod, setInitialPeriod] = useState<PeriodTag>("fasting");
  // null = the persisted AsyncStorage preference has not been read yet. A Pro
  // user who had sync ON must never see the switch commit to OFF for one frame
  // and then jump to ON - the card stays in its skeleton shape until this
  // resolves to a real boolean.
  const [cgmOn, setCgmOn] = useState<boolean | null>(null);
  const [syncing, setSyncing] = useState(false);
  // undefined = not checked yet, or this platform/build cannot say either way
  // (no native module linked, a query error). The setup row's Widget item
  // stays neutral in that case rather than claiming "not installed".
  const [widgetInstalled, setWidgetInstalled] = useState<boolean | undefined>(undefined);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  // Set only by the "med" deep-link/widget shortcut below: makes the next
  // QuickAddSheet open land straight on its medication mini-form instead of
  // the option grid. Cleared the moment the sheet closes, so the normal "+"
  // CTA always opens on the grid.
  const [quickAddMedDirect, setQuickAddMedDirect] = useState(false);
  const [showWidgetTip, setShowWidgetTip] = useState(false);
  // Journal: session-only kind filter + how many slices are revealed (one, plus
  // one per "show more" press). Stats below still read the full loaded feed, so
  // filtering/paging never skews them.
  const [filter, setFilter] = useState<JournalFilter>("all");
  // Injection chip only exists in insulin modes that log injections; if the
  // profile's mode changes to "none" while it's selected, fall back to "all"
  // instead of leaving the list filtered on a kind with no chip.
  useEffect(() => {
    if (filter === "injection" && !insulinModeUsesInsulin(activeProfile?.insulin_mode)) {
      setFilter("all");
    }
  }, [filter, activeProfile?.insulin_mode]);
  // Med chip stays visible once meds exist even after oral meds is turned off
  // (so past entries stay reachable); only drop the filter to "all" once both
  // the setting is off AND no med entries remain, matching the chip's own
  // visibility condition below.
  useEffect(() => {
    if (
      filter === "med" &&
      activeProfile?.oral_meds_enabled !== 1 &&
      !journalEntries.some((e) => e.kind === "med")
    ) {
      setFilter("all");
    }
  }, [filter, activeProfile?.oral_meds_enabled, journalEntries]);
  // SQL window (rows of the merged feed): decoupled from the visible slices so a
  // page-down is a pure in-memory slice. Widened by "show more" only when the
  // loaded feed is exhausted; 300 stays the stats-safe floor the hero/week tiles
  // read.
  // Fixed: the preview never widens its own SQL window - the full journal
  // screen owns paging now (app/journal.tsx).
  const [loadLimit] = useState(300);
  // Post-meal reminder countdown: the pending nudge's own start + end (epoch ms).
  // Armed by the "I started eating" button or by logging a meal (both persist the
  // timer in the service). Carrying the START too is what lets the card describe
  // the timer that is actually running rather than assuming it was armed with the
  // current preference. The live ticking label lives in <PostMealCountdown> so it
  // never re-renders this screen's journal list.
  const [postMealTimer, setPostMealTimer] = useState<PostMealTimerWindow | null>(null);
  // "I started eating a while ago" (2.3.0's G15), opened from the small button
  // beside the primary "I started eating" pill.
  const [lateSheetOpen, setLateSheetOpen] = useState(false);
  // The next thing that will actually reach the user (2.3.0's G18). null when
  // there is nothing to say - no reminder set up, the master switch or the OS
  // permission off, or nothing inside the next day - and the line is then not
  // drawn at all rather than drawn empty.
  const [nextReminder, setNextReminder] = useState<UpcomingItem | null>(null);
  const [nextReminderRows, setNextReminderRows] = useState<Reminder[]>([]);
  // An arm is in flight: the ref is the actual guard (see startedEating), the
  // state only greys the two buttons out while it runs.
  const startingTimerRef = useRef(false);
  const [startingTimer, setStartingTimer] = useState(false);

  // Mirrored so the callback below can stay stable (it is called from effects
  // and from every mutation) while still reading the CURRENT profile.
  const activeProfileRef = useRef(activeProfile);
  activeProfileRef.current = activeProfile;
  const activeProfileIdRef = useRef<string | null>(activeProfile?.id ?? null);
  activeProfileIdRef.current = activeProfile?.id ?? null;
  const glucoseUnitRef = useRef(activeProfile?.glucose_unit ?? "mgdl");
  glucoseUnitRef.current = activeProfile?.glucose_unit ?? "mgdl";

  const refreshPostMealTimer = useCallback(async () => {
    setPostMealTimer(await getPostMealTimerState());
  }, []);

  /**
   * The dashboard's own next-reminder line. Reads the SAME rows, gates and
   * delivery decision the reminders screen does (lib/upcomingReminders.ts), so
   * the two surfaces can never disagree about what is coming - and the profile
   * lock applies to the countdown here exactly as it does there.
   */
  const refreshNextReminder = useCallback(async () => {
    try {
      const [rows, prefs, permission, timer] = await Promise.all([
        listReminders(),
        getNotificationPrefs(),
        getNotificationPermission(),
        getPostMealTimerState(),
      ]);
      const alarmKitAvailable = isAlarmKitAvailable();
      const owned = postMealWindowForProfile(timer, activeProfileIdRef.current);
      // A store frame has to look like a real, working account (App Store
      // 2.3.3) and the simulator that captures it has granted nothing, so both
      // permission reads are forced open in screenshot mode - the SAME gate,
      // on the same two facts, as app/settings/reminders.tsx (alarmGranted /
      // notifGranted). Without it the dashboard's line and the reminders
      // screen's "Coming up" card disagreed in the very captures meant to show
      // them side by side. The stored master switch is deliberately NOT gated
      // here or there: the seed sets it like any other preference.
      const notifGranted = isScreenshotMode() ? true : permission === "granted";
      const alarmGranted = isScreenshotMode()
        ? true
        : alarmKitAvailable && getAlarmAuthorizationStatus() === "authorized";
      setNextReminderRows(rows);
      setNextReminder(
        nextUpcoming({
          rows,
          now: Date.now(),
          windowMs: 24 * 60 * 60 * 1000,
          masterEnabled: prefs.enabled,
          notificationPermission: notifGranted,
          showsBasal: insulinModeShowsBasal(insulinModeOf(activeProfileRef.current)),
          showsMeds: activeProfileRef.current?.oral_meds_enabled === 1,
          alarmKitAvailable,
          alarmAuthorized: alarmGranted,
          // Deliberately NOT passing the running countdown: it has its own
          // card right above this line, and repeating it here made the same
          // fact appear twice on one screen. The reminders screen does not
          // list it either.
          postMealEndsAt: null,
        })
      );
    } catch {
      // best-effort: the line simply stays hidden
      setNextReminder(null);
    }
  }, []);

  const load = useCallback(async () => {
    if (!activeProfile) return;
    try {
      // One SQL window for the whole screen: stats read the full feed, the list
      // slices it. Paging inside the window never re-runs this query.
      //
      // The second read is the same window filtered for the rendered list (see
      // the `journalEntries` state comment above); the filter runs in SQL before
      // the LIMIT, so the row budget is spent on rows that actually display.
      // Issued together rather than in sequence: this is the screen the app
      // opens on, and awaiting them one after the other doubled its first paint.
      const [feed, visible] = await Promise.all([
        getJournal(activeProfile.id, lang, loadLimit),
        getJournal(activeProfile.id, lang, loadLimit, undefined, {
          excludeCalculatorInjections: true,
        }),
      ]);
      setEntries(feed);
      setJournalEntries(visible);
    } catch (err) {
      logCrash(err, { screen: "dashboard", load: "journal" });
    } finally {
      // In `finally`: a rejected read used to leave `loaded` false for good, so
      // the hero/week skeletons stayed up with no message and no retry. The
      // screen falls back to its empty state instead.
      setLoaded(true);
    }
  }, [activeProfile, lang, loadLimit]);

  useEffect(() => {
    load();
  }, [load, dataVersion]);

  // Refresh the shared live-surface snapshot (next reminder + last glucose) so
  // the notification/Live Activity/widget/watch layer reads current data.
  //
  // Deliberately NOT part of load(): load widens its SQL window as the user
  // scrolls the journal, and riding along with it meant scrolling to the bottom
  // of the list recomputed the snapshot and asked WidgetKit / the Android widget
  // / the paired watch to redraw. Scroll position is not news for a widget. This
  // fires on what actually changes the numbers: the profile, its unit, and data.
  const profileId = activeProfile?.id;
  const glucoseUnit = activeProfile?.glucose_unit ?? "mgdl";
  useEffect(() => {
    if (!profileId) return;
    void syncLiveData(profileId, glucoseUnit);
  }, [profileId, glucoseUnit, dataVersion]);

  // Deep-link with a `sheet` param: a reminder tap (app/_layout.tsx routes the
  // notification here), a widget tap, or the Live Activity card. Each accepted
  // value is matched EXPLICITLY:
  //   "med"           the medication form (QuickAddSheet)
  //   "post_meal_2h"  the glucose sheet on the post-meal period
  //   "glucose"       the glucose sheet exactly as the in-app quick add opens
  //                   it (DEFAULT_LOG_PERIOD, the same constant that button
  //                   uses) - it used to land in the catch-all below and be
  //                   forced to "fasting" from here, so a widget tap at 3pm
  //                   pre-labelled the reading as a fasting one.
  // Anything else opens NOTHING: an unrecognised value is a bug or a stale
  // link, and guessing a form for it is how the wrong period gets recorded.
  // The param is always cleared, so returning to this tab never reopens it.
  useEffect(() => {
    const s = params.sheet;
    if (!s || !activeProfile) return;
    (async () => {
      if (s === "med") {
        setQuickAddMedDirect(true);
        setQuickAddOpen(true);
      } else if (s === "post_meal_2h") {
        // Profile lock (B): a post-meal reminder tap only opens the 2h sheet
        // when the running timer is actually this profile's own - a legacy
        // timer with no recorded owner still opens it (see the card below).
        const timer = await getPostMealTimerState();
        if (timer && timer.profileId != null && timer.profileId !== activeProfile.id) {
          // Say so rather than dying silently: the notification, the widget or
          // the alarm that led here is real, it just belongs to whoever was
          // using the app when the meal happened.
          toast(t("dashboard.postMealOtherProfile"), "info");
          router.setParams({ sheet: "" });
          return;
        }
        setEditGlucose(null);
        setInitialPeriod("post_meal_2h");
        setSheetOpen(true);
      } else if (s === "glucose") {
        setEditGlucose(null);
        setInitialPeriod(DEFAULT_LOG_PERIOD);
        setSheetOpen(true);
      }
      router.setParams({ sheet: "" });
    })();
  }, [params.sheet, activeProfile, router]);

  // Tap-to-edit is invisible until you know it: show a dismissible one-time
  // hint above the journal until the user closes it. The setup row next to it
  // is read here too, so both dismissals resolve in one pass. Re-runs on a
  // profile switch: each profile keeps its own dismissal (see readProfileFlag).
  useEffect(() => {
    if (!activeProfile) return;
    const profileId = activeProfile.id;
    (async () => {
      try {
        const [hint, setupDone] = await Promise.all([
          readProfileFlag(EDIT_HINT_KEY, profileId),
          readProfileFlag(FINISH_SETUP_KEY, profileId),
        ]);
        setShowEditHint(!hint);
        setShowFinishSetup(!setupDone);
      } catch {
        // best-effort hint
      }
    })();
  }, [activeProfile?.id]);

  async function dismissEditHint() {
    setShowEditHint(false);
    if (!activeProfile) return;
    try {
      await writeProfileFlag(EDIT_HINT_KEY, activeProfile.id, true);
    } catch {
      // best-effort hint
    }
  }

  async function dismissFinishSetup() {
    setShowFinishSetup(false);
    if (!activeProfile) return;
    try {
      await writeProfileFlag(FINISH_SETUP_KEY, activeProfile.id, true);
    } catch {
      // best-effort dismissal
    }
  }

  // Re-read the persisted post-meal timer whenever the feed changes (a log on
  // this screen or a meal logged elsewhere both bump dataVersion).
  useEffect(() => {
    refreshPostMealTimer();
    void refreshNextReminder();
  }, [refreshPostMealTimer, refreshNextReminder, dataVersion]);

  // Also on focus: a timer started (or ended) away from this screen must show
  // up without waiting for a data change or an app restart.
  useFocusEffect(
    useCallback(() => {
      refreshPostMealTimer();
      // Also the next-reminder line: a reminder added, renamed, switched off or
      // switched between alarm and notification in Settings has to show here
      // the moment the user comes back.
      void refreshNextReminder();
    }, [refreshPostMealTimer, refreshNextReminder])
  );

  // The setup row's Widget item re-checks on every dashboard focus, the same
  // moment a user actually comes back after placing (or removing) it - a
  // plain mount-only check would miss both.
  useFocusEffect(
    useCallback(() => {
      isWidgetInstalled().then(setWidgetInstalled);
    }, [])
  );

  // Day-7 downsell: every gate (the lifetime cap, a real discount existing, the
  // seven days themselves) lives in lib/services/downsell.ts - this is only the
  // trigger. The ref stops a double focus from racing two pushes; `push`, not
  // `replace`, is deliberate, so back returns to the dashboard.
  const day7CheckedRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (day7CheckedRef.current || isProUser) return;
      day7CheckedRef.current = true;
      void (async () => {
        if (!(await shouldShowDay7Downsell())) return;
        await markDay7DownsellShown();
        router.push({ pathname: "/downsell", params: { trigger: "day7" } });
      })();
    }, [isProUser, router])
  );

  // Coming back to the foreground: re-read the timer (it may have elapsed while
  // backgrounded; the service returns null for an elapsed end, which disarms).
  // Also re-publish the live-surface snapshot right away rather than waiting on
  // dataVersion: the widget/Live Activity/watch can otherwise keep showing an
  // elapsed reminder for a while after the app itself has already moved on.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      refreshPostMealTimer();
      void refreshNextReminder();
      if (profileId) void syncLiveData(profileId, glucoseUnit);
    });
    return () => sub.remove();
  }, [refreshPostMealTimer, refreshNextReminder, profileId, glucoseUnit]);

  // Restore the persisted sync preference, and silently re-sync on open so new
  // Health readings keep flowing in without re-toggling the switch. Auto-sync is
  // Pro-only now: a free user who had it on keeps their imported data but stops
  // auto-importing, and is told once.
  useEffect(() => {
    // Health/CGM sync is iOS-only (Health Connect was removed for Play policy).
    if (Platform.OS !== "ios") return;
    // Profile lock (A): nothing to key the preference off until the active
    // profile has resolved.
    if (!activeProfile) return;
    const profileId = activeProfile.id;
    // Reset to the skeleton state immediately on a profile switch: without this
    // the card could flash the PREVIOUS profile's sync preference (and briefly
    // let its toggle read as this profile's own) for one frame before the read
    // below resolves.
    setCgmOn(null);
    (async () => {
      let saved = false;
      try {
        saved = await readProfileFlag(CGM_KEY, profileId);
      } catch (err) {
        // A failed read must still resolve cgmOn to a real boolean: left at
        // null the Health card keeps its skeleton switch for good and
        // openHealthFlow returns early, so the card cannot be used at all.
        logCrash(err, { screen: "dashboard", load: "cgmPref" });
      }
      if (isProUser) {
        setCgmOn(saved);
        if (saved) runSync(false);
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

  const unit = activeProfile?.glucose_unit ?? "mgdl";

  /**
   * Every derived figure on this screen, from ONE pass over the feed.
   *
   * These were a dozen independent chained `.filter().reduce()` expressions in
   * the render body: each walked the whole loaded feed (up to 300 entries, more
   * once the user pages), several parsed `logged_at` into a Date again per entry,
   * and one of them built `new Date().toISOString()` per row just to compare day
   * keys. All of it re-ran on every single re-render - a ticking countdown, a
   * sheet opening, a filter chip - to produce values that only change when the
   * feed or the profile does. Same figures, same order of operations, computed
   * once.
   */
  const stats = useMemo(() => {
    const weekAgo = Date.now() - 7 * 86_400_000;
    // Measured against the PROFILE'S band, not a fixed 70-180 rectangle, so
    // these figures agree with Insights and the doctor report.
    const weekBand = targetBandFor(activeProfile ?? {});

    let weekReadings = 0;
    let weekSum = 0;
    let weekInBand = 0;
    let weekInjections = 0;
    let lastGlucose: GlucoseEntry | undefined;
    const injections: InjectionEntry[] = [];
    const logDates: string[] = [];
    // Feed order is newest-first; the sparkline reads chronologically.
    const weekValuesDesc: number[] = [];

    for (const e of entries) {
      logDates.push(e.logged_at);
      if (e.kind === "meal") continue;
      const inWeek = new Date(e.logged_at).getTime() >= weekAgo;
      if (e.kind === "glucose") {
        if (!lastGlucose) lastGlucose = e;
        if (inWeek) {
          weekReadings++;
          weekSum += e.glucose_level_mgdl;
          weekValuesDesc.push(e.glucose_level_mgdl);
          if (
            e.glucose_level_mgdl >= weekBand.low &&
            e.glucose_level_mgdl <= weekBand.high
          ) {
            weekInBand++;
          }
        }
        continue;
      }
      // Medication entries (schema v16) count toward the logging streak above and
      // toward nothing else: no dose, no average and no in-range figure is
      // computed from them.
      if (e.kind !== "injection") continue;
      injections.push(e);
      if (inWeek) weekInjections++;
    }

    const weekAvg = weekReadings ? Math.round(weekSum / weekReadings) : null;
    const weekTIR = weekReadings
      ? Math.round((weekInBand / weekReadings) * 100)
      : null;
    const lastStatus =
      lastGlucose && activeProfile
        ? classifyGlucose(
            lastGlucose.glucose_level_mgdl,
            lastGlucose.period_tag,
            activeProfile
          )
        : null;

    return {
      // Encouraging consistency count ("X days in a row"), never a streak to
      // protect.
      logStreak: consecutiveLogDays(logDates),
      // Hero ring: the most recent glucose reading in its status color (Midnight
      // Monitor). Decorative sweep only - the value + period label carry it.
      lastGlucose,
      lastStatus,
      lastColor: lastStatus ? RICH_BY_STATUS[lastStatus] : THEME.accent,
      weekAvg,
      weekTIR,
      hasWeekData: weekReadings > 0 || weekInjections > 0,
      weekSparkline: weekValuesDesc.reverse(),
      avgColor:
        weekAvg != null && activeProfile
          ? STATUS_COLOR[classifyGlucose(weekAvg, "manual", activeProfile)]
          : THEME.ink,
      tirColor:
        weekTIR == null
          ? THEME.ink
          : weekTIR >= 70
            ? STATUS_COLOR.normal
            : weekTIR >= 50
              ? STATUS_COLOR.elevated
              : STATUS_COLOR.high,
      // Active insulin still working from recent doses (stacking awareness),
      // shaped by the user's own selected products; basal is kept apart from
      // the headline bolus figure, see lib/iob.ts.
      ...activeInsulinBreakdown(injections, {
        bolusProfile: bolusProfileFor(activeProfile?.bolus_insulin_id),
        basalProfile: basalProfileFor(activeProfile?.basal_insulin_id),
      }),
    };
  }, [entries, activeProfile]);

  const {
    lastGlucose,
    lastStatus,
    lastColor,
    logStreak,
    weekAvg,
    weekTIR,
    hasWeekData,
    weekSparkline,
    avgColor,
    tirColor,
    bolus: iob,
    basal: basalIob,
  } = stats;

  // Onboarding said whether this user takes a mealtime insulin at all. When they
  // do not, the insulin apparatus (IOB line here, the whole Injection tab) stays
  // out of the way instead of implying they should be dosing.
  const showsInsulin = insulinModeShowsBolus(activeProfile?.insulin_mode);

  /** Whether the next reminder is STORED as an alarm, whatever this device can
   *  do about it - what tells "not allowed yet" from "set to notification". */
  const nextReminderWantsAlarm =
    nextReminder != null &&
    nextReminder.kind === "reminder" &&
    (nextReminderRows.find((r) => r.id === nextReminder.id)?.alarm_enabled === 1);

  /** What the next-reminder line reads: the TIME first, then the reminder's own
   *  NAME (preset rows are named after their part of the day; an older, unnamed
   *  row falls back to its type) - the same two strings Settings > Reminders
   *  shows, so the surfaces cannot disagree.
   *
   *  Time first because it is the half that must survive: the strip clips to
   *  one line, and with the name leading, a long translated name ("Erinnerung
   *  an das Basalinsulin") pushed the actual time off the end, leaving a line
   *  about a reminder with no when. */
  function nextReminderLabel(item: UpcomingItem): string {
    if (item.kind === "postMeal") {
      return `${formatTimeForLang(item.at, lang)} · ${t("reminders.upcomingPostMeal")}`;
    }
    const row = nextReminderRows.find((r) => r.id === item.id);
    const name =
      row?.label && row.label.trim()
        ? row.label
        : t(
            item.type === "med"
              ? "reminders.typeMed"
              : item.type === "basal"
                ? "reminders.typeBasal"
                : item.type === "custom"
                  ? "reminders.typeCustom"
                  : "reminders.typeGlucose"
          );
    return row ? `${row.time} · ${name}` : name;
  }

  // "What is this based on?" explanation for the compact active-insulin line:
  // names the selected bolus product and its typical duration, or says a
  // generic profile is in use, plus any still-active basal kept apart from
  // the headline bolus figure.
  const iobTooltipText = useMemo(() => {
    const bolusProduct = insulinProductById(activeProfile?.bolus_insulin_id);
    const parts = [
      t("iob.basisText"),
      bolusProduct
        ? t("iob.productText", {
            product: bolusProduct.label,
            hours: num(bolusProduct.durationHours),
          })
        : t("iob.genericText"),
    ];
    if (basalIob > 0) parts.push(t("iob.basalActive", { value: num(basalIob) }));
    parts.push(t("iob.personalNote"));
    return parts.join("\n\n");
  }, [activeProfile?.bolus_insulin_id, basalIob, t]);

  // Post-meal button slot: while a reminder is pending the <PostMealCountdown>
  // child ticks in place, otherwise the slot is the normal CTA. Reaching the end
  // also closes the lock-screen countdown (the notification has just fired).
  const onPostMealElapsed = useCallback(() => {
    setPostMealTimer(null);
    void (async () => {
      await completePostMealTimer();
      // The countdown was on the widget, the watch face and the "next" line
      // too: restartPostMealForEntry already refreshes all three, and ending
      // one has to do the same or those surfaces keep counting to a moment
      // that has passed.
      await refreshNextReminder();
      const id = activeProfileIdRef.current;
      if (id) void syncLiveData(id, glucoseUnitRef.current);
      bumpData();
    })();
  }, [refreshNextReminder, bumpData]);

  // Profile lock (B): a timer armed for a DIFFERENT profile (a caregiver
  // switched away mid-countdown) renders as if none were running - the idle
  // "started eating" CTA shows instead. The persisted timer itself is left
  // alone, so it is picked back up the moment that other profile is active
  // again. A timer with no recorded owner (armed before this lock existed)
  // keeps showing everywhere, same as before.
  const postMealTimerForProfile = postMealWindowForProfile(
    postMealTimer,
    activeProfile?.id
  );

  // Which action the running card offers - the two are mutually exclusive, see
  // postMealCardActions (lib/postMealTimer.ts). A meal logged AFTER the running
  // timer's own anchor is what turns "log a meal" into "restart for this meal"
  // (schedulePostMealReminder leaves an already-active timer untouched per
  // decidePostMealAutoStart, so that newer meal never moved the countdown on
  // its own - this is how the user moves it themselves). No separate storage:
  // `entries` is the same feed the journal list already reads. Cleared the
  // moment the timer itself is cleared or completes.
  const postMealActions = useMemo(() => {
    if (!postMealTimerForProfile) {
      return { actions: NO_POST_MEAL_ACTIONS, entry: null as MealEntry | null };
    }
    const meals = entries.filter((e): e is MealEntry => e.kind === "meal");
    const actions = postMealCardActions({
      meals: meals.map((m) => ({
        id: m.id,
        loggedAtMs: new Date(m.logged_at).getTime(),
      })),
      startedAt: postMealTimerForProfile.startedAt,
    });
    return {
      actions,
      entry: actions.restartMealId
        ? (meals.find((m) => m.id === actions.restartMealId) ?? null)
        : null,
    };
  }, [entries, postMealTimerForProfile]);
  const postMealRestartCandidate = postMealActions.entry;

  // Always-visible shortcut on the running countdown card: the same one-tap
  // entry point the "+" add-record sheet's own food card uses (see the
  // QuickAddSheet onFood prop below) - logging a meal never has to mean
  // touching the timer first.
  function logMealFromCountdown() {
    hapticSelect();
    router.navigate("/(tabs)/food");
  }

  // Re-anchors the running timer to a meal logged while it was already
  // counting down, instead of the meal's own auto-start being a no-op forever.
  // Non-prompting (see restartPostMealTimerAt): the user already has a timer
  // running, so this never raises a fresh permission dialog.
  async function restartPostMealForEntry(entry: MealEntry) {
    if (!activeProfile) return;
    // Captured BEFORE the move: one tap re-anchors a running countdown, and
    // until now there was no way back from a mis-tap.
    const previous = postMealTimerForProfile;
    const outcome = await restartPostMealTimerAt(new Date(entry.logged_at), activeProfile.id);
    if (outcome === "idle") return;
    hapticSuccess();
    await refreshPostMealTimer();
    await refreshNextReminder();
    void syncLiveData(activeProfile.id, glucoseUnit);
    if (outcome === "elapsed") {
      setPostMealTimer(null);
      toast(t("dashboard.postMealRestartElapsed"), "info");
    } else {
      toast(
        t("dashboard.postMealRestarted"),
        "success",
        previous
          ? { label: t("common.undo"), onPress: () => void restorePostMealAnchor(previous) }
          : undefined
      );
    }
  }

  // Manual logging is unlimited on both tiers now, so there is no gate here.
  function openLogger(period: PeriodTag) {
    if (!activeProfile) return;
    setInitialPeriod(period);
    setSheetOpen(true);
  }

  // "I started eating": arms the post-meal check timer (dedupes with the
  // meal-log auto reminder via a shared notification id). `minutesAgo` is only
  // passed by the "a while ago" sheet (2.3.0's G15); the primary button arms
  // from now, so the common case is still one tap.
  //
  // ONE arm at a time, across BOTH entry points: the pill and the sheet's own
  // "Start" can otherwise overlap (the sheet closes on the next render, the
  // pill is still on screen underneath it), and two arms racing would leave the
  // persisted start/end pair and the armed delivery describing two different
  // countdowns. A ref, not state, because the second tap has to see the guard
  // on the SAME tick it happens.
  async function startedEating(minutesAgo = 0) {
    if (startingTimerRef.current) return;
    startingTimerRef.current = true;
    setStartingTimer(true);
    setLateSheetOpen(false);
    try {
      await finishStartedEating(await startPostMealTimer(minutesAgo));
    } catch {
      // startPostMealTimer arms nothing when it throws (schedulePostMealAt rolls
      // its own write back), so the countdown is simply not started.
      toast(t("dashboard.toklukNeedsPerm"), "info");
    } finally {
      startingTimerRef.current = false;
      setStartingTimer(false);
    }
  }

  async function finishStartedEating(outcome: PostMealStartOutcome) {
    if (outcome.kind === "elapsed") {
      // Nothing was armed: the meal is older than the window. Say so and leave
      // the user on the dashboard, where the reading is one tap away.
      toast(t("dashboard.postMealLatePassed", { n: POST_MEAL_WINDOW_MIN }), "info");
      return;
    }
    if (outcome.kind === "started") {
      logEvent("tokluk_timer_started");
      hapticSuccess();
      toast(t("dashboard.toklukSet", { n: outcome.minutesLeft }), "success");
      await refreshPostMealTimer();
      await refreshNextReminder();
      if (activeProfile) void syncLiveData(activeProfile.id, glucoseUnit);
      // First timer: tell the user the countdown also shows on the lock screen.
      try {
        if (activeProfile && !(await readProfileFlag(WIDGET_TIP_KEY, activeProfile.id))) {
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
    if (!activeProfile) return;
    try {
      await writeProfileFlag(WIDGET_TIP_KEY, activeProfile.id, true);
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
      // Correcting an existing reading: no reminders, no review nudge. Shared
      // with the full journal screen, which offers the same edit on the same
      // row (lib/services/glucoseEdit.ts).
      await applyGlucoseCorrection(editGlucose, value, period, tags, loggedAt);
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
    void noteJournalActivity();
    logEvent("log_added", { kind: "glucose", source: "manual" });
    void noteLogAndMaybeReview("log_glucose");
    hapticSuccess();
    // NOTHING is armed here. A reading is a measurement, not a meal: logging a
    // fasting or manual value used to start the post-meal countdown by itself, so
    // a user who only checked their sugar got a lock-screen timer and a nudge two
    // hours later about a meal that never happened. The timer now has exactly two
    // deliberate sources: the "I started eating" button and a logged meal.
    //
    // Reflective feedback for a 2-hour post-meal reading: a descriptive note
    // comparing the user's own reading to their own target (never advice).
    if (period === "post_meal_2h") {
      if (isNow) {
        // Early completion: the 2-hour reading is logged, so the pending nudge
        // is no longer needed. Cancel it and clear the countdown.
        await cancelPostMealTimer();
        setPostMealTimer(null);
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

  // Neutral follow-up: after the user LOGS a reading below their own profile's
  // low threshold, offer (never force) a 15-minute re-measure reminder and a
  // shortcut to reach an emergency contact. No diagnosis, no automatic alert.
  async function maybeOfferLowFollowup(mgdl: number) {
    const prefs = await getNotificationPrefs();
    if (!prefs.enabled || !prefs.lowFollowup) return;
    // UX#1: one low threshold, not two that could disagree - always the active
    // profile's own low threshold from Profile (see lowFollowupThresholdMgdl).
    if (mgdl >= (await lowFollowupThresholdMgdl())) return;
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
    if (activeProfile) await writeProfileFlag(CGM_KEY, activeProfile.id, next);
    if (next) await runSync(true);
  }

  // The one Health entry point, shared by the quick-access card and the
  // first-run step: sell the feature when it is locked, arm the sync when it is
  // off, and sync now when it is already on. The card used to be inert whenever
  // the switch was off, so only its 30pt switch reacted to a tap.
  function openHealthFlow() {
    if (!isProUser) {
      hapticWarning();
      router.push({ pathname: "/paywall", params: { reason: "health" } });
      return;
    }
    if (syncing) return;
    // The persisted preference has not resolved yet (card is still its
    // skeleton, not a Pressable) - nothing to act on either way.
    if (cgmOn == null) return;
    if (cgmOn) void runSync(true);
    else void toggleCgm(true);
  }

  // "I started eating" timer running: let the user cancel it in place.
  /** Puts a countdown back exactly where it was, by re-anchoring to its own
   *  original start. The window length is fixed (POST_MEAL_WINDOW_MIN), so
   *  restoring the start restores the end to the same millisecond - which is
   *  what makes an undo here honest rather than approximate. */
  async function restorePostMealAnchor(previous: PostMealTimerWindow) {
    const outcome = await restartPostMealTimerAt(
      new Date(previous.startedAt),
      previous.profileId ?? activeProfileIdRef.current ?? undefined
    );
    await refreshPostMealTimer();
    await refreshNextReminder();
    const id = activeProfileIdRef.current;
    if (id) void syncLiveData(id, glucoseUnitRef.current);
    bumpData();
    // Only reachable if what was left of the original window ran out between
    // the tap and the undo; there is nothing to put back in that case.
    if (outcome === "elapsed") toast(t("dashboard.postMealRestartElapsed"), "info");
  }

  // Cancelling kills a running countdown in one tap, with nothing to
  // reconstruct it from - so it carries the same undo every other one-tap
  // mutation on this screen does (see deleteWithUndo below, and the calculator's
  // save toast). A blocking confirm is deliberately NOT used: this codebase
  // reserves confirm() for losses a toast cannot undo (deleting a recipe), and
  // a countdown is two numbers.
  async function cancelEatingTimer() {
    const previous = postMealTimerForProfile;
    await cancelPostMealTimer();
    setPostMealTimer(null);
    await refreshNextReminder();
    if (activeProfile) void syncLiveData(activeProfile.id, glucoseUnit);
    bumpData();
    hapticWarning();
    if (previous) {
      toast(t("dashboard.postMealCancelled"), "info", {
        label: t("common.undo"),
        onPress: () => void restorePostMealAnchor(previous),
      });
    }
  }

  // Every row behaviour - tap to correct, long press for the menu, delete with
  // an undo toast, the meal-response chevron - comes from ONE hook shared with
  // the full journal screen (components/useJournalRows.tsx), so a row cannot
  // behave differently depending on which of the two it was tapped on. The
  // glucose sheet stays here because this screen also logs NEW readings through
  // it; what the two share is the correction itself.
  const journalRows = useJournalRows({
    entries,
    onChanged: bumpData,
    onEditGlucose: (entry) => {
      setEditGlucose(entry);
      setSheetOpen(true);
    },
  });

  // Journal display: apply the kind filter, cut it at the revealed slices, group
  // by day. Memoized so re-renders that do not touch the feed (countdowns, sheet
  // state) reuse the same section objects and the SectionList can bail out.
  const { journalSections } = useMemo(() => {
    const filtered =
      filter === "all"
        ? journalEntries
        : journalEntries.filter((e) => e.kind === filter);
    // ONE slice, always: the preview does not page. Reaching further into the
    // journal is a screen, not a button that grows this list.
    const display = filtered.slice(0, nextJournalCut(filtered, 0, JOURNAL_PREVIEW_LIMITS));
    const sections: JournalSection[] = [];
    const byKey = new Map<string, JournalEntry[]>();
    for (const e of display) {
      const key = formatDateKey(e.logged_at);
      let arr = byKey.get(key);
      if (!arr) {
        arr = [];
        byKey.set(key, arr);
        const rel = relativeDay(e.logged_at, {
          today: t("common.today"),
          yesterday: t("common.yesterday"),
        });
        const date = formatDate(e.logged_at);
        sections.push({
          // Relative word for today/yesterday, weekday further back; the chip
          // shows the concrete date next to it either way.
          title: rel !== date ? rel : formatWeekday(e.logged_at) || date,
          dateLabel: date,
          data: arr,
        });
      }
      arr.push(e);
    }
    return { journalSections: sections };
  }, [journalEntries, filter, t]);

  /** The preview always hands off to the full screen, carrying whatever filter
   *  the user is looking at so tapping through never silently widens it back to
   *  everything. Offered whenever the preview is showing anything at all: the
   *  point of the action is "there is a whole journal behind this", which is
   *  true even when the last two days happen to be all there is. */
  function openFullJournal() {
    hapticSelect();
    router.push({
      pathname: "/journal",
      ...(filter !== "all" ? { params: { filter } } : {}),
    });
  }


  const renderItem = useCallback(
    ({ item, index }: { item: JournalEntry; index: number }) =>
      activeProfile ? (
        <View style={journalPanelSide}>
          <Animated.View entering={listEntering.delay(Math.min(index, 8) * 40)}>
            <JournalItem
              entry={item}
              profile={activeProfile}
              onPress={journalRows.onRowPress}
              onLongPress={journalRows.onRowLongPress}
              hasResponse={item.kind === "meal" && journalRows.mealResponseIds.has(item.id)}
              onOpenResponse={journalRows.onRowOpenResponse}
              // `index` is the position WITHIN the day section, so the first row
              // after a day separator skips its divider - the separator is
              // already the break.
              inPanel
              firstInPanel={index === 0}
            />
          </Animated.View>
        </View>
      ) : null,
    [
      activeProfile,
      journalRows.mealResponseIds,
      journalRows.onRowPress,
      journalRows.onRowLongPress,
      journalRows.onRowOpenResponse,
    ]
  );

  // Day separator. Inside the panel it is a SECTION BREAK rather than a pill on
  // the page: a full-width band carrying the container's sides, so it divides
  // the rows instead of adding a second bordered shape on top of them. Still
  // opaque, which is what keeps it readable while stuck over scrolling rows.
  //
  // The label wraps rather than clipping: the longest relative-day + date
  // combinations (de "Gestern", pt "Ontem" plus a long date) need the second
  // line at large accessibility text sizes.
  const renderSectionHeader = useCallback(
    ({ section }: { section: JournalSection }) => <JournalDayHeader section={section} />,
    []
  );

  const FILTER_CHIPS: { key: JournalFilter; label: string }[] = [
    { key: "all", label: t("dashboard.filterAll") },
    { key: "glucose", label: t("dashboard.quickAddGlucose") },
    { key: "meal", label: t("dashboard.quickAddFood") },
    ...(insulinModeUsesInsulin(activeProfile?.insulin_mode)
      ? [{ key: "injection" as const, label: t("dashboard.quickAddInjection") }]
      : []),
    ...(activeProfile?.oral_meds_enabled === 1 || journalEntries.some((e) => e.kind === "med")
      ? [{ key: "med" as const, label: t("meds.entryLabel") }]
      : []),
  ];

  // Nothing logged yet: the dashboard is every number this app has, and all of
  // them are empty. Instead of showing a hero with no reading in it, a meal
  // timer for a meal nobody logged and two shortcuts into empty screens, the
  // screen becomes a short guided setup - the ring the first reading will fill,
  // the numbered steps, one button.
  //
  // Both of these require `loaded`: before the first feed read lands, entries
  // is an empty array for EVERY user, existing or brand new. Without that
  // guard, "existing user" chrome (post-meal card, quick-access row, history
  // heading) used to render immediately on `!isFirstRun` alone, then vanish
  // into the first-run guide if the user turned out to be new - or, for an
  // existing user, sit there while the hero ring and week strip popped in on
  // top of it a moment later and shoved everything down. See HeroSkeleton /
  // WeekSkeleton below for what fills that gap instead.
  const isFirstRun = loaded && entries.length === 0;
  const isExistingUser = loaded && entries.length > 0;

  const startSteps: {
    key: string;
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    onPress: () => void;
    // Real completion state where one exists (health/widget); undefined for a
    // step that has none (log) or whose state has not resolved/could not be
    // determined yet - the compact setup row below keeps those neutral.
    done?: boolean;
  }[] = [
    {
      key: "log",
      icon: "water",
      label: t("dashboard.stepGlucose"),
      onPress: () => setQuickAddOpen(true),
    },
    // Health sync is iOS-only here (Health Connect stays out of the Android
    // build), so on Android the guide is a two-step one and numbers itself.
    ...(Platform.OS === "ios"
      ? [
          {
            key: "health",
            icon: "pulse" as keyof typeof Ionicons.glyphMap,
            label: HEALTH_NAME,
            onPress: openHealthFlow,
            done: cgmOn == null ? undefined : cgmOn,
          },
        ]
      : []),
    {
      key: "widget",
      icon: "phone-portrait",
      label: t("dashboard.stepWidget"),
      onPress: () => router.push("/widget-guide"),
      done: widgetInstalled,
    },
  ];

  // Same optional steps the first-run guide offered, minus the one the user has
  // already done (logging). Health stays off Android with the build.
  const setupShortcuts = startSteps.filter((s) => s.key !== "log");
  // Both (or, on Android, the one) optional steps have a confirmed "done":
  // the compact row below hides itself even if the user never tapped its
  // close button. An unresolved/unknown step (done === undefined) never
  // counts as complete, so the row never disappears on a guess.
  const setupAllDone =
    setupShortcuts.length > 0 && setupShortcuts.every((s) => s.done === true);

  const FirstRunGuide = (
    <>
      {/* The hero ring, empty: same shape and size the first reading will take,
          in a neutral track colour, with the invitation under it. */}
      <GlassCard style={{ paddingVertical: 16, marginBottom: 12 }}>
        <View className="items-center">
          {/* Both colours stay HEX: the ring's glow runs them through the
              token helper, which parses hex (an rgba token comes out NaN). */}
          <GlucoseRing
            display="-"
            caption={glucoseUnitLabel(unit)}
            color={THEME.muted}
            gradientTo={THEME.muted}
            fraction={0}
            size={132}
          />
          <Text
            style={{
              color: THEME.muted,
              fontSize: 12,
              lineHeight: 17,
              textAlign: "center",
              marginTop: 10,
              paddingHorizontal: 8,
            }}
          >
            {t("dashboard.empty")}
          </Text>
        </View>
      </GlassCard>

      <GlassCard accent style={{ marginBottom: 12, gap: 8 }}>
        <Text
          style={{ color: THEME.muted, fontSize: 11, letterSpacing: 1.3, fontWeight: "800" }}
        >
          {upper(t("dashboard.startTitle", { n: startSteps.length }))}
        </Text>
        {startSteps.map((step, i) => (
          <Pressable
            key={step.key}
            onPress={step.onPress}
            accessibilityRole="button"
            accessibilityLabel={`${i + 1}. ${step.label}`}
            className="flex-row items-center active:opacity-80"
            style={{ gap: 10, paddingVertical: 3 }}
          >
            <View
              style={{
                width: 22,
                height: 22,
                borderRadius: 11,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1,
                borderColor: THEME.border,
                backgroundColor: THEME.glass,
              }}
            >
              <Text style={[TABULAR, { color: THEME.accent, fontSize: 11, fontWeight: "800" }]}>
                {i + 1}
              </Text>
            </View>
            <IconTile icon={step.icon} size={38} radius={12} hero />
            <Text
              style={{ color: THEME.ink, fontSize: 14, fontWeight: "700", flex: 1 }}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.85}
            >
              {step.label}
            </Text>
            <DirIcon name="chevron-forward" size={16} color={THEME.muted} />
          </Pressable>
        ))}
        <GradientCTA
          label={t("dashboard.firstCta")}
          onPress={() => setQuickAddOpen(true)}
          style={{ marginTop: 4 }}
        />
      </GlassCard>
    </>
  );

  const Header = (
    // No bottom padding when the journal panel is open: the panel's sides are
    // drawn by the header, each day separator and each row as separate pieces
    // of one container, so any spacing BETWEEN those pieces shows up as a gap
    // in the border. The separator's own paddingTop provides that air from
    // inside the container instead.
    <View className={journalEntries.length > 0 ? "" : "pb-2"}>
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


      {!loaded ? (
        // Unknown yet whether this is a first run or an existing user: neither
        // shell is correct to show, so a same-sized placeholder holds the hero
        // + week strip's height instead of guessing.
        <>
          <HeroSkeleton />
          <WeekSkeleton />
        </>
      ) : isFirstRun ? (
        FirstRunGuide
      ) : (
        <>
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
                    value: weekAvg != null ? formatGlucose(weekAvg, unit) : t("dashboard.noValueYet"),
                    accent: avgColor,
                  },
                  {
                    label: t("insights.timeInRange"),
                    value: weekTIR != null ? pct(weekTIR) : t("dashboard.noValueYet"),
                    accent: tirColor,
                  },
                  { label: t("dashboard.streakDays"), value: `${logStreak}` },
                ]}
              />
            </View>
          ) : null}
        </>
      )}

      {/* Post-meal timer: a REAL filled pill button, not text that reads like a
          value. While the timer runs, the same slot shows the countdown + a small
          cancel action. Hidden before the first entry (and before we know which
          case this is - see isExistingUser above): "I started eating" was the
          loudest action on a brand-new dashboard, ahead of logging anything. */}
      {isExistingUser ? (
      <GlassCard accent style={{ marginBottom: 12, paddingVertical: 12 }}>
        {postMealTimerForProfile != null ? (
          <PostMealCountdown
            timer={postMealTimerForProfile}
            onCancel={cancelEatingTimer}
            onElapsed={onPostMealElapsed}
            onLogMeal={logMealFromCountdown}
            actions={postMealActions.actions}
            restartEntry={postMealRestartCandidate}
            restartTimeLabel={
              postMealRestartCandidate
                ? formatTimeForLang(new Date(postMealRestartCandidate.logged_at).getTime(), lang)
                : ""
            }
            onRestart={restartPostMealForEntry}
          />
        ) : (
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center flex-1" style={{ gap: 8 }}>
              <Ionicons name="restaurant-outline" size={18} color={THEME.accent} />
              {/* Title and window on their own lines. As one line it needed
                  adjustsFontSizeToFit to survive the CTA beside it, which is
                  iOS-only, so the longer translations were simply clipped on
                  Android. */}
              <View style={{ flex: 1 }}>
                <Text
                  style={{ color: THEME.ink, fontSize: 13, fontWeight: "700" }}
                  numberOfLines={2}
                >
                  {t("dashboard.quickPostMealTitle")}
                </Text>
                <Text
                  style={{ color: THEME.muted, fontSize: 12, fontWeight: "600" }}
                  numberOfLines={1}
                >
                  {t("dashboard.quickPostMealWindow", { n: POST_MEAL_WINDOW_MIN })}
                </Text>
              </View>
            </View>
            <View className="flex-row items-center" style={{ gap: 6 }}>
              <PressableScale
                onPress={() => void startedEating()}
                disabled={startingTimer}
                accessibilityRole="button"
                accessibilityLabel={t("dashboard.startedEating")}
                style={{
                  backgroundColor: THEME.accent,
                  borderRadius: RADIUS.full,
                  paddingHorizontal: 16,
                  paddingVertical: 9,
                  opacity: startingTimer ? 0.6 : 1,
                }}
              >
                <Text style={{ color: "#00171c", fontWeight: "800", fontSize: 13 }}>
                  {t("dashboard.startedEating")}
                </Text>
              </PressableScale>
              {/* The one-off length (2.3.0's K2-C). Deliberately smaller and
                  quieter than the pill beside it: the usual window is one tap,
                  and this is the exception. */}
              <Pressable
                onPress={() => setLateSheetOpen(true)}
                disabled={startingTimer}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t("dashboard.postMealLateA11y")}
                className="items-center justify-center active:opacity-70"
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: RADIUS.full,
                  borderWidth: 1,
                  borderColor: THEME.border,
                  opacity: startingTimer ? 0.6 : 1,
                }}
              >
                {/* "I am logging this late", not "pick a length": a clock
                    turning back reads as the meal already having happened. */}
                <Ionicons name="time-outline" size={16} color={THEME.accent} />
              </Pressable>
            </View>
          </View>
        )}
      </GlassCard>
      ) : null}

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
              // 11px text with hitSlop 6 is a ~23pt target. The slop is widened
              // instead of the type, so the tip keeps its size while the tap
              // area clears 44pt.
              hitSlop={{ top: 14, bottom: 14, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel={t("dashboard.widgetTipCta")}
            >
              <Text
                style={{ color: THEME.accent, fontSize: 11, marginTop: 2, minHeight: 16 }}
              >
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

      {/* Context strip: active insulin (IOB) and the next reminder (2.3.0's
          G18), the two facts that qualify what the card above is showing.
          Drawn as ONE bordered strip of up to two segments rather than two
          centred micro-lines: as centred 11px text they read as debug output
          dropped under the card, and two of them stacked read as a list of
          nothing in particular. Each segment is a labelled value the same shape
          as every other tile on this screen (quiet label, then the number), so
          they belong to the layout instead of floating in it.

          Either half can be absent - no mealtime insulin working, no reminder
          in the next day - and the strip then holds a single full-width
          segment, which stays balanced because the content is left-aligned
          inside it rather than centred. With neither, nothing is drawn at all.

          The labels sit on their own line above the values on purpose: the long
          translations ("Aktives Insulin", "Insuline active") do not fit beside a
          value on one line at this width, and every string here is single-line
          clipped rather than allowed to reflow the strip. */}
      {(iob > 0 && showsInsulin) || nextReminder ? (
        <View className="flex-row rounded-2xl bg-glass border border-hair mb-3 overflow-hidden">
          {iob > 0 && showsInsulin ? (
            <View className="flex-1 px-3 justify-center" style={{ minHeight: 46, paddingVertical: 8 }}>
              <View className="flex-row items-center" style={{ gap: 5 }}>
                <Ionicons name="hourglass-outline" size={11} color={THEME.accent} />
                <Text
                  numberOfLines={1}
                  style={{ color: THEME.muted, fontSize: 10, flexShrink: 1 }}
                >
                  {t("dashboard.activeInsulin")}
                </Text>
                {/* The existing "what is this based on?" explanation, kept
                    exactly where it was: on the IOB half, not on the strip. */}
                <Tooltip text={iobTooltipText} size={12} />
              </View>
              <Text
                numberOfLines={1}
                style={{ color: THEME.ink, fontSize: 13, fontWeight: "700", marginTop: 2 }}
              >
                {num(iob)} {t("common.units")}
              </Text>
            </View>
          ) : null}

          {iob > 0 && showsInsulin && nextReminder ? (
            <View style={{ width: 1, backgroundColor: THEME.border, marginVertical: 8 }} />
          ) : null}

          {nextReminder ? (
            <Pressable
              onPress={() => router.push("/settings/reminders")}
              accessibilityRole="button"
              accessibilityLabel={t("dashboard.nextReminderA11y")}
              className="flex-1 px-3 justify-center active:opacity-70"
              style={{ minHeight: 46, paddingVertical: 8 }}
            >
              <View className="flex-row items-center" style={{ gap: 5 }}>
                {/* Three states, the same vocabulary the reminders list uses: a
                    working alarm (accent `alarm`), an alarm this device is not
                    allowed to ring yet (muted `alarm-outline`), or a
                    notification. `mode` already folds the permission in, so the
                    stored intent is what tells the second case from the third. */}
                <Ionicons
                  name={
                    nextReminder.mode === "alarm"
                      ? "alarm"
                      : nextReminderWantsAlarm
                        ? "alarm-outline"
                        : "notifications-outline"
                  }
                  size={11}
                  color={nextReminder.mode === "alarm" ? THEME.accent : THEME.muted}
                />
                <Text
                  numberOfLines={1}
                  style={{ color: THEME.muted, fontSize: 10, flexShrink: 1 }}
                >
                  {t("dashboard.nextReminder")}
                </Text>
              </View>
              {/* Time-first (see nextReminderLabel) AND allowed to shrink: on
                  a narrow screen the longest names in de/fr/es still overrun
                  half a strip, and shrinking keeps the whole line readable
                  instead of ending it in an ellipsis. */}
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
                style={{ color: THEME.ink, fontSize: 13, fontWeight: "700", marginTop: 2 }}
              >
                {nextReminderLabel(nextReminder)}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* Quick access: Insights + Health sync, promoted from the old list footer
          so they are reachable without scrolling past the whole journal. The Pro
          gate and the sync switch behave exactly as before. Both lead into
          screens that have nothing to show yet before the first entry, so the row
          waits for it (and for `loaded`, so it never shows during the moment we
          don't yet know which case this is). */}
      {isExistingUser ? (
      <View className="flex-row mb-3" style={{ gap: 8 }}>
        <Pressable
          onPress={() => router.push("/insights")}
          accessibilityRole="button"
          accessibilityLabel={t("insights.title")}
          className="rounded-2xl bg-glass border border-hair p-3 active:opacity-80"
          // Android has no Health card next to it, and a lone flex:1 card
          // stretched the full row width around a small icon and two short
          // lines. There it takes a card's width instead of the row's.
          style={showsHealthCard ? { flex: 1 } : { width: 220, maxWidth: "100%" }}
        >
          <View className="flex-row items-center justify-between">
            <IconTile icon="stats-chart" size={28} radius={9} />
            <DirIcon name="chevron-forward" size={16} color={THEME.muted} />
          </View>
          <Text
            numberOfLines={1}
            style={{ color: THEME.ink, fontWeight: "700", fontSize: 13, marginTop: 8 }}
          >
            {t("insights.title")}
          </Text>
          <Text numberOfLines={1} style={{ color: THEME.muted, fontSize: 10, marginTop: 2 }}>
            {t("insights.cardSub")}
          </Text>
        </Pressable>

        {showsHealthCard ? (
          <Pressable
            onPress={openHealthFlow}
            disabled={isProUser && syncing}
            accessibilityRole="button"
            accessibilityLabel={HEALTH_NAME}
            className="flex-1 rounded-2xl bg-glass border border-hair p-3 active:opacity-80"
          >
            <View className="flex-row items-center justify-between">
              <IconTile icon="pulse" size={28} radius={9} />
              {!isProUser ? (
                <View className="rounded-full bg-brand px-2 py-0.5">
                  <Text className="text-black text-[10px] font-bold">{t("common.pro")}</Text>
                </View>
              ) : cgmOn === null ? (
                // The persisted preference has not been read yet: a Pro user
                // who had sync ON must never see the switch commit to OFF and
                // then jump ON a frame later, so it stays unresolved-looking
                // until the AsyncStorage read lands.
                <Skeleton width={30} height={18} radius={9} style={{ marginVertical: -6 }} />
              ) : (
                <Switch
                  value={cgmOn}
                  onValueChange={toggleCgm}
                  trackColor={{ true: THEME.accent, false: THEME.border }}
                  thumbColor={THEME.ink}
                  style={{ transform: [{ scale: 0.75 }], marginVertical: -6 }}
                />
              )}
            </View>
            <Text
              numberOfLines={1}
              style={{ color: THEME.ink, fontWeight: "700", fontSize: 13, marginTop: 8 }}
            >
              {HEALTH_NAME}
            </Text>
            {isProUser && cgmOn === null ? (
              <Skeleton width={110} height={10} radius={4} style={{ marginTop: 4 }} />
            ) : (
              <Text numberOfLines={1} style={{ color: THEME.muted, fontSize: 10, marginTop: 2 }}>
                {!isProUser
                  ? t("dashboard.cgmProHint")
                  : syncing
                    ? t("dashboard.syncing")
                    : cgmOn
                      ? t("dashboard.cgmOnTapToSync")
                      : t("dashboard.cgmSubtitle")}
              </Text>
            )}
          </Pressable>
        ) : null}
      </View>
      ) : null}

      {/* Compact setup row: the first-run guide's optional steps survive the
          first record instead of disappearing with it. Stays until closed, OR
          hides itself the moment every step it still shows is confirmed done
          (setupAllDone) - the close button below still works independently,
          same persisted flag as before. */}
      {isExistingUser && showFinishSetup && !setupAllDone ? (
        <View className="flex-row items-start rounded-2xl border border-hair bg-glass px-3.5 py-3 mb-3">
          <View style={{ flex: 1 }}>
            <Text
              style={{ color: THEME.ink, fontSize: 12, fontWeight: "700" }}
              numberOfLines={1}
            >
              {t("dashboard.finishSetupTitle")}
            </Text>
            <View className="flex-row items-center flex-wrap" style={{ gap: 6, marginTop: 8 }}>
              {setupShortcuts.map((s) => (
                <Pressable
                  key={s.key}
                  onPress={s.onPress}
                  accessibilityRole="button"
                  accessibilityLabel={s.label}
                  className="flex-row items-center rounded-full border border-hair bg-sheet px-3 py-1.5 active:opacity-80"
                  style={{ gap: 5 }}
                >
                  {/* Ticked once its own state (health-sync / native widget
                      detection) confirms it; an unresolved/unknown state
                      (s.done === undefined) keeps the plain step icon. */}
                  <Ionicons
                    name={s.done ? "checkmark-circle" : s.icon}
                    size={12}
                    color={s.done ? GLUCOSE_RICH.target : THEME.accent}
                  />
                  <Text style={{ color: THEME.ink, fontSize: 11, fontWeight: "700" }}>
                    {s.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
          <Pressable
            onPress={dismissFinishSetup}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t("common.close")}
          >
            <Ionicons name="close" size={16} color={THEME.muted} />
          </Pressable>
        </View>
      ) : null}

      {/* The journal panel's TOP: heading and filter chips, sharing the
          container with the rows below instead of floating on the page. Gated
          on the VISIBLE list (journalEntries), not the stats feed - the two can
          differ now that the calculator's own bolus row is filtered out of the
          former - so the container is never opened without rows to close it. */}
      {journalEntries.length > 0 ? (
        <JournalPanelTop title={t("dashboard.history")}>
          <JournalFilterChips
            chips={FILTER_CHIPS}
            value={filter}
            onChange={setFilter}
          />

          {/* One-time tap-to-edit discoverability hint, inside the panel top so
              it reads as part of the journal rather than a page-level notice. */}
          {showEditHint ? (
            <View className="flex-row items-center rounded-xl border border-hair bg-glass px-3 py-2.5 mt-2">
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
        </JournalPanelTop>
      ) : null}
    </View>
  );

  return (
    <AppBackground style={{ paddingTop: insets.top }}>
      <SectionList
        sections={journalSections}
        keyExtractor={journalKey}
        stickySectionHeadersEnabled={true}
        renderSectionHeader={renderSectionHeader}
        initialNumToRender={12}
        maxToRenderPerBatch={10}
        windowSize={7}
        ListHeaderComponent={Header}
        ListFooterComponent={
          journalEntries.length > 0 ? (
            <View>
              {/* Closes the panel opened by the header, with the one action
                  that belongs to the journal: the whole of it, on its own
                  screen. The medical notice sits below on the page - it speaks
                  for the app, not for this list. */}
              <JournalPanelBottom>
                <Button
                  label={t("journal.seeAll")}
                  variant="secondary"
                  onPress={openFullJournal}
                  className="border border-hair"
                  icon={<Ionicons name="arrow-forward" size={16} color={THEME.ink} />}
                />
              </JournalPanelBottom>
              <JournalDisclaimerNote />
            </View>
          ) : null
        }
        renderItem={renderItem}
        // A kind filter with no matches is NOT the first-run case: the user has
        // records, just none of this kind, and telling them to add their first
        // reading was wrong. The first-run copy now lives in the guide above, so
        // this slot only speaks for an empty filter.
        ListEmptyComponent={
          filter !== "all" ? (
            <JournalEmptyFilter
              onClearFilter={() => setFilter("all")}
            />
          ) : null
        }
        contentContainerStyle={{
          // No floating CTA during first run, so the list does not have to
          // scroll clear of one.
          paddingBottom: isFirstRun ? 24 : CTA_CLEARANCE,
          // Tablet: one centred reading column instead of a stretched phone
          // layout. Reduces to the plain 16 inset on phones, so the narrow
          // render is unchanged.
          ...columnPad(16),
        }}
        showsVerticalScrollIndicator={false}
      />

      {/* Bottom CTA (mockup B03: single "add record"). During first run the
          guide carries the one primary button, so this one stands down rather
          than putting two identical CTAs on an otherwise empty screen. */}
      {!isFirstRun ? (
        <View
          className="absolute left-0 right-0 bottom-0 pt-2"
          style={{ paddingBottom: CTA_BOTTOM }}
        >
          <View style={columnPad(16)}>
            <GradientCTA
              label={`＋ ${t("dashboard.addRecord")}`}
              onPress={() => setQuickAddOpen(true)}
            />
          </View>
        </View>
      ) : null}

      <QuickAddSheet
        visible={quickAddOpen}
        onClose={() => {
          setQuickAddOpen(false);
          setQuickAddMedDirect(false);
        }}
        showInjection={insulinModeUsesInsulin(activeProfile?.insulin_mode)}
        showMed={activeProfile?.oral_meds_enabled === 1}
        openMedDirect={quickAddMedDirect}
        onGlucose={() => openLogger(DEFAULT_LOG_PERIOD)}
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

      <MedEditSheet
        visible={editMed != null}
        med={editMed}
        onClose={() => setEditMed(null)}
        onSaved={() => {
          setEditMed(null);
          bumpData();
        }}
      />

      <PostMealLateSheet
        visible={lateSheetOpen}
        onClose={() => setLateSheetOpen(false)}
        onStart={(minutesAgo) => void startedEating(minutesAgo)}
        onAddReading={() => {
          setLateSheetOpen(false);
          openLogger("post_meal_2h");
        }}
      />
    </AppBackground>
  );
}

/**
 * The armed post-meal slot: small label, live remaining time, thin elapsed bar,
 * cancel. Owns its own tick (30 s cadence far out, 1 s in the last minute) so
 * the once-per-tick re-render stays inside this card instead of re-rendering
 * the dashboard and its journal list. Calls onElapsed when the time is reached.
 */
function PostMealCountdown({
  timer,
  onCancel,
  onElapsed,
  onLogMeal,
  actions,
  restartEntry,
  restartTimeLabel,
  onRestart,
}: {
  timer: PostMealTimerWindow;
  onCancel: () => void;
  onElapsed: () => void;
  /** Always-visible shortcut to the meal-logging entry point. */
  onLogMeal: () => void;
  /** The newer meal record to re-anchor onto, or null while none qualifies -
   *  its own presence is what shows/hides the "restart for this meal" action. */
  /** Which of the two actions to draw, or neither - see postMealCardActions. */
  actions: PostMealCardActions;
  restartEntry: MealEntry | null;
  /** That meal's own clock time, in the device's locale format - the label says
   *  WHICH meal it would re-anchor to. The meal's NAME is deliberately not
   *  used: it is arbitrarily long and this is a one-line action. */
  restartTimeLabel: string;
  onRestart: (entry: MealEntry) => void;
}) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  const end = timer.endsAt;

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;
    const tick = () => {
      const remaining = end - Date.now();
      if (remaining <= 0) {
        onElapsed();
        return;
      }
      setNow(Date.now());
      timeoutId = setTimeout(tick, remaining <= 60_000 ? 1_000 : 30_000);
    };
    tick();
    return () => clearTimeout(timeoutId);
  }, [end, onElapsed]);

  // Foreground return: the scheduled tick was frozen, refresh the label now.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") setNow(Date.now());
    });
    return () => sub.remove();
  }, []);

  const remainingMs = Math.max(0, end - now);
  const countdown = formatPostMealRemaining(remainingMs);
  // The bar reads the RUNNING timer's own start/end pair, which is what makes a
  // backdated start ("I started eating a while ago") arrive already part-way
  // along instead of empty.
  const progress = postMealElapsedFraction(timer, now);
  const restartLabel = t("dashboard.postMealRestart", { time: restartTimeLabel });

  return (
    <View>
      <View className="flex-row items-center justify-between" style={{ marginBottom: 10 }}>
        <View className="flex-row items-center flex-1" style={{ gap: 8 }}>
          <Ionicons name="time" size={16} color={THEME.accent} />
          <Text
            style={{ color: THEME.muted, fontSize: 12, fontWeight: "700", flex: 1 }}
            numberOfLines={1}
          >
            {/* The feature name alone. The window length used to be appended
                here in brackets, but it is fixed at POST_MEAL_WINDOW_MIN and
                the live countdown sits immediately to the right, so it read as
                the same number twice on one row. */}
            {t("dashboard.quickPostMealTitle")}
          </Text>
        </View>
        <View className="flex-row items-center" style={{ gap: 10 }}>
          <Text style={[TABULAR, { color: THEME.accent, fontSize: 15, fontWeight: "800" }]}>
            {countdown.seconds
              ? t("dashboard.postMealCountdownSec", { s: countdown.value })
              : t("dashboard.postMealCountdownMin", { m: countdown.value })}
          </Text>
          <Pressable
            onPress={onCancel}
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
      {/* ONE action, in its own row so the tight header row above (title +
          countdown + cancel) never has to squeeze it in and overflow.
          Mutually exclusive by rule, not by layout - see postMealCardActions:
          with no meal yet the card offers to log one, and once a meal belonging
          to this window exists the only remaining question is whether the
          countdown should move to it. Showing both let the card ask the user to
          log a meal they had visibly just logged. A second meal mid-window
          still goes through the dashboard's own "+" flow. */}
      {actions.restart && restartEntry ? (
        <View className="flex-row items-center" style={{ marginBottom: 10 }}>
          <Pressable
            onPress={() => onRestart(restartEntry)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={restartLabel}
            style={{ flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 }}
          >
            <Ionicons name="refresh" size={13} color={THEME.muted} />
            {/* Two lines allowed: the longest translations ("Für die Mahlzeit um
                14:30 neu starten") do not fit one line at this size, and this is
                the only action on the row. */}
            <Text
              style={{ color: THEME.muted, fontSize: 11, fontWeight: "700", flexShrink: 1 }}
              numberOfLines={2}
            >
              {restartLabel}
            </Text>
          </Pressable>
        </View>
      ) : actions.logMeal ? (
        <View className="flex-row items-center" style={{ marginBottom: 10 }}>
          <Pressable
            onPress={onLogMeal}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t("dashboard.postMealLogMeal")}
            style={{ flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 }}
          >
            <Ionicons name="restaurant-outline" size={13} color={THEME.accent} />
            <Text style={{ color: THEME.accent, fontSize: 11, fontWeight: "700" }} numberOfLines={1}>
              {t("dashboard.postMealLogMeal")}
            </Text>
          </Pressable>
        </View>
      ) : null}
      <View style={{ height: 6, borderRadius: 3, backgroundColor: THEME.track, overflow: "hidden" }}>
        <View
          style={{
            height: "100%",
            width: `${Math.round(progress * 100)}%`,
            backgroundColor: THEME.accent,
            borderRadius: 3,
          }}
        />
      </View>
    </View>
  );
}
