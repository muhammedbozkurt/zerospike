import { doseHintVisible, injectionDoseOk } from "../../lib/injectionDose";
import {
  afterSaveTarget,
  cameFromToday,
  findInjectionLocation,
  SAVED_HIGHLIGHT_MS,
} from "../../lib/injectionAfterSave";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Keyboard,
  Pressable,
  ScrollView,
  SectionList,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Redirect, useFocusEffect, useRouter, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import Animated from "react-native-reanimated";

import { useApp } from "../../lib/store/AppContext";
import { useProCta } from "../../lib/proCta";
import { ProfileSwitcher } from "../../components/ProfileSwitcher";
import { DirIcon } from "../../components/DirIcon";
import { InjectionEditSheet } from "../../components/InjectionEditSheet";
import { useStepperValidity } from "../../components/Stepper";
import { NumericField } from "../../components/NumericField";
import { INJECTION_DOSE_BOUNDS } from "../../lib/numericField";
import { InlineDateTimePicker } from "../../components/InlineDateTimePicker";
import { useFeedback } from "../../components/Feedback";
import { useUndoBatch } from "../../components/useUndoBatch";
import { useEntryGuardConfirm } from "../../components/useEntryGuardConfirm";
import { keyboardAwareScrollProps } from "../../lib/keyboard";
import { listEntering, listExiting, listLayout } from "../../lib/theme/motion";
import { fitFontSize } from "../../lib/fitText";
import {
  InjectionBodyMap,
  daysSince,
  type PointSelection,
} from "../../components/InjectionBodyMap";
import type { LastPointRecord } from "../../components/InjectionSiteBoard";
import {
  getRotationCycleStart,
  startRotationCycle,
} from "../../lib/rotationCycle";
import { AppBackground, GradientCTA, IconTile } from "../../components/rich";
import { EmptyState } from "../../components/EmptyState";
import { injectionMapIsEmpty, injectionUsageTotal } from "../../lib/emptyStates";
import { Button, Card, Chip, Row, Txt } from "../../components/ui";
import type { BolusKind, Injection, InsulinType } from "../../lib/db/types";
import { BOLUS_KINDS, SELECTABLE_SITES, SITE_POINTS } from "../../lib/db/types";
import {
  getSiteUsageHistory,
  leastRecentlyUsedPoint,
  getInjections,
  logInjection,
  deleteInjection,
  pointKey,
  type RotationUsage,
} from "../../lib/db/injections";
import { captureDeletion } from "../../lib/db/undo";
import { checkDose } from "../../lib/insulin";
import { OTHER_PRODUCT_ID } from "../../lib/insulinCatalog";
import { insulinModeOf, insulinModeUsesInsulin } from "../../lib/insulinMode";
import { logCrash, logEvent } from "../../lib/analytics";
import { noteLogAndMaybeReview } from "../../lib/services/review";
import { noteFirstLog } from "../../lib/services/firstLog";
import { noteJournalActivity } from "../../lib/services/notifications";
import {
  injectionMapFlipNoticeSeen,
  markInjectionMapFlipNoticeSeen,
} from "../../lib/services/injectionMapNotice";
import { formatTime, num, relativeDay } from "../../lib/format";
import {
  groupInjectionsByDay,
  initialHistorySlice,
  type InjectionDaySection,
} from "../../lib/injectionHistory";
import { hapticSuccess, hapticWarning, hapticSelect } from "../../lib/haptics";
import {
  GLUCOSE_RICH,
  HIT_TARGET,
  INPUT_TEXT,
  RADIUS,
  SPACE,
  THEME,
  glow,
} from "../../lib/theme/tokens";
import { RIPPLE_ALPHA } from "../../lib/theme/uiPrimitives";
import { withAlpha } from "../../components/rich/GlassCard";
import { upper } from "../../lib/upper";
import { isScreenshotMode } from "../../lib/screenshotMode";
import { useLayout } from "../../lib/useLayout";
import { STACK_AT_SCALE } from "../../lib/layoutForFontScale";
import { useFontScale } from "../../lib/useFontScale";
import { injectionColumns } from "../../lib/injectionLayout";

// Heat-map / rotation usage window (days). The prompt's "last 30 days" heat map.
const USAGE_WINDOW_DAYS = 30;
// History page size (count-based paging behind the "show more" button).
const HISTORY_PAGE = 50;
// Initial history slice: the last HISTORY_INITIAL_DAYS days, capped at
// HISTORY_PAGE records - whichever boundary is hit first. No auto-loading
// scroll: "show more" fetches/reveals the next page explicitly.
const HISTORY_INITIAL_DAYS = 14;

type Segment = "save" | "map" | "history";

const inputStyle = () =>
  ({
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: THEME.border,
    backgroundColor: THEME.surface,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.md,
    minHeight: HIT_TARGET,
    color: THEME.text,
  }) as const;

const pressRipple = () =>
  ({ color: withAlpha(THEME.text, RIPPLE_ALPHA), foreground: true }) as const;

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <Txt kind="caption" tone="muted" style={{ fontWeight: "700", marginBottom: SPACE.sm }}>
      {children}
    </Txt>
  );
}

// Header row budget (pt): px-4 gutters 32 + help tile 32 + gap 10 + profile pill
// chrome (px-3 24, icon 18, name margins 12, chevron 14) + name cap + title gap 8.
const PROFILE_NAME_MAX_WIDTH = 72;
const HEADER_FIXED_WIDTH = 32 + 32 + 10 + (24 + 18 + 12 + 14 + PROFILE_NAME_MAX_WIDTH) + 8;

