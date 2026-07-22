import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { useApp } from "../lib/store/AppContext";
import { listSugarLogs, listMealLogs } from "../lib/db/logs";
import { getInjections } from "../lib/db/injections";
import { readHealthSummary, type HealthSummary } from "../lib/services/health";
import type { Injection, MealLog, SugarLog } from "../lib/db/types";
import { formatGlucose, glucoseUnitLabel } from "../lib/glucose";
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
  type DayKind,
  type InsightPattern,
  type WeeklySentence,
} from "../lib/insights";
import { insulinModeUsesInsulin } from "../lib/insulinMode";
import { maybeReviewOnWeeklyView } from "../lib/services/review";
import { ChartCard } from "../components/charts/ChartCard";
import { HourlyChart } from "../components/charts/HourlyChart";
import { TrendChart } from "../components/charts/TrendChart";
import { CHART, CHART_HEIGHT } from "../components/charts/theme";
import { StatCard } from "../components/StatCard";
import { ScreenHeader } from "../components/ScreenHeader";
import { useFeedback } from "../components/Feedback";
import { logEvent } from "../lib/analytics";
import { num } from "../lib/format";
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
import { GLUCOSE_RICH, TABULAR, THEME, glow } from "../lib/theme/tokens";

const GREEN = GLUCOSE_RICH.target;
const AMBER = GLUCOSE_RICH.high;
const BRAND = THEME.accent;

/** Two points make a line; one is just a dot. */
const TREND_MIN_DAYS = 2;

function Seg({ pct, color }: { pct: number; color: string }) {
  if (pct <= 0) return null;
  return <View style={{ width: `${pct}%`, backgroundColor: color }} className="h-full" />;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Text className="text-xs font-semibold uppercase tracking-wider text-mut mt-5 mb-2 px-1.5">
      {children}
    </Text>
  );
}

