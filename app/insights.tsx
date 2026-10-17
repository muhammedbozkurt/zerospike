import React, { useEffect, useMemo, useState } from "react";
import {
  I18nManager,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { useApp } from "../lib/store/AppContext";
import { listSugarLogs, listMealLogs } from "../lib/db/logs";
import { getInjections } from "../lib/db/injections";
import { getFood } from "../lib/db/foods";
import {
  getHealthSyncEnabled,
  readHealthSummary,
  type HealthSummary,
} from "../lib/services/health";
import type { Injection, Lang, MealLog, SugarLog } from "../lib/db/types";
import { foodName } from "../lib/db/types";
import { formatGlucose, glucoseUnitLabel, VERY_HIGH_MGDL } from "../lib/glucose";
import { targetBandFor } from "../lib/agpChart";
import { AGP_MIN_READINGS, computeAgp } from "../lib/agp";
import {
  computeInsights,
  dailyAverages,
  derivePatterns,
  trendVsPrevious,
  windowPercentiles,
  weeklyDigest,
  FREE_INSIGHTS_WINDOW,
  GMI_MIN_READINGS,
  GMI_MIN_SPAN_DAYS,
  INSIGHTS_WINDOW_DAYS,
  INSIGHTS_WINDOWS,
  rangeFromWindow,
  rangeWindowDays,
  type DateRange,
  type DayKind,
  type InsightPattern,
  type WeeklySentence,
} from "../lib/insights";
import {
  weekAnchorForLang,
  weeklyComparison,
  hourBandAverages,
  bestDayAndStreaks,
  DAY_IN_TARGET_TIR_PCT,
  mealResponseSummary,
  cvTrend,
  CV_TREND_MIN_WEEKS,
} from "../lib/insightsPro";
import { insulinModeUsesInsulin } from "../lib/insulinMode";
import { useLayout } from "../lib/useLayout";
import { DateRangePicker, type PickedRange } from "../components/DateRangePicker";
import {
  closeLtrIsolate,
  formatDate,
  isolateLtr,
  openLtrIsolate,
  stripBidiMarks,
} from "../lib/format";
import { isScreenshotMode } from "../lib/screenshotMode";
import { maybeRequestReview } from "../lib/services/review";
import { getTrialStatus } from "../lib/services/purchases";
import { ChartCard } from "../components/charts/ChartCard";
import { HourlyChart } from "../components/charts/HourlyChart";
import { TrendChart } from "../components/charts/TrendChart";
import { CHART, CHART_HEIGHT } from "../components/charts/theme";
import { StatCard } from "../components/StatCard";
import { Sparkline } from "../components/Sparkline";
import { ScreenHeader } from "../components/ScreenHeader";
import { DirIcon } from "../components/DirIcon";
import { Skeleton } from "../components/Skeleton";
import { useFeedback } from "../components/Feedback";
import { logEvent } from "../lib/analytics";
import { formatLocale, num, pct, pctParts } from "../lib/format";
import { useProCta } from "../lib/proCta";
import {
  AppBackground,
  GlassCard,
  GlucoseChip,
  GradientAreaChart,
  GradientCTA,
  IconTile,
  TIRDonut,
  tirSegments,
  withAlpha,
} from "../components/rich";
import { GLUCOSE_RICH, RADIUS, TABULAR, THEME, glow } from "../lib/theme/tokens";
import { upper } from "../lib/upper";

const GREEN = GLUCOSE_RICH.target;
const AMBER = GLUCOSE_RICH.high;
const BRAND = THEME.accent;

/** A hung native HealthKit call must not leave the Health card's own
 *  skeleton spinning forever - it settles to "no data" instead. */
const HEALTH_TIMEOUT_MS = 6000;

/** Two points make a line; one is just a dot. */
const TREND_MIN_DAYS = 2;

/** Gutter between the two card columns on a wide screen. */
const GRID_GAP = 12;
/** Cap for the two-column report. Wider than the single reading column
 *  (lib/useLayout) because it holds two of them: each column then lands near a
 *  phone's card width instead of a stretched half-screen. */
const GRID_MAX_WIDTH = 1040;

/**
 * The report's card flow. On a phone it renders its children exactly as they
 * were written (a fragment, no wrapper); on a tablet it deals them into two
 * equal columns, alternating, so the cards stop being one endless stretched
 * strip. Each child is one card: a card that is really a titled group keeps its
 * parts together by staying a single keyed fragment.
 */
function CardGrid({
  isWide,
  children,
}: {
  isWide: boolean;
  children: React.ReactNode;
}) {
  if (!isWide) return <>{children}</>;
  const cards = React.Children.toArray(children);
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: GRID_GAP }}>
      <View style={{ flex: 1 }}>{cards.filter((_, i) => i % 2 === 0)}</View>
      <View style={{ flex: 1 }}>{cards.filter((_, i) => i % 2 === 1)}</View>
    </View>
  );
}

function Seg({ pct, color }: { pct: number; color: string }) {
  if (pct <= 0) return null;
  return <View style={{ width: `${pct}%`, backgroundColor: color }} className="h-full" />;
}

/** "0" -> "00", "13" -> "13". Only for the heat strip's hour labels (00-24),
 *  which are physical clock digits, never translated - see lib/format's own
 *  private `two()` for the same rule applied to dates/times. */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/**
 * Bucket color for the hour-band heat strip, mirroring lib/glucose.ts's
 * classifyGlucose boundaries (low / in-range / elevated up to +25% over the
 * band ceiling / veryHigh at the fixed clinical threshold) without needing a
 * PeriodTag + full TargetProfile - a 3-hour pooled AVERAGE is not a single
 * reading classified against a meal-specific range, just a value read
 * against the profile's own day-wide band (same `band` the AGP/hourly charts
 * already shade against).
 */
function heatColor(avg: number, band: { low: number; high: number }): string {
  if (avg < band.low) return GLUCOSE_RICH.low;
  if (avg <= band.high) return GLUCOSE_RICH.target;
  if (avg >= VERY_HIGH_MGDL) return GLUCOSE_RICH.veryHigh;
  if (avg <= band.high * 1.25) return GLUCOSE_RICH.high;
  return GLUCOSE_RICH.wellAbove;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Text className="text-xs font-semibold tracking-wider text-mut mt-5 mb-2 px-1.5">
      {typeof children === "string" ? upper(children) : children}
    </Text>
  );
}

const SLICES: DayKind[] = ["night", "morning", "afternoon", "evening"];

/** A StatCard-shaped placeholder: same container (rounded-2xl p-4, glass fill
 *  + hairline border) and label row as the real StatCard, so a card never
 *  resizes when the real value replaces the skeleton bar. `footnote` reserves
 *  the second line for the cards that carry one (readings, and avg/TIR once
 *  premium adds their trend line). */