export default function InjectionScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width: winWidth } = useWindowDimensions();
  const router = useRouter();
  const params = useLocalSearchParams<{ compose?: string; from?: string; segment?: string; zoom?: string }>();
  const { activeProfile, isProUser, dataVersion, bumpData } = useApp();
  const proCta = useProCta(!isProUser);
  const { confirm, actionSheet, toast } = useFeedback();
  const deleteWithUndo = useUndoBatch(bumpData);
  const guardEntry = useEntryGuardConfirm();
  const { columnPad, isWide } = useLayout();
  const headerFontScale = useFontScale();
  // Large text: the title takes its own line, the actions sit under it.
  const headerStacked = headerFontScale > STACK_AT_SCALE;
  const { twoCol, gap: colGap } = injectionColumns(winWidth, isWide);

  // Which of the three faces is showing. State (form values, selected site) lives
  // at the component level, so switching segments never loses anything.
  //
  // MAP is the default: opening this tab is far more often "where should the
  // next one go / where have they been" than "write one down right now", and
  // the write path has its own entry point (the dashboard's add-record flow,
  // which arrives with ?compose and is honoured below). Seeded from the param
  // rather than corrected by an effect, so a compose deep-link opens straight
  // on the form instead of flashing the map for a frame first.
  const [segment, setSegment] = useState<Segment>(params.compose ? "save" : "map");
  // True while the form was opened from Today (dashboard quick-add): a save
  // then returns there instead of switching to the history. Seeded from the
  // params like `segment`, dropped as soon as the user wanders off the form.
  const fromTodayRef = useRef(cameFromToday(params));
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const historyListRef = useRef<SectionList<Injection, InjectionDaySection>>(null);
  const scrolledToRef = useRef<string | null>(null);
  // Two-column tablets show the map permanently on the left, so the right
  // column only toggles between the form and the history: a "map" segment
  // reads as the form there.
  const shownSegment: Segment = twoCol && segment === "map" ? "save" : segment;
  const mapVisible = twoCol || segment === "map";

  const [usage, setUsage] = useState<RotationUsage>({
    sites: [],
    noSiteCount: 0,
    legacyCount: 0,
    legacyLastUsedAt: null,
  });
  const [leastUsed, setLeastUsed] = useState<PointSelection | null>(null);
  // Flips true once loadRotation's first pass resolves. leastUsed always ends
  // up non-null once it does (the DB helper has no empty case), so gating the
  // rotation card's render on this instead of on leastUsed avoids the "-" ->
  // real value swap and the CTA button popping in after the card is already
  // on screen.
  const [rotationLoaded, setRotationLoaded] = useState(false);
  const [history, setHistory] = useState<Injection[]>([]);
  // Flips true once loadHistory's first pass resolves, so the GECMIS empty
  // state (illustration + CTA) only ever shows once there truly is no history -
  // never for the one frame before the first fetch comes back.
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyLimit, setHistoryLimit] = useState(HISTORY_PAGE);
  // False = trimmed to the last HISTORY_INITIAL_DAYS days (still capped at
  // HISTORY_PAGE); true once "show more" was pressed at least once, so every
  // fetched row is shown instead of only the ones inside that day window.
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [cycleStart, setCycleStart] = useState<string | null>(null);

  const [selected, setSelected] = useState<PointSelection | null>(null);
  const [dose, setDose] = useState(0);
  const [insulinType, setInsulinType] = useState<InsulinType>("bolus");
  const [bolusKind, setBolusKind] = useState<BolusKind | null>(null);
  const [loggedAt, setLoggedAt] = useState(new Date());
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const stepperFields = useStepperValidity();
  const [editing, setEditing] = useState<Injection | null>(null);

  const typeSeeded = useRef(false);
  // True once the dose has been hand-edited this session; while false, an
  // insulin-type switch is still allowed to prefill/clear it.
  const doseTouched = useRef(false);
  const [doseInteracted, setDoseInteracted] = useState(false);
  // True once the user has hand-picked a time this session. While false,
  // loggedAt tracks "now" on every focus (see the useFocusEffect below): the
  // tab never unmounts (freezeOnBlur), so without this a form left open from
  // the morning would silently log an evening entry under the mount-time
  // timestamp.
  const timeTouched = useRef(false);
  const dateLabels = useMemo(
    () => ({ today: t("common.today"), yesterday: t("common.yesterday") }),
    [t]
  );

  /** Switches insulin type and, unless the user already hand-edited the dose
   *  this session, pre-fills it: the profile's daily basal for basal, empty
   *  for bolus (WP3 - basal is usually a fixed daily amount). Which product
   *  the entry uses is no longer picked here (settings/profile.tsx owns that
   *  choice now) - save() reads it straight from the profile at save time. */
  const applyInsulinType = useCallback(
    (type: InsulinType) => {
      setInsulinType(type);
      if (!doseTouched.current) {
        setDose(type === "basal" ? activeProfile?.basal_daily_units ?? 0 : 0);
      }
    },
    [activeProfile]
  );

  /**
   * The rotation picture: per-region/per-point usage and the least-recently-used
   * point. Both are whole-history GROUP BY aggregates and neither depends on how
   * far the history list has been paged - they used to sit in the same loader as
   * the list, so every scroll-to-end recomputed the entire heat map and the LRU
   * scan to append twenty rows.
   *
   * The rotation-cycle stamp narrows what feeds the heat colours and the
   * least-recently-used helper. injection_logs themselves are never touched.
   */
  // Both flags are set in `finally`: a rejected read (locked or half-migrated
  // DB) used to leave them false for good, so the rotation card and the history
  // list stayed in their loading shape with no message and no retry. The screen
  // now lands on the ordinary empty state and the failure is reported once.
  const loadRotation = useCallback(async () => {
    if (!activeProfile) return;
    try {
      const cycle = await getRotationCycleStart(activeProfile.id);
      const [u, least] = await Promise.all([
        getSiteUsageHistory(activeProfile.id, USAGE_WINDOW_DAYS, cycle),
        leastRecentlyUsedPoint(activeProfile.id, cycle),
      ]);
      setCycleStart(cycle);
      setUsage(u);
      setLeastUsed(least);
    } catch (err) {
      logCrash(err, { screen: "injection", load: "rotation" });
    } finally {
      setRotationLoaded(true);
    }
  }, [activeProfile]);

  const loadHistory = useCallback(async () => {
    if (!activeProfile) return;
    try {
      const hist = await getInjections(activeProfile.id, historyLimit);
      setHistory(hist);
      if (!typeSeeded.current && hist[0]?.insulin_type) {
        applyInsulinType(hist[0].insulin_type);
        typeSeeded.current = true;
      }
    } catch (err) {
      logCrash(err, { screen: "injection", load: "history" });
    } finally {
      setHistoryLoaded(true);
    }
  }, [activeProfile, historyLimit, applyInsulinType]);

  useEffect(() => {
    loadRotation();
  }, [loadRotation, dataVersion]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory, dataVersion]);

  // Keeps the KAYDET form's time honest across a tab switch: freezeOnBlur
  // (app/(tabs)/_layout.tsx) means this screen never unmounts, so the
  // useState(new Date()) initializer only ever ran once, at first mount - a
  // form opened at 08:00 and saved at 20:00 was logging 08:00. Refreshed on
  // every focus, but only while the user has not hand-picked a time.
  useFocusEffect(
    useCallback(() => {
      if (!timeTouched.current) setLoggedAt(new Date());
    }, [])
  );

  // Same "now" refresh as the focus effect above, for the one path that never
  // triggers a focus event: freezeOnBlur keeps this screen mounted and focused
  // while switching segments, so picking a site on MAP and landing back on
  // KAYDET (or tapping the KAYDET pill directly) would otherwise keep
  // whatever loggedAt was last set at mount/focus.
  useEffect(() => {
    if (shownSegment === "save" && !timeTouched.current) setLoggedAt(new Date());
  }, [shownSegment]);

  // Quick-add "compose" deep-link (from the dashboard): open the KAYDET segment
  // so the form is front and centre. Cleared so it fires once.
  useEffect(() => {
    if (!cameFromToday(params)) return;
    fromTodayRef.current = true;
    setSegment("save");
    router.setParams({ compose: "", from: "" });
  }, [params.compose, params.from, router]);

  // Leaving the tab without saving ends the "came from Today" intent, so a
  // later direct visit and save stays in the log.
  useFocusEffect(
    useCallback(
      () => () => {
        fromTodayRef.current = false;
      },
      []
    )
  );

  useEffect(() => {
    if (!highlightId) return;
    const timer = setTimeout(() => setHighlightId(null), SAVED_HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [highlightId]);

  // One-time notice for the injection map's self-view -> observer-view flip
  // (components/InjectionBodyMap.tsx SIDE CONVENTION note): a profile that
  // already has injection history had the old left-on-left layout memorised,
  // so opening MAP shows one short toast the first time, then never again (flag
  // in lib/services/injectionMapNotice.ts). A fresh install has no history to
  // reorient from, so `history` staying empty just keeps this effect waiting -
  // checkedRef is only latched once a real (loaded, non-empty) history read has
  // decided the outcome, so a profile that logs its first entry later still
  // gets evaluated on its next visit to MAP instead of being silently skipped.
  const flipNoticeChecked = useRef(false);
  useEffect(() => {
    if (!mapVisible) return;
    if (flipNoticeChecked.current) return;
    if (!historyLoaded || history.length === 0) return;
    if (isScreenshotMode()) return;
    flipNoticeChecked.current = true;
    (async () => {
      if (await injectionMapFlipNoticeSeen()) return;
      toast(t("injectionMap.flipNotice"), "info");
      await markInjectionMapFlipNoticeSeen();
    })();
  }, [mapVisible, historyLoaded, history, t, toast]);

  // Store-screenshot navigation: ?segment=map opens the heat map (the 02-bodymap
  // shot). Only honoured behind the double lock; ignored in a normal build.
  useEffect(() => {
    if (!isScreenshotMode()) return;
    if (params.segment === "map") setSegment("map");
    else if (params.segment === "history") setSegment("history");
  }, [params.segment]);

  async function confirmDose(units: number): Promise<boolean> {
    const check = checkDose(units);
    if (check === "ok") return true;
    const first = await confirm({
      title: t("injection.doseCheckTitle", { n: num(units) }),
      message: t("injection.doseCheckBody"),
      confirmLabel: t("injection.doseCheckConfirm"),
      icon: "help-circle-outline",
    });
    if (!first) return false;
    if (check === "high") return true;
    return confirm({
      title: t("injection.doseCheckTitle", { n: num(units) }),
      message: t("injection.doseImplausibleBody"),
      confirmLabel: t("injection.doseCheckConfirm"),
      icon: "help-circle-outline",
    });
  }

  /** Gentle, non-blocking nudge when the selected point already has entries
   *  this rotation cycle AND another point is still untouched (a genuinely
   *  empty point, or every point already used, both skip this - see
   *  selectedPointCount/unusedPointCount above). Runs first in the chain: the
   *  user confirms the SITE choice itself before the dose questions below it. */
  async function confirmReusedPoint(): Promise<boolean> {
    if (!selected || selectedPointCount === 0 || unusedPointCount === 0) return true;
    return confirm({
      title: t("injection.reusedPointTitle"),
      message: t("injection.reusedPointBody", {
        count: selectedPointCount,
        remaining: unusedPointCount,
      }),
      confirmLabel: t("injection.reusedPointConfirm"),
      icon: "help-circle-outline",
    });
  }

  /** Shared post-action reset for the KAYDET form: save() and startNewCycle()
   *  both clear the same fields through this one place, so the two paths can
   *  never drift apart. */
  function resetForm() {
    setSelected(null);
    doseTouched.current = false;
    setDoseInteracted(false);
    // Re-applies the current insulinType's dose prefill rule (profile's
    // daily basal for basal, 0 for bolus) now that the "touched" flag is
    // clear again - a plain setDose(0) here made the NEXT entry start from
    // zero instead of the profile's usual basal amount.
    applyInsulinType(insulinType);
    setBolusKind(null);
    timeTouched.current = false;
    setLoggedAt(new Date());
    setNote("");
  }

  /** "Undo" on the saved toast: removes the row through the same delete path as
   *  the history (deleteInjection revokes its Apple Health sample; injections
   *  carry no stock or pen accounting, so nothing else needs reversing). */
  async function undoSaved(id: string) {
    try {
      await deleteInjection(id);
    } catch (err) {
      logCrash(err, { screen: "injection", op: "undoSaved" });
      return;
    }
    hapticSuccess();
    setHighlightId((cur) => (cur === id ? null : cur));
    bumpData();
  }

  async function save() {
    if (!activeProfile || !selected || saving || !stepperFields.allValid || !injectionDoseOk(dose)) return;
    if (!(await confirmReusedPoint())) return;
    if (!(await confirmDose(dose))) return;
    // Duplicate-entry check (lib/entryGuard.ts), run last so it never fights
    // the site/dose confirms above for the same dialog: a basal or bolus
    // record close to this one asks a plain factual "save anyway?".
    if (!(await guardEntry({ entryKind: "injection", insulinType, entryAtIso: loggedAt.toISOString() }))) {
      return;
    }
    setSaving(true);
    try {
      // Product picking moved to settings/profile.tsx (2.4): this row just
      // reads the active profile's current basal/bolus product at save time
      // rather than carrying its own pre-filled copy. A profile with no
      // product set for this type still logs the dose - same as today's
      // "Not set" behaviour, just without the picker.
      const productId =
        (insulinType === "basal"
          ? activeProfile.basal_insulin_id
          : activeProfile.bolus_insulin_id) ?? null;
      const productOther =
        productId === OTHER_PRODUCT_ID
          ? ((insulinType === "basal"
              ? activeProfile.basal_insulin_other
              : activeProfile.bolus_insulin_other) ?? null)
          : null;
      const saved = await logInjection({
        profile_id: activeProfile.id,
        site: selected.site,
        site_point: selected.point,
        dose_units: dose,
        insulin_type: insulinType,
        bolus_kind: insulinType === "bolus" ? bolusKind : null,
        insulin_product_id: productId,
        insulin_product_other: productOther,
        note: note.trim() || null,
        logged_at: loggedAt.toISOString(),
      });
      const kind = insulinType === "basal" ? "basal" : "injection";
      logEvent("log_added", { kind });
      void noteFirstLog(kind);
      void noteLogAndMaybeReview();
      void noteJournalActivity();
      hapticSuccess();
      toast(t("injection.saved"), "success", {
        label: t("common.undo"),
        onPress: () => {
          void undoSaved(saved.id);
        },
      });
      resetForm();
      bumpData();
      const target = afterSaveTarget(fromTodayRef.current);
      fromTodayRef.current = false;
      if (target === "today") {
        router.navigate("/(tabs)");
      } else {
        scrolledToRef.current = null;
        setHighlightId(saved.id);
        setSegment("history");
      }
    } finally {
      setSaving(false);
    }
  }

  // Picking a site on the map returns to the form to finish and save.
  function onMapSelect(sel: PointSelection) {
    setSelected(sel);
    setSegment("save");
  }

  /** Confirms, then stamps a new rotation cycle for this profile. Presentation
   *  only: heat colours restart from now, the log rows stay untouched.
   *  resetForm() runs AFTER the stamp is written, so the fresh loggedAt it
   *  sets is guaranteed to land after cycleStart - otherwise the very next
   *  save would log before its own cycle's window and never show on the map. */
  async function startNewCycle() {
    if (!activeProfile) return;
    const ok = await confirm({
      title: t("injection.newCycleConfirmTitle"),
      message: t("injection.newCycleConfirmBody"),
      confirmLabel: t("injection.newCycle"),
      icon: "refresh-outline",
    });
    if (!ok) return;
    await startRotationCycle(activeProfile.id);
    resetForm();
    hapticSuccess();
    toast(t("injection.newCycleStarted"), "success");
    bumpData();
  }

  // The newest stored injection with a region AND a point, for the repeat-point
  // annotation. A dose logged without a region marks no point as repeated.
  const lastRecord: LastPointRecord | null = useMemo(() => {
    const latest = history.find((h) => h.site != null && h.site_point != null);
    return latest && latest.site != null && latest.site_point != null
      ? { site: latest.site, point: latest.site_point, loggedAt: latest.logged_at }
      : null;
  }, [history]);

  // Per-point usage across the 32 selectable region x point combinations
  // (SELECTABLE_SITES x SITE_POINTS), keyed by pointKey. getSiteUsageHistory
  // already returns one row per INJECTION_SITES site (a superset of
  // SELECTABLE_SITES) with every SITE_POINTS count zero-filled, so nothing here
  // is ever actually missing - but the lookup is still driven off the fixed
  // selectable grid, not off whatever usage.sites happens to contain, so a
  // future change to that shape (e.g. only returning sites with history)
  // cannot silently break this count.
  const pointCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const site of SELECTABLE_SITES) {
      const siteUsage = usage.sites.find((s) => s.site === site);
      for (const point of SITE_POINTS) {
        counts.set(
          pointKey(site, point),
          siteUsage?.points.find((p) => p.point === point)?.count ?? 0
        );
      }
    }
    return counts;
  }, [usage]);

  // How many times the selected point was logged this rotation cycle, and how
  // many of the 32 points are still untouched - the two facts the "already
  // used" confirm and its inline note report. Never a recommendation.
  const selectedPointCount = selected
    ? pointCounts.get(pointKey(selected.site, selected.point)) ?? 0
    : 0;
  const unusedPointCount = useMemo(() => {
    let n = 0;
    pointCounts.forEach((c) => {
      if (c === 0) n++;
    });
    return n;
  }, [pointCounts]);

  // Descriptive only, never a block: the chosen point equals the last record's.
  const samePointNote = useMemo(() => {
    if (!selected || !lastRecord) return null;
    if (selected.site !== lastRecord.site || selected.point !== lastRecord.point) return null;
    const d = daysSince(lastRecord.loggedAt, Date.now());
    if (d == null) return null;
    if (d === 0) return t("injection.samePointToday");
    if (d === 1) return t("injection.samePointYesterday");
    return t("injection.samePointDays", { n: d });
  }, [selected, lastRecord, t]);

  // Fallback for samePointNote: fires only when that more specific note has
  // nothing to say, and only while the point has been used this cycle AND
  // another point is still empty (same gating as confirmReusedPoint). The two
  // notes never show at once.
  const reusedPointNote = useMemo(() => {
    if (samePointNote) return null;
    if (!selected || selectedPointCount === 0 || unusedPointCount === 0) return null;
    return t("injection.reusedPointNote", {
      count: selectedPointCount,
      remaining: unusedPointCount,
    });
  }, [samePointNote, selected, selectedPointCount, unusedPointCount, t]);

  const pointNote = samePointNote ?? reusedPointNote;

  const onDelete = useCallback(
    async (id: string) => {
      const snap = await captureDeletion("injection", id);
      await deleteWithUndo(snap, () => deleteInjection(id));
    },
    [deleteWithUndo]
  );

  const onRowLongPress = useCallback(
    (inj: Injection) => {
      actionSheet({
        actions: [
          { label: t("common.edit"), icon: "create-outline", onPress: () => setEditing(inj) },
          {
            label: t("common.delete"),
            icon: "trash-outline",
            destructive: true,
            onPress: () => {
              void onDelete(inj.id);
            },
          },
        ],
      });
    },
    [actionSheet, onDelete, t]
  );

  const selectedLabel = selected
    ? t("injection.siteWithPoint", {
        site: t(`injectionSite.${selected.site}`),
        n: selected.point,
      })
    : null;

  // The slice actually shown: trimmed to HISTORY_INITIAL_DAYS (still capped at
  // HISTORY_PAGE) until "show more" is pressed once, then everything fetched.
  const visibleHistory = useMemo(
    () =>
      historyExpanded ? history : initialHistorySlice(history, HISTORY_INITIAL_DAYS, HISTORY_PAGE),
    [history, historyExpanded]
  );

  // More exists either because the day window is still hiding rows already
  // fetched, or because the last fetch came back full (there may be older
  // rows the DB hasn't been asked for yet). Same "fetched a full page" signal
  // the old onEndReached check used.
  const hasMoreHistory =
    (!historyExpanded && visibleHistory.length < history.length) || history.length >= historyLimit;

  const showMoreHistory = useCallback(() => {
    setHistoryExpanded(true);
    setHistoryLimit((l) => l + HISTORY_PAGE);
  }, []);

  // History grouped into day sections (Today / Yesterday / weekday + date),
  // same rule as the dashboard journal, newest first.
  const sections = useMemo(
    () => groupInjectionsByDay(visibleHistory, dateLabels),
    [visibleHistory, dateLabels]
  );

  const SEGMENTS: { key: Segment; label: string }[] = [
    { key: "save", label: t("injection.segSave") },
    { key: "map", label: t("injection.segMap") },
    { key: "history", label: t("injection.segHistory") },
  ];

  const injectionRow = useCallback(
    (inj: Injection) => (
      <Pressable
        onPress={() => setEditing(inj)}
        onLongPress={() => onRowLongPress(inj)}
        android_ripple={pressRipple()}
        className="flex-row items-center rounded-xl bg-glass border border-hair px-3 py-2.5 mb-2 active:opacity-80"
        style={[
          { minHeight: HIT_TARGET },
          inj.id === highlightId
            ? { backgroundColor: withAlpha(THEME.accent, 0.14), borderColor: THEME.accent }
            : null,
        ]}
      >
        <View
          className="rounded-lg px-2 py-1"
          style={[{ backgroundColor: withAlpha(THEME.accent, 0.16) }, glow(THEME.accent, 10, 0.35)]}
        >
          <Txt kind="micro" tone="accent" tabular style={{ fontWeight: "800" }}>
            {inj.dose_units != null ? `${num(inj.dose_units)}${t("common.unitsShort")}` : "-"}
          </Txt>
        </View>
        <View className="flex-1 ml-3" style={{ minWidth: 0 }}>
          <Txt kind="caption" style={{ fontWeight: "700" }} numberOfLines={2}>
            {inj.insulin_type
              ? `${inj.insulin_type === "basal" ? t("injection.typeBasal") : t("injection.typeBolus")}${
                  inj.insulin_type === "bolus" && inj.bolus_kind
                    ? ` (${
                        inj.bolus_kind === "meal"
                          ? t("injection.bolusKindMeal")
                          : t("injection.bolusKindCorrection")
                      })`
                    : ""
                } · `
              : ""}
            {inj.site == null
              ? t("injectionSite.unassigned")
              : inj.site_point != null
                ? t("injection.siteWithPoint", { site: t(`injectionSite.${inj.site}`), n: inj.site_point })
                : t(`injectionSite.${inj.site}`)}
          </Txt>
          <Txt kind="micro" tone="muted" style={{ marginTop: 1 }}>
            {formatTime(inj.logged_at)}
            {inj.source === "calculator" ? ` · ${t("injection.fromCalculator")}` : ""}
            {inj.source === "reminder" ? ` · ${t("report.fromReminder")}` : ""}
          </Txt>
        </View>
        <DirIcon name="chevron-forward" size={16} color={THEME.textMuted} />
      </Pressable>
    ),
    [onRowLongPress, t, highlightId]
  );

  // A freshly saved row can sit below the fold (back-dated entry): bring it
  // into view once, the first time it shows up in the sections.
  useEffect(() => {
    if (!highlightId || shownSegment !== "history" || scrolledToRef.current === highlightId) return;
    const loc = findInjectionLocation(sections, highlightId);
    if (!loc) return;
    scrolledToRef.current = highlightId;
    if (loc.sectionIndex === 0 && loc.itemIndex === 0) return;
    const timer = setTimeout(() => {
      try {
        historyListRef.current?.scrollToLocation({ ...loc, viewPosition: 0.3, animated: true });
      } catch {
        // best-effort: the highlight alone still marks the row
      }
    }, 60);
    return () => clearTimeout(timer);
  }, [highlightId, sections, shownSegment]);

  const renderHistoryItem = useCallback(
    ({ item }: { item: Injection }) => <View className="px-4">{injectionRow(item)}</View>,
    [injectionRow]
  );

  const renderHistorySectionHeader = useCallback(
    ({ section }: { section: InjectionDaySection }) => (
      <View className="px-4" style={{ alignItems: "flex-start", paddingTop: SPACE.md, paddingBottom: SPACE.sm }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: SPACE.sm,
            backgroundColor: THEME.surfaceRaised,
            borderWidth: 1,
            borderColor: THEME.border,
            borderRadius: RADIUS.full,
            paddingHorizontal: SPACE.md,
            paddingVertical: SPACE.xs,
          }}
        >
          <Txt kind="micro" style={{ fontWeight: "800", letterSpacing: 0.8 }}>
            {upper(section.title)}
          </Txt>
          {section.dateLabel !== section.title ? (
            <Txt kind="micro" tone="muted">
              {section.dateLabel}
            </Txt>
          ) : null}
        </View>
      </View>
    ),
    []
  );

  // Loading vs. genuinely empty: without historyLoaded this rendered for one
  // frame on every first mount, so the empty-state illustration flashed even
  // for a profile with plenty of history (it just had not been fetched yet).
  const historyEmptyComponent = useMemo(() => {
    if (!historyLoaded) return null;
    return (
      <EmptyState
        icon="document-text-outline"
        title={t("injection.empty")}
        actionLabel={t("injection.emptyCta")}
        onAction={() => setSegment("save")}
        compact
      />
    );
  }, [historyLoaded, t]);

  const historyFooterComponent = useMemo(() => {
    if (!hasMoreHistory) return null;
    return (
      <Button
        label={t("common.showMore")}
        variant="outlined"
        size="sm"
        onPress={showMoreHistory}
        icon={<Ionicons name="chevron-down-outline" size={14} color={THEME.accent} />}
        className="mx-4 mt-1"
      />
    );
  }, [hasMoreHistory, showMoreHistory, t]);

  // Gated on rotationLoaded (not on leastUsed) so the card never shows the
  // "-" placeholder or pops its CTA button in after first paint: the DB
  // helper behind leastUsed always resolves to a real point, so once loaded
  // it never reverts to empty.
  const rotationCard = isProUser && !rotationLoaded ? null : isProUser ? (
    <Card style={{ marginBottom: SPACE.lg }}>
      <View className="flex-row items-center mb-2">
        <Ionicons name="sync-outline" size={16} color={THEME.accent} />
        <Txt style={{ fontWeight: "700", marginLeft: SPACE.sm, flexShrink: 1, minWidth: 0 }}>
          {t("injection.rotationTitle")}
        </Txt>
      </View>
      <Txt kind="micro" tone="muted">
        {t("injection.leastUsedPoint")}
      </Txt>
      <Txt kind="subtitle" style={{ fontWeight: "800", marginTop: SPACE.xs / 2 }}>
        {leastUsed
          ? t("injection.siteWithPoint", { site: t(`injectionSite.${leastUsed.site}`), n: leastUsed.point })
          : "-"}
      </Txt>
      <Txt kind="micro" tone="muted" style={{ marginTop: SPACE.sm }}>
        {t("injection.rotationDisclaimer")}
      </Txt>
      {leastUsed ? (
        <Button
          label={t("injection.useThisSite")}
          variant="outlined"
          onPress={() => {
            hapticSelect();
            onMapSelect(leastUsed);
          }}
          icon={<DirIcon name="arrow-forward-outline" size={16} color={THEME.accent} />}
          className="mt-3"
        />
      ) : null}
    </Card>
  ) : (
    <Pressable
      onPress={() => {
        hapticWarning();
        router.push({ pathname: "/paywall", params: { reason: "rotation" } });
      }}
      android_ripple={pressRipple()}
      className="rounded-2xl bg-glass border border-hair p-4 mb-4 flex-row items-center active:opacity-80"
    >
      <IconTile icon="lock-closed" size={36} radius={12} tint={THEME.textMuted} style={{ marginRight: SPACE.md }} />
      <View className="flex-1" style={{ minWidth: 0 }}>
        <Txt style={{ fontWeight: "700" }}>{t("injection.rotationTitle")}</Txt>
        <Txt kind="micro" tone="muted" style={{ marginTop: SPACE.xs / 2 }}>
          {t("paywall.limitTitleRotation")}
        </Txt>
        <Txt kind="caption" tone="accent" style={{ fontWeight: "700", marginTop: SPACE.xs }}>
          {t(proCta.key, proCta.params)}
        </Txt>
      </View>
      <View className="rounded-full bg-brand px-2 py-0.5">
        <Txt kind="micro" tone="onAccent" style={{ fontWeight: "700" }}>
          {t("common.pro")}
        </Txt>
      </View>
    </Pressable>
  );

  // Second line of defence: the tab is already hidden for a profile that does not
  // use insulin, but the route itself stays reachable (deep link, widget, an old
  // navigation entry). Placed after every hook so a mode change mid-session
  // cannot change the hook order.
  if (!insulinModeUsesInsulin(insulinModeOf(activeProfile))) {
    return <Redirect href="/(tabs)" />;
  }

  const mapEmpty = injectionMapIsEmpty({
    historyLoaded,
    historyCount: history.length,
    usageCount: injectionUsageTotal(usage),
  });

  const mapBlock = (
      <>
        <View className="mb-2">
          <InjectionBodyMap
            usage={usage.sites}
            noSiteCount={usage.noSiteCount}
            selected={selected}
            onSelect={onMapSelect}
            windowDays={USAGE_WINDOW_DAYS}
            initialZoom={params.zoom}
            cycleStart={cycleStart}
            onStartNewCycle={startNewCycle}
            showRotationHint={isProUser}
          />
        </View>
        {mapEmpty ? (
          <EmptyState
            compact
            icon="body-outline"
            title={t("emptyStates.injectionTitle")}
            subtitle={t("emptyStates.injectionBody")}
            // Two columns keep the form beside the map, so there is no segment
            // to switch to.
            actionLabel={twoCol ? undefined : t("injection.emptyCta")}
            onAction={twoCol ? undefined : () => setSegment("save")}
          />
        ) : null}
        {rotationCard}
      </>
  );

  const formBlock = (
      <>
        {/* KAYDET: the log form */}
        <Card style={{ marginBottom: SPACE.md }}>
          <Txt
            kind="micro"
            tone="muted"
            style={{ letterSpacing: 1.3, fontWeight: "800", marginBottom: SPACE.md }}
          >
            {upper(t("injection.formTitle"))}
          </Txt>
  
          {/* 1. When: defaults to now, editable, never future (WP3). */}
          <FieldLabel>{t("injection.time")}</FieldLabel>
          <Pressable
            onPress={() => {
              Keyboard.dismiss();
              setTimePickerOpen((v) => !v);
            }}
            accessibilityRole="button"
            accessibilityLabel={t("injection.time")}
            android_ripple={pressRipple()}
            className="flex-row items-center mb-4"
            style={inputStyle()}
          >
            <Ionicons name="time-outline" size={16} color={THEME.textMuted} />
            <Txt style={{ marginLeft: SPACE.sm, flexShrink: 1, minWidth: 0 }}>
              {relativeDay(loggedAt.toISOString(), {
                today: t("common.today"),
                yesterday: t("common.yesterday"),
              })}
              {" · "}
              {formatTime(loggedAt.toISOString())}
            </Txt>
          </Pressable>
          <InlineDateTimePicker
            visible={timePickerOpen}
            value={loggedAt}
            max={new Date()}
            locale={i18n.language}
            // No min={cycleStart}: a hand-picked time before the rotation
            // cycle started is still a real injection and stays logged and
            // editable - it just falls outside THIS cycle's window, so the
            // heat map and point counts read it as if it never happened
            // (correct: it is not part of the new cycle). Left unblocked
            // and unflagged rather than warned, same as any other
            // pre-cycle row.
            onChange={(d) => {
              timeTouched.current = true;
              setLoggedAt(d);
            }}
            onClose={() => setTimePickerOpen(false)}
          />
  
          {/* 2. Insulin type before dose: basal pre-fills the dose below. */}
          <FieldLabel>{t("injection.insulinType")}</FieldLabel>
          <View className="flex-row mb-4" style={{ gap: SPACE.sm }}>
            {(["basal", "bolus"] as const).map((type) => (
              <Chip
                key={type}
                label={type === "basal" ? t("injection.typeBasal") : t("injection.typeBolus")}
                selected={insulinType === type}
                onPress={() => applyInsulinType(type)}
                className="flex-1"
              />
            ))}
          </View>
  
          {/* 3. Dose: auto-filled from the profile's daily basal while on
              "basal" and not yet hand-edited this session. */}
          <FieldLabel>{t("injection.dose")}</FieldLabel>
          <NumericField
            value={dose}
            onChange={(v) => {
              if (v == null) return;
              doseTouched.current = true;
              setDoseInteracted(true);
              setDose(v);
            }}
            onValidityChange={stepperFields.reporter("dose")}
            required
            step={INJECTION_DOSE_BOUNDS.step}
            longStep={1}
            min={INJECTION_DOSE_BOUNDS.min}
            max={INJECTION_DOSE_BOUNDS.max}
            decimals={INJECTION_DOSE_BOUNDS.decimals}
            suffix={t("common.units")}
            accessibilityLabel={t("injection.dose")}
            style={{ marginBottom: doseHintVisible(injectionDoseOk(dose), doseInteracted) ? SPACE.sm : SPACE.lg }}
          />
          {doseHintVisible(injectionDoseOk(dose), doseInteracted) ? (
            <Txt kind="caption" tone="muted" style={{ marginBottom: SPACE.md }}>
              {t("basalConfirm.doseRequired")}
            </Txt>
          ) : null}
          {insulinType === "basal" && activeProfile?.basal_daily_units == null ? (
            <Row
              icon="information-circle-outline"
              label={t("injection.basalPrefillHint")}
              onPress={() => router.push("/settings/profile")}
            />
          ) : null}
  
          {/* 4. Everything below reflows smoothly when the bolus-label row
              (5.) appears or disappears above it (WP3 UI/UX rule). */}
          <Animated.View layout={listLayout}>
            {insulinType === "bolus" ? (
              <Animated.View
                entering={listEntering}
                exiting={listExiting}
                style={{ marginBottom: SPACE.lg }}
              >
                <FieldLabel>{t("injection.bolusKindLabel")}</FieldLabel>
                <View className="flex-row" style={{ gap: SPACE.sm }}>
                  {BOLUS_KINDS.map((kind) => (
                    <Chip
                      key={kind}
                      label={
                        kind === "meal"
                          ? t("injection.bolusKindMeal")
                          : t("injection.bolusKindCorrection")
                      }
                      selected={bolusKind === kind}
                      onPress={() => {
                        if (bolusKind === kind) hapticSelect();
                        setBolusKind((prev) => (prev === kind ? null : kind));
                      }}
                      className="flex-1"
                    />
                  ))}
                </View>
              </Animated.View>
            ) : null}
  
            {/* Site summary chip = the mini map preview: tap to open HARITA
                (the current selection is kept). */}
            <Pressable
              onPress={() => {
                    if (!twoCol) setSegment("map");
                  }}
              accessibilityRole="button"
              accessibilityLabel={selectedLabel ?? t("injection.chooseSitePoint")}
              android_ripple={pressRipple()}
              className="flex-row items-center rounded-xl px-3 py-2.5 mb-4 active:opacity-80"
              style={{
                minHeight: HIT_TARGET,
                borderWidth: 1,
                borderColor: selected ? withAlpha(THEME.accent, 0.4) : THEME.border,
                backgroundColor: selected ? withAlpha(THEME.accent, 0.1) : THEME.surface,
              }}
            >
              <Ionicons
                name="location-outline"
                size={15}
                color={selected ? THEME.accent : THEME.textMuted}
              />
              <Txt
                kind="caption"
                tone={selected ? "accent" : "muted"}
                style={{ fontWeight: "700", marginLeft: SPACE.sm, flex: 1, minWidth: 0 }}
                numberOfLines={1}
              >
                {selectedLabel ?? t("injection.chooseSitePoint")}
              </Txt>
              <Ionicons name="map-outline" size={16} color={THEME.accent} />
            </Pressable>
  
            {/* Repeat-point / rotation-usage annotation: descriptive only, saving
                stays possible. Amber rather than red, because red would make this
                read as an alarm from a medical device, which the app is not allowed
                to be. samePointNote (same point as the newest record) is the more
                specific signal and wins; reusedPointNote is only the fallback when
                it has nothing to say - the two never show together. */}
            {pointNote ? (
              <View
                className="flex-row items-center rounded-xl px-3 py-2"
                style={{
                  marginTop: -8,
                  marginBottom: 16,
                  borderWidth: 1,
                  borderColor: withAlpha(THEME.warning, 0.4),
                  backgroundColor: withAlpha(THEME.warning, 0.12),
                }}
              >
                <Ionicons name="alert-circle-outline" size={14} color={THEME.warning} />
                <Txt kind="micro" style={{ marginLeft: SPACE.sm, flex: 1, minWidth: 0 }}>
                  {pointNote}
                </Txt>
              </View>
            ) : null}
  
            <FieldLabel>{t("common.note")}</FieldLabel>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder={t("injection.notePlaceholder")}
              placeholderTextColor={THEME.textMuted}
              returnKeyType="done"
              style={[inputStyle(), INPUT_TEXT, { marginBottom: SPACE.lg }]}
            />
  
            <GradientCTA
              label={t("injection.logInjection")}
              disabled={!selected || saving || !stepperFields.allValid || !injectionDoseOk(dose)}
              onPress={save}
            />
          </Animated.View>
        </Card>
  
        {/* Short disclaimer under KAYDET only. Wraps to two lines on a
            narrow screen (numberOfLines={2}) rather than being clipped. */}
        <View
          className="flex-row items-start rounded-xl px-3.5 py-3"
          style={{
            borderWidth: 1,
            borderColor: withAlpha(GLUCOSE_RICH.high, 0.3),
            backgroundColor: withAlpha(GLUCOSE_RICH.high, 0.1),
          }}
        >
          <Ionicons name="medical-outline" size={15} color={GLUCOSE_RICH.high} />
          <Txt
            kind="caption"
            style={{ marginLeft: SPACE.md, flex: 1, minWidth: 0, opacity: 0.85 }}
            numberOfLines={3}
          >
            {t("disclaimer.short")}
          </Txt>
        </View>
      </>
  );

  const segmentRow = (keys: Segment[], inset: number) => (
    <View
      className="flex-row mb-2"
      style={[
        { gap: SPACE.sm, marginHorizontal: inset },
        headerStacked ? { flexDirection: "column" } : null,
      ]}
    >
      {SEGMENTS.filter((s) => keys.includes(s.key)).map((s) => (
        <Chip
          key={s.key}
          label={s.label}
          selected={shownSegment === s.key}
          onPress={() => {
            if (s.key !== "save") fromTodayRef.current = false;
            setSegment(s.key);
          }}
          className={headerStacked ? "w-full" : "flex-1"}
        />
      ))}
    </View>
  );

  const historyList = (contentStyle: ViewStyle[]) => (
          <SectionList
            ref={historyListRef}
            extraData={highlightId}
            sections={sections}
            keyExtractor={(inj) => inj.id}
            renderItem={renderHistoryItem}
            renderSectionHeader={renderHistorySectionHeader}
            stickySectionHeadersEnabled={false}
            initialNumToRender={20}
            maxToRenderPerBatch={20}
            windowSize={7}
            // Android's default (true) recycles offscreen rows; WP6 saw the sibling
            // food tab hand back blank recycled cells under the same default, so this
            // list opts out too rather than risk the same class of bug here.
            removeClippedSubviews={false}
            ListEmptyComponent={historyEmptyComponent}
            ListFooterComponent={historyFooterComponent}
            contentContainerStyle={contentStyle}
            showsVerticalScrollIndicator={false}
          />
  );

  const formScroll = (pad: ViewStyle) => (
    <ScrollView
      {...keyboardAwareScrollProps}
      contentContainerStyle={[{ paddingTop: 16, paddingBottom: insets.bottom + 32 }, pad]}
      showsVerticalScrollIndicator={false}
    >
      {shownSegment === "map" ? mapBlock : formBlock}
    </ScrollView>
  );

  return (
    <AppBackground style={{ paddingTop: insets.top }}>
      <View
        className="flex-row items-center justify-between px-4 pt-2 pb-3"
        style={headerStacked ? { flexDirection: "column", alignItems: "flex-start", gap: 8 } : undefined}
      >
        <View
          style={headerStacked ? { width: "100%" } : { flex: 1, minWidth: 0, marginRight: 8 }}
        >
          <Text
            numberOfLines={headerStacked ? undefined : 1}
            style={{
              color: THEME.text,
              fontWeight: "800",
              fontSize: fitFontSize({
                text: t("injection.title"),
                availableWidth: winWidth - HEADER_FIXED_WIDTH,
                maxSize: 24,
                minSize: 18,
                fontScale: headerFontScale,
              }),
            }}
          >
            {t("injection.title")}
          </Text>
        </View>
        <View className="flex-row items-center" style={{ gap: 10, flexShrink: 0 }}>
          <Pressable
            onPress={() => router.push("/injection-guide")}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t("injection.guideLink")}
          >
            <IconTile icon="help-circle" size={32} radius={10} />
          </Pressable>
          <ProfileSwitcher nameMaxWidth={PROFILE_NAME_MAX_WIDTH} />
        </View>
      </View>

      {twoCol ? (
        <View style={{ flex: 1, flexDirection: "row" }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <ScrollView
              {...keyboardAwareScrollProps}
              contentContainerStyle={[
                { paddingTop: 16, paddingBottom: insets.bottom + 32 },
                { paddingLeft: 16 + colGap, paddingRight: 16 + colGap },
              ]}
              showsVerticalScrollIndicator={false}
            >
              {mapBlock}
            </ScrollView>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            {segmentRow(["save", "history"], 16 + colGap)}
            {shownSegment === "history"
              ? historyList([
                  { paddingBottom: insets.bottom + 32, paddingTop: 4 },
                  { paddingLeft: colGap, paddingRight: colGap },
                ])
              : formScroll({ paddingLeft: 16 + colGap, paddingRight: 16 + colGap })}
          </View>
        </View>
      ) : (
        <>
          {segmentRow(["save", "map", "history"], 16)}
          {shownSegment === "history"
            ? historyList([{ paddingBottom: insets.bottom + 32, paddingTop: 4 }, columnPad()])
            : formScroll(columnPad(16))}
        </>
      )}


      <InjectionEditSheet
        visible={editing != null}
        injection={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          bumpData();
        }}
      />
    </AppBackground>
  );
}
