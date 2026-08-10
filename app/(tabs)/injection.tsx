import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  SectionList,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";

import { useApp } from "../../lib/store/AppContext";
import { ProfileSwitcher } from "../../components/ProfileSwitcher";
import { InjectionEditSheet } from "../../components/InjectionEditSheet";
import { Stepper } from "../../components/Stepper";
import { useFeedback } from "../../components/Feedback";
import { useUndoBatch } from "../../components/useUndoBatch";
import { keyboardAwareScrollProps } from "../../lib/keyboard";
import { TagPicker } from "../../components/TagPicker";
import {
  InjectionBodyMap,
  daysSince,
  type PointSelection,
} from "../../components/InjectionBodyMap";
import {
  InjectionSiteBoard,
  type LastPointRecord,
} from "../../components/InjectionSiteBoard";
import {
  getRotationCycleStart,
  startRotationCycle,
} from "../../lib/rotationCycle";
import {
  AppBackground,
  GlassCard,
  GradientCTA,
  IconTile,
} from "../../components/rich";
import type { Injection, InsulinType, LogTag } from "../../lib/db/types";
import {
  getSiteUsageHistory,
  leastRecentlyUsedPoint,
  getInjections,
  logInjection,
  deleteInjection,
  findRecentCalculatorBolus,
  type RotationUsage,
} from "../../lib/db/injections";
import { captureDeletion } from "../../lib/db/undo";
import { checkDose } from "../../lib/insulin";
import { logEvent } from "../../lib/analytics";
import { noteLogAndMaybeReview } from "../../lib/services/review";
import { noteJournalActivity } from "../../lib/services/notifications";
import { formatTime, num } from "../../lib/format";
import { groupInjectionsByDay, initialHistorySlice } from "../../lib/injectionHistory";
import { hapticSuccess, hapticWarning, hapticSelect } from "../../lib/haptics";
import { GLUCOSE_RICH, INPUT_TEXT, RADIUS, TABULAR, THEME, glow } from "../../lib/theme/tokens";
import { withAlpha } from "../../components/rich/GlassCard";
import { upper } from "../../lib/upper";
import { isScreenshotMode } from "../../lib/screenshotMode";
import { useLayout } from "../../lib/useLayout";

// Heat-map / rotation usage window (days). The prompt's "last 30 days" heat map.
const USAGE_WINDOW_DAYS = 30;
// History page size (count-based paging behind the "show more" button).
const HISTORY_PAGE = 50;
// Initial history slice: the last HISTORY_INITIAL_DAYS days, capped at
// HISTORY_PAGE records - whichever boundary is hit first. No auto-loading
// scroll: "show more" fetches/reveals the next page explicitly.
const HISTORY_INITIAL_DAYS = 14;

type Segment = "save" | "map" | "history";

const inputStyle = {
  borderRadius: RADIUS.md,
  borderWidth: 1,
  borderColor: THEME.border,
  backgroundColor: THEME.glass,
  paddingHorizontal: 14,
  paddingVertical: 12,
  color: THEME.ink,
} as const;

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text style={{ color: THEME.muted, fontSize: 12, fontWeight: "700", marginBottom: 6 }}>
      {children}
    </Text>
  );
}

