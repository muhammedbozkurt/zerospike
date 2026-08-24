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
import { mealSlotForHour } from "../../lib/insulin";
import { mealIdsWithResponse } from "../../lib/mealResponse";
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
  updateSugarLog,
  deleteSugarLog,
  deleteMealLog,
  getSugarLog,
  setSugarLogHealthUuid,
} from "../../lib/db/logs";
import { useLayout } from "../../lib/useLayout";
import { deleteInjection } from "../../lib/db/injections";
import { deleteMed } from "../../lib/db/meds";
import { captureDeletion } from "../../lib/db/undo";
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
  postMealElapsedFraction,
  postMealWindowForProfile,
  POST_MEAL_WINDOW_MIN,
  type PostMealTimerWindow,
} from "../../lib/postMealTimer";
import { getNotificationPrefs } from "../../lib/services/notificationPrefs";
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
// Journal paging. One slice is at most JOURNAL_PAGE rows AND at most
// JOURNAL_WINDOW_DAYS of history - whichever boundary is reached first. The list
// no longer grows by itself as you scroll: every further slice is an explicit
// "show more" press, and the button disappears once the feed is exhausted.
const JOURNAL_PAGE = 50;
const JOURNAL_WINDOW_DAYS = 14;
// How much wider the SQL window gets when a page-down runs past the loaded feed.
const JOURNAL_LOAD_STEP = 250;
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
import { useUndoBatch } from "../../components/useUndoBatch";
import { GlucoseInputSheet } from "../../components/GlucoseInputSheet";
import { InjectionEditSheet } from "../../components/InjectionEditSheet";
import { MedEditSheet } from "../../components/MedEditSheet";
import { PostMealLateSheet } from "../../components/PostMealLateSheet";
import { ProfileSwitcher } from "../../components/ProfileSwitcher";
import { useFeedback, type SheetAction } from "../../components/Feedback";
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

type JournalSection = { title: string; dateLabel: string; data: JournalEntry[] };

const journalKey = (e: JournalEntry) => `${e.kind}-${e.id}`;

/**
 * Re-mirrors an EDITED reading into Apple Health: the stale sample is revoked and
 * the corrected value/time written in its place (HealthKit has no update), then
 * the new UUID is recorded on the row - or cleared when the write did not land,
 * so the row never points at a sample that no longer exists.
 *
 * Only touches rows that were actually mirrored, and only while the write toggle
 * is on: with the mirror switched off the old sample stays where it is and its
 * link is kept, so a later delete can still revoke it. Best-effort throughout -
 * the local edit is already saved and a mirror failure must never surface.
 */
async function remirrorEditedGlucose(
  previous: GlucoseEntry,
  mgdl: number,
  loggedAt: Date | null
): Promise<void> {
  try {
    if (!previous.healthkit_uuid || Platform.OS !== "ios") return;
    if (!(await getHealthWriteEnabled())) return;
    const dateIso = (loggedAt ?? new Date(previous.logged_at)).toISOString();
    const uuid = await updateGlucoseInHealth(previous.healthkit_uuid, mgdl, dateIso);
    // Same orphan guard as writeGlucoseToHealthIfEnabled: if the row was
    // deleted while the rewrite was in flight, revoke the fresh sample instead
    // of leaving it unlinked in the user's Health app.
    if (uuid && !(await getSugarLog(previous.id))) {
      await deleteGlucoseFromHealth(uuid);
      return;
    }
    await setSugarLogHealthUuid(previous.id, uuid);
  } catch {
    // best-effort mirror: never blocks or reports back to the edit flow
  }
}

/**
 * End index of the next journal slice, walking the newest-first feed from
 * `from`: stops at JOURNAL_PAGE rows, or as soon as a row is older than
 * JOURNAL_WINDOW_DAYS before the slice's newest row - whichever comes first.
 *
 * The day window is anchored on the slice's own newest row rather than on "now",
 * so a user who has not logged for a month still opens on their last two weeks
 * of records instead of on an empty list with a button under it.
 */