const SLICES: DayKind[] = ["night", "morning", "afternoon", "evening"];

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
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { activeProfile, isProUser } = useApp();
  const { actionSheet } = useFeedback();
  const unit = activeProfile?.glucose_unit ?? "mgdl";
  const fmtG = (mgdl: number | null) =>
    mgdl == null ? "-" : formatGlucose(mgdl, unit);

  // The band every figure on this screen is measured against: the profile's own.
  const band = useMemo(() => targetBandFor(activeProfile ?? {}), [activeProfile]);
  const tirBand = useMemo(() => ({ low: band.low, high: band.high }), [band]);

  // Optional ?window=7|14|30 (e.g. from the dashboard "This week" card).
  const { window: windowParam } = useLocalSearchParams<{ window?: string }>();
  const initialWindow = (INSIGHTS_WINDOWS as readonly number[]).includes(
    Number(windowParam)
  )
    ? Number(windowParam)
    : isProUser
      ? INSIGHTS_WINDOW_DAYS
      : FREE_INSIGHTS_WINDOW;

  const [loading, setLoading] = useState(true);
  const [windowDays, setWindowDays] = useState<number>(initialWindow);

  useEffect(() => {
    logEvent("insights_view", { window: windowDays });
  }, [windowDays]);

  const [sugar, setSugar] = useState<SugarLog[]>([]);
  const [meals, setMeals] = useState<MealLog[]>([]);
  const [injections, setInjections] = useState<Injection[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!activeProfile) {
        setLoading(false);
        return;
      }
      const [s, m, inj] = await Promise.all([
        listSugarLogs(activeProfile.id, 2000),
        listMealLogs(activeProfile.id, 2000),
        getInjections(activeProfile.id, 2000),
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
  }, [isProUser, activeProfile]);

  // Recompute locally when the window changes (no reload).
  const data = useMemo(
    () => computeInsights(sugar, meals, injections, windowDays, tirBand),
    [sugar, meals, injections, windowDays, tirBand]
  );

  const pct = (n: number | null) => (n == null ? "-" : `${Math.round(n)}`);

  // Descriptive patterns from the user's own readings (never causal/advice).
  const patterns = useMemo(
    () => derivePatterns(sugar, windowDays),
    [sugar, windowDays]
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
        return t("insights.patternHighVariability", { cv: p.cv });
    }
  };

  // Trend vs the previous equal-length window, and the window percentile summary.
  const trend = useMemo(
    () => trendVsPrevious(sugar, windowDays, tirBand),
    [sugar, windowDays, tirBand]
  );
  const pctile = useMemo(
    () => windowPercentiles(sugar, windowDays),
    [sugar, windowDays]
  );
  // Free users see only the 7-day basic summary fully; 30/90 render as a blurred
  // preview behind a lock (curiosity gap, not an empty screen).
  const locked = !isProUser && windowDays !== FREE_INSIGHTS_WINDOW;
  const premium = isProUser || locked;
  const showsInjections = insulinModeUsesInsulin(activeProfile?.insulin_mode);

  // Pro "from Health" summary: activity minutes + insulin delivery (read-only).
  const [health, setHealth] = useState<HealthSummary | null>(null);
  useEffect(() => {
    // iOS-only (Health Connect removed for Play policy).
    if (!isProUser || Platform.OS !== "ios") return;
    let alive = true;
    readHealthSummary(windowDays)
      .then((h) => alive && setHealth(h))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [isProUser, windowDays]);

  // Weekly digest (Pro): rule-based, descriptive sentences comparing this week
  // to last. Viewing it is one of the review-prompt triggers.
  const digest = useMemo(() => weeklyDigest(sugar, tirBand), [sugar, tirBand]);
  useEffect(() => {
    if (isProUser && !loading && digest.length > 0) void maybeReviewOnWeeklyView();
  }, [isProUser, loading, digest.length]);
  const weeklyText = (s: WeeklySentence): string => {
    const u = glucoseUnitLabel(unit);
    switch (s.kind) {
      case "tir":
        return s.delta >= 0
          ? t("insights.weeklyTirUp", { tir: s.tir, points: Math.abs(s.delta) })
          : t("insights.weeklyTirDown", { tir: s.tir, points: Math.abs(s.delta) });
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
  const agp = useMemo(() => computeAgp(sugar, windowDays), [sugar, windowDays]);
  const trendDays = useMemo(
    () => dailyAverages(sugar, windowDays),
    [sugar, windowDays]
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

  // The window's first day, for the trend chart's left axis label.
  const windowStartLabel = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - (windowDays - 1));
    const two = (n: number) => (n < 10 ? `0${n}` : `${n}`);
    return `${two(d.getDate())}.${two(d.getMonth() + 1)}`;
  }, [windowDays]);

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
      ? `${trend.tirDelta >= 0 ? "▲" : "▼"} ${Math.abs(
          Math.round(trend.tirDelta)
        )}% ${t("insights.vsPrevious")}`
      : undefined;

  /** The mockup's header chip: the active window, opening the window picker. */
  function openWindowPicker() {
    actionSheet({
      title: t("insights.title"),
      actions: INSIGHTS_WINDOWS.map((d) => ({
        label:
          !isProUser && d !== FREE_INSIGHTS_WINDOW
            ? `${t("insights.windowDays", { n: d })} · ${t("common.pro")}`
            : t("insights.windowDays", { n: d }),
        icon: (!isProUser && d !== FREE_INSIGHTS_WINDOW
          ? "lock-closed"
          : "calendar-outline") as keyof typeof Ionicons.glyphMap,
        onPress: () => setWindowDays(d),
      })),
    });
  }

  const isEmpty =
    data.readings === 0 && data.injectionCount === 0 && data.meals === 0;
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
            <Text style={{ color: THEME.ink, fontSize: 11, fontWeight: "700" }}>
              {t("insights.windowDays", { n: windowDays })}
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

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={BRAND} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
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
            <View>
              <View pointerEvents={locked ? "none" : "auto"}>
                {/* ── Glucose ─────────────────────────────────────────────── */}
                {data.readings > 0 ? (
                  <>
                    {/* HERO: the time-in-range donut (mockup's signature) */}
                    <GlassCard glow={GREEN} style={{ marginBottom: 10 }}>
                      <View className="flex-row items-center justify-between mb-1">
                        <Text
                          style={{
                            color: THEME.muted,
                            fontSize: 9,
                            letterSpacing: 1.3,
                            textTransform: "uppercase",
                            fontWeight: "800",
                          }}
                        >
                          {t("insights.timeInRange")}
                        </Text>
                        <GlucoseChip
                          status="normal"
                          dot={false}
                          label={`${pct(data.inRangePct)}%`}
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
                          centerValue={pct(data.inRangePct)}
                          centerSuffix="%"
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
                            <View key={name} className="flex-row items-center">
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
                                  marginLeft: 8,
                                }}
                              >
                                {name}
                              </Text>
                              <Text style={[TABULAR, { color: THEME.muted, fontSize: 12 }]}>
                                {value == null ? "-" : `${Math.round(value)}%`}
                              </Text>
                            </View>
                          ))}
                        </View>
                      </View>
                      <Text style={{ color: THEME.muted, fontSize: 11, marginTop: 10 }}>
                        {t("glucose.bandLabel", {
                          min: formatGlucose(band.low, unit),
                          max: formatGlucose(band.high, unit),
                          unit: u,
                        })}
                      </Text>
                    </GlassCard>

                    {/* AGP as the mockup's gradient area curve */}
                    <GlassCard style={{ marginBottom: 10 }}>
                      <Text
                        style={{
                          color: THEME.muted,
                          fontSize: 9,
                          letterSpacing: 1.3,
                          textTransform: "uppercase",
                          fontWeight: "800",
                          marginBottom: 8,
                        }}
                      >
                        {t("insights.agpTitle")}
                      </Text>
                      {agpCurve.length >= 2 ? (
                        <>
                          <GradientAreaChart
                            data={agpCurve}
                            height={84}
                            targetBand={{ min: band.low, max: band.high }}
                            style={{ alignSelf: "stretch", width: "100%" }}
                          />
                          <View className="flex-row justify-between mt-1">
                            {["00", "06", "12", "18", "24"].map((h) => (
                              <Text key={h} style={{ color: THEME.muted, fontSize: 10 }}>
                                {h}
                              </Text>
                            ))}
                          </View>
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

                    {/* The mockup's StatCard strip */}
                    <View className="flex-row" style={{ gap: 8 }}>
                      <StatCard
                        glass
                        glow={data.gmi != null}
                        label={t("insights.gmi")}
                        display={data.gmi == null ? "-" : data.gmi.toFixed(1)}
                        suffix={data.gmi == null ? undefined : "%"}
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
                        display={pct(data.inRangePct)}
                        suffix="%"
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

                    {/* Weekly digest (Pro): this week vs last, in sentences */}
                    {isProUser && digest.length > 0 ? (
                      <GlassCard accent style={{ marginTop: 12 }}>
                        <View className="flex-row items-center mb-2">
                          <Ionicons name="calendar-outline" size={15} color={BRAND} />
                          <Text
                            style={{
                              color: BRAND,
                              fontSize: 10,
                              fontWeight: "800",
                              letterSpacing: 1.2,
                              textTransform: "uppercase",
                              marginLeft: 8,
                            }}
                          >
                            {t("insights.weeklyTitle")}
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

                    {/* Daily average over the window, with a neutral delta chip */}
                    {premium ? (
                      <ChartCard
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
                            windowDays={windowDays}
                            unit={unit}
                            width={w}
                            height={CHART_HEIGHT.trend}
                            startLabel={windowStartLabel}
                            endLabel={t("common.today")}
                            band={band}
                          />
                        )}
                      </ChartCard>
                    ) : null}

                    {/* Percentile band summary (AGP numeric), Pro */}
                    {premium && pctile ? (
                      <GlassCard style={{ marginTop: 12 }}>
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

                    {premium ? (
                      <>
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
                            display={
                              data.glucoseCV == null
                                ? "-"
                                : String(Math.round(data.glucoseCV))
                            }
                            suffix="%"
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

                        {/* Average by time of day */}
                        <ChartCard
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
                      </>
                    ) : null}
                  </>
                ) : null}

                {/* ── Patterns (descriptive observations) ─────────────────── */}
                {premium && patterns.length > 0 ? (
                  <>
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
                  </>
                ) : null}

                {/* ── Injections (Pro, insulin users) ─────────────────────── */}
                {premium && showsInjections ? (
                  <>
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
                                <Text
                                  style={{ color: THEME.muted, fontSize: 11, width: 112, paddingRight: 8 }}
                                  numberOfLines={1}
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
                  </>
                ) : null}

                {/* ── From Apple Health (Pro, read-only) ──────────────────── */}
                {premium &&
                health &&
                (health.activeMinutes != null || health.insulin != null) ? (
                  <>
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
                  </>
                ) : null}

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

                {/* Free 7-day: nudge to Pro for the longer windows */}
                {!premium ? (
                  <Pressable
                    onPress={() => router.push("/paywall")}
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
                    <Ionicons name="chevron-forward" size={16} color={BRAND} />
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
                      label={t("paywall.cta")}
                      onPress={() => router.push("/paywall")}
                      style={{ alignSelf: "stretch" }}
                    />
                  </View>
                </BlurView>
              ) : null}
            </View>
          )}
        </ScrollView>
      )}
    </AppBackground>
  );
}