export default function InjectionScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ compose?: string; segment?: string; zoom?: string }>();
  const { activeProfile, isProUser, dataVersion, bumpData } = useApp();
  const { confirm, actionSheet, toast } = useFeedback();
  const deleteWithUndo = useUndoBatch(bumpData);
  const { contentColumn } = useLayout();

  // Which of the three faces is showing. State (form values, selected site) lives
  // at the component level, so switching segments never loses anything.
  const [segment, setSegment] = useState<Segment>("save");

  const [usage, setUsage] = useState<RotationUsage>({
    sites: [],
    noSiteCount: 0,
    legacyCount: 0,
    legacyLastUsedAt: null,
  });
  const [leastUsed, setLeastUsed] = useState<PointSelection | null>(null);
  const [history, setHistory] = useState<Injection[]>([]);
  const [historyLimit, setHistoryLimit] = useState(HISTORY_PAGE);
  // False = trimmed to the last HISTORY_INITIAL_DAYS days (still capped at
  // HISTORY_PAGE); true once "show more" was pressed at least once, so every
  // fetched row is shown instead of only the ones inside that day window.
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [cycleStart, setCycleStart] = useState<string | null>(null);

  const [selected, setSelected] = useState<PointSelection | null>(null);
  const [dose, setDose] = useState(0);
  const [insulinType, setInsulinType] = useState<InsulinType>("bolus");
  const [note, setNote] = useState("");
  const [tags, setTags] = useState<LogTag[]>([]);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Injection | null>(null);

  const typeSeeded = useRef(false);
  const dateLabels = useMemo(
    () => ({ today: t("common.today"), yesterday: t("common.yesterday") }),
    [t]
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
  const loadRotation = useCallback(async () => {
    if (!activeProfile) return;
    const cycle = await getRotationCycleStart(activeProfile.id);
    const [u, least] = await Promise.all([
      getSiteUsageHistory(activeProfile.id, USAGE_WINDOW_DAYS, cycle),
      leastRecentlyUsedPoint(activeProfile.id, cycle),
    ]);
    setCycleStart(cycle);
    setUsage(u);
    setLeastUsed(least);
  }, [activeProfile]);

  const loadHistory = useCallback(async () => {
    if (!activeProfile) return;
    const hist = await getInjections(activeProfile.id, historyLimit);
    setHistory(hist);
    if (!typeSeeded.current && hist[0]?.insulin_type) {
      setInsulinType(hist[0].insulin_type);
      typeSeeded.current = true;
    }
  }, [activeProfile, historyLimit]);

  useEffect(() => {
    loadRotation();
  }, [loadRotation, dataVersion]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory, dataVersion]);

  // Quick-add "compose" deep-link (from the dashboard): open the KAYDET segment
  // so the form is front and centre. Cleared so it fires once.
  useEffect(() => {
    if (!params.compose) return;
    setSegment("save");
    router.setParams({ compose: "" });
  }, [params.compose, router]);

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

  /** Gentle, non-blocking nudge when a bolus the calculator already wrote sits
   *  within DOUBLE_BOLUS_WINDOW_MINUTES of this one (R10 1.4). Runs before the
   *  dose-threshold checks so the two never fight for the same dialog. */
  async function confirmDoubleBolus(): Promise<boolean> {
    if (!activeProfile) return true;
    const existing = await findRecentCalculatorBolus(activeProfile.id, new Date());
    if (!existing) return true;
    return confirm({
      title: t("injection.doubleBolusTitle", {
        n: num(existing.dose_units ?? 0),
        time: formatTime(existing.logged_at),
      }),
      message: t("injection.doubleBolusBody"),
      confirmLabel: t("injection.doubleBolusConfirm"),
      icon: "help-circle-outline",
    });
  }

  async function save() {
    if (!activeProfile || !selected || saving) return;
    const hasDose = dose > 0;
    if (insulinType === "bolus" && hasDose && !(await confirmDoubleBolus())) return;
    if (hasDose && !(await confirmDose(dose))) return;
    setSaving(true);
    try {
      await logInjection({
        profile_id: activeProfile.id,
        site: selected.site,
        site_point: selected.point,
        dose_units: hasDose ? dose : null,
        insulin_type: insulinType,
        note: note.trim() || null,
        tags,
      });
      logEvent("log_added", { kind: "insulin", source: "manual" });
      void noteLogAndMaybeReview();
      void noteJournalActivity();
      hapticSuccess();
      toast(t("injection.saved"), "success");
      setSelected(null);
      setDose(0);
      setNote("");
      setTags([]);
      bumpData();
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
   *  only: heat colours restart from now, the log rows stay untouched. */
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

  async function onDelete(id: string) {
    const snap = await captureDeletion("injection", id);
    await deleteWithUndo(snap, () => deleteInjection(id));
  }

  function onRowLongPress(inj: Injection) {
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
  }

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

  function showMoreHistory() {
    setHistoryExpanded(true);
    setHistoryLimit((l) => l + HISTORY_PAGE);
  }

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

  const injectionRow = (inj: Injection) => (
    <Pressable
      onPress={() => setEditing(inj)}
      onLongPress={() => onRowLongPress(inj)}
      className="flex-row items-center rounded-xl bg-glass border border-hair px-3 py-2.5 mb-2 active:opacity-80"
    >
      <View
        className="rounded-lg px-2 py-1"
        style={[{ backgroundColor: withAlpha(THEME.accent, 0.16) }, glow(THEME.accent, 10, 0.35)]}
      >
        <Text style={[TABULAR, { color: THEME.accent, fontWeight: "800", fontSize: 11 }]}>
          {inj.dose_units != null ? `${num(inj.dose_units)}${t("common.unitsShort")}` : "-"}
        </Text>
      </View>
      <View className="flex-1 ml-3">
        <Text
          style={{ color: THEME.ink, fontSize: 13, fontWeight: "700" }}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.85}
        >
          {inj.insulin_type
            ? `${inj.insulin_type === "basal" ? t("injection.typeBasal") : t("injection.typeBolus")} · `
            : ""}
          {inj.site == null
            ? t("injectionSite.unassigned")
            : inj.site_point != null
              ? t("injection.siteWithPoint", { site: t(`injectionSite.${inj.site}`), n: inj.site_point })
              : t(`injectionSite.${inj.site}`)}
        </Text>
        <Text style={{ color: THEME.muted, fontSize: 11, marginTop: 1 }}>
          {formatTime(inj.logged_at)}
          {inj.source === "calculator" ? ` · ${t("injection.fromCalculator")}` : ""}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={THEME.muted} />
    </Pressable>
  );

  const rotationCard = isProUser ? (
    <GlassCard style={{ marginBottom: 16 }}>
      <View className="flex-row items-center mb-2">
        <Ionicons name="sync-outline" size={16} color={THEME.accent} />
        <Text style={{ color: THEME.ink, fontWeight: "700", marginLeft: 8 }}>
          {t("injection.rotationTitle")}
        </Text>
      </View>
      <Text style={{ color: THEME.muted, fontSize: 11 }}>{t("injection.leastUsedPoint")}</Text>
      <Text style={{ color: THEME.ink, fontSize: 18, fontWeight: "800", marginTop: 2 }}>
        {leastUsed
          ? t("injection.siteWithPoint", { site: t(`injectionSite.${leastUsed.site}`), n: leastUsed.point })
          : "-"}
      </Text>
      <Text style={{ color: THEME.muted, fontSize: 11, lineHeight: 16, marginTop: 8 }}>
        {t("injection.rotationDisclaimer")}
      </Text>
      {leastUsed ? (
        <Pressable
          onPress={() => {
            hapticSelect();
            onMapSelect(leastUsed);
          }}
          className="flex-row items-center justify-center rounded-xl py-2.5 mt-3"
          style={{ backgroundColor: withAlpha(THEME.accent, 0.15) }}
        >
          <Ionicons name="arrow-forward-outline" size={16} color={THEME.accent} />
          <Text style={{ color: THEME.accent, fontWeight: "700", marginLeft: 8, fontSize: 13 }}>
            {t("injection.useThisSite")}
          </Text>
        </Pressable>
      ) : null}
    </GlassCard>
  ) : (
    <Pressable
      onPress={() => {
        hapticWarning();
        router.push({ pathname: "/paywall", params: { reason: "rotation" } });
      }}
      className="rounded-2xl bg-glass border border-hair p-4 mb-4 flex-row items-center active:opacity-80"
    >
      <IconTile icon="lock-closed" size={36} radius={12} tint={THEME.muted} style={{ marginRight: 12 }} />
      <View className="flex-1">
        <Text style={{ color: THEME.ink, fontWeight: "700" }}>{t("injection.rotationTitle")}</Text>
        <Text style={{ color: THEME.muted, fontSize: 11, marginTop: 2 }}>
          {t("paywall.limitTitleRotation")}
        </Text>
      </View>
      <View className="rounded-full bg-brand px-2 py-0.5">
        <Text className="text-black text-[10px] font-bold">{t("common.pro")}</Text>
      </View>
    </Pressable>
  );

  return (
    <AppBackground style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center justify-between px-4 pt-2 pb-3">
        <Text style={{ color: THEME.ink, fontSize: 24, fontWeight: "800" }}>
          {t("injection.title")}
        </Text>
        <View className="flex-row items-center" style={{ gap: 10 }}>
          <Pressable
            onPress={() => router.push("/injection-guide")}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t("injection.guideLink")}
            className="flex-row items-center"
            style={{ gap: 6 }}
          >
            <IconTile icon="help-circle" size={32} radius={10} />
            <Text style={{ color: THEME.muted, fontSize: 11, fontWeight: "700" }}>
              {t("injection.guideLinkLabel")}
            </Text>
          </Pressable>
          <ProfileSwitcher />
        </View>
      </View>

      {/* Segment control: KAYDET / HARITA / GECMIS */}
      <View
        className="flex-row rounded-full border border-hair mx-4 mb-2 p-1"
        style={{ backgroundColor: THEME.glass }}
      >
        {SEGMENTS.map((s) => {
          const on = segment === s.key;
          return (
            <Pressable
              key={s.key}
              onPress={() => {
                hapticSelect();
                setSegment(s.key);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={s.label}
              className="flex-1 items-center rounded-full py-2"
              style={{ backgroundColor: on ? THEME.accent : "transparent" }}
            >
              <Text style={{ color: on ? "#00171c" : THEME.muted, fontWeight: "800", fontSize: 12 }}>
                {upper(s.label)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {segment === "history" ? (
        <SectionList
          sections={sections}
          keyExtractor={(inj) => inj.id}
          renderItem={({ item }) => <View className="px-4">{injectionRow(item)}</View>}
          renderSectionHeader={({ section }) => (
            <View className="px-4" style={{ alignItems: "flex-start", paddingTop: 10, paddingBottom: 6 }}>
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
          )}
          stickySectionHeadersEnabled={false}
          initialNumToRender={20}
          maxToRenderPerBatch={20}
          windowSize={7}
          ListEmptyComponent={
            <View className="items-center py-12">
              <Ionicons name="document-text-outline" size={36} color={THEME.muted} />
              <Text style={{ color: THEME.muted, textAlign: "center", marginTop: 8 }}>
                {t("injection.empty")}
              </Text>
              <Pressable
                onPress={() => setSegment("save")}
                accessibilityRole="button"
                accessibilityLabel={t("injection.emptyCta")}
                className="flex-row items-center rounded-full mt-4 px-4 py-2.5 active:opacity-80"
                style={{
                  borderWidth: 1,
                  borderColor: withAlpha(THEME.accent, 0.3),
                  backgroundColor: withAlpha(THEME.accent, 0.12),
                }}
              >
                <Ionicons name="add-circle-outline" size={15} color={THEME.accent} />
                <Text style={{ color: THEME.accent, fontWeight: "800", fontSize: 12, marginLeft: 6 }}>
                  {t("injection.emptyCta")}
                </Text>
              </Pressable>
            </View>
          }
          ListFooterComponent={
            hasMoreHistory ? (
              <Pressable
                onPress={showMoreHistory}
                accessibilityRole="button"
                accessibilityLabel={t("common.showMore")}
                className="flex-row items-center justify-center rounded-full mx-4 mt-1 py-2.5 active:opacity-80"
                style={{
                  borderWidth: 1,
                  borderColor: withAlpha(THEME.accent, 0.3),
                  backgroundColor: withAlpha(THEME.accent, 0.12),
                }}
              >
                <Ionicons name="chevron-down-outline" size={14} color={THEME.accent} />
                <Text style={{ color: THEME.accent, fontWeight: "800", fontSize: 12, marginLeft: 6 }}>
                  {upper(t("common.showMore"))}
                </Text>
              </Pressable>
            ) : null
          }
          contentContainerStyle={[{ paddingBottom: insets.bottom + 32, paddingTop: 4 }, contentColumn]}
          showsVerticalScrollIndicator={false}
        />
      ) : (
        <ScrollView
          {...keyboardAwareScrollProps}
          contentContainerStyle={[{ padding: 16, paddingBottom: insets.bottom + 32 }, contentColumn]}
          showsVerticalScrollIndicator={false}
        >
          {segment === "map" ? (
            <>
              <View className="mb-2">
                {isScreenshotMode() ? (
                  // Store screenshots keep the approved silhouette shot (02-bodymap).
                  <InjectionBodyMap
                    usage={usage.sites}
                    selected={selected}
                    onSelect={onMapSelect}
                    windowDays={USAGE_WINDOW_DAYS}
                    initialZoom={params.zoom}
                  />
                ) : (
                  <InjectionSiteBoard
                    usage={usage.sites}
                    selected={selected}
                    onSelect={onMapSelect}
                    windowDays={USAGE_WINDOW_DAYS}
                    cycleStart={cycleStart}
                    onStartNewCycle={startNewCycle}
                    lastRecord={lastRecord}
                    recent={history}
                    legacyCount={usage.legacyCount}
                    legacyLastUsedAt={usage.legacyLastUsedAt}
                    noSiteCount={usage.noSiteCount}
                  />
                )}
              </View>
              {rotationCard}
            </>
          ) : (
            <>
              {/* KAYDET: the log form */}
              <GlassCard style={{ marginBottom: 12 }}>
                <Text
                  style={{
                    color: THEME.muted,
                    fontSize: 11,
                    letterSpacing: 1.3,
                    fontWeight: "800",
                    marginBottom: 10,
                  }}
                >
                  {upper(t("injection.formTitle"))}
                </Text>

                {/* Site summary chip = the mini map preview: tap to open HARITA
                    (the current selection is kept). */}
                <Pressable
                  onPress={() => setSegment("map")}
                  accessibilityRole="button"
                  accessibilityLabel={selectedLabel ?? t("injection.chooseSitePoint")}
                  className="flex-row items-center rounded-xl px-3 py-2.5 mb-4 active:opacity-80"
                  style={{
                    borderWidth: 1,
                    borderColor: selected ? withAlpha(THEME.accent, 0.4) : THEME.border,
                    backgroundColor: selected ? withAlpha(THEME.accent, 0.1) : THEME.glass,
                  }}
                >
                  <Ionicons
                    name="location-outline"
                    size={15}
                    color={selected ? THEME.accent : THEME.muted}
                  />
                  <Text
                    style={{
                      color: selected ? THEME.accent : THEME.muted,
                      fontSize: 13,
                      fontWeight: "700",
                      marginLeft: 8,
                      flex: 1,
                    }}
                    numberOfLines={1}
                  >
                    {selectedLabel ?? t("injection.chooseSitePoint")}
                  </Text>
                  <Ionicons name="map-outline" size={16} color={THEME.accent} />
                </Pressable>

                {/* Repeat-point annotation: descriptive only, saving stays possible. */}
                {samePointNote ? (
                  <View
                    className="flex-row items-center rounded-xl px-3 py-2"
                    style={{
                      marginTop: -8,
                      marginBottom: 16,
                      borderWidth: 1,
                      borderColor: withAlpha(THEME.accent, 0.25),
                      backgroundColor: withAlpha(THEME.accent, 0.08),
                    }}
                  >
                    <Ionicons name="information-circle-outline" size={14} color={THEME.accent} />
                    <Text
                      style={{ color: THEME.ink, fontSize: 11, lineHeight: 15, marginLeft: 8, flex: 1 }}
                    >
                      {samePointNote}
                    </Text>
                  </View>
                ) : null}

                <FieldLabel>{t("injection.dose")}</FieldLabel>
                <Stepper
                  value={dose}
                  onChange={setDose}
                  step={0.5}
                  longStep={1}
                  min={0}
                  max={150}
                  decimals={1}
                  suffix={t("common.units")}
                  accessibilityLabel={t("injection.dose")}
                  style={{ marginBottom: 16 }}
                />

                <FieldLabel>{t("injection.insulinType")}</FieldLabel>
                <View className="flex-row mb-4" style={{ gap: 8 }}>
                  {(["basal", "bolus"] as const).map((type) => {
                    const on = insulinType === type;
                    return (
                      <Pressable
                        key={type}
                        onPress={() => {
                          hapticSelect();
                          setInsulinType(type);
                        }}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                        className="flex-1 items-center rounded-xl px-3 py-2.5"
                        style={[
                          {
                            borderWidth: 1,
                            borderColor: on ? THEME.accent : THEME.border,
                            backgroundColor: on ? withAlpha(THEME.accent, 0.12) : THEME.glass,
                          },
                          on ? glow(THEME.accent, 12, 0.35) : undefined,
                        ]}
                      >
                        <Text style={{ color: on ? THEME.accent : THEME.muted, fontWeight: on ? "800" : "600" }}>
                          {type === "basal" ? t("injection.typeBasal") : t("injection.typeBolus")}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <FieldLabel>{t("common.note")}</FieldLabel>
                <TextInput
                  value={note}
                  onChangeText={setNote}
                  placeholder={t("injection.notePlaceholder")}
                  placeholderTextColor="rgba(137,163,176,0.7)"
                  returnKeyType="done"
                  style={[inputStyle, INPUT_TEXT, { marginBottom: 16 }]}
                />

                <TagPicker value={tags} onChange={setTags} className="mb-4" />

                <GradientCTA
                  label={t("injection.logInjection")}
                  disabled={!selected || saving}
                  onPress={save}
                />
              </GlassCard>

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
                <Text
                  style={{ color: THEME.ink, fontSize: 12, lineHeight: 17, marginLeft: 10, flex: 1, opacity: 0.85 }}
                  numberOfLines={2}
                >
                  {t("disclaimer.short")}
                </Text>
              </View>
            </>
          )}
        </ScrollView>
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