function nextJournalCut(list: JournalEntry[], from: number): number {
  if (from >= list.length) return from;
  const oldest =
    new Date(list[from].logged_at).getTime() - JOURNAL_WINDOW_DAYS * 86_400_000;
  let i = from;
  while (i < list.length && i - from < JOURNAL_PAGE) {
    if (new Date(list[i].logged_at).getTime() < oldest) break;
    i++;
  }
  // A slice always advances, so a sparse feed can never stall the button.
  return Math.max(i, from + 1);
}

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
  const [filter, setFilter] = useState<"all" | "glucose" | "meal" | "injection" | "med">("all");
  const [journalPages, setJournalPages] = useState(1);
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
  const [loadLimit, setLoadLimit] = useState(300);
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
      setNextReminderRows(rows);
      setNextReminder(
        nextUpcoming({
          rows,
          now: Date.now(),
          windowMs: 24 * 60 * 60 * 1000,
          granted: prefs.enabled && permission === "granted",
          showsBasal: insulinModeShowsBasal(insulinModeOf(activeProfileRef.current)),
          showsMeds: activeProfileRef.current?.oral_meds_enabled === 1,
          alarmKitAvailable,
          alarmAuthorized:
            alarmKitAvailable && getAlarmAuthorizationStatus() === "authorized",
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

  // Also on focus: the post-meal window label must pick up a delay changed in
  // Settings without waiting for a data change or an app restart.
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

  /** What the next-reminder line reads. A reminder shows its own NAME (preset
   *  rows are named after their part of the day; an older, unnamed row falls
   *  back to its type) and its stored "HH:MM" - the same two strings Settings >
   *  Reminders shows, so the surfaces cannot disagree. */
  function nextReminderLabel(item: UpcomingItem): string {
    if (item.kind === "postMeal") {
      return `${t("reminders.upcomingPostMeal")} · ${formatTimeForLang(item.at, lang)}`;
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
    return row ? `${name} · ${row.time}` : name;
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

  // The "restart for this meal" action's own visibility: a meal logged AFTER
  // the running timer's own anchor exists (schedulePostMealReminder leaves an
  // already-active timer untouched per decidePostMealAutoStart, so that newer
  // meal never moved the countdown on its own - this is how the user moves it
  // themselves). No separate storage: `entries` is the same feed the journal
  // list already reads, newest first, so the first qualifying row is the one
  // to offer. Cleared the moment the timer itself is cleared or completes.
  const postMealRestartCandidate = useMemo(() => {
    if (!postMealTimerForProfile) return null;
    const startedAtMs = postMealTimerForProfile.startedAt;
    for (const e of entries) {
      if (e.kind === "meal" && new Date(e.logged_at).getTime() > startedAtMs) return e;
    }
    return null;
  }, [entries, postMealTimerForProfile]);

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
      toast(t("dashboard.postMealRestarted"), "success");
    }
  }

  // Manual logging is unlimited on both tiers now, so there is no gate here.
  function openLogger(period: PeriodTag) {
    if (!activeProfile) return;
    setInitialPeriod(period);
    setSheetOpen(true);
  }

  // "I started eating": arms the post-meal check timer (dedupes with the meal-log
  // auto reminder via a shared notification id). `minutes` is only passed by the
  // duration sheet (2.3.0's K2-C); the primary button keeps using the saved
  // window, so the common case is still one tap.
  //
  // ONE arm at a time, across BOTH entry points: the pill and the sheet's own
  // "Start" can otherwise overlap (the sheet closes on the next render, the
  // pill is still on screen underneath it), and two arms racing would leave the
  // stored window, the one-off flag and the armed delivery describing two
  // different countdowns. A ref, not state, because the second tap has to see
  // the guard on the SAME tick it happens.
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
      // Correcting an existing reading: no reminders, no review nudge.
      await updateSugarLog(editGlucose.id, {
        glucose_level_mgdl: value,
        period_tag: period,
        tags,
        ...(loggedAt ? { logged_at: loggedAt.toISOString() } : {}),
      });
      // H2: keep the Apple Health mirror honest. A corrected reading whose
      // mirrored sample still carried the old value made the two disagree, and
      // HealthKit has no "update", so the helper revokes and rewrites. Only for
      // rows that were actually mirrored; fire-and-forget, never blocks the edit.
      void remirrorEditedGlucose(editGlucose, value, loggedAt);
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
  async function cancelEatingTimer() {
    await cancelPostMealTimer();
    setPostMealTimer(null);
    await refreshNextReminder();
    if (activeProfile) void syncLiveData(activeProfile.id, glucoseUnit);
    bumpData();
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
      else if (entry.kind === "med") await deleteMed(entry.id);
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
    } else if (entry.kind === "injection") {
      setEditInjection(entry);
    } else if (entry.kind === "med") {
      setEditMed(entry);
    }
  }

  // Meal rows with a computable response (lib/mealResponse.ts) get a small
  // additive chevron (JournalItem) that opens it instead of the edit flow.
  // Recomputed from the already-loaded feed, no extra query.
  //
  // One pass, via mealIdsWithResponse: running the full response builder per meal
  // re-filtered every reading and re-parsed its timestamp for each one, so a feed
  // with 60 meals and 200 readings did 12 000 Date constructions to decide which
  // rows get an icon. The set it returns is identical (see the parity test in
  // scripts/mealResponse.test.ts).
  const mealResponseIds = useMemo(() => {
    if (!activeProfile) return new Set<string>();
    const readings: GlucoseEntry[] = [];
    const meals: MealEntry[] = [];
    for (const e of entries) {
      if (e.kind === "glucose") readings.push(e);
      else if (e.kind === "meal") meals.push(e);
    }
    return mealIdsWithResponse(meals, readings);
  }, [entries, activeProfile]);

  function openMealResponse(entry: JournalEntry) {
    router.push({ pathname: "/meal-response", params: { mealId: entry.id } });
  }

  // Long press = edit/delete menu (the built-in cancel row closes it). A meal row
  // also offers "make a template out of this": the whole day+slot bucket it belongs
  // to becomes the items (groupMealsBySlot, resolved on the editor screen).
  function onEntryLongPress(entry: JournalEntry) {
    const actions: SheetAction[] = [];
    actions.push({
      label: t("common.edit"),
      icon: "create-outline",
      onPress: () => openEdit(entry),
    });
    if (entry.kind === "meal") {
      actions.push({
        label: t("templates.fromMeal"),
        icon: "bookmark-outline",
        onPress: () =>
          router.push({
            pathname: "/meal-template",
            params: {
              fromDay: formatDateKey(entry.logged_at),
              fromSlot: mealSlotForHour(new Date(entry.logged_at).getHours()),
            },
          }),
      });
    }
    actions.push({
      label: t("common.delete"),
      icon: "trash-outline",
      destructive: true,
      onPress: () => {
        void deleteWithUndo(entry);
      },
    });
    actionSheet({ actions });
  }

  // Journal display: apply the kind filter, cut it at the revealed slices, group
  // by day. Memoized so re-renders that do not touch the feed (countdowns, sheet
  // state) reuse the same section objects and the SectionList can bail out.
  const { filteredEntries, displayEntries, journalSections } = useMemo(() => {
    const filtered =
      filter === "all"
        ? journalEntries
        : journalEntries.filter((e) => e.kind === filter);
    let cut = 0;
    for (let p = 0; p < journalPages; p++) cut = nextJournalCut(filtered, cut);
    const display = filtered.slice(0, cut);
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
    return { filteredEntries: filtered, displayEntries: display, journalSections: sections };
  }, [journalEntries, filter, journalPages, t]);

  // "Show more" is offered while the loaded feed still has rows to reveal, or
  // while the SQL window came back full (so the DB may hold older records). Both
  // false = the journal really is at its end and the button goes away. Reads
  // `journalEntries` (not `entries`): that is the feed this window's fullness
  // actually describes, now that the two queries can return different counts
  // for the same LIMIT.
  const canShowMore =
    displayEntries.length < filteredEntries.length ||
    journalEntries.length >= loadLimit;

  function showMoreJournal() {
    hapticSelect();
    if (displayEntries.length < filteredEntries.length) {
      // Rows are already in memory: revealing the next slice is a pure slice.
      setJournalPages((p) => p + 1);
    } else if (journalEntries.length >= loadLimit) {
      // Loaded window exhausted and the query filled it: widen the window once
      // and advance with it. When the DB is drained the length check stops this.
      setLoadLimit((l) => l + JOURNAL_LOAD_STEP);
      setJournalPages((p) => p + 1);
    }
  }

  // Row actions behind a ref so renderItem keeps ONE identity across renders:
  // list cells then only re-render when the feed itself changes.
  const rowActionsRef = useRef({ openEdit, onEntryLongPress, openMealResponse });
  rowActionsRef.current = { openEdit, onEntryLongPress, openMealResponse };
  const onRowPress = useCallback((e: JournalEntry) => rowActionsRef.current.openEdit(e), []);
  const onRowLongPress = useCallback(
    (e: JournalEntry) => rowActionsRef.current.onEntryLongPress(e),
    []
  );
  const onRowOpenResponse = useCallback(
    (e: JournalEntry) => rowActionsRef.current.openMealResponse(e),
    []
  );

  const renderItem = useCallback(
    ({ item, index }: { item: JournalEntry; index: number }) =>
      activeProfile ? (
        <Animated.View entering={listEntering.delay(Math.min(index, 8) * 40)}>
          <JournalItem
            entry={item}
            profile={activeProfile}
            onPress={onRowPress}
            onLongPress={onRowLongPress}
            hasResponse={item.kind === "meal" && mealResponseIds.has(item.id)}
            onOpenResponse={onRowOpenResponse}
          />
        </Animated.View>
      ) : null,
    [activeProfile, mealResponseIds, onRowPress, onRowLongPress, onRowOpenResponse]
  );

  // Day separator: an opaque chip (relative day + date) that stays readable
  // while stuck over scrolling rows.
  const renderSectionHeader = useCallback(
    ({ section }: { section: JournalSection }) => (
      <View style={{ alignItems: "flex-start", paddingTop: 10, paddingBottom: 6 }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            backgroundColor: THEME.sheet,
            borderWidth: 1,
            borderColor: THEME.border,
            borderRadius: RADIUS.full,
            paddingHorizontal: 10,
            paddingVertical: 4,
          }}
        >
          <Text style={{ color: THEME.ink, fontSize: 11, fontWeight: "800", letterSpacing: 0.8 }}>
            {upper(section.title)}
          </Text>
          {section.dateLabel !== section.title ? (
            <Text style={{ color: THEME.muted, fontSize: 11, fontWeight: "600" }}>
              {section.dateLabel}
            </Text>
          ) : null}
        </View>
      </View>
    ),
    []
  );

  const FILTER_CHIPS: { key: typeof filter; label: string }[] = [
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
            restartEntry={postMealRestartCandidate}
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

      {/* Active insulin (IOB): a compact contextual line, only when working and
          only for users who actually take a mealtime insulin. */}
      {iob > 0 && showsInsulin ? (
        <View className="items-center mb-3">
          <View className="flex-row items-center justify-center" style={{ gap: 6 }}>
            <Ionicons name="hourglass-outline" size={12} color={THEME.accent} />
            <Text style={{ color: THEME.muted, fontSize: 11 }}>
              {t("dashboard.activeInsulin")}: {num(iob)} {t("common.units")}
            </Text>
            <Tooltip text={iobTooltipText} size={13} />
          </View>
        </View>
      ) : null}

      {/* The next reminder (2.3.0's G18): one quiet line, the same weight as the
          active-insulin line above it, and only when there IS one - no
          reminders, no permission, or nothing within the day and it is not
          drawn at all. Tapping goes to the place it can be changed. */}
      {nextReminder ? (
        <Pressable
          onPress={() => router.push("/settings/reminders")}
          accessibilityRole="button"
          accessibilityLabel={t("dashboard.nextReminderA11y")}
          hitSlop={8}
          className="items-center mb-3 active:opacity-70"
        >
          <View className="flex-row items-center justify-center" style={{ gap: 6 }}>
            {/* Three states, the same vocabulary the reminders list uses: a
                working alarm (accent `alarm`), an alarm this device is not
                allowed to ring yet (muted `alarm-outline`), or a notification.
                `mode` already folds the permission in, so the stored intent is
                what tells the second case from the third. */}
            <Ionicons
              name={
                nextReminder.mode === "alarm"
                  ? "alarm"
                  : nextReminderWantsAlarm
                    ? "alarm-outline"
                    : "notifications-outline"
              }
              size={12}
              color={nextReminder.mode === "alarm" ? THEME.accent : THEME.muted}
            />
            <Text numberOfLines={1} style={{ color: THEME.muted, fontSize: 11 }}>
              {nextReminderLabel(nextReminder)}
            </Text>
          </View>
        </Pressable>
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

      {isExistingUser ? (
        <Text className="text-xs font-semibold tracking-wider text-mut mb-2">
          {upper(t("dashboard.history"))}
        </Text>
      ) : null}

      {/* Journal kind filter (session-only). Gated on the VISIBLE list
          (journalEntries), not the stats feed: the two can differ now that
          the calculator's own bolus row is filtered out of the former. */}
      {journalEntries.length > 0 ? (
        <View className="flex-row mb-2" style={{ gap: 6 }}>
          {FILTER_CHIPS.map((c) => {
            const on = filter === c.key;
            return (
              <Pressable
                key={c.key}
                onPress={() => {
                  hapticSelect();
                  setFilter(c.key);
                  setJournalPages(1);
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
      {showEditHint && journalEntries.length > 0 ? (
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
              {canShowMore ? (
                <Button
                  label={t("journal.showMore")}
                  variant="secondary"
                  onPress={showMoreJournal}
                  className="border border-hair mt-3"
                  icon={<Ionicons name="chevron-down" size={16} color={THEME.ink} />}
                />
              ) : null}
              <View className="flex-row items-start rounded-xl border border-amber-500/25 bg-amber-500/10 px-3.5 py-3 mt-3">
                <Ionicons name="medical-outline" size={15} color="#f59e0b" />
                <Text className="text-amber-200/80 text-xs leading-4 ml-2.5 flex-1">
                  {t("disclaimer.short")}
                </Text>
              </View>
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
            <View className="items-center py-10">
              <Ionicons name="funnel-outline" size={32} color={THEME.muted} />
              <Text className="text-mut text-center mt-3 px-8">
                {t("dashboard.emptyFilter")}
              </Text>
              <Pressable
                onPress={() => {
                  hapticSelect();
                  setFilter("all");
                  setJournalPages(1);
                }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t("dashboard.filterAll")}
                className="mt-3 rounded-full border border-hair bg-glass px-3.5 py-1.5"
              >
                <Text className="text-xs font-semibold text-mut">
                  {t("dashboard.filterAll")}
                </Text>
              </Pressable>
            </View>
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
  restartEntry,
  onRestart,
}: {
  timer: PostMealTimerWindow;
  onCancel: () => void;
  onElapsed: () => void;
  /** Always-visible shortcut to the meal-logging entry point. */
  onLogMeal: () => void;
  /** The newer meal record to re-anchor onto, or null while none qualifies -
   *  its own presence is what shows/hides the "restart for this meal" action. */
  restartEntry: MealEntry | null;
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
  // Both the label and the bar read the RUNNING timer's own window, so a window
  // shortened mid-countdown is described honestly instead of against the length
  // the timer happened to be armed with.
  const windowMin = Math.max(1, Math.round((end - timer.startedAt) / 60_000));
  const progress = postMealElapsedFraction(timer, now);

  return (
    <View>
      <View className="flex-row items-center justify-between" style={{ marginBottom: 10 }}>
        <View className="flex-row items-center flex-1" style={{ gap: 8 }}>
          <Ionicons name="time" size={16} color={THEME.accent} />
          <Text
            style={{ color: THEME.muted, fontSize: 12, fontWeight: "700", flex: 1 }}
            numberOfLines={1}
          >
            {t("dashboard.quickPostMealTitle")}{" "}
            {t("dashboard.quickPostMealWindow", { n: windowMin })}
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
      {/* Two small actions, stacked in their own row so the tight header row
          above (title + countdown + cancel) never has to squeeze them in and
          overflow. "Log a meal" stays up the whole time the timer runs; the
          restart action only joins it while a newer meal record qualifies. */}
      <View className="flex-row items-center flex-wrap" style={{ gap: 16, marginBottom: 10 }}>
        <Pressable
          onPress={onLogMeal}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t("dashboard.postMealLogMeal")}
          style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
        >
          <Ionicons name="restaurant-outline" size={13} color={THEME.accent} />
          <Text style={{ color: THEME.accent, fontSize: 11, fontWeight: "700" }} numberOfLines={1}>
            {t("dashboard.postMealLogMeal")}
          </Text>
        </Pressable>
        {restartEntry ? (
          <Pressable
            onPress={() => onRestart(restartEntry)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t("dashboard.postMealRestart")}
            style={{ flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 }}
          >
            <Ionicons name="refresh" size={13} color={THEME.muted} />
            <Text
              style={{ color: THEME.muted, fontSize: 11, fontWeight: "700" }}
              numberOfLines={1}
            >
              {t("dashboard.postMealRestart")}
            </Text>
          </Pressable>
        ) : null}
      </View>
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
