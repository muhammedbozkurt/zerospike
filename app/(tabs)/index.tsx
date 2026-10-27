import React, { Children, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, AppState, Platform, Pressable, ScrollView, SectionList, Switch, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";

import { useApp } from "../../lib/store/AppContext";
import { firstImportOutcome, HEALTH_FIRST_IMPORT_KEY } from "../../lib/healthFirstImport";
import { retryHealthRecords } from "../../lib/healthRecords";
import { displayProfileName } from "../../lib/profileName";
import { getJournal, JournalEntry, GlucoseEntry, InjectionEntry, MealEntry } from "../../lib/db/journal";
import { activeInsulinBreakdown } from "../../lib/iob";
import { bolusProfileFor, basalProfileFor } from "../../lib/insulinCatalog";
import { targetBandFor } from "../../lib/agpChart";
import { isConfigured as spikeConfigured } from "../../lib/ai/spikeClient";
import { FREE_DAILY_MESSAGES } from "../../lib/ai/spikeLimit";
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
} from "../../lib/db/logs";
import { useLayout } from "../../lib/useLayout";
import { STACK_AT_SCALE, ctaFootprintPx, ctaLineExtra } from "../../lib/layoutForFontScale";
import { useFontScale } from "../../lib/useFontScale";
import type { LogTag, PeriodTag, Reminder, SugarLog } from "../../lib/db/types";
import { listReminders } from "../../lib/db/reminders";
import { nextUpcoming, type UpcomingItem } from "../../lib/upcomingReminders";
import {
  getAlarmAuthorizationStatus,
  isAlarmKitAvailable,
} from "../../modules/zerospike-alarmkit";
import {
  startPostMealTimer,
  openExactTimingSettings,
  restartPostMealTimerAt,
  scheduleLowFollowup,
  lowFollowupThresholdMgdl,
  getPostMealTimerState,
  cancelPostMealTimer,
  completePostMealTimer,
  getNotificationPermission,
  noteJournalActivity,
  cancelTrialDay1Nudge,
  type PostMealStartOutcome,
} from "../../lib/services/notifications";
import {
  formatPostMealRemaining,
  cancelPostMealTimerAfterConfirm,
  postMealCardActions,
  postMealReminderPreview,
  postMealElapsedFraction,
  postMealWindowForProfile,
  POST_MEAL_WINDOW_MIN,
  type PostMealCardActions,
  type PostMealTimerWindow,
} from "../../lib/postMealTimer";
import { PostMealDurationSheet } from "../../components/PostMealDurationSheet";
import { weekSummaryView } from "../../lib/weekSummary";
import { IobInfoSheet } from "../../components/IobInfoSheet";
import { AnalyticsConsentSheet } from "../../lib/analytics/ConsentSheet";
import { BasalStatusLine } from "../../components/BasalStatusLine";
import { getNotificationPrefs } from "../../lib/services/notificationPrefs";
import {
  markDay7DownsellShown,
  shouldShowDay7Downsell,
} from "../../lib/services/downsell";
import {
  AFTER_LOGS_THRESHOLD,
  shouldTriggerAfterLogsPaywall,
} from "../../lib/afterLogsPaywall";
import {
  getAfterLogsPaywallGate,
  markAfterLogsPaywallShown,
} from "../../lib/services/afterLogsPaywall";
import { isPro } from "../../lib/services/purchases";
import { useProCta } from "../../lib/proCta";
import { syncLiveData } from "../../lib/services/liveData";
import {
  importHealthGlucose,
  writeGlucoseToHealthIfEnabled,
  getHealthWriteEnabled,
  hasHealthProvider,
  takeHealthWriteFailureNotice,
  shouldAnnounceHealthWriteFailure,
  retryPendingHealthWrites,
  isHealthAvailable,
  requestHealthReadWriteAccess,
  requestHealthWritePermission,
  setHealthWriteEnabled,
  HEALTH_NAME,
  type SyncResult,
} from "../../lib/services/health";
import { undoNewGlucose } from "../../lib/services/glucoseUndo";
import { healthWriteAskSeen, markHealthWriteAskSeen } from "../../lib/services/healthWritePrompt";
import { useHealthBackfill } from "../../lib/useHealthBackfill";
import { useHealthWriteDenied } from "../../lib/useHealthWriteDenied";
import { useHealthAvailable } from "../../lib/services/healthAvailability";
import { consecutiveLogDays } from "../../lib/insights";
import { noteLog, maybeRequestReview, noteStreakAndMaybeReview, crossedStreak7 } from "../../lib/services/review";
import {
  noteFirstLog,
  readFirstSyncDone,
  refreshFirstSync,
  seedFirstLogFlags,
} from "../../lib/services/firstLog";
import { cgmActivitySinceIso, firstStepPlan } from "../../lib/homeFirstStep";
import { getCgmMode } from "../../lib/cgm/state";
import { getGlucoseOptIn, withCgmPause } from "../../lib/cgm/reminderMode";
import { listCgmActivity } from "../../lib/db/sugarRange";
import { logCrash, logEvent } from "../../lib/analytics";
import { trackSaveFailed } from "../../lib/analytics/saveFailed";
import { TrialCard } from "../../components/TrialCard";
import { markProWelcomeStep } from "../../lib/services/proWelcome";
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
// Tablet two-column home: each column's content is capped at a readable 560 so
// a 13in iPad landscape (1376) does not stretch the cards; the 16 inset on each
// side of a column stays INSIDE its scroll area so card shadows are not clipped.
// Content width per column: 800dp tablet 368; iPad 13in portrait (1032) 484;
// 7in landscape (~960) 448; iPad 13in landscape 560 (centred); 7in portrait
// (600) and anything under 700 wide stay one column. Thresholds, the column
// split and the fixed card gap live in lib/tabletLayout.ts (tested, and drawn
// by scripts/tabletLayoutRender.ts). Cards keep their natural height; nothing
// is stretched, and the whole page scrolls as one.
// The CTA's own footprint: the wrapper's pt-2 (8) plus GradientCTA's rendered
// height (13 vertical padding x2 plus its ~24 line of 15pt bold text) plus the
// wrapper's own bottom inset.
const CTA_FOOTPRINT = 8 + 13 * 2 + 24 + CTA_BOTTOM;
// Wide/tablet only (android-tablet7, tablet10): the pre-journal content (hero,
// week strip, post-meal timer, quick access, finish-setup) is tall enough on
// its own to reach the bottom of a tall portrait viewport before the list ever
// needs to scroll, so at rest the floating CTA landed on the journal panel's
// own title and filter chips instead of on empty space - contentContainerStyle
// padding only guards the scrolled-to-end state, it cannot move content that
// is still above the fold. Reserving the CTA's footprint directly on the
// list's own style (not contentContainerStyle) shrinks its visible viewport so
// nothing is ever laid out behind the overlay, whatever the scroll position.
// Phones are untouched: this is isWide-only, and on a phone the same content
// stack already needs scrolling well before it reaches the CTA's height.
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
  type JournalListRow,
  type JournalSection,
} from "../../components/JournalPanel";
import { useJournalRows } from "../../components/useJournalRows";
import {
  JOURNAL_PREVIEW_LIMITS,
  nextJournalCut,
} from "../../lib/journalSlice";
import { applyGlucoseCorrection } from "../../lib/services/glucoseEdit";
import { attemptGlucoseWrite, openNewReadingState } from "../../lib/glucoseSheetFlow";
import { GlucoseInputSheet } from "../../components/GlucoseInputSheet";
import { useEntryGuardConfirm } from "../../components/useEntryGuardConfirm";
import { ProfileSwitcher } from "../../components/ProfileSwitcher";
import { useFeedback } from "../../components/Feedback";
import { StatCard } from "../../components/StatCard";
import { Sparkline } from "../../components/Sparkline";
import { Button, Card, Chip, SegmentedStat, Txt } from "../../components/ui";
import { TWO_COL_MAX_WIDTH, estimateJournalHeight, splitHomeByKeys } from "../../lib/tabletLayout";
import { withAlpha } from "../../components/rich/GlassCard";
import { RIPPLE_ALPHA, ROW_MIN_HEIGHT } from "../../lib/theme/uiPrimitives";
import { EmptyState } from "../../components/EmptyState";
import { DirIcon } from "../../components/DirIcon";
import Animated from "react-native-reanimated";
import { listEntering, PressableScale } from "../../lib/theme/motion";
import { RICH_BY_STATUS, GLUCOSE_RICH, THEME, RADIUS, SPACE, ELEVATION, HIT_TARGET, switchColors } from "../../lib/theme/tokens";
import {
  AppBackground,
  GlucoseRing,
  GlucoseChip,
  GradientCTA,
  IconTile,
} from "../../components/rich";
import { formatDate, formatDateKey, formatTime, formatTimeForLang, formatWeekday, isolateLtr, relativeDay, num, pct } from "../../lib/format";
import {
  formatGlucose,
  glucoseUnitLabel,
  glucoseToDisplay,
  classifyGlucose,
  statusLabelKey,
  summarizeReadings,
  type DayReading,
  STATUS_COLOR,
} from "../../lib/glucose";
import { hapticSuccess, hapticWarning, hapticSelect } from "../../lib/haptics";
import { upper } from "../../lib/upper";
import { switchProps } from "../../lib/a11y";
import { WelcomeCard } from "../../components/WelcomeCard";
import { isUserEntered } from "../../lib/glucoseSource";
import { bosDurumKarari, cgmHomeVisible, todayRangeShare, usesTwoColumn } from "../../lib/homeEmpty";
import { applyScreenshotCgm } from "../../lib/db/screenshotSeed";
import { CgmHomeCard } from "../../components/CgmHomeCard";
import { CgmSwitchOffer } from "../../components/CgmSwitchOffer";
import { CgmDayRow } from "../../components/CgmDayRow";
import { countNonCgmHealthRows } from "../../lib/db/cgmSql";
import {
  CGM_PREVIEW_DAYS,
  cgmDayEntry,
  cgmDaysForFilter,
  isCgmDayEntry,
  mergeCgmDays,
} from "../../lib/cgm/daySummary";
import { useCgmDaySummaries, useCgmMode } from "../../lib/useCgmWindow";


const journalKey = (e: JournalListRow) => `${e.kind}-${e.id}`;

/** Android press feedback for card-like tap targets; read at render so it
 *  follows the live theme. iOS keeps the Pressable's opacity feedback. */
const cardRipple = () => ({
  color: withAlpha(THEME.text, RIPPLE_ALPHA),
  foreground: true,
});

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
    <Card style={{ marginBottom: SPACE.md }}>
      <View className="flex-row items-center justify-between px-1 mb-1">
        <Skeleton width={90} height={11} radius={4} />
        <Skeleton width={54} height={18} radius={9} />
      </View>
      <View className="items-center">
        <Skeleton width={152} height={152} radius={76} />
      </View>
    </Card>
  );
}