function StatCardSkeleton({ label, footnote }: { label: string; footnote?: boolean }) {
  return (
    <View
      className="rounded-2xl p-4"
      style={{ flex: 1, backgroundColor: THEME.glass, borderWidth: 1, borderColor: THEME.border }}
    >
      <View className="flex-row items-center mb-1">
        <Text
          className="text-[11px] font-semibold tracking-wider text-mut"
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.75}
        >
          {upper(label)}
        </Text>
      </View>
      <View className="flex-row items-end">
        <Skeleton width={56} height={28} radius={6} />
      </View>
      {footnote ? (
        <View style={{ marginTop: 4 }}>
          <Skeleton width={64} height={11} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Loading placeholder for the whole report. It reuses the real card shells
 * (GlassCard / ChartCard) and every STATIC label (section titles, StatCard
 * captions, axis ticks) exactly as the real cards render them - only the
 * data-derived parts (values, curves, the donut) are skeletonised - so the
 * swap from this to the real report lands on the same card heights instead
 * of resizing the page under the user. `premium` and `showsInjections` are
 * both known before the fetch resolves (profile + entitlement, not data), so
 * the sections that will actually appear are the ones skeletonised here.
 */
function InsightsSkeleton({
  isWide,
  premium,
  showsInjections,
}: {
  isWide: boolean;
  premium: boolean;
  showsInjections: boolean;
}) {
  const { t } = useTranslation();
  return (
    <CardGrid isWide={isWide}>
      {/* Time in range */}
      <GlassCard key="tir" glow={GREEN} style={{ marginBottom: 10 }}>
        <View className="flex-row items-center justify-between mb-1">
          <Text
            style={{ color: THEME.muted, fontSize: 11, letterSpacing: 1.3, fontWeight: "800" }}
          >
            {upper(t("insights.timeInRange"))}
          </Text>
          <Skeleton width={48} height={20} radius={RADIUS.full} />
        </View>
        <View className="flex-row items-center">
          <Skeleton width={104} height={104} radius={52} />
          <View style={{ flex: 1, marginLeft: 16, gap: 6 }}>
            {(
              [GLUCOSE_RICH.low, GLUCOSE_RICH.target, GLUCOSE_RICH.high, GLUCOSE_RICH.veryHigh] as const
            ).map((color, i) => (
              <View key={i} className="flex-row items-center">
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
                <View style={{ flex: 1, marginLeft: 8 }}>
                  <Skeleton height={12} />
                </View>
              </View>
            ))}
          </View>
        </View>
        <View style={{ marginTop: 10 }}>
          <Skeleton width="60%" height={11} />
        </View>
      </GlassCard>

      {/* AGP gradient curve */}
      <GlassCard key="agp" style={{ marginBottom: 10 }}>
        <Text
          style={{ color: THEME.muted, fontSize: 11, letterSpacing: 1.3, fontWeight: "800", marginBottom: 8 }}
        >
          {upper(t("insights.agpTitle"))}
        </Text>
        <Skeleton height={84} radius={RADIUS.md} />
        {/* Hour axis: physically LTR always (00 -> 24 left to right), same
            fixed-order lock as TimeInRangeBar - it mirrors the SVG curve
            above, which never mirrors either. */}
        <View
          className="justify-between mt-1"
          style={{ flexDirection: I18nManager.isRTL ? "row-reverse" : "row" }}
        >
          {["00", "06", "12", "18", "24"].map((h) => (
            <Text key={h} style={{ color: THEME.muted, fontSize: 10 }}>
              {h}
            </Text>
          ))}
        </View>
        <View style={{ marginTop: 6 }}>
          <Skeleton width="80%" height={11} />
        </View>
      </GlassCard>

      {/* StatCard strip */}
      <React.Fragment key="stats">
        <View className="flex-row" style={{ gap: 8 }}>
          <StatCardSkeleton label={t("insights.gmi")} />
          <StatCardSkeleton label={t("insights.avgGlucose")} footnote={premium} />
        </View>
        <View className="flex-row mt-2" style={{ gap: 8 }}>
          <StatCardSkeleton label={t("insights.timeInRange")} footnote={premium} />
          <StatCardSkeleton label={t("insights.readings")} footnote />
        </View>
        <View style={{ marginTop: 8, paddingHorizontal: 6 }}>
          <Skeleton width="90%" height={11} />
        </View>
      </React.Fragment>

      {premium ? (
        <ChartCard
          key="trend"
          title={t("insights.chartTrendTitle")}
          subtitle={t("insights.chartTrendSub")}
          height={CHART_HEIGHT.trend}
        >
          {(w) => <Skeleton width={w} height={CHART_HEIGHT.trend} radius={RADIUS.md} />}
        </ChartCard>
      ) : null}

      {premium ? (
        <GlassCard key="pctile" style={{ marginTop: 12 }}>
          <Text style={{ color: THEME.ink, fontWeight: "800" }}>
            {t("insights.percentileTitle")}
          </Text>
          <Text style={{ color: THEME.muted, fontSize: 11, marginBottom: 12 }}>
            {t("insights.percentileSub")}
          </Text>
          <View className="flex-row justify-between">
            {(["p05", "p25", "median", "p75", "p95"] as const).map((k) => (
              <View key={k} className="items-center flex-1">
                <Skeleton width={36} height={15} />
                <View style={{ marginTop: 2 }}>
                  <Text style={{ color: THEME.muted, fontSize: 10 }}>{t(`insights.${k}`)}</Text>
                </View>
              </View>
            ))}
          </View>
        </GlassCard>
      ) : null}

      {premium ? (
        <React.Fragment key="vitals">
          <View className="flex-row mt-3" style={{ gap: 8 }}>
            <StatCardSkeleton label={t("insights.fasting")} />
            <StatCardSkeleton label={t("insights.postMeal")} />
          </View>
          <View className="flex-row mt-2" style={{ gap: 8 }}>
            <StatCardSkeleton label={t("insights.variability")} />
            <StatCardSkeleton label={t("insights.cv")} />
            <StatCardSkeleton label={t("insights.lows")} />
          </View>
          <View style={{ marginTop: 8, paddingHorizontal: 6 }}>
            <Skeleton width="95%" height={11} />
          </View>
        </React.Fragment>
      ) : null}

      {premium ? (
        <ChartCard key="hourly" title={t("insights.hourlyTitle")} height={CHART_HEIGHT.hourly}>
          {(w) => <Skeleton width={w} height={CHART_HEIGHT.hourly} radius={RADIUS.md} />}
        </ChartCard>
      ) : null}

      {premium && showsInjections ? (
        <React.Fragment key="injections">
          <SectionTitle>{t("injection.title")}</SectionTitle>
          <View className="flex-row" style={{ gap: 8 }}>
            <StatCardSkeleton label={t("insights.injectionsCount")} />
            <StatCardSkeleton label={t("insights.avgDose")} />
          </View>
        </React.Fragment>
      ) : null}
    </CardGrid>
  );
}

/**
 * Insights, rebuilt to the mockup's composition: the window as a chip in the
 * header, a time-in-range DONUT as the hero, a gradient AGP area curve under it,
 * then a strip of StatCards. Everything below that (trend, hourly, percentiles,
 * injections, Health) is supporting detail, in that order.
 *
 * Every figure is descriptive: it reports what the user logged. Time in range is
 * measured against the user's OWN target band, not a fixed 70-180 rectangle.
 */
export default function InsightsScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const router = useRouter();
  const { activeProfile, isProUser, dataVersion } = useApp();
  const proCta = useProCta(!isProUser);
  const { isWide } = useLayout();
  const { actionSheet } = useFeedback();
  const rtl = I18nManager.isRTL;
  // Tablet: the report is centred and capped instead of stretching edge to edge.
  const bodyColumn: ViewStyle | undefined = isWide
    ? { width: "100%", maxWidth: GRID_MAX_WIDTH, alignSelf: "center" }
    : undefined;
  const unit = activeProfile?.glucose_unit ?? "mgdl";
  const fmtG = (mgdl: number | null) =>
    mgdl == null ? "-" : formatGlucose(mgdl, unit);

  // The band every figure on this screen is measured against: the profile's own.
  const band = useMemo(() => targetBandFor(activeProfile ?? {}), [activeProfile]);
  const tirBand = useMemo(() => ({ low: band.low, high: band.high }), [band]);

  // Optional ?window=7|14|30 (e.g. from the dashboard "This week" card).
  // ?custom=1 is store-screenshot-only: preselects a custom range for the shot.
  const { window: windowParam, custom: customParam } = useLocalSearchParams<{
    window?: string;
    custom?: string;
  }>();
  const initialWindow = (INSIGHTS_WINDOWS as readonly number[]).includes(
    Number(windowParam)
  )
    ? Number(windowParam)
    : isProUser
      ? INSIGHTS_WINDOW_DAYS
      : FREE_INSIGHTS_WINDOW;

  const [loading, setLoading] = useState(true);
  const [windowDays, setWindowDays] = useState<number>(initialWindow);
  // Optional custom "from-to" window (Pro). When set it overrides windowDays for
  // every chart via the range-aware compute functions.
  const [customRange, setCustomRange] = useState<DateRange | null>(null);
  const [rangePickerOpen, setRangePickerOpen] = useState(false);
  const range = customRange ?? undefined;

  // Whether this view happens inside a free trial, for the funnel event. Null
  // until known, so the event below goes out once, with the real answer.
  const [duringTrial, setDuringTrial] = useState<boolean | null>(null);
  useEffect(() => {
    if (!isProUser) {
      setDuringTrial(false);
      return;
    }
    let alive = true;
    void getTrialStatus().then((s) => {
      if (alive) setDuringTrial(s?.active === true);
    });
    return () => {
      alive = false;
    };
  }, [isProUser]);

  useEffect(() => {
    if (duringTrial === null) return;
    logEvent("insights_view", {
      range_days: customRange ? rangeWindowDays(customRange) : windowDays,
      during_trial: duringTrial,
    });
  }, [windowDays, customRange, duringTrial]);

  // Store-screenshot: preselect a 21-day custom range so the header chip shows a
  // "from - to" label for the 05-insights shot. Double-locked; ignored otherwise.
  useEffect(() => {
    if (!isScreenshotMode() || customParam !== "1") return;
    const end = Date.now();
    setCustomRange({ start: end - 21 * 86_400_000, end });
  }, [customParam]);

  const [sugar, setSugar] = useState<SugarLog[]>([]);
  const [meals, setMeals] = useState<MealLog[]>([]);
  const [injections, setInjections] = useState<Injection[]>([]);

  /**
   * The span the three queries below are allowed to read.
   *
   * The window selector recomputes locally with no reload, so one fetch has to
   * cover every window the user can switch to WITHOUT a refetch - the widest
   * shortcut (90 days) and the previous equal-length window `trendVsPrevious`
   * compares it against, hence 2x. That is the honest upper bound, and it was
   * missing entirely: all three tables were read with no date filter at all, so a
   * profile with years of history pulled 2000 rows of it on every open to compute
   * figures that can only ever look back six months.
   *
   * A custom range (Pro) can point anywhere, so it extends the span by its own
   * length on the leading side for the same trend comparison.
   */
  const fetchRange = useMemo<DateRange>(() => {
    const now = Date.now();
    const widest = Math.max(...INSIGHTS_WINDOWS);
    let start = now - 2 * widest * 86_400_000;
    let end = now;
    if (customRange) {
      const span = Math.max(0, customRange.end - customRange.start);
      start = Math.min(start, customRange.start - span);
      end = Math.max(end, customRange.end);
    }
    return { start, end };
  }, [customRange]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!activeProfile) {
        setLoading(false);
        return;
      }
      const [s, m, inj] = await Promise.all([
        listSugarLogs(activeProfile.id, 2000, fetchRange),
        listMealLogs(activeProfile.id, 2000, fetchRange),
        getInjections(activeProfile.id, 2000, fetchRange),
      ]);
      if (!alive) return;
      setSugar(s);
      setMeals(m);
      setInjections(inj);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
    // dataVersion (D5, 2.3.1 delete audit): every other reader of this profile's
    // data re-fetches on it (see AppContext.bumpData) - without it, a delete or
    // edit made elsewhere left this screen showing stale rows until something
    // else (a window change, a profile switch) happened to re-run the effect.
  }, [isProUser, activeProfile, fetchRange, dataVersion]);

  // Recompute locally when the window changes (no reload).
  const data = useMemo(
    () => computeInsights(sugar, meals, injections, windowDays, tirBand, range),
    [sugar, meals, injections, windowDays, tirBand, customRange]
  );

  // The bare number, for widgets that style the percent sign separately; and the
  // whole percentage, sign placed by the language (lib/format).
  const pctNum = (n: number | null) => (n == null ? "-" : pctParts(n).number);
  const pctText = (n: number | null) => (n == null ? "-" : pct(n));
  const PCT_SIGN = pctParts(0);

  // Descriptive patterns from the user's own readings (never causal/advice).
  const patterns = useMemo(
    () => derivePatterns(sugar, windowDays, range),
    [sugar, windowDays, customRange]
  );
  const patternText = (p: InsightPattern): string => {
    const u = glucoseUnitLabel(unit);
    switch (p.kind) {
      case "tag_higher":
        return t("insights.patternTagHigher", {
          tag: t(`tags.${p.tag}`),
          avg: fmtG(p.avg),
          baseline: fmtG(p.baseline),
          unit: u,
          n: p.n,
        });
      case "dawn":
        return t("insights.patternDawn", {
          morningAvg: fmtG(p.morningAvg),
          baseline: fmtG(p.baseline),
          unit: u,
        });
      case "high_variability":
        return t("insights.patternHighVariability", { cv: pct(p.cv) });
    }
  };

  // Trend vs the previous equal-length window, and the window percentile summary.
  const trend = useMemo(
    () => trendVsPrevious(sugar, windowDays, tirBand, range),
    [sugar, windowDays, tirBand, customRange]
  );
  const pctile = useMemo(
    () => windowPercentiles(sugar, windowDays, range),
    [sugar, windowDays, customRange]
  );
  // Free users see only the 7-day basic summary fully; 30/90 render as a blurred
  // preview behind a lock (curiosity gap, not an empty screen).
  const locked = !isProUser && (windowDays !== FREE_INSIGHTS_WINDOW || customRange != null);
  // Enough blurred report to create the curiosity gap, never more than fits on
  // screen (the unlock card is centred inside it).
  const lockedPreviewHeight = Math.max(360, windowHeight - insets.top - insets.bottom - 120);
  const premium = isProUser || locked;
  // D3 (2.3.1 delete audit): mode changes are a VISIBILITY choice, never a
  // deletion - switching to "no diagnosis" must not make already-logged doses
  // vanish from this report while the same range's PDF (lib/services/report.ts)
  // keeps showing them via the identical `|| injections.length > 0` guard.
  const showsInjections =
    insulinModeUsesInsulin(activeProfile?.insulin_mode) || injections.length > 0;

  // Pro "from Health" summary: activity minutes + insulin delivery (read-only).
  const [health, setHealth] = useState<HealthSummary | null>(null);
  // Whether the Health card applies AT ALL is known synchronously on the
  // first render (profile + platform, not a query): Android, free, and
  // non-Pro users never fetch, so that card reserves no space from the very
  // first frame. When it IS applicable, this only tracks the very first
  // read - a later window switch updates the card in place, with no local
  // skeleton flash.
  const [initialHealthPending] = useState(
    () => isProUser && Platform.OS === "ios"
  );
  const [healthSettled, setHealthSettled] = useState(false);
  const healthProfileId = activeProfile?.id ?? null;
  useEffect(() => {
    // The Health summary is windowDays-based; a custom range would mislabel it,
    // so it is simply hidden while a custom range is active.
    if (customRange) {
      setHealth(null);
      setHealthSettled(true);
      return;
    }
    // iOS-only (Health Connect removed for Play policy).
    if (!isProUser || Platform.OS !== "ios") {
      setHealth(null);
      setHealthSettled(true);
      return;
    }
    let alive = true;
    // A native HealthKit call that never resolves (a stuck query, see the
    // audit that flagged this) used to leave the whole report on its
    // skeleton with no way out. It no longer gates the report at all (see
    // pageLoading below), but the Health card's own local skeleton still
    // needs a floor - it settles to "no data", not an error message.
    let settled = false;
    const timer = setTimeout(() => {
      if (!alive || settled) return;
      settled = true;
      setHealth(null);
      setHealthSettled(true);
    }, HEALTH_TIMEOUT_MS);
    // One Health account serves the whole device, so this card is only about
    // the ACTIVE profile: it is read at all only while that profile has Health
    // sync switched on, never off another profile's connection.
    void getHealthSyncEnabled(healthProfileId)
      .then((syncOn) => {
        if (!alive || settled) return;
        if (!syncOn) {
          settled = true;
          clearTimeout(timer);
          setHealth(null);
          setHealthSettled(true);
          return;
        }
        return readHealthSummary(windowDays)
          .then((h) => {
            if (alive && !settled) setHealth(h);
          })
          .catch(() => {})
          .finally(() => {
            if (!alive || settled) return;
            settled = true;
            clearTimeout(timer);
            setHealthSettled(true);
          });
      })
      .catch(() => {
        if (!alive || settled) return;
        settled = true;
        clearTimeout(timer);
        setHealth(null);
        setHealthSettled(true);
      });
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [isProUser, windowDays, customRange, healthProfileId]);

  // The SQLite data (readings/meals/injections) is the report; Health is
  // read-only supporting detail from a separate, slower native query. Gating
  // the whole page on it used to mean a stuck HealthKit call froze the report
  // forever even though every figure on it comes from data already in hand.
  const pageLoading = loading;

  // Weekly digest (Pro): rule-based, descriptive sentences comparing this week
  // to last. Viewing it is one of the review-prompt triggers.
  const digest = useMemo(() => weeklyDigest(sugar, tirBand), [sugar, tirBand]);
  useEffect(() => {
    if (isProUser && !loading && digest.length > 0) void maybeRequestReview("weekly_insights_view");
  }, [isProUser, loading, digest.length]);
  const weeklyText = (s: WeeklySentence): string => {
    const u = glucoseUnitLabel(unit);
    switch (s.kind) {
      case "tir":
        return s.delta >= 0
          ? t("insights.weeklyTirUp", { tir: pct(s.tir), points: Math.abs(s.delta) })
          : t("insights.weeklyTirDown", { tir: pct(s.tir), points: Math.abs(s.delta) });
      case "avg":
        return s.avgDelta >= 0
          ? t("insights.weeklyAvgUp", { n: fmtG(Math.abs(s.avgDelta)), unit: u })
          : t("insights.weeklyAvgDown", { n: fmtG(Math.abs(s.avgDelta)), unit: u });
      case "morning_evening":
        return s.higher === "morning"
          ? t("insights.weeklyMorningHigher", { diff: fmtG(s.diff), unit: u })
          : t("insights.weeklyEveningHigher", { diff: fmtG(s.diff), unit: u });
    }
  };

  // ── Chart data. All memoized: a 90-day window is a few thousand readings and
  // the window selector re-renders the whole screen. ────────────────────────
  const agp = useMemo(() => computeAgp(sugar, windowDays, range), [sugar, windowDays, customRange]);
  const trendDays = useMemo(
    () => dailyAverages(sugar, windowDays, range),
    [sugar, windowDays, customRange]
  );
  /** The hourly median curve, for the mockup's gradient AGP area. */
  const agpCurve = useMemo(() => agp.bands.map((b) => b.p50), [agp]);

  const u = glucoseUnitLabel(unit);

  const dailyCaption = useMemo(() => {
    if (agp.bands.length === 0) return "";
    // The window's own median, not the median of the hourly medians.
    return t("insights.chartDailyCaption", {
      readings: agp.totalReadings,
      hours: agp.bands.length,
      median: fmtG(pctile?.p50 ?? null),
      unit: u,
    });
  }, [agp, pctile, t, unit]);

  const trendCaption = useMemo(() => {
    if (trendDays.length === 0) return "";
    const avgs = trendDays.map((d) => d.avg);
    return t("insights.chartTrendCaption", {
      days: trendDays.length,
      min: fmtG(Math.round(Math.min(...avgs))),
      max: fmtG(Math.round(Math.max(...avgs))),
      unit: u,
    });
  }, [trendDays, t, unit]);

  const hourlyBars = SLICES.map((slice) => ({
    label: t(`insights.${slice}`),
    value: data.hourly[slice],
  }));
  const hourlyCaption = t("insights.chartHourlyCaption", {
    summary: `${hourlyBars
      .map((b) => `${b.label} ${b.value == null ? "-" : fmtG(b.value)}`)
      .join(", ")} ${u}`,
  });
  const hourlyEmpty = hourlyBars.every((b) => b.value == null);

  // Locale-correct short "day.month" axis label (digit order, separator - all
  // Intl's call, not a hand-written "GG.AA"): a plain toLocaleDateString runtime
  // without full Intl falls back to the old hand-built form.
  const shortDayMonth = (d: Date) => {
    try {
      return d.toLocaleDateString(formatLocale(), { day: "2-digit", month: "2-digit" });
    } catch {
      const two = (n: number) => (n < 10 ? `0${n}` : `${n}`);
      return `${two(d.getDate())}.${two(d.getMonth() + 1)}`;
    }
  };

  // The window's first day, for the trend chart's left axis label.
  const windowStartLabel = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - (windowDays - 1));
    return shortDayMonth(d);
  }, [windowDays]);

  // Trend chart axis: with a custom range the x-scale spans the range's own day
  // count and the labels come from the range's real ends (end = "Today" only when
  // it actually is today), so the last point reaches the right edge.
  const shortDate = (ms: number) => shortDayMonth(new Date(ms));
  const trendWindowDays = customRange ? rangeWindowDays(customRange) : windowDays;
  const trendStartLabel = customRange ? shortDate(customRange.start) : windowStartLabel;
  const endIsToday = customRange
    ? new Date(customRange.end).toDateString() === new Date().toDateString()
    : true;
  const trendEndLabel = customRange && !endIsToday ? shortDate(customRange.end) : t("common.today");

  // Neutral delta chip: the signed difference, and nothing about what it means.
  const avgDeltaChip =
    trend.avgDelta == null
      ? null
      : Math.round(trend.avgDelta) === 0
        ? t("insights.chartNoChange")
        : `${trend.avgDelta > 0 ? "+" : "-"}${fmtG(Math.abs(Math.round(trend.avgDelta)))} ${u}`;

  const avgTrend =
    trend.avgDelta != null
      ? `${trend.avgDelta >= 0 ? "▲" : "▼"} ${fmtG(
          Math.abs(Math.round(trend.avgDelta))
        )} ${t("insights.vsPrevious")}`
      : undefined;
  const tirTrend =
    trend.tirDelta != null
      ? `${trend.tirDelta >= 0 ? "▲" : "▼"} ${pct(
          Math.abs(Math.round(trend.tirDelta))
        )} ${t("insights.vsPrevious")}`
      : undefined;

  // ── D10: Pro insight sections (wave 2, lib/insightsPro.ts) ────────────────
  //
  // Each card below picks its OWN natural lookback rather than inheriting the
  // window/custom-range picker above, matching the one sibling card that
  // already exists on this screen (the "This week" digest a few lines down,
  // which also ignores `windowDays`): a streak or a week-over-week
  // comparison is either "as of right now" or it is not the thing its name
  // says it is - a "day-in-target streak" scoped to a user's currently
  // selected 7-day view would just always read as "7", which is not a
  // streak. Only the hour-band strip and the meal-response summary are
  // scoped to the active window/range, because they are direct analogues of
  // cards that already are (the hourly bar chart above, and "meals in this
  // report" respectively). The AGP percentile ribbons need no scope decision
  // of their own at all - they reuse the SAME `agp` computed above them.
  const lang = (i18n.language || "en").slice(0, 2) as Lang;
  const weekAnchor = useMemo(() => weekAnchorForLang(lang), [lang]);

  // a) This calendar week vs. the previous full week.
  const weeklyCompare = useMemo(
    () => weeklyComparison(sugar, Date.now(), weekAnchor, tirBand),
    [sugar, tirBand, weekAnchor]
  );
  const weekDeltaText = (delta: number | null, fmt: (abs: number) => string): string | undefined => {
    if (delta == null) return undefined;
    if (Math.round(delta) === 0) return t("insights.chartNoChange");
    return `${delta >= 0 ? "▲" : "▼"} ${fmt(Math.abs(delta))} ${t("insights.vsPrevious")}`;
  };

  // b) Hour-of-day heat strip: hourBandAverages does no date filtering of its
  // own (see its docstring), unlike computeAgp/bestDayAndStreaks below, so the
  // active window/range is applied here first - the same readings the hourly
  // bar chart above is already scoped to, just pooled into 3h bands instead
  // of 4 fixed dayparts.
  const activeRange = useMemo<DateRange>(
    () => range ?? rangeFromWindow(windowDays),
    [range, windowDays]
  );
  const readingsInActiveWindow = useMemo(
    () =>
      sugar.filter((r) => {
        const ms = new Date(r.logged_at).getTime();
        return Number.isFinite(ms) && ms >= activeRange.start && ms <= activeRange.end;
      }),
    [sugar, activeRange]
  );
  const hourBands = useMemo(
    () => hourBandAverages(readingsInActiveWindow, trendWindowDays),
    [readingsInActiveWindow, trendWindowDays]
  );

  // c) AGP percentile ribbons: `agp` above already carries p05/p25/p75/p95 per
  // band (computeAgp - the exact function insightsPro's agpPercentiles wraps,
  // see that module's own docstring), and it is already scoped to the active
  // window/custom range, so this only reshapes it - no second computeAgp call
  // and no loss of custom-range support the range-less agpPercentiles would
  // have meant.
  const agpBands = useMemo(() => {
    if (agp.bands.length < 2) return undefined;
    return [
      {
        upper: agp.bands.map((b) => b.p95),
        lower: agp.bands.map((b) => b.p05),
        color: CHART.band,
        opacity: 0.1,
      },
      {
        upper: agp.bands.map((b) => b.p75),
        lower: agp.bands.map((b) => b.p25),
        color: CHART.band,
        opacity: 0.22,
      },
    ];
  }, [agp]);

  // d) Best day + streaks: own default 30-day lookback (bestDayAndStreaks
  // does its own date filtering), independent of the window picker for the
  // same "a streak is as of today" reason as the weekly comparison above.
  const bestStreaks = useMemo(
    () => bestDayAndStreaks(sugar, tirBand, Date.now()),
    [sugar, tirBand]
  );

  // e) Meal response summary: meals scoped to the active window (so the card
  // matches "meals in this report"), but readings passed WIDE (unfiltered) so
  // a meal near the window's edge still has its baseline/lookback readings to
  // draw from - mirrors how mealResponseSummary's own caller contract expects
  // "every reading the meal might draw from", not just in-window ones.
  const mealsInActiveWindow = useMemo(
    () =>
      meals.filter((m) => {
        const ms = new Date(m.logged_at).getTime();
        return Number.isFinite(ms) && ms >= activeRange.start && ms <= activeRange.end;
      }),
    [meals, activeRange]
  );
  const mealSummary = useMemo(
    () => mealResponseSummary(mealsInActiveWindow, sugar),
    [mealsInActiveWindow, sugar]
  );
  // Meal names are user data (custom_food_name) or the localized catalogue
  // name (lib/db/foods getFood + lib/db/types foodName) - resolved here
  // rather than added to insightsPro.ts, which stays DB/app-free. At most two
  // lookups (best + worst), same getFood() the meal-response screen already
  // uses for the same purpose.
  const mealNameIds = useMemo(() => {
    const ids = new Set<string>();
    if (mealSummary.best) ids.add(mealSummary.best.mealId);
    if (mealSummary.worst) ids.add(mealSummary.worst.mealId);
    return Array.from(ids);
  }, [mealSummary]);
  const [mealNames, setMealNames] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    if (mealNameIds.length === 0) {
      setMealNames({});
      return;
    }
    (async () => {
      const resolved = await Promise.all(
        mealNameIds.map(async (id): Promise<[string, string]> => {
          const meal = meals.find((m) => m.id === id);
          if (!meal) return [id, "-"];
          const custom = meal.custom_food_name?.trim();
          if (custom) return [id, custom];
          if (!meal.food_id) return [id, "-"];
          try {
            const food = await getFood(meal.food_id);
            return [id, food ? foodName(food, lang) : "-"];
          } catch {
            return [id, "-"];
          }
        })
      );
      if (!alive) return;
      setMealNames(Object.fromEntries(resolved));
    })();
    return () => {
      alive = false;
    };
  }, [mealNameIds, meals, lang]);
  const deltaGlucoseText = (v: number) =>
    `${v >= 0 ? "+" : "-"}${fmtG(Math.abs(Math.round(v)))} ${u}`;

  // f) CV trend: own default ~10-week lookback, independent of the window
  // picker for the same reason as (a)/(d).
  const cvWeeks = useMemo(() => cvTrend(sugar, Date.now(), weekAnchor), [sugar, weekAnchor]);
  const cvNonNull = useMemo(
    () => cvWeeks.weeks.filter((w): w is typeof w & { cv: number } => w.cv != null),
    [cvWeeks]
  );
  const cvSparklineData = useMemo(() => cvNonNull.map((w) => w.cv), [cvNonNull]);
  const lastCv = cvNonNull.length ? cvNonNull[cvNonNull.length - 1].cv : null;
  const cvDeltaText =
    cvNonNull.length >= 2
      ? weekDeltaText(
          cvNonNull[cvNonNull.length - 1].cv - cvNonNull[cvNonNull.length - 2].cv,
          (n) => pct(Math.round(n))
        )
      : undefined;

  /** The mockup's header chip: the active window, opening the window picker. */
  function openWindowPicker() {
    actionSheet({
      title: t("insights.title"),
      actions: [
        ...INSIGHTS_WINDOWS.map((d) => ({
          label:
            !isProUser && d !== FREE_INSIGHTS_WINDOW
              ? `${t("insights.windowDays", { n: d })} · ${t("common.pro")}`
              : t("insights.windowDays", { n: d }),
          icon: (!isProUser && d !== FREE_INSIGHTS_WINDOW
            ? "lock-closed"
            : "calendar-outline") as keyof typeof Ionicons.glyphMap,
          // A shortcut clears any custom range so the two never fight.
          onPress: () => {
            setCustomRange(null);
            setWindowDays(d);
          },
        })),
        {
          label: !isProUser
            ? `${t("report.customRange")} · ${t("common.pro")}`
            : t("report.customRange"),
          icon: (!isProUser ? "lock-closed" : "create-outline") as keyof typeof Ionicons.glyphMap,
          // A free user used to be walked through the whole two-date picker and
          // only THEN shown a lock over the result. The option is already marked
          // Pro, so it goes where it actually leads.
          onPress: () =>
            isProUser
              ? setRangePickerOpen(true)
              : router.push({ pathname: "/paywall", params: { reason: "insights" } }),
        },
      ],
    });
  }

  const isEmpty =
    data.readings === 0 && data.injectionCount === 0 && data.meals === 0;
  const hasReadings = data.readings > 0;
  const maxSite = Math.max(1, ...data.siteDistribution.map((s) => s.count));
  const usedSites = data.siteDistribution
    .filter((s) => s.count > 0)
    .sort((a, b) => b.count - a.count);

  return (
    <AppBackground style={{ paddingTop: insets.top }}>
      <ScreenHeader
        title={t("insights.title")}
        onBack={() => router.back()}
        right={
          <Pressable
            onPress={openWindowPicker}
            hitSlop={8}
            className="flex-row items-center rounded-full px-3 py-1.5"
            style={{ borderWidth: 1, borderColor: THEME.border, backgroundColor: THEME.glass }}
          >
            {/* A custom range puts two dates in one chip next to the back arrow
                and the title; on a narrow screen that overflowed. Bidi: root
                cause traced on-device - formatDate() under "ar" embeds its
                OWN RLM marks before every "/" (ICU's ar date pattern, e.g.
                "28‏/7‏/2026"), which still wins the bidi resolution INSIDE
                our own isolateLtr() wrap and reorders the date's digit
                groups; stripBidiMarks() clears those before we compose and
                isolate the pair ourselves. writingDirection stays on as a
                cheap extra (it did nothing on its own, but costs nothing). */}
            <Text
              style={{ color: THEME.ink, fontSize: 11, fontWeight: "700", writingDirection: "ltr" }}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              {customRange
                ? isolateLtr(
                    `${stripBidiMarks(formatDate(new Date(customRange.start).toISOString()))} - ${stripBidiMarks(formatDate(new Date(customRange.end).toISOString()))}`
                  )
                : t("insights.windowDays", { n: windowDays })}
            </Text>
            <Ionicons
              name="chevron-down"
              size={11}
              color={THEME.muted}
              style={{ marginLeft: 4 }}
            />
          </Pressable>
        }
      />

      {pageLoading ? (
        <ScrollView
          contentContainerStyle={{
            padding: 16,
            paddingBottom: insets.bottom + 24,
            ...(bodyColumn ?? {}),
          }}
          showsVerticalScrollIndicator={false}
        >
          <InsightsSkeleton isWide={isWide} premium={premium} showsInjections={showsInjections} />
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={{
            padding: 16,
            paddingBottom: insets.bottom + 24,
            ...(bodyColumn ?? {}),
          }}
          showsVerticalScrollIndicator={false}
        >
          {isEmpty ? (
            <View className="items-center py-12">
              <IconTile icon="analytics-outline" size={64} radius={20} hero />
              <Text style={{ color: THEME.muted, textAlign: "center", marginTop: 14 }}>
                {t("insights.empty")}
              </Text>
            </View>
          ) : (
            // Locked, the preview is clipped to roughly one screen. The unlock
            // card is centred inside this box, and the box used to be the FULL
            // (several-screens-tall) report, so the lock's title, body and CTA
            // landed far below the fold: the user saw a blurred wall with no
            // visible way out unless they thought to scroll it.
            <View
              style={
                locked
                  ? { maxHeight: lockedPreviewHeight, overflow: "hidden" }
                  : undefined
              }
            >
              <View
                pointerEvents={locked ? "none" : "auto"}
                importantForAccessibility={locked ? "no-hide-descendants" : "auto"}
              >
                {/* Meals (or injections) logged but no glucose reading: almost
                    every card below is gated on readings, so the report rendered
                    as a blank page under the header with no explanation. */}
                {!hasReadings ? (
                  <View className="flex-row items-start rounded-2xl bg-glass border border-hair p-3.5 mb-1">
                    <Ionicons name="water-outline" size={15} color={THEME.muted} />
                    <Text
                      style={{
                        color: THEME.muted,
                        fontSize: 12,
                        lineHeight: 18,
                        marginLeft: 10,
                        flex: 1,
                      }}
                    >
                      {t("insights.noReadings")}
                    </Text>
                  </View>
                ) : null}
                <CardGrid isWide={isWide}>
                  {/* ── Glucose ───────────────────────────────────────────── */}
                  {hasReadings ? (
                    <GlassCard key="tir" glow={GREEN} style={{ marginBottom: 10 }}>
                      <View className="flex-row items-center justify-between mb-1">
                        <Text
                          style={{
                            color: THEME.muted,
                            fontSize: 11,
                            letterSpacing: 1.3,
                            fontWeight: "800",
                          }}
                        >
                          {upper(t("insights.timeInRange"))}
                        </Text>
                        <GlucoseChip
                          status="normal"
                          dot={false}
                          label={pctText(data.inRangePct)}
                        />
                      </View>
                      <View className="flex-row items-center">
                        <TIRDonut
                          segments={tirSegments({
                            low: data.lowPct ?? 0,
                            target: data.inRangePct ?? 0,
                            high: data.highPct ?? 0,
                            veryHigh: data.veryHighPct ?? 0,
                          })}
                          centerValue={pctNum(data.inRangePct)}
                          centerSuffix={PCT_SIGN.sign}
                          centerSuffixFirst={PCT_SIGN.signFirst}
                          size={104}
                        />
                        <View style={{ flex: 1, marginLeft: 16, gap: 6 }}>
                          {(
                            [
                              [t("insights.low"), GLUCOSE_RICH.low, data.lowPct],
                              [t("insights.inRange"), GLUCOSE_RICH.target, data.inRangePct],
                              [t("insights.high"), GLUCOSE_RICH.high, data.highPct],
                              [
                                t("insights.veryHigh"),
                                GLUCOSE_RICH.veryHigh,
                                data.veryHighPct,
                              ],
                            ] as const
                          ).map(([name, color, value]) => (
                            // RTL EXEMPTION: dot -> label -> percent is a fixed
                            // layout (percent pinned to the row's far edge via
                            // the label's flex:1), not a reading-direction list.
                            // Locked to physical-row order like TimeInRangeBar's
                            // legend, because RN's automatic row mirroring alone
                            // breaks it: the label's default (non-swapping,
                            // see components/form.tsx) LEFT text alignment would
                            // stay put while the row itself reversed, gluing the
                            // percent straight onto the label with the dot left
                            // stranded across the whole flex gap on the other
                            // side - on-device this read "منخفض6%" with the dot
                            // floating away from its own row.
                            <View
                              key={name}
                              className="items-center"
                              style={{ flexDirection: rtl ? "row-reverse" : "row" }}
                            >
                              <View
                                style={{
                                  width: 8,
                                  height: 8,
                                  borderRadius: 4,
                                  backgroundColor: color,
                                }}
                              />
                              <Text
                                style={{
                                  color: THEME.ink,
                                  fontSize: 12,
                                  fontWeight: "700",
                                  flex: 1,
                                  // RN auto-flips marginLeft/Right independently
                                  // of the flexDirection lock above, so the key
                                  // itself has to be pre-swapped (same trick as
                                  // InjectionBodyMap's side badges) to keep
                                  // landing on the dot's side.
                                  [rtl ? "marginRight" : "marginLeft"]: 8,
                                }}
                              >
                                {name}
                              </Text>
                              {/* Bidi: a bare "12%" can still get its sign
                                  reordered under an RTL base paragraph
                                  direction; pin it LTR like the other
                                  number+sign pairs on this screen. */}
                              <Text
                                style={[
                                  TABULAR,
                                  { color: THEME.muted, fontSize: 12, writingDirection: "ltr" },
                                ]}
                              >
                                {isolateLtr(pctText(value))}
                              </Text>
                            </View>
                          ))}
                        </View>
                      </View>
                      {/* Bidi: "80-160 mg/dL" reads back to front under RTL
                          (the hyphen splits it into two number runs that get
                          reordered); writingDirection alone was verified NOT
                          enough on-device. The locale string is a single
                          fixed template ("{{word}} {{min}}-{{max}} {{unit}}",
                          same shape in all 9 locales) this task cannot edit,
                          so the LTR isolate is smuggled through it instead:
                          opening it inside `min` and closing it inside `max`
                          wraps "min-max" (hyphen included, since that literal
                          "-" sits between the two placeholders in the
                          template) as one atomic block, while the
                          translated word stays outside it. */}
                      <Text
                        style={{
                          color: THEME.muted,
                          fontSize: 11,
                          marginTop: 10,
                        }}
                      >
                        {t("glucose.bandLabel", {
                          min: openLtrIsolate(formatGlucose(band.low, unit)),
                          max: closeLtrIsolate(formatGlucose(band.high, unit)),
                          unit: u,
                        })}
                      </Text>
                    </GlassCard>
                  ) : null}

                  {/* AGP as the mockup's gradient area curve */}
                  {hasReadings ? (
                    <GlassCard key="agp" style={{ marginBottom: 10 }}>
                      <Text
                        style={{
                          color: THEME.muted,
                          fontSize: 11,
                          letterSpacing: 1.3,
                          fontWeight: "800",
                          marginBottom: 8,
                        }}
                      >
                        {upper(t("insights.agpTitle"))}
                      </Text>
                      {agpCurve.length >= 2 ? (
                        <>
                          <GradientAreaChart
                            data={agpCurve}
                            height={84}
                            targetBand={{ min: band.low, max: band.high }}
                            // D10c: p25-p75/p5-p95 shading is part of the Pro
                            // insights package, same as every other card below -
                            // a free user (or the locked/blurred preview) sees
                            // the plain median curve exactly as before.
                            bands={premium ? agpBands : undefined}
                            style={{ alignSelf: "stretch", width: "100%" }}
                          />
                          {/* Hour axis: physically LTR always (00 -> 24 left to
                              right), same fixed-order lock as TimeInRangeBar -
                              it mirrors the SVG curve above, which never
                              mirrors either. */}
                          <View
                            className="justify-between mt-1"
                            style={{ flexDirection: I18nManager.isRTL ? "row-reverse" : "row" }}
                          >
                            {["00", "06", "12", "18", "24"].map((h) => (
                              <Text key={h} style={{ color: THEME.muted, fontSize: 10 }}>
                                {h}
                              </Text>
                            ))}
                          </View>
                          {premium && agpBands ? (
                            <View
                              className="flex-row flex-wrap mt-2"
                              style={{ gap: 10, flexDirection: rtl ? "row-reverse" : "row" }}
                            >
                              {(
                                [
                                  { label: t("insights.chartMedianLegend"), color: CHART.line, opacity: 1 },
                                  { label: t("insights.chartIqrLegend"), color: CHART.band, opacity: 0.4 },
                                  { label: t("insights.chartP595Legend"), color: CHART.band, opacity: 0.2 },
                                  { label: t("insights.chartTargetLegend"), color: GREEN, opacity: 0.4 },
                                ] as const
                              ).map((entry) => (
                                <View
                                  key={entry.label}
                                  className="items-center"
                                  style={{ flexDirection: rtl ? "row-reverse" : "row" }}
                                >
                                  <View
                                    style={{
                                      width: 8,
                                      height: 8,
                                      borderRadius: 3,
                                      backgroundColor: entry.color,
                                      opacity: entry.opacity,
                                    }}
                                  />
                                  <Text
                                    style={{
                                      color: THEME.muted,
                                      fontSize: 10,
                                      [rtl ? "marginRight" : "marginLeft"]: 5,
                                    }}
                                  >
                                    {entry.label}
                                  </Text>
                                </View>
                              ))}
                            </View>
                          ) : null}
                          <Text
                            style={{
                              color: THEME.muted,
                              fontSize: 11,
                              lineHeight: 16,
                              marginTop: 6,
                            }}
                          >
                            {dailyCaption}
                          </Text>
                        </>
                      ) : (
                        <Text style={{ color: THEME.muted, fontSize: 12, paddingVertical: 12 }}>
                          {t("insights.chartNeedMore")}
                        </Text>
                      )}
                    </GlassCard>
                  ) : null}

                  {/* The mockup's StatCard strip, with the note that qualifies it */}
                  {hasReadings ? (
                    <React.Fragment key="stats">
                    <View className="flex-row" style={{ gap: 8 }}>
                      <StatCard
                        glass
                        glow={data.gmi != null}
                        label={t("insights.gmi")}
                        display={data.gmi == null ? "-" : pctParts(data.gmi, 1).number}
                        suffix={data.gmi == null ? undefined : PCT_SIGN.sign}
                        suffixFirst={PCT_SIGN.signFirst}
                        accent={BRAND}
                        style={{ flex: 1 }}
                      />
                      <StatCard
                        glass
                        label={t("insights.avgGlucose")}
                        display={fmtG(data.avgGlucose)}
                        suffix={u}
                        footnote={premium ? avgTrend : undefined}
                        style={{ flex: 1 }}
                      />
                    </View>
                    <View className="flex-row mt-2" style={{ gap: 8 }}>
                      <StatCard
                        glass
                        label={t("insights.timeInRange")}
                        display={pctNum(data.inRangePct)}
                        suffix={PCT_SIGN.sign}
                        suffixFirst={PCT_SIGN.signFirst}
                        accent={GREEN}
                        footnote={premium ? tirTrend : undefined}
                        style={{ flex: 1 }}
                      />
                      <StatCard
                        glass
                        label={t("insights.readings")}
                        display={String(data.readings)}
                        footnote={t("insights.windowDays", { n: data.days })}
                        style={{ flex: 1 }}
                      />
                    </View>

                    {/* GMI is withheld until the sample can carry it */}
                    <Text
                      style={{
                        color: THEME.muted,
                        fontSize: 11,
                        lineHeight: 16,
                        marginTop: 8,
                        paddingHorizontal: 6,
                      }}
                    >
                      {data.gmi == null
                        ? t("insights.gmiNeedMore", {
                            n: GMI_MIN_READINGS,
                            days: GMI_MIN_SPAN_DAYS,
                          })
                        : t("insights.gmiNote")}
                    </Text>
                    </React.Fragment>
                  ) : null}

                  {/* D10a: this calendar week vs the previous full week - TIR/avg/CV, delta arrows */}
                  {hasReadings && premium ? (
                    <GlassCard key="weeklyCompare" style={{ marginTop: 12 }}>
                      <Text style={{ color: THEME.ink, fontWeight: "800" }}>
                        {t("insights.weeklyCompareTitle")}
                      </Text>
                      {weeklyCompare.currentReadingCount === 0 &&
                      weeklyCompare.previousReadingCount === 0 ? (
                        <Text style={{ color: THEME.muted, fontSize: 12, marginTop: 8 }}>
                          {t("insights.weeklyCompareEmpty")}
                        </Text>
                      ) : (
                        <View className="flex-row mt-3" style={{ gap: 8 }}>
                          <StatCard
                            glass
                            label={t("insights.timeInRange")}
                            display={pctNum(weeklyCompare.tir.current)}
                            suffix={weeklyCompare.tir.current == null ? undefined : PCT_SIGN.sign}
                            suffixFirst={PCT_SIGN.signFirst}
                            accent={GREEN}
                            footnote={weekDeltaText(weeklyCompare.tir.delta, (n) => pct(Math.round(n)))}
                            style={{ flex: 1 }}
                          />
                          <StatCard
                            glass
                            label={t("insights.avgGlucose")}
                            display={fmtG(weeklyCompare.avg.current)}
                            suffix={u}
                            footnote={weekDeltaText(
                              weeklyCompare.avg.delta,
                              (n) => `${fmtG(Math.round(n))} ${u}`
                            )}
                            style={{ flex: 1 }}
                          />
                          <StatCard
                            glass
                            label={t("insights.cv")}
                            display={pctNum(weeklyCompare.cv.current)}
                            suffix={weeklyCompare.cv.current == null ? undefined : PCT_SIGN.sign}
                            suffixFirst={PCT_SIGN.signFirst}
                            footnote={weekDeltaText(weeklyCompare.cv.delta, (n) => pct(Math.round(n)))}
                            style={{ flex: 1 }}
                          />
                        </View>
                      )}
                    </GlassCard>
                  ) : null}

                  {/* Weekly digest (Pro): this week vs last, in sentences */}
                  {hasReadings && isProUser && digest.length > 0 ? (
                      <GlassCard key="digest" accent style={{ marginTop: 12 }}>
                        <View className="flex-row items-center mb-2">
                          <Ionicons name="calendar-outline" size={15} color={BRAND} />
                          <Text
                            style={{
                              color: BRAND,
                              fontSize: 10,
                              fontWeight: "800",
                              letterSpacing: 1.2,
                              marginLeft: 8,
                            }}
                          >
                            {upper(t("insights.weeklyTitle"))}
                          </Text>
                        </View>
                        {digest.map((s, i) => (
                          <View key={i} className="flex-row items-start mb-1.5">
                            <Text style={{ color: THEME.muted, marginRight: 8 }}>•</Text>
                            <Text
                              style={{
                                color: THEME.ink,
                                fontSize: 13,
                                lineHeight: 19,
                                flex: 1,
                              }}
                            >
                              {weeklyText(s)}
                            </Text>
                          </View>
                        ))}
                      </GlassCard>
                    ) : null}

                  {/* D10d: best single day (by TIR) in the last 30 days, plus a
                      day-in-target streak and a plain logging streak */}
                  {hasReadings && premium ? (
                    <GlassCard key="bestDayStreaks" style={{ marginTop: 12 }}>
                      <Text style={{ color: THEME.ink, fontWeight: "800" }}>
                        {t("insights.bestDayStreaksTitle")}
                      </Text>
                      {bestStreaks.bestDay ? (
                        <View className="flex-row items-center mt-3">
                          <IconTile icon="trophy-outline" size={38} radius={12} hero />
                          <View className="flex-1 ml-3">
                            <Text style={{ color: THEME.muted, fontSize: 11 }}>
                              {t("insights.bestDayLabel")}
                            </Text>
                            <Text style={{ color: THEME.ink, fontWeight: "800", marginTop: 2 }}>
                              {formatDate(
                                new Date(`${bestStreaks.bestDay.day}T12:00:00`).toISOString()
                              )}
                            </Text>
                          </View>
                          <View style={{ alignItems: rtl ? "flex-start" : "flex-end" }}>
                            <Text style={{ color: GREEN, fontWeight: "800" }}>
                              {pctText(bestStreaks.bestDay.tir)}
                            </Text>
                            <Text style={{ color: THEME.muted, fontSize: 11 }}>
                              {fmtG(bestStreaks.bestDay.avg)} {u}
                            </Text>
                          </View>
                        </View>
                      ) : (
                        <Text style={{ color: THEME.muted, fontSize: 12, marginTop: 8 }}>
                          {t("insights.bestDayEmpty")}
                        </Text>
                      )}
                      <View className="flex-row mt-3" style={{ gap: 8 }}>
                        <StatCard
                          glass
                          label={t("insights.streakTargetLabel")}
                          display={String(bestStreaks.targetDayStreak.current)}
                          footnote={t("insights.streakLongest", {
                            n: bestStreaks.targetDayStreak.longest,
                          })}
                          style={{ flex: 1 }}
                        />
                        <StatCard
                          glass
                          label={t("insights.streakLoggingLabel")}
                          display={String(bestStreaks.loggingStreak.current)}
                          footnote={t("insights.streakLongest", {
                            n: bestStreaks.loggingStreak.longest,
                          })}
                          style={{ flex: 1 }}
                        />
                      </View>
                      <Text
                        style={{
                          color: THEME.muted,
                          fontSize: 11,
                          lineHeight: 16,
                          marginTop: 8,
                          paddingHorizontal: 6,
                        }}
                      >
                        {t("insights.streaksNote", { pct: pct(DAY_IN_TARGET_TIR_PCT) })}
                      </Text>
                    </GlassCard>
                  ) : null}

                  {/* Daily average over the window, with a neutral delta chip */}
                  {hasReadings && premium ? (
                      <ChartCard
                        key="trend"
                        title={t("insights.chartTrendTitle")}
                        subtitle={t("insights.chartTrendSub")}
                        accessory={
                          avgDeltaChip ? (
                            <View
                              className="rounded-full px-2.5 py-1"
                              style={{ backgroundColor: THEME.glass }}
                            >
                              <Text
                                style={{ color: THEME.muted, fontSize: 11, fontWeight: "700" }}
                              >
                                {avgDeltaChip}
                              </Text>
                            </View>
                          ) : null
                        }
                        caption={
                          avgDeltaChip
                            ? `${trendCaption} ${avgDeltaChip} ${t("insights.chartDeltaLabel")}.`
                            : trendCaption
                        }
                        emptyNote={
                          trendDays.length < TREND_MIN_DAYS
                            ? t("insights.chartNeedMore")
                            : undefined
                        }
                        height={CHART_HEIGHT.trend}
                      >
                        {(w) => (
                          <TrendChart
                            days={trendDays}
                            windowDays={trendWindowDays}
                            unit={unit}
                            width={w}
                            height={CHART_HEIGHT.trend}
                            startLabel={trendStartLabel}
                            endLabel={trendEndLabel}
                            band={band}
                          />
                        )}
                      </ChartCard>
                    ) : null}

                  {/* Percentile band summary (AGP numeric), Pro */}
                  {hasReadings && premium && pctile ? (
                      <GlassCard key="pctile" style={{ marginTop: 12 }}>
                        <Text style={{ color: THEME.ink, fontWeight: "800" }}>
                          {t("insights.percentileTitle")}
                        </Text>
                        <Text style={{ color: THEME.muted, fontSize: 11, marginBottom: 12 }}>
                          {t("insights.percentileSub")}
                        </Text>
                        <View className="flex-row justify-between">
                          {(
                            [
                              ["p05", pctile.p05],
                              ["p25", pctile.p25],
                              ["median", pctile.p50],
                              ["p75", pctile.p75],
                              ["p95", pctile.p95],
                            ] as const
                          ).map(([k, v]) => (
                            <View key={k} className="items-center flex-1">
                              <Text
                                style={[
                                  TABULAR,
                                  {
                                    color: k === "median" ? BRAND : THEME.ink,
                                    fontSize: 15,
                                    fontWeight: "800",
                                  },
                                ]}
                              >
                                {fmtG(v)}
                              </Text>
                              <Text style={{ color: THEME.muted, fontSize: 10, marginTop: 2 }}>
                                {t(`insights.${k}`)}
                              </Text>
                            </View>
                          ))}
                        </View>
                      </GlassCard>
                    ) : null}

                  {/* D10e: average glucose change after a meal - lowest/highest
                      AVERAGE CHANGE by the user's own meal name, never "best"/"worst" food */}
                  {hasReadings && premium ? (
                    <GlassCard key="mealResponse" style={{ marginTop: 12 }}>
                      <Text style={{ color: THEME.ink, fontWeight: "800" }}>
                        {t("insights.mealResponseTitle")}
                      </Text>
                      <Text style={{ color: THEME.muted, fontSize: 11, marginTop: 2 }}>
                        {t("insights.mealResponseSub")}
                      </Text>
                      {mealSummary.deltaSampleSize === 0 ? (
                        <Text style={{ color: THEME.muted, fontSize: 12, marginTop: 8 }}>
                          {t("insights.mealResponseEmpty")}
                        </Text>
                      ) : (
                        <>
                          <View className="mt-3">
                            <StatCard
                              glass
                              label={t("insights.mealResponseAvgLabel")}
                              display={
                                mealSummary.avgDelta == null
                                  ? "-"
                                  : deltaGlucoseText(mealSummary.avgDelta)
                              }
                              footnote={t("insights.mealResponseSampleNote", {
                                n: mealSummary.deltaSampleSize,
                              })}
                            />
                          </View>
                          {mealSummary.best ? (
                            <View className="flex-row items-center mt-3">
                              <View className="flex-1">
                                <Text style={{ color: THEME.muted, fontSize: 11 }}>
                                  {t("insights.mealResponseLowest")}
                                </Text>
                                <Text
                                  style={{ color: THEME.ink, fontWeight: "700", marginTop: 2 }}
                                  numberOfLines={1}
                                >
                                  {mealNames[mealSummary.best.mealId] ?? "-"}
                                </Text>
                              </View>
                              <Text style={[TABULAR, { color: THEME.ink, fontWeight: "800" }]}>
                                {deltaGlucoseText(mealSummary.best.delta as number)}
                              </Text>
                            </View>
                          ) : null}
                          {mealSummary.worst && mealSummary.worst !== mealSummary.best ? (
                            <View className="flex-row items-center mt-2">
                              <View className="flex-1">
                                <Text style={{ color: THEME.muted, fontSize: 11 }}>
                                  {t("insights.mealResponseHighest")}
                                </Text>
                                <Text
                                  style={{ color: THEME.ink, fontWeight: "700", marginTop: 2 }}
                                  numberOfLines={1}
                                >
                                  {mealNames[mealSummary.worst.mealId] ?? "-"}
                                </Text>
                              </View>
                              <Text style={[TABULAR, { color: THEME.ink, fontWeight: "800" }]}>
                                {deltaGlucoseText(mealSummary.worst.delta as number)}
                              </Text>
                            </View>
                          ) : null}
                        </>
                      )}
                    </GlassCard>
                  ) : null}

                  {/* Period averages, variability and lows */}
                  {hasReadings && premium ? (
                      <React.Fragment key="vitals">
                        {/* Period + variability + lows */}
                        <View className="flex-row mt-3" style={{ gap: 8 }}>
                          <StatCard
                            glass
                            label={t("insights.fasting")}
                            display={fmtG(data.avgFasting)}
                            suffix={u}
                            style={{ flex: 1 }}
                          />
                          <StatCard
                            glass
                            label={t("insights.postMeal")}
                            display={fmtG(data.avgPostMeal)}
                            suffix={u}
                            style={{ flex: 1 }}
                          />
                        </View>
                        <View className="flex-row mt-2" style={{ gap: 8 }}>
                          <StatCard
                            glass
                            label={t("insights.variability")}
                            display={fmtG(data.glucoseSD)}
                            suffix={u}
                            style={{ flex: 1 }}
                          />
                          <StatCard
                            glass
                            label={t("insights.cv")}
                            display={pctNum(data.glucoseCV)}
                            suffix={PCT_SIGN.sign}
                            suffixFirst={PCT_SIGN.signFirst}
                            style={{ flex: 1 }}
                          />
                          {/* A low is never shown in the colour reserved for a
                              high (see lib/glucose.ts). */}
                          <StatCard
                            glass
                            label={t("insights.lows")}
                            display={String(data.hypoCount)}
                            accent={GLUCOSE_RICH.low}
                            style={{ flex: 1 }}
                          />
                        </View>
                        <Text
                          style={{
                            color: THEME.muted,
                            fontSize: 11,
                            lineHeight: 16,
                            marginTop: 8,
                            paddingHorizontal: 6,
                          }}
                        >
                          {t("insights.variabilityNote")}
                        </Text>
                      </React.Fragment>
                  ) : null}

                  {/* D10f: weekly %CV mini trend - a Sparkline (the app's existing
                      mini-chart pattern), plus the current value and a two-point delta */}
                  {hasReadings && premium ? (
                    <GlassCard key="cvTrend" style={{ marginTop: 12 }}>
                      <View className="flex-row items-center justify-between">
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: THEME.ink, fontWeight: "800" }}>
                            {t("insights.cvTrendTitle")}
                          </Text>
                          <Text style={{ color: THEME.muted, fontSize: 11, marginTop: 2 }}>
                            {t("insights.cvTrendSub")}
                          </Text>
                        </View>
                        {cvSparklineData.length > 1 ? (
                          <Sparkline
                            data={cvSparklineData}
                            width={80}
                            height={28}
                            color={BRAND}
                            showLast
                            fill={false}
                          />
                        ) : null}
                      </View>
                      {cvNonNull.length < CV_TREND_MIN_WEEKS ? (
                        <Text style={{ color: THEME.muted, fontSize: 12, marginTop: 8 }}>
                          {t("insights.chartNeedMore")}
                        </Text>
                      ) : (
                        <View className="flex-row items-end mt-3" style={{ gap: 8 }}>
                          <Text style={[TABULAR, { color: THEME.ink, fontSize: 22, fontWeight: "800" }]}>
                            {pctText(lastCv)}
                          </Text>
                          {cvDeltaText ? (
                            <Text style={{ color: THEME.muted, fontSize: 12, marginBottom: 3 }}>
                              {cvDeltaText}
                            </Text>
                          ) : null}
                        </View>
                      )}
                    </GlassCard>
                  ) : null}

                  {/* Average by time of day */}
                  {hasReadings && premium ? (
                        <ChartCard
                          key="hourly"
                          title={t("insights.hourlyTitle")}
                          caption={hourlyCaption}
                          emptyNote={hourlyEmpty ? t("insights.chartNeedMore") : undefined}
                          height={CHART_HEIGHT.hourly}
                        >
                          {(w) => (
                            <HourlyChart
                              bars={hourlyBars}
                              unit={unit}
                              width={w}
                              height={CHART_HEIGHT.hourly}
                              band={band}
                            />
                          )}
                        </ChartCard>
                  ) : null}

                  {/* D10b: finer-grained companion to the 4-slice chart above -
                      8 bands of 3h, colored by the existing glucose color scale */}
                  {hasReadings && premium ? (
                    <GlassCard key="heatStrip" style={{ marginTop: 12 }}>
                      <Text style={{ color: THEME.ink, fontWeight: "800" }}>
                        {t("insights.heatStripTitle")}
                      </Text>
                      <Text style={{ color: THEME.muted, fontSize: 11, marginTop: 2, marginBottom: 10 }}>
                        {t("insights.heatStripSub")}
                      </Text>
                      {hourBands.every((b) => b.n === 0) ? (
                        <Text style={{ color: THEME.muted, fontSize: 12 }}>
                          {t("insights.chartNeedMore")}
                        </Text>
                      ) : (
                        <>
                          {/* Physically LTR always (00 -> 24 left to right), same
                              fixed-order lock as the AGP hour axis above - a heat
                              strip is a clock, not a reading-direction list. */}
                          <View
                            style={{ flexDirection: I18nManager.isRTL ? "row-reverse" : "row", gap: 4 }}
                          >
                            {hourBands.map((b) => (
                              <View
                                key={b.startHour}
                                style={{
                                  flex: 1,
                                  borderRadius: 8,
                                  paddingVertical: 8,
                                  alignItems: "center",
                                  backgroundColor: b.avg == null ? THEME.track : heatColor(b.avg, band),
                                  opacity: b.avg != null && b.sparse ? 0.4 : 1,
                                }}
                              >
                                <Text
                                  style={[
                                    TABULAR,
                                    {
                                      color: b.avg == null ? THEME.muted : "#0b1220",
                                      fontSize: 11,
                                      fontWeight: "800",
                                    },
                                  ]}
                                >
                                  {b.avg == null ? "-" : fmtG(b.avg)}
                                </Text>
                                <Text
                                  style={[
                                    TABULAR,
                                    {
                                      color: b.avg == null ? THEME.muted : "rgba(11,18,32,0.7)",
                                      fontSize: 8,
                                      marginTop: 2,
                                      writingDirection: "ltr",
                                    },
                                  ]}
                                >
                                  {pad2(b.startHour)}-{pad2(b.endHour)}
                                </Text>
                              </View>
                            ))}
                          </View>
                          {hourBands.some((b) => b.avg != null && b.sparse) ? (
                            <Text style={{ color: THEME.muted, fontSize: 10, marginTop: 8 }}>
                              {t("insights.heatStripSparseNote")}
                            </Text>
                          ) : null}
                        </>
                      )}
                    </GlassCard>
                  ) : null}

                  {/* ── Patterns (descriptive observations) ───────────────── */}
                  {premium && patterns.length > 0 ? (
                    <React.Fragment key="patterns">
                    <SectionTitle>{t("insights.patternsTitle")}</SectionTitle>
                    {patterns.map((p, i) => (
                      <View
                        key={`${p.kind}-${i}`}
                        className="flex-row items-start rounded-2xl bg-glass border border-hair p-3.5 mb-2"
                      >
                        <Ionicons name="bulb-outline" size={16} color={BRAND} />
                        <Text
                          style={{
                            color: THEME.ink,
                            fontSize: 13,
                            lineHeight: 19,
                            marginLeft: 10,
                            flex: 1,
                          }}
                        >
                          {patternText(p)}
                        </Text>
                      </View>
                    ))}
                    </React.Fragment>
                  ) : null}

                  {/* ── Injections (Pro, insulin users) ───────────────────── */}
                  {premium && showsInjections ? (
                    <React.Fragment key="injections">
                    <SectionTitle>{t("injection.title")}</SectionTitle>
                    {data.injectionCount === 0 ? (
                      <Text
                        style={{
                          color: THEME.muted,
                          fontSize: 13,
                          paddingHorizontal: 6,
                          paddingVertical: 8,
                        }}
                      >
                        {t("injection.empty")}
                      </Text>
                    ) : (
                      <>
                        <View className="flex-row" style={{ gap: 8 }}>
                          <StatCard
                            glass
                            label={t("insights.injectionsCount")}
                            display={String(data.injectionCount)}
                            style={{ flex: 1 }}
                          />
                          <StatCard
                            glass
                            label={t("insights.avgDose")}
                            display={
                              data.avgDailyDose == null
                                ? "-"
                                : num(Math.round(data.avgDailyDose * 10) / 10)
                            }
                            suffix={t("common.units")}
                            style={{ flex: 1 }}
                          />
                        </View>

                        {/* Basal / Bolus split */}
                        {data.basalPct != null ? (
                          <GlassCard style={{ marginTop: 12 }}>
                            <Text style={{ color: THEME.ink, fontWeight: "800", marginBottom: 12 }}>
                              {t("insights.basalBolus")}
                            </Text>
                            <View
                              className="h-3 rounded-full overflow-hidden flex-row"
                              style={{ backgroundColor: THEME.track }}
                            >
                              <Seg pct={data.basalPct} color={BRAND} />
                              <Seg pct={100 - data.basalPct} color={AMBER} />
                            </View>
                            <View className="flex-row justify-between mt-3">
                              <View className="flex-row items-center">
                                <View
                                  className="w-2.5 h-2.5 rounded-full mr-1.5"
                                  style={{ backgroundColor: BRAND }}
                                />
                                <Text style={{ color: THEME.muted, fontSize: 11 }}>
                                  {t("insights.basal")}{" "}
                                  {num(Math.round(data.basalUnits * 10) / 10)}{" "}
                                  {t("common.units")}
                                </Text>
                              </View>
                              <View className="flex-row items-center">
                                <View
                                  className="w-2.5 h-2.5 rounded-full mr-1.5"
                                  style={{ backgroundColor: AMBER }}
                                />
                                <Text style={{ color: THEME.muted, fontSize: 11 }}>
                                  {t("insights.bolus")}{" "}
                                  {num(Math.round(data.bolusUnits * 10) / 10)}{" "}
                                  {t("common.units")}
                                </Text>
                              </View>
                            </View>
                          </GlassCard>
                        ) : null}

                        {/* Most-used site */}
                        {data.mostUsedSite ? (
                          <GlassCard style={{ marginTop: 12, flexDirection: "row", alignItems: "center" }}>
                            <IconTile icon="body-outline" size={38} radius={12} hero />
                            <View className="flex-1 ml-3">
                              <Text style={{ color: THEME.muted, fontSize: 11 }}>
                                {t("insights.mostUsedSite")}
                              </Text>
                              <Text style={{ color: THEME.ink, fontWeight: "800", marginTop: 2 }}>
                                {t(`injectionSite.${data.mostUsedSite}`)}
                              </Text>
                            </View>
                            <Text
                              style={[TABULAR, { color: THEME.ink, fontWeight: "800" }]}
                            >
                              {data.mostUsedSiteCount}
                            </Text>
                          </GlassCard>
                        ) : null}

                        {/* Site distribution */}
                        {usedSites.length > 0 ? (
                          <GlassCard style={{ marginTop: 12 }}>
                            <Text style={{ color: THEME.ink, fontWeight: "800", marginBottom: 12 }}>
                              {t("insights.siteDistribution")}
                            </Text>
                            {usedSites.map((sc) => (
                              <View key={sc.site} className="flex-row items-center mb-2">
                                {/* 112px at scale 0.85 could not hold "Abdomen
                                    superior izquierdo" or "Abdomen inférieur
                                    gauche", so those clipped. Wider column, two
                                    lines allowed, and a floor low enough that no
                                    region name is ever cut. */}
                                <Text
                                  style={{ color: THEME.muted, fontSize: 11, width: 132, paddingRight: 8 }}
                                  numberOfLines={2}
                                  adjustsFontSizeToFit
                                  minimumFontScale={0.7}
                                >
                                  {t(`injectionSite.${sc.site}`)}
                                </Text>
                                <View
                                  className="flex-1 h-2 rounded-full overflow-hidden mr-2"
                                  style={{ backgroundColor: THEME.track }}
                                >
                                  <View
                                    className="h-2 rounded-full"
                                    style={{
                                      width: `${(sc.count / maxSite) * 100}%`,
                                      backgroundColor: BRAND,
                                    }}
                                  />
                                </View>
                                <Text
                                  style={[
                                    TABULAR,
                                    { color: THEME.muted, fontSize: 11, width: 24, textAlign: "right" },
                                  ]}
                                >
                                  {sc.count}
                                </Text>
                              </View>
                            ))}
                          </GlassCard>
                        ) : null}
                      </>
                    )}
                    </React.Fragment>
                  ) : null}

                  {/* ── From Apple Health (Pro, read-only) ────────────────── */}
                  {/* While the first Health read is still in flight, this
                      reserves the SAME shape (title + one StatCard row + a
                      footnote line) the real card below renders, so the
                      section settling in - or collapsing to nothing, if
                      there is no data - never shoves the disclaimer/upsell
                      card under it. */}
                  {initialHealthPending && !healthSettled ? (
                    <React.Fragment key="health-pending">
                    <SectionTitle>{t("insights.healthTitle")}</SectionTitle>
                    <View className="flex-row" style={{ gap: 8 }}>
                      <StatCardSkeleton label={t("insights.activeMinutes")} />
                      <StatCardSkeleton label={t("insights.healthBasal")} />
                    </View>
                    <View style={{ marginTop: 8, paddingHorizontal: 6 }}>
                      <Skeleton width="90%" height={11} />
                    </View>
                    </React.Fragment>
                  ) : premium &&
                  health &&
                  (health.activeMinutes != null || health.insulin != null) ? (
                    <React.Fragment key="health">
                    <SectionTitle>{t("insights.healthTitle")}</SectionTitle>
                    <View className="flex-row" style={{ gap: 8 }}>
                      {health.activeMinutes != null ? (
                        <StatCard
                          glass
                          label={t("insights.activeMinutes")}
                          display={String(health.activeMinutes)}
                          suffix={t("insights.minShort")}
                          style={{ flex: 1 }}
                        />
                      ) : null}
                      {health.insulin != null ? (
                        <>
                          <StatCard
                            glass
                            label={t("insights.healthBasal")}
                            display={num(health.insulin.basalUnits)}
                            suffix={t("common.units")}
                            style={{ flex: 1 }}
                          />
                          <StatCard
                            glass
                            label={t("insights.healthBolus")}
                            display={num(health.insulin.bolusUnits)}
                            suffix={t("common.units")}
                            style={{ flex: 1 }}
                          />
                        </>
                      ) : null}
                    </View>
                    <Text
                      style={{
                        color: THEME.muted,
                        fontSize: 11,
                        lineHeight: 16,
                        marginTop: 8,
                        paddingHorizontal: 6,
                      }}
                    >
                      {t("insights.healthNote")}
                    </Text>
                    </React.Fragment>
                  ) : null}
                </CardGrid>

                {/* Descriptive disclaimer */}
                <View className="flex-row items-start rounded-2xl bg-glass border border-hair p-3.5 mt-5">
                  <Ionicons name="information-circle-outline" size={15} color={THEME.muted} />
                  <Text
                    style={{
                      color: THEME.muted,
                      fontSize: 11,
                      lineHeight: 17,
                      marginLeft: 10,
                      flex: 1,
                    }}
                  >
                    {t("insights.disclaimer")}
                  </Text>
                </View>

                {/* Sources link */}
                <Pressable
                  onPress={() => router.push("/sources")}
                  className="flex-row items-center justify-center mt-4 py-2"
                >
                  <Ionicons name="information-circle-outline" size={14} color={BRAND} />
                  <Text style={{ color: BRAND, fontSize: 12, marginLeft: 6 }}>
                    {t("sources.calcLink")}
                  </Text>
                </Pressable>

                {/* The terms on this screen (TIR, GMI) are exactly what Spike
                    explains, so the question starts prefilled - not sent. */}
                <Pressable
                  onPress={() =>
                    router.push({ pathname: "/spike", params: { ask: "suggest2" } })
                  }
                  className="flex-row items-center justify-center py-2"
                  accessibilityRole="button"
                  accessibilityLabel={t("spike.askSpike")}
                >
                  <Ionicons name="sparkles-outline" size={14} color={BRAND} />
                  <Text style={{ color: BRAND, fontSize: 12, marginLeft: 6 }}>
                    {t("spike.askSpike")}
                  </Text>
                </Pressable>

                {/* Free 7-day: nudge to Pro for the longer windows */}
                {!premium ? (
                  <Pressable
                    onPress={() =>
                      router.push({ pathname: "/paywall", params: { reason: "insights" } })
                    }
                    className="rounded-2xl p-4 mt-4 flex-row items-center active:opacity-80"
                    style={{
                      borderWidth: 1,
                      borderColor: withAlpha(BRAND, 0.3),
                      backgroundColor: withAlpha(BRAND, 0.1),
                    }}
                  >
                    <Ionicons name="sparkles" size={18} color={BRAND} />
                    <Text
                      style={{
                        color: BRAND,
                        fontSize: 13,
                        fontWeight: "600",
                        flex: 1,
                        marginLeft: 10,
                      }}
                    >
                      {t("insights.freeUpsell")}
                    </Text>
                    <DirIcon name="chevron-forward" size={16} color={BRAND} />
                  </Pressable>
                ) : null}

                {/* The doctor-ready PDF, offered where the summaries it is made
                    of are actually being read - the same locked-row shape as
                    the window nudge above, with its own paywall source so the
                    two can be told apart. */}
                {!premium ? (
                  <Pressable
                    onPress={() =>
                      router.push({ pathname: "/paywall", params: { reason: "export" } })
                    }
                    className="rounded-2xl p-4 mt-2 flex-row items-center active:opacity-80"
                    style={{
                      borderWidth: 1,
                      borderColor: withAlpha(BRAND, 0.3),
                      backgroundColor: withAlpha(BRAND, 0.1),
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={t("insights.reportUpsellTitle")}
                  >
                    <Ionicons name="document-text-outline" size={18} color={BRAND} />
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={{ color: BRAND, fontSize: 13, fontWeight: "600" }}>
                        {t("insights.reportUpsellTitle")}
                      </Text>
                      <Text style={{ color: THEME.muted, fontSize: 11, marginTop: 2 }}>
                        {t("insights.reportUpsellBody")}
                      </Text>
                    </View>
                    <DirIcon name="chevron-forward" size={16} color={BRAND} />
                  </Pressable>
                ) : null}
              </View>

              {/* Locked (free 30/90): blurred preview + unlock card */}
              {locked ? (
                <BlurView
                  intensity={24}
                  tint="dark"
                  style={StyleSheet.absoluteFill}
                  className="items-center justify-center overflow-hidden rounded-2xl"
                  accessibilityViewIsModal
                >
                  <View className="items-center px-8">
                    <IconTile icon="lock-closed" size={56} radius={18} hero />
                    <Text
                      style={{
                        color: THEME.ink,
                        fontSize: 18,
                        fontWeight: "800",
                        textAlign: "center",
                        marginTop: 12,
                      }}
                    >
                      {t("insights.lockedTitle")}
                    </Text>
                    <Text
                      style={{
                        color: THEME.muted,
                        textAlign: "center",
                        marginTop: 8,
                        marginBottom: 18,
                        lineHeight: 20,
                      }}
                    >
                      {t("insights.lockedBody")}
                    </Text>
                    <GradientCTA
                      label={t(proCta.key, proCta.params)}
                      onPress={() =>
                        router.push({ pathname: "/paywall", params: { reason: "insights" } })
                      }
                      style={{ alignSelf: "stretch" }}
                    />
                  </View>
                </BlurView>
              ) : null}
            </View>
          )}
        </ScrollView>
      )}
      <DateRangePicker
        visible={rangePickerOpen}
        minDate={activeProfile ? new Date(activeProfile.created_at) : new Date(2020, 0, 1)}
        maxDate={new Date()}
        initialStart={customRange ? new Date(customRange.start) : new Date(Date.now() - 30 * 86_400_000)}
        initialEnd={customRange ? new Date(customRange.end) : new Date()}
        locale={formatLocale()}
        onCancel={() => setRangePickerOpen(false)}
        onConfirm={(r: PickedRange) => {
          setRangePickerOpen(false);
          setCustomRange({ start: r.start, end: r.end });
        }}
      />
    </AppBackground>
  );
}