/** This-week strip placeholder, sized to match the loaded SegmentedStat row. */
function WeekSkeleton() {
  return (
    <View style={{ marginBottom: 12 }}>
      <View className="flex-row items-center justify-between mb-2 px-1">
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
  const params = useLocalSearchParams<{ sheet?: string; health?: string; shot?: string }>();
  const { isWide, isTwoCol, columnPad } = useLayout();
  // Large text: the title row wraps (title first, actions under it).
  const fontScale = useFontScale();
  const headerLarge = fontScale > STACK_AT_SCALE;
  // The floating CTA grows with the text; the list scrolls clear of the taller bar.
  const ctaExtra = ctaLineExtra(fontScale);
  const { activeProfile, profiles, isProUser, dataVersion, bumpData, lang } = useApp();
  // How this profile gets its readings. Everything sensor-related on this screen
  // hangs off `cgmActive`; a manual profile (the default) renders exactly as it
  // always has.
  const { mode: dataMode, ready: dataModeReady } = useCgmMode(activeProfile?.id);
  const cgmActive = cgmHomeVisible(dataMode);
  const cgmBand = useMemo(
    () => targetBandFor(activeProfile ?? {}),
    [activeProfile?.target_fasting_min, activeProfile?.target_postmeal_max, activeProfile?.hypo_threshold_mgdl]
  );
  const cgmDays = useCgmDaySummaries({
    profileId: activeProfile?.id,
    enabled: cgmActive,
    band: cgmBand,
    dayCount: CGM_PREVIEW_DAYS,
    dataVersion,
  });
  // Sensor-mode extras, both empty on a manual profile: the days a sensor fed the
  // journal (they count toward "days in a row") and the first-sync tick.
  const [cgmDates, setCgmDates] = useState<string[]>([]);
  const [syncDone, setSyncDone] = useState(false);
  const firstPlan = firstStepPlan(dataMode, syncDone);
  // Store-screenshot only: zerospike://?shot=cgm opens this screen in sensor mode
  // over a demo curve; any dashboard link without it puts the profile back to
  // manual. The route param (not a global one) is what a warm deep link
  // delivers on Android too. Inert unless isScreenshotMode() (dev + env lock).
  const shotCgm = params.shot === "cgm";
  const screenshotProfileId = activeProfile?.id;
  useEffect(() => {
    if (!isScreenshotMode() || !screenshotProfileId) return;
    void applyScreenshotCgm(screenshotProfileId, shotCgm).then(bumpData);
  }, [screenshotProfileId, shotCgm, bumpData]);
  const { toast, confirm, actionSheet } = useFeedback();
  const healthBackfill = useHealthBackfill();
  const onHealthWriteDenied = useHealthWriteDenied();
  const guardEntry = useEntryGuardConfirm();
  // Store-screenshot only: an Android store frame is captured on the iOS
  // simulator (?scPlatform=android). The quick-access row drops the Health
  // card there regardless of the real device's Health Connect/HealthKit
  // availability, so the captured frame stays deterministic. Always false in
  // a normal build (dev + env double lock).
  const androidSourceShot = useScreenshotAndroidSource();
  // Shared gate for BOTH Health entry points (quick-access card + first-run
  // step): see lib/services/healthAvailability.ts for why hasHealthProvider()
  // alone is not enough on Android.
  const healthAvailable = useHealthAvailable();
  const showsHealthCard = healthAvailable && !androidSourceShot;
  const proCta = useProCta(!isProUser && showsHealthCard);

  const [entries, setEntries] = useState<JournalEntry[]>([]);
  // The visible journal list only: same window, but with the calculator's own
  // auto-written bolus row (source = 'calculator') filtered out in SQL, so a
  // logged meal no longer shows its dose twice (once on the meal row, once on
  // the injection line right under it). Kept SEPARATE from `entries` above -
  // active insulin, the week strip and the response icons below still read the
  // unfiltered feed, because IOB is computed from every bolus row including
  // this one; only the rendered list itself hides it.
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  // The same list narrowed to the selected kind. The narrowing happens in SQL
  // before the row limit: filtering `journalEntries` in JS showed "no entries"
  // for a kind the database held whenever a newer burst of another kind (a CGM
  // import, a run of readings) filled the window (G15).
  const [kindEntries, setKindEntries] = useState<{ kind: JournalFilter; rows: JournalEntry[] }>({
    kind: "all",
    rows: [],
  });
  // The first feed read has landed. Without it an empty `entries` means both
  // "still loading" and "nothing logged yet", and the first-run guide flashed
  // over an existing user's dashboard for one frame on every cold start.
  const [loaded, setLoaded] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editGlucose, setEditGlucose] = useState<GlucoseEntry | null>(null);
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
  // The duration + "I started eating a while ago" sheet (2.3.2 folded the two
  // into one - see components/PostMealDurationSheet.tsx). Never carries a
  // saved length: the card always arms POST_MEAL_WINDOW_MIN unless this sheet
  // is used to pick a different one for THIS tap only.
  const [durationSheetOpen, setDurationSheetOpen] = useState(false);
  // "What does this number include?" sheet for the active-insulin card
  // (components/IobInfoSheet.tsx) - opened by tapping the card itself.
  const [iobInfoOpen, setIobInfoOpen] = useState(false);
  // The next thing that will actually reach the user (2.3.0's G18). null when
  // there is nothing to say - no reminder set up, the master switch or the OS
  // permission off, or nothing inside the next day - and the line is then not
  // drawn at all rather than drawn empty.
  const [nextReminder, setNextReminder] = useState<UpcomingItem | null>(null);
  const [nextReminderRows, setNextReminderRows] = useState<Reminder[]>([]);
  // An arm is in flight: the ref is the actual guard (see startedEating), the
  // state only greys the two buttons out while it runs.
  const startingTimerRef = useRef(false);
  const stopAskOpenRef = useRef(false);
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
      // A sensor profile's measurement reminders are paused unless opted in;
      // the line must not promise one that will not arrive.
      const profileIdNow = activeProfileIdRef.current;
      const mode = profileIdNow ? await getCgmMode(profileIdNow) : "manual";
      const optIn = profileIdNow ? await getGlucoseOptIn(profileIdNow) : new Set<string>();
      setNextReminderRows(rows);
      setNextReminder(
        nextUpcoming({
          rows: withCgmPause(rows, mode, optIn),
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
      const [feed, visible, ofKind] = await Promise.all([
        // A sensor profile's stats feed leaves the sensor rows out: 300 of them
        // would be a day and a half of readings and push every meal, dose and
        // hand-entered reading out of the window. Its ring and curve read the
        // sensor data through their own queries (components/CgmHomeCard.tsx).
        getJournal(
          activeProfile.id,
          lang,
          loadLimit,
          undefined,
          cgmActive ? { cgm: "exclude" } : undefined
        ),
        getJournal(activeProfile.id, lang, loadLimit, undefined, {
          excludeCalculatorInjections: true,
          cgm: "exclude",
        }),
        filter === "all"
          ? Promise.resolve<JournalEntry[]>([])
          : getJournal(activeProfile.id, lang, loadLimit, undefined, {
              excludeCalculatorInjections: true,
              cgm: "exclude",
              kind: filter,
            }),
      ]);
      setEntries(feed);
      setJournalEntries(visible);
      setKindEntries({ kind: filter, rows: ofKind });
    } catch (err) {
      logCrash(err, { screen: "dashboard", load: "journal" });
    } finally {
      // In `finally`: a rejected read used to leave `loaded` false for good, so
      // the hero/week skeletons stayed up with no message and no retry. The
      // screen falls back to its empty state instead.
      setLoaded(true);
    }
  }, [activeProfile, lang, loadLimit, filter, cgmActive]);

  useEffect(() => {
    load();
  }, [load, dataVersion]);

  // The kind filter lasts for one visit: coming back to this tab shows
  // everything again, so an entry added elsewhere is never hidden by a filter
  // chosen earlier.
  useFocusEffect(
    useCallback(() => () => setFilter("all"), [])
  );

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

  // An install that logged before first_log existed must not report its next
  // entry as a first one; this runs once and is a no-op after that.
  useEffect(() => {
    if (profileId) void seedFirstLogFlags();
  }, [profileId]);

  // Sensor days for the streak, and the first-sync tick; both read only on a
  // sensor mode, so a manual profile does no extra work here.
  useEffect(() => {
    if (!profileId || !cgmActive) {
      setCgmDates([]);
      setSyncDone(false);
      return;
    }
    let alive = true;
    void listCgmActivity(profileId, cgmActivitySinceIso(Date.now()))
      .then((dates) => {
        if (alive) setCgmDates(dates);
      })
      .catch((err) => logCrash(err, { screen: "dashboard", load: "cgmActivity" }));
    void readFirstSyncDone(profileId)
      .then((done) => (done ? true : refreshFirstSync(profileId)))
      .then((done) => {
        if (alive) setSyncDone(done);
      });
    return () => {
      alive = false;
    };
  }, [profileId, cgmActive, dataVersion]);

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
      } else if (s === "post_meal_start") {
        // The timer widget's idle tile and the iOS 18 control both land here.
        // Neither arms the countdown itself, on purpose: a lock-screen surface
        // that logs on one tap can start a countdown nobody meant to start, and
        // both the length and the "I started a while ago" answer belong to the
        // user. So the link opens the duration sheet - the same one the card's
        // own duration pill opens. A countdown already running for THIS profile
        // needs nothing - the card below is already showing it.
        const running = postMealWindowForProfile(
          await getPostMealTimerState(),
          activeProfile.id
        );
        if (running == null) setDurationSheetOpen(true);
      }
      router.setParams({ sheet: "" });
    })();
  }, [params.sheet, activeProfile, router]);

  // Deep link from the Pro welcome's Health step and the day-1 nudge: runs the
  // one Health connect flow (openHealthFlow) once the sync preference has
  // resolved. A param of its own on purpose: the `sheet` effect above clears
  // anything it does not recognise the moment it sees it, which would eat this
  // one before cgmOn is known.
  useEffect(() => {
    if (params.health !== "connect") return;
    if (!hasHealthProvider()) {
      router.setParams({ health: "" });
      return;
    }
    if (cgmOn === null) return;
    router.setParams({ health: "" });
    openHealthFlow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.health, cgmOn]);

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

  // "First value" paywall (2.3.4): opens once, the first time this profile's
  // own VISIBLE log count reaches AFTER_LOGS_THRESHOLD, replacing the old
  // end-of-onboarding paywall. The one-shot AsyncStorage gate lives in
  // lib/services/afterLogsPaywall.ts; this is only the trigger. Re-runs on
  // every dashboard focus AND whenever one of this screen's own sheets opens
  // or closes (they change the callback identity without a route change,
  // which useFocusEffect still re-fires for) - and bails out for as long as
  // any of them is open, so the paywall never lands on top of an in-progress
  // log; closing one immediately gives the trigger another look.
  //
  // "Visible" (excludeCalculatorInjections, same option the dashboard's own
  // list reads with, see `load` above): a meal logged through the calculator
  // with a dose also silently writes a source='calculator' injection row
  // (app/calculator.tsx) - counting that row here would let one user action
  // spend two of the three "logs" the user never sees as two.
  //
  // Two live checks guard the async gap between the reads above and the
  // actual navigation, on top of the dependency array retrying the whole
  // effect: `sheetsOpenRef` (kept fresh below, read live rather than through
  // this closure's own now-stale sheetOpen/etc.) catches a sheet opening
  // WHILE a check is already in flight; `cancelled` (set in this effect's own
  // cleanup, which useFocusEffect runs on blur OR on a dependency change) is
  // the same guard for the user leaving the screen entirely mid-check.
  const afterLogsPendingRef = useRef(false);
  const sheetsOpenRef = useRef(false);
  useEffect(() => {
    sheetsOpenRef.current = sheetOpen || quickAddOpen || durationSheetOpen || iobInfoOpen;
  }, [sheetOpen, quickAddOpen, durationSheetOpen, iobInfoOpen]);
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      if (afterLogsPendingRef.current) return;
      if (isProUser) return;
      if (isScreenshotMode()) return; // never let a paywall land mid-capture
      if (sheetOpen || quickAddOpen || durationSheetOpen || iobInfoOpen) return;
      if (!activeProfile) return;
      const profileId = activeProfile.id;
      afterLogsPendingRef.current = true;
      void (async () => {
        try {
          const gate = await getAfterLogsPaywallGate();
          if (cancelled) return;
          if (gate === "done") return;
          if (gate === "grandfather") {
            // A pre-2.3.4 install whose completeOnboarding ran on an older
            // version never armed this flag - never show it retroactively.
            await markAfterLogsPaywallShown();
            return;
          }
          const rows = await getJournal(profileId, lang, AFTER_LOGS_THRESHOLD, undefined, {
            excludeCalculatorInjections: true,
          });
          if (cancelled || sheetsOpenRef.current) return;
          if (
            !shouldTriggerAfterLogsPaywall({
              logCount: rows.length,
              alreadyTriggered: false,
              isProUser,
            })
          ) {
            return;
          }
          // Cached isProUser can lag a purchase made elsewhere (another
          // device, a restore); re-verify against the STORE right before
          // spending the one-shot, same as the day-7 trigger does.
          const proNow = await isPro();
          if (proNow) {
            await markAfterLogsPaywallShown();
            return;
          }
          if (cancelled || sheetsOpenRef.current) return;
          await markAfterLogsPaywallShown();
          router.push({
            pathname: "/paywall",
            params: { context: "inapp", reason: "after_logs" },
          });
        } finally {
          afterLogsPendingRef.current = false;
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [isProUser, sheetOpen, quickAddOpen, durationSheetOpen, iobInfoOpen, activeProfile, lang, router])
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
      // Health write-mirror catch-up (2.4): coming back to the foreground is
      // the other of the two moments this retries pending writes, alongside
      // a manual sync (runSync below). Not gated on Pro - see
      // retryPendingHealthWrites's own doc comment.
      if (profileId) {
        void retryPendingHealthWrites(profileId);
        void retryHealthRecords(profileId);
      }
    });
    return () => sub.remove();
  }, [refreshPostMealTimer, refreshNextReminder, profileId, glucoseUnit]);

  // Restore the persisted sync preference, and silently re-sync on open so new
  // Health readings keep flowing in without re-toggling the switch. Auto-sync is
  // Pro-only now: a free user who had it on keeps their imported data but stops
  // auto-importing, and is told once.
  useEffect(() => {
    // Health/CGM sync now runs on any platform with a wired-up provider
    // (iOS/HealthKit, Android/Health Connect); hasHealthProvider() is the
    // shared gate so this stays in sync with health.ts's own provider pick.
    if (!hasHealthProvider()) return;
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
      if (isProUser && isScreenshotMode()) {
        // Store frames show the connected card; no real HealthKit read or prompt in the simulator.
        setCgmOn(true);
      } else if (isProUser) {
        setCgmOn(saved);
        if (saved) runSync(false);
      } else {
        setCgmOn(false);
        if (saved) await maybeShowHealthProNotice();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProfile?.id, isProUser]);

  useEffect(() => {
    if (isScreenshotMode() && isProUser && cgmOn === false) setCgmOn(true);
  }, [cgmOn, isProUser]);

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
      return { msg: t("dashboard.healthUnavailable", { health: HEALTH_NAME }), tone: "info" };
    if (res.status === "denied")
      return { msg: t("dashboard.healthDenied", { health: HEALTH_NAME }), tone: "info" };
    if (res.status === "error")
      return { msg: t("dashboard.healthError", { health: HEALTH_NAME }), tone: "info" };
    if (res.inserted > 0)
      return {
        msg: t("dashboard.imported", { n: res.inserted, health: HEALTH_NAME }),
        tone: "success",
      };
    if (res.read > 0)
      return { msg: t("dashboard.healthUpToDate"), tone: "info" };
    // read === 0 && inserted === 0: iOS never reveals read-permission denial
    // (requestHealthPermissions always resolves true there), so an empty
    // result can mean "nothing new" OR "access was never granted" - this
    // neutral copy names both instead of asserting the wrong one.
    return { msg: t("dashboard.healthNoDataOrAccess", { health: HEALTH_NAME }), tone: "info" };
  }

  // Pulls from Health. `announce` shows a toast (off for the silent open-sync).
  // Auto-sync (the IMPORT) is a Pro feature, so that part stays gated below -
  // but the write-mirror retry is not (same as the foreground AppState
  // trigger above), so it runs here even for a non-Pro profile that still
  // has the write toggle on from an earlier Pro period.
  async function runSync(announce: boolean): Promise<SyncResult | null> {
    if (!activeProfile) return null;
    void retryPendingHealthWrites(activeProfile.id);
    void retryHealthRecords(activeProfile.id);
    if (syncing || !isProUser) return null;
    setSyncing(true);
    try {
      const manualBefore = await countNonCgmHealthRows(activeProfile.id).catch(() => null);
      const res = await importHealthGlucose(activeProfile.id, announce ? "manual" : "foreground");
      if (res.status === "ok") void refreshFirstSync(activeProfile.id).then(setSyncDone);
      if (res.inserted > 0) {
        // One event per sync (not per row) to keep health-import volume sane. Its
        // own kind keeps imports out of the counts of what the user logged, and
        // out of first_log. A sensor stream syncs constantly and is not a logged
        // reading, so only a sync that added a non-sensor row counts.
        const manualAfter = await countNonCgmHealthRows(activeProfile.id).catch(() => null);
        if (manualBefore == null || manualAfter == null || manualAfter > manualBefore) {
          logEvent("log_added", { kind: "health_import" });
        }
        bumpData();
      }
      if (announce) {
        // H3: a mirrored write to Health can fail silently while the toggle
        // stays on (write access revoked in iOS Settings, which iOS never
        // notifies the app about). Surfaced once per failure, here rather than
        // at the point of the failed write itself, because a sync is the next
        // moment the user is actually looking at this card.
        //
        // It REPLACES the sync-result toast for this one run rather than
        // preceding it: there is a single toast slot, so two calls in a row
        // leave only the second on screen, and the routine "nothing new" line
        // is the less useful of the two - the sync outcome is already written
        // on this card, a broken mirror is not written anywhere. The toggle
        // itself is never touched; only the user turns that off.
        if (takeHealthWriteFailureNotice()) {
          toast(t("dashboard.healthWriteFailed", { health: HEALTH_NAME }), "info");
        } else {
          let firstEmpty = false;
          try {
            const done = await readProfileFlag(HEALTH_FIRST_IMPORT_KEY, activeProfile.id);
            const first = firstImportOutcome(res, Platform.OS === "ios", done);
            firstEmpty = first.showEmptyNote;
            if (first.markDone) await writeProfileFlag(HEALTH_FIRST_IMPORT_KEY, activeProfile.id, true);
          } catch {
            // best-effort note
          }
          if (firstEmpty) {
            toast(t("dashboard.healthFirstImportEmpty", { health: HEALTH_NAME }), "info");
          } else {
            const { msg, tone } = describeSync(res);
            toast(msg, tone);
          }
        }
      }
      return res;
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
    // Device local day - the same key formatDateKey groups the journal by,
    // so "today" here can never disagree with how the journal itself groups.
    const todayKey = formatDateKey(new Date().toISOString());

    let weekReadings = 0;
    let weekSum = 0;
    let weekInBand = 0;
    let weekInjections = 0;
    let lastGlucose: GlucoseEntry | undefined;
    let todayReadings = 0;
    let todaySum = 0;
    const todayList: DayReading[] = [];
    let todayBolusTotal = 0;
    let todayBasalTotal = 0;
    // Feed is newest-first, so the first today basal row found is the most
    // recent one - the same "first match wins" trick lastGlucose uses below.
    let todayBasalRecord: InjectionEntry | undefined;
    const injections: InjectionEntry[] = [];
    const logDates: string[] = [];
    // Feed order is newest-first; the sparkline reads chronologically.
    const weekValuesDesc: number[] = [];

    for (const e of entries) {
      logDates.push(e.logged_at);
      if (e.kind === "meal") continue;
      const isToday = formatDateKey(e.logged_at) === todayKey;
      const inWeek = new Date(e.logged_at).getTime() >= weekAgo;
      if (e.kind === "glucose") {
        if (!lastGlucose) lastGlucose = e;
        if (isToday) {
          todayReadings++;
          todaySum += e.glucose_level_mgdl;
          todayList.push({ mgdl: e.glucose_level_mgdl, tag: e.period_tag });
        }
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
      if (isToday && e.dose_units != null && e.dose_units > 0) {
        if (e.insulin_type === "bolus") {
          todayBolusTotal += e.dose_units;
        } else if (e.insulin_type === "basal") {
          todayBasalTotal += e.dose_units;
          if (!todayBasalRecord) todayBasalRecord = e;
        }
      }
    }

    const weekAvg = weekReadings ? Math.round(weekSum / weekReadings) : null;
    const weekTIR = weekReadings
      ? Math.round((weekInBand / weekReadings) * 100)
      : null;
    const todayAvg = todayReadings ? Math.round(todaySum / todayReadings) : null;
    // Today's chip and ring share go through summarizeReadings, which calls
    // the same classifyGlucose + period each journal row and the entry sheet
    // use, so a reading never reads "high" on its row and "in range" here.
    const todaySummary = summarizeReadings(todayList, activeProfile ?? {});
    const todayStatus = activeProfile ? todaySummary.avgStatus : null;

    return {
      // Encouraging consistency count ("X days in a row"), never a streak to
      // protect.
      logStreak: consecutiveLogDays(logDates, cgmDates),
      logDates,
      // Hero ring: TODAY's average (device local day), in its status color -
      // never the widgets' own "last 7 days" figure, so the two never read as
      // disagreeing about the same number.
      todayAvg,
      todayReadings,
      // Ring fill: share of today's readings that are "in range" against their
      // own period target (the centre number stays the average).
      todayShare: todayRangeShare(todaySummary.total, todaySummary.inRange),
      todayStatus,
      todayColor: todayStatus ? RICH_BY_STATUS[todayStatus] : THEME.textMuted,
      todayBasalRecord,
      todayBolusTotal: Math.round(todayBolusTotal * 100) / 100,
      todayBasalTotal: Math.round(todayBasalTotal * 100) / 100,
      // The single most recent reading overall (any day), for the small line
      // under the ring - kept apart from the average above.
      lastGlucose,
      lastGlucoseIsToday: lastGlucose
        ? formatDateKey(lastGlucose.logged_at) === todayKey
        : false,
      weekAvg,
      weekTIR,
      weekView: weekSummaryView({
        hasAnyReading: lastGlucose != null,
        weekReadings,
        weekInjections,
      }),
      weekSparkline: weekValuesDesc.reverse(),
      avgColor:
        weekAvg != null && activeProfile
          ? STATUS_COLOR[classifyGlucose(weekAvg, "manual", activeProfile)]
          : THEME.text,
      tirColor:
        weekTIR == null
          ? THEME.text
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
  }, [entries, activeProfile, cgmDates]);

  const {
    todayAvg,
    todayReadings,
    todayShare,
    todayStatus,
    todayColor,
    todayBasalRecord,
    todayBolusTotal,
    todayBasalTotal,
    lastGlucose,
    lastGlucoseIsToday,
    logStreak,
    logDates,
    weekAvg,
    weekTIR,
    weekView,
    weekSparkline,
    avgColor,
    tirColor,
    bolus: iob,
  } = stats;

  // Onboarding said whether this user takes a mealtime insulin at all. When they
  // do not, the insulin apparatus (IOB line here, the whole Injection tab) stays
  // out of the way instead of implying they should be dosing.
  const showsInsulin = insulinModeShowsBolus(activeProfile?.insulin_mode);
  // The basal status line only makes sense for a profile that actually takes
  // a basal dose: either it has one on record (basal_daily_units) or it has a
  // basal-type reminder set up (see components/BasalStatusLine.tsx).
  const showsBasalStatus =
    (activeProfile?.basal_daily_units ?? 0) > 0 ||
    nextReminderRows.some((r) => r.type === "basal");

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
  // running, so this never raises a fresh permission dialog. windowMin is
  // deliberately omitted: restartPostMealTimerAt derives it from the RUNNING
  // timer's own span when left out, so re-anchoring never quietly shrinks a
  // countdown that was armed with a non-default length back to 120.
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
    // Always a NEW reading: an edit target left behind by an earlier
    // correction must not turn this into an edit of that old row.
    const next = openNewReadingState(
      { open: sheetOpen, edit: editGlucose, initialPeriod },
      period
    );
    setEditGlucose(next.edit);
    setInitialPeriod(next.initialPeriod);
    setSheetOpen(next.open);
  }

  // "I started eating": arms the post-meal check timer (dedupes with the
  // meal-log auto reminder via a shared notification id). `minutesAgo` is
  // only passed by the duration sheet (2.3.2 folded the "a while ago" sheet's
  // second section into it, P14 removed the sheet's first section entirely);
  // the primary button arms from now, so the common case is still one tap.
  // The countdown itself is always POST_MEAL_WINDOW_MIN - it is never a
  // choice any more (lib/postMealTimer.ts's own doc comment on that
  // constant).
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
    setDurationSheetOpen(false);
    try {
      // Duplicate-entry check (lib/entryGuard.ts), against a FRESH read of the
      // persisted timer rather than the `postMealTimerForProfile` React state:
      // that state is only as current as the last refreshPostMealTimer() call
      // (on focus / app-foreground), so a countdown armed a moment earlier -
      // by a notification, the widget, or another device - could otherwise
      // still read as "nothing running" here and get silently overwritten
      // (startPostMealTimer itself always renews, it never refuses).
      const runningNow = postMealWindowForProfile(
        await getPostMealTimerState(),
        activeProfile?.id ?? null
      );
      if (runningNow) {
        const proceed = await guardEntry({
          entryKind: "post_meal_timer",
          runningTimerEndsAtIso: new Date(runningNow.endsAt).toISOString(),
        });
        if (!proceed) return;
      }
      await finishStartedEating(await startPostMealTimer(minutesAgo), minutesAgo);
    } catch {
      // startPostMealTimer arms nothing when it throws (schedulePostMealAt rolls
      // its own write back), so the countdown is simply not started. The card is
      // re-read anyway so it can never disagree with what is persisted.
      toast(t("dashboard.toklukNeedsPerm"), "info");
      await refreshPostMealTimer();
    } finally {
      startingTimerRef.current = false;
      setStartingTimer(false);
    }
  }

  async function finishStartedEating(outcome: PostMealStartOutcome, minutesAgo = 0) {
    if (outcome.kind === "elapsed") {
      // Nothing was armed: the meal is older than the window. Say so and leave
      // the user on the dashboard, where the reading is one tap away.
      toast(t("dashboard.postMealLatePassed", { n: POST_MEAL_WINDOW_MIN }), "info");
      return;
    }
    if (outcome.kind === "started") {
      hapticSuccess();
      // Same function and same clock formatting as the duration sheet's preview,
      // so the toast names exactly the time the user saw before tapping Start.
      const preview = postMealReminderPreview(minutesAgo, Date.now());
      toast(
        preview
          ? t("dashboard.postMealSetAt", {
              time: isolateLtr(formatTime(new Date(preview.atMs).toISOString())),
              left: preview.leftMin,
            })
          : t("dashboard.toklukSet", { n: outcome.minutesLeft }),
        "success"
      );
      await refreshPostMealTimer();
      await refreshNextReminder();
      if (activeProfile) void syncLiveData(activeProfile.id, glucoseUnit);
      if (outcome.timingNotice === "exactTiming") {
        Alert.alert(t("dashboard.exactTimingTitle"), t("dashboard.exactTimingBody"), [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("dashboard.exactTimingAction"),
            onPress: () => void openExactTimingSettings(),
          },
        ]);
      }
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
  ): Promise<boolean> {
    if (!activeProfile) return true;
    // The sheet closes only after the write landed (it awaits this promise and
    // leaves on `true`); a failed write keeps it open with the typed value, and
    // the edit target is cleared by the sheet's own close, not before.
    const failed = (err: unknown) => {
      logCrash(err, { screen: "dashboard", op: "saveGlucose" });
      toast(t("common.saveFailed"), "error");
    };
    const target = editGlucose;

    if (target) {
      // Correcting an existing reading: no reminders, no review nudge. Shared
      // with the full journal screen, which offers the same edit on the same
      // row (lib/services/glucoseEdit.ts).
      const res = await attemptGlucoseWrite(
        () => applyGlucoseCorrection(target, value, period, tags, loggedAt),
        failed
      );
      if (!res.ok) return false;
      logEvent("log_edited", { kind: "glucose" });
      hapticSuccess();
      bumpData();
      return true;
    }

    // loggedAt is null when the user left the time untouched ("now"); a
    // backdated reading must not arm/cancel today's timers or nudges.
    const isNow = loggedAt == null;
    const streakBefore = consecutiveLogDays(logDates, cgmDates);
    const written = await attemptGlucoseWrite(
      () =>
        addSugarLog({
          profile_id: activeProfile.id,
          glucose_level_mgdl: value,
          period_tag: period,
          tags,
          logged_at: loggedAt ? loggedAt.toISOString() : undefined,
        }),
      failed
    );
    if (!written.ok) return false;
    // Everything after the write must not hold the sheet open.
    void afterGlucoseAdded(written.value, value, period, isNow, streakBefore).catch((err) => {
      logCrash(err, { screen: "dashboard", op: "afterGlucoseAdded" });
      trackSaveFailed("glucose", "side");
    });
    return true;
  }

  async function afterGlucoseAdded(
    addedSugar: Awaited<ReturnType<typeof addSugarLog>>,
    value: number,
    period: PeriodTag,
    isNow: boolean,
    streakBefore: number
  ) {
    if (!activeProfile) return;
    // Opt-in Apple Health mirror (H1); no-op unless the user enabled it. A
    // genuine failure (toggle on, write attempted, came back empty) shows an
    // immediate toast here rather than waiting for the next manual sync -
    // capped at once per session by shouldAnnounceHealthWriteFailure.
    void writeGlucoseToHealthIfEnabled(addedSugar).then((ok) => {
      if (!ok && shouldAnnounceHealthWriteFailure()) {
        toast(t("dashboard.healthWriteFailed", { health: HEALTH_NAME }), "info");
      }
    });
    void noteJournalActivity();
    logEvent("log_added", { kind: "glucose" });
    void noteFirstLog("glucose");
    void noteLog();
    hapticSuccess();
    const savedUndo = {
      label: t("common.undo"),
      onPress: () => {
        void undoNewGlucose(addedSugar.id)
          .catch((err) => logCrash(err, { screen: "dashboard", op: "undoGlucose" }))
          .finally(() => bumpData());
      },
    };
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
        status === "normal" ? "success" : "info",
        savedUndo
      );
    } else {
      toast(t("calculator.savedRecord"), "success", savedUndo);
    }
    bumpData();
    const followupShown = isNow ? await maybeOfferLowFollowup(value) : false;
    // Not on top of the low-reading follow-up sheet.
    const isLow = classifyGlucose(value, period, activeProfile) === "low";
    const healthAsked = isLow ? false : await maybeAskHealthWrite(addedSugar);
    if (!isLow && !followupShown && !healthAsked) {
      const streakAfter = consecutiveLogDays([...logDates, addedSugar.logged_at], cgmDates);
      if (crossedStreak7(streakBefore, streakAfter)) void noteStreakAndMaybeReview(streakAfter);
      else void maybeRequestReview("log_saved");
    }
  }

  // One-time question for a profile that never turned Health writing on: asked
  // right after a manual reading (the moment the value is obvious), answered
  // either way it is never asked again; Settings > Data keeps the switch.
  function writeOnMessage(): string {
    return profiles.length > 1 && activeProfile
      ? t("dashboard.healthWriteOnNamed", { name: displayProfileName(activeProfile, t), health: HEALTH_NAME })
      : t("dashboard.healthWriteOn", { health: HEALTH_NAME });
  }

  async function maybeAskHealthWrite(log: SugarLog): Promise<boolean> {
    try {
      if (!isUserEntered(log.source) || !hasHealthProvider() || !healthAvailable) return false;
      if (await getHealthWriteEnabled(log.profile_id)) return false;
      if (await healthWriteAskSeen()) return false;
      // Marked only once Health is known to be usable here: an unavailable
      // Health Connect must not use up the one question.
      if (!(await isHealthAvailable())) return false;
      await markHealthWriteAskSeen();
      const many = profiles.length > 1 && activeProfile ? displayProfileName(activeProfile, t) : undefined;
      const yes = await confirm({
        title: t("dashboard.healthWriteAskTitle", { health: HEALTH_NAME }),
        message:
          t("dashboard.healthWriteAskBody", { health: HEALTH_NAME }) +
          (many ? `\n\n${t("dashboard.healthWriteAskProfile", { name: many })}` : ""),
        confirmLabel: t("dashboard.healthWriteAskYes"),
        cancelLabel: t("dashboard.healthWriteAskLater"),
        icon: "heart-outline",
      });
      if (!yes) return true;
      if (!(await requestHealthWritePermission())) {
        await onHealthWriteDenied();
        return true;
      }
      await setHealthWriteEnabled(true, log.profile_id);
      void writeGlucoseToHealthIfEnabled(log);
      toast(writeOnMessage(), "success");
      await healthBackfill.offerOnce(log.profile_id);
      return true;
    } catch (err) {
      logCrash(err, { screen: "dashboard", op: "askHealthWrite" });
      return true;
    }
  }

  // Neutral follow-up: after the user LOGS a reading below their own profile's
  // low threshold, offer (never force) a 15-minute re-measure reminder and a
  // shortcut to reach an emergency contact. No diagnosis, no automatic alert.
  async function maybeOfferLowFollowup(mgdl: number): Promise<boolean> {
    const prefs = await getNotificationPrefs();
    if (!prefs.enabled || !prefs.lowFollowup) return false;
    // UX#1: one low threshold, not two that could disagree - always the active
    // profile's own low threshold from Profile (see lowFollowupThresholdMgdl).
    if (mgdl >= (await lowFollowupThresholdMgdl())) return false;
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
    return true;
  }

  async function toggleCgm(next: boolean) {
    setCgmOn(next);
    if (activeProfile) await writeProfileFlag(CGM_KEY, activeProfile.id, next);
    if (!next) return;
    // Connecting asks for write access in the same system dialog as read; a new
    // grant switches the mirror on for this profile, a denial stays silent.
    const access = activeProfile
      ? await requestHealthReadWriteAccess(activeProfile.id)
      : null;
    // Read refused in the combined dialog: opening the read dialog again right
    // away (importHealthGlucose asks for it) would just repeat the same prompt.
    if (access && !access.read) {
      toast(
        access.newlyEnabled ? writeOnMessage() : t("dashboard.healthDenied", { health: HEALTH_NAME }),
        "info"
      );
      return;
    }
    const synced = await runSync(true);
    if (synced?.status === "ok") {
      // Connected and the first import went through: the Health funnel step, and
      // the day-1 nudge (and the Pro welcome step) have nothing left to ask for.
      logEvent("health_connected", {
        platform: Platform.OS === "ios" ? "ios" : "android",
        imported: synced.inserted,
      });
      void markProWelcomeStep("health", "done");
      void cancelTrialDay1Nudge();
    }
    if (access?.newlyEnabled && activeProfile) {
      toast(writeOnMessage(), "success");
      await healthBackfill.offerOnce(activeProfile.id);
    }
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
   *  original start AND passing the original span explicitly - the window
   *  length is no longer a single fixed constant (2.3.2's duration sheet can
   *  arm a timer with any length), so restoring the start alone is not enough
   *  to land on the same end; the exact previous span is what makes an undo
   *  here honest rather than approximate. */
  async function restorePostMealAnchor(previous: PostMealTimerWindow) {
    const outcome = await restartPostMealTimerAt(
      new Date(previous.startedAt),
      previous.profileId ?? activeProfileIdRef.current ?? undefined,
      Math.round((previous.endsAt - previous.startedAt) / 60_000)
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

  // The X asks before cancelling (a stray tap on a small button used to kill the
  // countdown). Once confirmed, the cancel still carries the undo toast below.
  function requestCancelEatingTimer() {
    void cancelPostMealTimerAfterConfirm(
      () =>
        confirm({
          title: t("dashboard.postMealStopTitle"),
          message: t("dashboard.postMealStopBody"),
          confirmLabel: t("dashboard.postMealStopConfirm"),
          cancelLabel: t("dashboard.postMealStopKeep"),
          destructive: true,
          icon: "stop-circle-outline",
        }),
      cancelEatingTimer,
      stopAskOpenRef
    );
  }

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
    // Until the SQL read for a freshly chosen chip lands, the JS narrowing of
    // what is already loaded stands in, so the list never flashes empty.
    const ofKind: JournalListRow[] =
      filter === "all"
        ? journalEntries
        : kindEntries.kind === filter
          ? kindEntries.rows
          : journalEntries.filter((e) => e.kind === filter);
    // A sensor profile's readings fold into one summary row per day.
    const filtered: JournalListRow[] =
      cgmActive && cgmDaysForFilter(filter)
        ? mergeCgmDays(ofKind, cgmDays.map(cgmDayEntry))
        : ofKind;
    // ONE slice, always: the preview does not page. Reaching further into the
    // journal is a screen, not a button that grows this list.
    const display = filtered.slice(0, nextJournalCut(filtered, 0, JOURNAL_PREVIEW_LIMITS));
    const sections: JournalSection[] = [];
    const byKey = new Map<string, JournalListRow[]>();
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
  }, [journalEntries, kindEntries, filter, t, cgmActive, cgmDays]);

  // The panel opens only when it has something to close: records, or (sensor
  // profile) at least one day of readings folded into its summary row.
  const hasJournalRows = journalEntries.length > 0 || (cgmActive && cgmDays.length > 0);

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
    ({ item, index }: { item: JournalListRow; index: number }) =>
      isCgmDayEntry(item) ? (
        activeProfile ? (
          <View style={journalPanelSide()}>
            <CgmDayRow
              entry={item}
              unit={activeProfile.glucose_unit ?? "mgdl"}
              onPress={journalRows.onCgmDayPress}
              firstInPanel={index === 0}
            />
          </View>
        ) : null
      ) : activeProfile ? (
        <View style={journalPanelSide()}>
          <Animated.View entering={listEntering.delay(Math.min(index, 8) * 40)}>
            <JournalItem
              entry={item}
              profile={activeProfile}
              onPress={journalRows.onRowPress}
              onLongPress={journalRows.onRowLongPress}
              onDelete={journalRows.onRowDelete}
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
      journalRows.onRowDelete,
      journalRows.onRowOpenResponse,
      journalRows.onCgmDayPress,
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
  const homeLoaded = loaded && dataModeReady;
  const homeState = bosDurumKarari({ loaded: homeLoaded, entries: entries.length, cgm: cgmActive });
  const isFirstRun = homeState === "welcome";
  const isExistingUser = homeLoaded && (entries.length > 0 || cgmActive);
  const hasAnyLog = homeLoaded && (entries.length > 0 || cgmActive);

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
      icon: firstPlan.action === "quickAdd" ? "water" : "sync",
      label: t(firstPlan.labelKey),
      onPress: () => {
        switch (firstPlan.action) {
          case "quickAdd":
            setQuickAddOpen(true);
            return;
          case "health":
            openHealthFlow();
            return;
          case "dataSources":
            // The generated route types (.expo/types) lag a new screen until the
            // next dev-server start, so the typed-route check cannot see this one yet.
            router.push("/settings/data-sources" as never);
            return;
        }
      },
      done: firstPlan.done,
    },
    // Health sync now shows on both platforms (HealthKit / Health Connect);
    // healthAvailable also drops it on an Android device where Health Connect
    // itself is unavailable, leaving a two-step guide there instead.
    ...(healthAvailable
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
  // already done (logging). Health drops out on an Android device where
  // Health Connect itself is unavailable (see healthAvailable above).
  const setupShortcuts = startSteps.filter((s) => s.key !== "log" || firstPlan.inSetupRow);
  // Both (or, on Android, the one) optional steps have a confirmed "done":
  // the compact row below hides itself even if the user never tapped its
  // close button. An unresolved/unknown step (done === undefined) never
  // counts as complete, so the row never disappears on a guess.
  const setupAllDone =
    setupShortcuts.length > 0 && setupShortcuts.every((s) => s.done === true);

  const FirstRunGuide = (
    <WelcomeCard
      onAddFirst={() => setQuickAddOpen(true)}
      onAddFood={() => router.navigate("/(tabs)/food")}
      onSetReminder={() => router.push("/settings/reminders")}
    />
  );

  // The header is built in three pieces so a tablet can split them over two
  // columns (titleRow above both, headerTop left, headerRest + journal right);
  // the phone Header below stacks the same three in the same order.
  const titleRow = (
      <View
        className="flex-row items-center justify-between mb-4"
        style={headerLarge ? { flexWrap: "wrap", rowGap: SPACE.sm } : undefined}
      >
        <Txt kind="title" accessibilityRole="header">{t("common.today")}</Txt>
        <View className="flex-row items-center" style={{ gap: SPACE.md }}>
          {/* Spike's entry point only exists when the function URL is actually
              configured. A visible button that opens a dead end is worse than
              no button; see lib/ai/spikeClient.ts. K4: also shown in store-
              screenshot mode, where spike.tsx renders a mock chat with no
              backend. */}
          {spikeConfigured || isScreenshotMode() ? (
            <Pressable
              onPress={() => router.push("/spike")}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t("spike.title")}
            >
              <IconTile icon="sparkles" size={32} radius={10} />
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => router.push("/sos")}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t("sos.title")}
          >
            <IconTile icon="medical" size={32} radius={10} tint={THEME.danger} />
          </Pressable>
          <ProfileSwitcher />
        </View>
      </View>
  );

  const headerTop = (
    <>
      {/* Free-trial card: days left and open Pro welcome steps. Renders nothing
          unless the store reports a running trial. */}
      <TrialCard />

      {!homeLoaded ? (
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
          {/* Hero: TODAY's average as the signature glucose ring (device local
              day - see the `stats` memo above), with the count of readings it
              is built from, and the single most recent reading (whichever day
              it fell on) as a small line underneath. Still gated on
              `lastGlucose` existing at all: with no reading EVER logged this
              stays out of the way for the FirstRunGuide branch above. */}
          {activeProfile ? (
            <CgmSwitchOffer
              profileId={activeProfile.id}
              mode={dataMode}
              dataVersion={dataVersion}
            />
          ) : null}
          {cgmActive && activeProfile ? (
            // A sensor profile's hero: the same ring, the curve under it, the
            // last reading with its age. Never drawn for a manual profile.
            <CgmHomeCard profile={activeProfile} mode={dataMode} dataVersion={dataVersion} />
          ) : lastGlucose ? (
            <Card
              glow={todayAvg != null ? todayColor : THEME.textMuted}
              style={{ marginBottom: SPACE.md }}
            >
              <View className="flex-row items-center justify-between px-1 mb-1">
                <Txt
                  kind="micro"
                  tone="muted"
                  numberOfLines={1}
                  style={{ letterSpacing: 1.3, fontWeight: "700", flexShrink: 1 }}
                >
                  {upper(t("dashboard.todayAvgLabel"))}
                </Txt>
                {todayStatus ? (
                  <GlucoseChip
                    status={todayStatus}
                    label={t(statusLabelKey(todayStatus))}
                  />
                ) : null}
              </View>
              <View className="items-center">
                <GlucoseRing
                  value={todayAvg ?? undefined}
                  display={todayAvg != null ? formatGlucose(todayAvg, unit) : "-"}
                  caption={
                    todayAvg != null
                      ? t("dashboard.todayReadingCount", { count: todayReadings })
                      : t("dashboard.todayNoReading")
                  }
                  color={todayAvg != null ? todayColor : THEME.textMuted}
                  gradientTo={todayAvg != null ? undefined : THEME.textMuted}
                  fraction={todayShare != null ? todayShare / 100 : 0}
                  size={152}
                />
              </View>
              {todayShare != null ? (
                // What the ring's fill means: the centre number is the average,
                // the sweep is the share of today's readings in the target band.
                <Txt
                  kind="caption"
                  tone="muted"
                  style={{ textAlign: "center", marginTop: SPACE.md, paddingHorizontal: SPACE.sm }}
                >
                  {t("dashboard.ringShareLine", { share: isolateLtr(pct(todayShare)) })}
                </Txt>
              ) : null}
              <Txt
                kind="caption"
                tone="muted"
                numberOfLines={2}
                style={{ textAlign: "center", marginTop: todayShare != null ? SPACE.sm : SPACE.md }}
              >
                {t("dashboard.lastReadingLine", {
                  // "value unit · when" is one purely-LTR run (digits + unit +
                  // digits); composed and isolated as a single block (lib/format's
                  // LRI/PDI wrap) so RTL never reorders the reading against its
                  // own timestamp - same pattern as components/CarbRatioLine.tsx.
                  summary: isolateLtr(
                    `${formatGlucose(lastGlucose.glucose_level_mgdl, unit)} ${glucoseUnitLabel(unit)} · ${
                      lastGlucoseIsToday
                        ? formatTime(lastGlucose.logged_at)
                        : `${formatDate(lastGlucose.logged_at)} ${formatTime(lastGlucose.logged_at)}`
                    }`
                  ),
                })}
              </Txt>
            </Card>
          ) : null}

          {/* This-week strip: numbers that were computed but never shown (avg, TIR,
              streak) with a small sparkline of the week's readings. One compact row. */}
          {!cgmActive && weekView === "firstHint" ? (
            <Txt
              kind="caption"
              tone="muted"
              style={{ fontWeight: "600", marginBottom: SPACE.md, paddingHorizontal: SPACE.xs }}
            >
              {t("dashboard.weekEmptyHint")}
            </Txt>
          ) : null}
          {!cgmActive && weekView === "boxes" ? (
            <View style={{ marginBottom: SPACE.md }}>
              <View className="flex-row items-center justify-between mb-2 px-1">
                <Txt kind="micro" tone="muted" style={{ fontWeight: "700" }}>
                  {t("dashboard.thisWeek")}
                </Txt>
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

    </>
  );

  // Tablet two-column home (width >= 700, existing user): the cards keep their
  // phone order and natural height; the cut between the columns is the one
  // that makes both as tall as possible alike (lib/tabletLayout.ts
  // splitHomeColumns, from the measured block heights). The journal panel is
  // one connected container and always closes the right column.
  const twoColHome = usesTwoColumn(homeState, isTwoCol);
  const [blockHeights, setBlockHeights] = useState<Record<string, number>>({});
  const [ctaHeight, setCtaHeight] = useState(0);
  const [journalHeight, setJournalHeight] = useState(0);
  const splitCutRef = useRef<string | null | undefined>(undefined);
  const onBlockLayout = useCallback((key: string, h: number) => {
    setBlockHeights((prev) => (Math.abs((prev[key] ?? -1) - h) < 1 ? prev : { ...prev, [key]: h }));
  }, []);

  const headerCards = (
    <>
      {/* Post-meal timer: a REAL filled pill button, not text that reads like a
          value. While the timer runs, the same slot shows the countdown + a small
          cancel action. Hidden before the first entry (and before we know which
          case this is - see isExistingUser above): "I started eating" was the
          loudest action on a brand-new dashboard, ahead of logging anything.

          Idle layout is DELIBERATELY vertical (device QA: "the card is
          cramped, the button doesn't read as a button, and it overflows on
          small screens"). The old shape packed an icon, a two-line title, a
          filled pill and a 34pt round button onto ONE row - German
          translations and large Dynamic Type had nowhere to go and the row
          clipped/overflowed. Stacking the pieces (title+pill row -> full-width
          CTA) gives each its own line; lib/postMealCardLayout.ts's test
          proves the pill and the CTA's own label both still fit the
          narrowest supported screen at max Dynamic Type. */}
      {isExistingUser ? (
      <Card accent style={{ marginBottom: SPACE.md }}>
        {postMealTimerForProfile != null ? (
          <PostMealCountdown
            timer={postMealTimerForProfile}
            onCancel={requestCancelEatingTimer}
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
          <View>
            {/* Idle layout: the pill is an ACTION label ("pick a length"),
                not the current value - the countdown length is never saved
                (see lib/postMealTimer.ts's own doc comment), so there is no
                value to show here. Tapping it opens the sheet that carries
                BOTH settings (the length for this one timer, and "when did
                you actually start eating") as its two sections. */}
            <View className="flex-row items-center" style={{ gap: SPACE.sm, marginBottom: SPACE.md }}>
              <Ionicons name="restaurant-outline" size={18} color={THEME.accent} />
              <Txt
                kind="caption"
                numberOfLines={2}
                style={{ fontWeight: "700", flex: 1, minWidth: 0 }}
              >
                {t("dashboard.quickPostMealTitle")}
              </Txt>
              {/* Stays a Pressable, not a Button: Button always speaks its
                  visible label, and this action needs the longer
                  postMealDurationA11y name. Same frame as Button outlined. */}
              <Pressable
                onPress={() => setDurationSheetOpen(true)}
                disabled={startingTimer}
                accessibilityRole="button"
                accessibilityLabel={t("dashboard.postMealDurationA11y")}
                android_ripple={cardRipple()}
                className="items-center justify-center active:opacity-70"
                style={{
                  minHeight: HIT_TARGET,
                  maxWidth: "55%",
                  flexShrink: 1,
                  paddingHorizontal: SPACE.md,
                  borderRadius: RADIUS.lg,
                  borderWidth: 1,
                  borderColor: THEME.border,
                  opacity: startingTimer ? 0.5 : 1,
                }}
              >
                <Txt kind="caption" tone="accent" numberOfLines={1} style={{ fontWeight: "700" }}>
                  {t("dashboard.postMealDurationPick")}
                </Txt>
              </Pressable>
            </View>
            {cgmActive ? (
              <Txt kind="micro" tone="muted" style={{ marginBottom: SPACE.sm }}>
                {t("cgmHome.watching")}
              </Txt>
            ) : null}

            <PressableScale
              onPress={() => void startedEating()}
              disabled={startingTimer}
              accessibilityRole="button"
              accessibilityLabel={t("dashboard.startedEating")}
              android_ripple={{
                color: withAlpha(THEME.accentOnFill, RIPPLE_ALPHA),
                foreground: true,
              }}
              style={[
                {
                  width: "100%",
                  minHeight: 48,
                  borderRadius: RADIUS.lg,
                  backgroundColor: THEME.accentFill,
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: startingTimer ? 0.6 : 1,
                },
                ELEVATION.card,
              ]}
            >
              <Txt
                kind="body"
                tone="onAccent"
                numberOfLines={1}
                style={{ fontWeight: "700", flexShrink: 1 }}
              >
                {t("dashboard.startedEating")}
              </Txt>
            </PressableScale>
          </View>
        )}
      </Card>
      ) : null}

      {/* One-time tip after the first meal timer: the countdown is also a native
          lock-screen surface. Dismissible; points at the widget guide. */}
      {showWidgetTip ? (
        <Card style={{ marginBottom: SPACE.md, flexDirection: "row", alignItems: "center" }}>
          <Ionicons name="phone-portrait-outline" size={18} color={THEME.accent} />
          <View style={{ flex: 1, minWidth: 0, marginStart: SPACE.md }}>
            <Txt kind="caption" style={{ fontWeight: "700" }}>
              {t("dashboard.widgetTipTitle")}
            </Txt>
            {/* The button's own inset is cancelled so the label lines up with
                the title above it. */}
            <View style={{ alignSelf: "flex-start", marginStart: -SPACE.md }}>
              <Button
                label={t("dashboard.widgetTipCta")}
                variant="tertiary"
                size="sm"
                onPress={() => {
                  void dismissWidgetTip();
                  router.push("/widget-guide");
                }}
              />
            </View>
          </View>
          <Pressable
            onPress={dismissWidgetTip}
            hitSlop={14}
            accessibilityRole="button"
            accessibilityLabel={t("common.close")}
          >
            <Ionicons name="close" size={16} color={THEME.textMuted} />
          </Pressable>
        </Card>
      ) : null}

      {loaded && hasAnyLog && spikeConfigured && !isScreenshotMode() ? (
        <Pressable
          onPress={() => router.push("/spike")}
          accessibilityRole="button"
          accessibilityLabel={t("spike.title")}
          android_ripple={cardRipple()}
          className="active:opacity-80"
          style={{ marginBottom: SPACE.md, borderRadius: RADIUS.lg }}
        >
          <Card>
            <View className="flex-row items-center" style={{ gap: SPACE.md }}>
              <IconTile icon="sparkles" size={32} radius={10} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt kind="caption" style={{ fontWeight: "700" }}>
                  {t("spike.title")}
                </Txt>
                <Txt kind="caption" tone="muted">
                  {t("spike.entryBody")}
                </Txt>
                {!isProUser ? (
                  <Txt kind="micro" tone="accent" style={{ marginTop: SPACE.xs }}>
                    {t("spike.entryFree", { n: FREE_DAILY_MESSAGES })}
                  </Txt>
                ) : null}
              </View>
              <DirIcon name="chevron-forward" size={18} color={THEME.textMuted} />
            </View>
          </Card>
        </Pressable>
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
        <View
          className="flex-row rounded-2xl bg-glass border border-hair overflow-hidden"
          style={{ marginBottom: SPACE.md }}
        >
          {iob > 0 && showsInsulin ? (
            <Pressable
              onPress={() => setIobInfoOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={t("dashboard.activeInsulin")}
              android_ripple={cardRipple()}
              className="flex-1 justify-center active:opacity-70"
              style={{
                minHeight: ROW_MIN_HEIGHT,
                paddingVertical: SPACE.sm,
                paddingHorizontal: SPACE.md,
              }}
            >
              <View className="flex-row items-center" style={{ gap: SPACE.xs }}>
                <Ionicons name="hourglass-outline" size={12} color={THEME.accent} />
                <Txt kind="micro" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {t("dashboard.activeInsulin")}
                </Txt>
                {/* "What does this number include?" now opens the full sheet
                    (components/IobInfoSheet.tsx) - the whole card is the
                    tap target, this icon is only the affordance. */}
                <Ionicons name="information-circle-outline" size={12} color={THEME.textMuted} />
              </View>
              <Txt
                kind="caption"
                tabular
                numberOfLines={1}
                style={{ fontWeight: "700" }}
              >
                {num(iob)} {t("common.units")}
              </Txt>
              {/* Bolus only: basal is a background dose, not a stacking risk
                  the way a fresh mealtime dose is, so it stays off this
                  headline figure entirely (see lib/iob.ts's own note). */}
              <Txt kind="micro" tone="muted" numberOfLines={1} style={{ fontWeight: "400" }}>
                {t("dashboard.activeInsulinBolusOnly")}
              </Txt>
            </Pressable>
          ) : null}

          {iob > 0 && showsInsulin && nextReminder ? (
            <View style={{ width: 1, backgroundColor: THEME.border, marginVertical: 8 }} />
          ) : null}

          {nextReminder ? (
            <Pressable
              onPress={() => router.push("/settings/reminders")}
              accessibilityRole="button"
              accessibilityLabel={t("dashboard.nextReminderA11y")}
              android_ripple={cardRipple()}
              className="flex-1 justify-center active:opacity-70"
              style={{
                minHeight: ROW_MIN_HEIGHT,
                paddingVertical: SPACE.sm,
                paddingHorizontal: SPACE.md,
              }}
            >
              <View className="flex-row items-center" style={{ gap: SPACE.xs }}>
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
                  size={12}
                  color={nextReminder.mode === "alarm" ? THEME.accent : THEME.textMuted}
                />
                <Txt kind="micro" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {t("dashboard.nextReminder")}
                </Txt>
              </View>
              {/* Time-first (see nextReminderLabel), and allowed to wrap onto a
                  second line: on a narrow screen the longest names in de/fr/es
                  overrun half a strip, and font shrinking would clip on
                  Android. */}
              <Txt
                kind="caption"
                numberOfLines={2}
                style={{ fontWeight: "700" }}
              >
                {nextReminderLabel(nextReminder)}
              </Txt>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* Basal status: only for a profile that actually takes a basal dose
          (see showsBasalStatus above). Today's own record if one exists, or a
          nudge into app/basal-confirm.tsx otherwise. */}
      {showsBasalStatus ? (
        <BasalStatusLine
          record={
            todayBasalRecord
              ? {
                  loggedAt: todayBasalRecord.logged_at,
                  units: todayBasalRecord.dose_units ?? 0,
                }
              : null
          }
          onConfirm={() =>
            router.push({
              pathname: "/basal-confirm",
              params: { step: "ask", profileId: activeProfile?.id },
            })
          }
        />
      ) : null}

      {/* Quick access: Insights + Health sync, promoted from the old list footer
          so they are reachable without scrolling past the whole journal. The Pro
          gate and the sync switch behave exactly as before. Both lead into
          screens that have nothing to show yet before the first entry, so the row
          waits for it (and for `loaded`, so it never shows during the moment we
          don't yet know which case this is). */}
      {isExistingUser ? (
      <View
        className="flex-row"
        style={{ gap: SPACE.sm, marginBottom: SPACE.md }}
      >
        <Pressable
          onPress={() => router.push("/insights")}
          accessibilityRole="button"
          accessibilityLabel={t("insights.title")}
          android_ripple={cardRipple()}
          className="active:opacity-80"
          // Android has no Health card next to it, and a lone flex:1 card
          // stretched the full row width around a small icon and two short
          // lines. There it takes a card's width instead of the row's.
          style={[
            { borderRadius: RADIUS.lg },
            showsHealthCard ? { flex: 1 } : { width: 220, maxWidth: "100%" },
          ]}
        >
          <Card style={{ flex: 1 }}>
            <View className="flex-row items-center justify-between">
              <IconTile icon="stats-chart" size={28} radius={9} />
              <DirIcon name="chevron-forward" size={16} color={THEME.textMuted} />
            </View>
            <Txt kind="caption" numberOfLines={1} style={{ fontWeight: "700", marginTop: SPACE.sm }}>
              {t("insights.title")}
            </Txt>
            <Txt kind="micro" tone="muted" numberOfLines={2} style={{ fontWeight: "400" }}>
              {t("insights.cardSub")}
            </Txt>
          </Card>
        </Pressable>

        {showsHealthCard ? (
          <Pressable
            onPress={openHealthFlow}
            disabled={isProUser && syncing}
            accessibilityRole="button"
            accessibilityLabel={HEALTH_NAME}
            android_ripple={cardRipple()}
            className="active:opacity-80"
            style={{ flex: 1, borderRadius: RADIUS.lg }}
          >
            <Card style={{ flex: 1 }}>
            <View className="flex-row items-center justify-between">
              <IconTile icon="pulse" size={28} radius={9} />
              {!isProUser ? (
                <View className="rounded-full bg-brand px-2 py-0.5">
                  <Txt kind="micro" tone="onAccent" style={{ fontWeight: "700" }}>
                    {t("common.pro")}
                  </Txt>
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
                  {...switchProps(HEALTH_NAME)}
                  {...switchColors()}
                  style={{ transform: [{ scale: 0.75 }], marginVertical: -6 }}
                />
              )}
            </View>
            <Txt kind="caption" numberOfLines={1} style={{ fontWeight: "700", marginTop: SPACE.sm }}>
              {HEALTH_NAME}
            </Txt>
            {isProUser && cgmOn === null ? (
              <Skeleton width={110} height={10} radius={4} style={{ marginTop: SPACE.xs }} />
            ) : (
              <Txt
                kind="micro"
                tone="muted"
                numberOfLines={2}
                style={{ fontWeight: "400" }}
              >
                {!isProUser
                  ? t(proCta.key, proCta.params)
                  : syncing
                    ? t("dashboard.syncing")
                    : cgmOn
                      ? t("dashboard.cgmOnTapToSync")
                      : t("dashboard.cgmSubtitle")}
              </Txt>
            )}
            </Card>
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
        <Card
          style={{ flexDirection: "row", alignItems: "flex-start", marginBottom: SPACE.md }}
        >
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt kind="caption" numberOfLines={2} style={{ fontWeight: "700" }}>
              {t("dashboard.finishSetupTitle")}
            </Txt>
            <View
              className="flex-row items-center flex-wrap"
              style={{ gap: SPACE.sm, marginTop: SPACE.sm }}
            >
              {setupShortcuts.map((s) => (
                <Chip
                  key={s.key}
                  label={s.label}
                  onPress={s.onPress}
                  icon={
                    // Ticked once its own state (health-sync / native widget
                    // detection) confirms it; an unresolved/unknown state
                    // (s.done === undefined) keeps the plain step icon.
                    <Ionicons
                      name={s.done ? "checkmark-circle" : s.icon}
                      size={14}
                      color={s.done ? GLUCOSE_RICH.target : THEME.accent}
                    />
                  }
                />
              ))}
            </View>
          </View>
          <Pressable
            onPress={dismissFinishSetup}
            hitSlop={14}
            accessibilityRole="button"
            accessibilityLabel={t("common.close")}
          >
            <Ionicons name="close" size={16} color={THEME.textMuted} />
          </Pressable>
        </Card>
      ) : null}
    </>
  );

  const headerJournal = (
    <>
      {/* The journal panel's TOP: heading and filter chips, sharing the
          container with the rows below instead of floating on the page. Gated
          on the VISIBLE list (journalEntries), not the stats feed - the two can
          differ now that the calculator's own bolus row is filtered out of the
          former - so the container is never opened without rows to close it. */}
      {hasJournalRows ? (
        <JournalPanelTop title={t("dashboard.history")}>
          <JournalFilterChips
            chips={FILTER_CHIPS}
            value={filter}
            onChange={setFilter}
          />

          {/* One-time tap-to-edit discoverability hint, inside the panel top so
              it reads as part of the journal rather than a page-level notice. */}
          {showEditHint ? (
            <View
              className="flex-row items-center rounded-xl border border-hair bg-glass"
              style={{ marginTop: SPACE.sm, padding: SPACE.md }}
            >
              <Ionicons name="create-outline" size={14} color={THEME.accent} />
              <Txt
                kind="caption"
                tone="muted"
                style={{ flex: 1, minWidth: 0, marginStart: SPACE.sm }}
              >
                {t("journal.editHint")}
              </Txt>
              <Pressable
                onPress={dismissEditHint}
                hitSlop={14}
                accessibilityRole="button"
                accessibilityLabel={t("common.close")}
              >
                <Ionicons name="close" size={16} color={THEME.textMuted} />
              </Pressable>
            </View>
          ) : null}
        </JournalPanelTop>
      ) : null}
    </>
  );

  // Phone and first run: the same three pieces in the same order as before.
  const headerRest = (
    <>
      {headerCards}
      {headerJournal}
    </>
  );

  // No bottom padding when the journal panel is open: the panel's sides are
  // drawn by the header, each day separator and each row as separate pieces
  // of one container, so any spacing BETWEEN those pieces shows up as a gap
  // in the border. The separator's own paddingTop provides that air from
  // inside the container instead.
  const headerWrapClass = hasJournalRows ? "" : "pb-2";
  const Header = (
    <View className={headerWrapClass}>
      {titleRow}
      {headerTop}
      {headerRest}
    </View>
  );

  // Tablet two-column home (width >= 700, existing user): the ring, week boxes
  // and cards in phone order, cut between the columns by splitHomeColumns; the
  // journal panel closes the right column. ONE outer ScrollView carries both
  // columns, so the page scrolls as a whole; cards keep their natural height.
  // The journal there is a plain list (no nested scrolling): it is
  // already capped to the preview slice (JOURNAL_PREVIEW_LIMITS: 15 rows, 2
  // days), so virtualisation buys nothing.
  // First run keeps the single centred column (one guide, nothing to split).
  const twoCol = twoColHome;
  const movableBlocks = twoCol
    ? [
        ...Children.toArray((headerTop.props as { children?: React.ReactNode }).children).map((el) => ({
          key: `top${(el as React.ReactElement).key}`,
          el,
        })),
        ...Children.toArray((headerCards.props as { children?: React.ReactNode }).children).map((el) => ({
          key: `card${(el as React.ReactElement).key}`,
          el,
        })),
      ]
    : [];
  const journalRowCount = journalSections.reduce((n, sec) => n + sec.data.length, 0);
  const columnSplit = twoCol
    ? splitHomeByKeys(
        movableBlocks.map((b) => b.key),
        blockHeights,
        journalHeight > 0 ? journalHeight : estimateJournalHeight(journalRowCount),
        {
          cutKey: splitCutRef.current,
          settled: journalHeight > 0 && movableBlocks.every((b) => blockHeights[b.key] != null),
        }
      )
    : null;
  if (columnSplit) splitCutRef.current = columnSplit.cutKey;
  const renderBlock = (b: { key: string; el: React.ReactNode }) => (
    <View key={b.key} onLayout={(e) => onBlockLayout(b.key, e.nativeEvent.layout.height)}>
      {b.el}
    </View>
  );
  // The bar's measured height wins over the one-line formula: at the largest
  // text sizes the label wraps and the bar grows past it (iPad AX5, J6).
  const ctaFootprint = ctaFootprintPx(ctaHeight, CTA_FOOTPRINT + ctaExtra);
  // The CGM store frame is a scroll-0 capture with more content below, so the
  // small button would sit on a card's text; that capture leaves it out
  // (dev + env locked, never in a release build).
  const showCta = !isFirstRun && !(isScreenshotMode() && shotCgm);
  const wideListInset = isWide && !isFirstRun ? { paddingBottom: ctaFootprint + insets.bottom } : undefined;

  const journalFooter =
    hasJournalRows ? (
      <View>
        {/* Closes the panel opened by the header, with the one action
            that belongs to the journal: the whole of it, on its own
            screen. The medical notice sits below on the page - it speaks
            for the app, not for this list. */}
        <JournalPanelBottom>
          <Button
            label={t("journal.seeAll")}
            variant="outlined"
            onPress={openFullJournal}
            icon={<Ionicons name="arrow-forward" size={16} color={THEME.text} />}
          />
        </JournalPanelBottom>
        <JournalDisclaimerNote />
      </View>
    ) : null;

  const journalEmpty =
    filter !== "all" ? <JournalEmptyFilter onClearFilter={() => setFilter("all")} /> : null;

  const journalList = (
      <SectionList
        // Wide screens only (see CTA_FOOTPRINT above): shrinks the list's own
        // visible viewport by the CTA's footprint so nothing is ever laid out
        // behind the floating overlay, regardless of scroll position. Phones
        // are unaffected (undefined style = today's behavior).
        style={wideListInset}
        sections={journalSections}
        keyExtractor={journalKey}
        stickySectionHeadersEnabled={true}
        renderSectionHeader={renderSectionHeader}
        initialNumToRender={12}
        maxToRenderPerBatch={10}
        windowSize={7}
        ListHeaderComponent={Header}
        ListFooterComponent={journalFooter}
        renderItem={renderItem}
        // A kind filter with no matches is NOT the first-run case: the user has
        // records, just none of this kind, and telling them to add their first
        // reading was wrong. The first-run copy now lives in the guide above, so
        // this slot only speaks for an empty filter.
        ListEmptyComponent={journalEmpty}
        contentContainerStyle={{
          // No floating CTA during first run, so the list does not have to
          // scroll clear of one. Wide screens already shrink the list's own
          // viewport by CTA_FOOTPRINT + insets.bottom via the `style` prop
          // above, so adding that same clearance again here on top of
          // CTA_CLEARANCE double-reserved space and left a dead ~180px band
          // at the end of the list; CTA_CLEARANCE alone is the correct
          // remaining clearance on every screen size.
          // Phones have no shrunken viewport, so the list itself reserves the
          // CTA's footprint plus the safe-area inset (and a little air): the
          // last card, full or empty list, never ends under the bar.
          paddingBottom: isFirstRun
            ? 24
            : isWide
              ? CTA_CLEARANCE + ctaExtra
              : Math.max(CTA_CLEARANCE + ctaExtra, ctaFootprint + insets.bottom + 40),
          // Tablet one column: a centred reading column instead of a stretched
          // phone layout. Reduces to the plain 16 inset on phones, so the
          // narrow render is unchanged.
          ...columnPad(16),
        }}
        showsVerticalScrollIndicator={false}
      />
  );

  return (
    <AppBackground style={{ paddingTop: insets.top }}>
      {twoCol ? (
        <View
          style={{
            flex: 1,
            width: "100%",
            maxWidth: TWO_COL_MAX_WIDTH,
            alignSelf: "center",
          }}
        >
          <ScrollView
            style={[{ flex: 1 }, wideListInset]}
            contentContainerStyle={{ paddingBottom: CTA_CLEARANCE + ctaExtra }}
            showsVerticalScrollIndicator={false}
          >
            <View style={{ paddingHorizontal: SPACE.lg }}>{titleRow}</View>
            <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
              {/* Reading order (J2): the left column is rendered first and,
                  on iOS, every Fabric view already groups its children
                  (RCTViewComponentView shouldGroupAccessibilityChildren), so
                  VoiceOver finishes this column before the right one. */}
              <View style={{ flex: 1, minWidth: 0, paddingHorizontal: SPACE.lg }}>
                {movableBlocks.slice(0, columnSplit?.leftCount ?? 0).map(renderBlock)}
              </View>
              <View style={{ flex: 1, minWidth: 0, paddingHorizontal: SPACE.lg }}>
                {movableBlocks.slice(columnSplit?.leftCount ?? 0).map(renderBlock)}
                <View onLayout={(e) => setJournalHeight(Math.round(e.nativeEvent.layout.height))}>
                  <View className={headerWrapClass}>{headerJournal}</View>
                  {journalSections.map((section, si) => (
                    <View key={`${si}-${section.dateLabel}`}>
                      <JournalDayHeader section={section} />
                      {section.data.map((item, i) => (
                        <React.Fragment key={journalKey(item)}>
                          {renderItem({ item, index: i })}
                        </React.Fragment>
                      ))}
                    </View>
                  ))}
                  {journalSections.length === 0 ? journalEmpty : null}
                  {journalFooter}
                </View>
              </View>
            </View>
          </ScrollView>
        </View>
      ) : (
        journalList
      )}

      {/* Bottom CTA (mockup B03: single "add record"). During first run the
          guide carries the one primary button, so this one stands down rather
          than putting two identical CTAs on an otherwise empty screen. */}
      {showCta ? (
        <View
          className="absolute left-0 right-0 bottom-0 pt-2"
          style={{ paddingBottom: CTA_BOTTOM }}
          onLayout={(e) => setCtaHeight(Math.ceil(e.nativeEvent.layout.height))}
        >
          <View style={columnPad(16)}>
            {cgmActive ? (
              // A sensor profile logs by hand only now and then: the button
              // stays, small and to the side, instead of the full-width bar.
              <View
                style={[
                  {
                    alignSelf: "flex-end",
                    borderRadius: RADIUS.lg,
                    backgroundColor: THEME.surfaceRaised,
                  },
                  ELEVATION.card,
                ]}
              >
                <Button
                  label={`＋ ${t("dashboard.addRecord")}`}
                  variant="outlined"
                  size="sm"
                  onPress={() => setQuickAddOpen(true)}
                />
              </View>
            ) : (
              <GradientCTA
                label={`＋ ${t("dashboard.addRecord")}`}
                onPress={() => setQuickAddOpen(true)}
              />
            )}
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
        // Same delete the full journal screen offers (app/journal.tsx). The
        // sheet only draws it while editing an existing reading, so passing it
        // here does not put a Delete on the new-entry path this same instance
        // serves. The sheet's own confirm has already run by the time this
        // fires; deleteEntry then does the undo-toast delete every other path
        // uses.
        onDelete={() => {
          const target = editGlucose;
          setSheetOpen(false);
          setEditGlucose(null);
          if (target) void journalRows.deleteEntry(target);
        }}
      />

      {/* The injection and medication edit sheets belong to useJournalRows: it
          owns the state a row tap sets, so only the copies it hands back can
          ever open. This screen used to render its OWN pair against local state
          nothing assigned - dead overlays, while the hook's real ones were never
          mounted here at all, so tapping an injection or medication row on the
          dashboard silently did nothing. app/journal.tsx always rendered
          `rows.sheets`; this is the same line, and it brings the per-sheet
          Delete with it. */}
      {journalRows.sheets}

      <PostMealDurationSheet
        visible={durationSheetOpen}
        onClose={() => setDurationSheetOpen(false)}
        onStart={(minutesAgo) => void startedEating(minutesAgo)}
        onAddReading={() => {
          setDurationSheetOpen(false);
          openLogger("post_meal_2h");
        }}
      />

      <IobInfoSheet
        visible={iobInfoOpen}
        onClose={() => setIobInfoOpen(false)}
        bolusProfile={bolusProfileFor(activeProfile?.bolus_insulin_id)}
        todayBolusUnits={todayBolusTotal}
        todayBasalUnits={todayBasalTotal}
      />

      {/* One-time usage-data question for an install that predates the opt-in;
          it decides for itself whether it is due (lib/analytics/ConsentSheet.tsx). */}
      <AnalyticsConsentSheet />
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
        // Only a countdown that ran out while watched: a stale timer found
        // already past on mount, or one ending in the background, stays quiet.
        if (-remaining < 5_000 && AppState.currentState === "active") hapticSuccess();
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
      <View className="flex-row items-center justify-between" style={{ marginBottom: SPACE.md }}>
        <View className="flex-row items-center flex-1" style={{ gap: SPACE.sm }}>
          <Ionicons name="time" size={16} color={THEME.accent} />
          <Txt
            kind="caption"
            tone="muted"
            style={{ fontWeight: "700", flex: 1, minWidth: 0 }}
            numberOfLines={1}
          >
            {/* The feature name alone. The window length used to be appended
                here in brackets, but it is fixed at POST_MEAL_WINDOW_MIN and
                the live countdown sits immediately to the right, so it read as
                the same number twice on one row. */}
            {t("dashboard.quickPostMealTitle")}
          </Txt>
        </View>
        <View className="flex-row items-center" style={{ gap: SPACE.md, flexShrink: 0 }}>
          <Txt
            kind="body"
            tone="accent"
            tabular
            numberOfLines={1}
            style={{ fontWeight: "700", flexShrink: 0 }}
          >
            {countdown.seconds
              ? t("dashboard.postMealCountdownSec", { s: countdown.value })
              : t("dashboard.postMealCountdownMin", { m: countdown.value })}
          </Txt>
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
              backgroundColor: THEME.surface,
              borderWidth: 1,
              borderColor: THEME.border,
            }}
          >
            <Ionicons name="close" size={15} color={THEME.textMuted} />
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
        <View className="flex-row items-center" style={{ marginBottom: SPACE.md }}>
          <Pressable
            onPress={() => onRestart(restartEntry)}
            hitSlop={{ top: 14, bottom: 14, left: SPACE.sm, right: SPACE.sm }}
            accessibilityRole="button"
            accessibilityLabel={restartLabel}
            android_ripple={cardRipple()}
            style={{ flexDirection: "row", alignItems: "center", gap: SPACE.xs, flexShrink: 1 }}
          >
            <Ionicons name="refresh" size={13} color={THEME.textMuted} />
            {/* Two lines allowed: the longest translations ("Für die Mahlzeit um
                14:30 neu starten") do not fit one line at this size, and this is
                the only action on the row. */}
            <Txt
              kind="micro"
              tone="muted"
              style={{ fontWeight: "700", flexShrink: 1, minWidth: 0 }}
              numberOfLines={2}
            >
              {restartLabel}
            </Txt>
          </Pressable>
        </View>
      ) : actions.logMeal ? (
        <View style={{ marginBottom: SPACE.md }}>
          {/* Outlined button: the bare accent text link did not read as
              something to press. Full width (the parent stretches it). */}
          <Button
            label={t("dashboard.postMealLogMeal")}
            variant="outlined"
            onPress={onLogMeal}
            icon={<Ionicons name="restaurant-outline" size={16} color={THEME.text} />}
          />
        </View>
      ) : null}
      {/* Track edge is a token held at >= 3:1 against the card in both themes
          (scripts/theme.test.ts); the fill is the plain accent. */}
      <View
        style={{
          height: 8,
          borderRadius: 4,
          backgroundColor: THEME.track,
          borderWidth: 1,
          borderColor: THEME.trackEdge,
          overflow: "hidden",
        }}
      >
        <View
          style={{
            height: "100%",
            width: `${Math.round(progress * 100)}%`,
            backgroundColor: THEME.accent,
          }}
        />
      </View>
    </View>
  );
}
