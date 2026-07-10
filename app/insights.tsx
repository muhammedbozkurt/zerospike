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
import { AGP_MIN_READINGS, computeAgp } from "../lib/agp";
import {
  computeInsights,
  dailyAverages,
  derivePatterns,
  trendVsPrevious,
  windowPercentiles,
  weeklyDigest,
  FREE_INSIGHTS_WINDOW,
  INSIGHTS_WINDOW_DAYS,
  INSIGHTS_WINDOWS,
  type DayKind,
  type InsightPattern,
  type WeeklySentence,
} from "../lib/insights";
import { maybeReviewOnWeeklyView } from "../lib/services/review";
import { Button } from "../components/ui";
import { ChartCard } from "../components/charts/ChartCard";
import { DailyProfileChart } from "../components/charts/DailyProfileChart";
import { HourlyChart } from "../components/charts/HourlyChart";
import { TimeInRangeBar } from "../components/charts/TimeInRangeBar";
import { TrendChart } from "../components/charts/TrendChart";
import { CHART, CHART_HEIGHT } from "../components/charts/theme";
import { logEvent } from "../lib/analytics";
import { num } from "../lib/format";

const GREEN = "#10b981";
const AMBER = "#f59e0b";
const BRAND = "#22d3ee";

/** Two points make a line; one is just a dot. */
const TREND_MIN_DAYS = 2;

function Tile({
  label,
  value,
  unit,
  color = "#fafafa",
  sub,
}: {
  label: string;
  value: string;
  unit?: string;
  color?: string;
  sub?: string;
}) {
  return (
    <View className="w-1/2 p-1.5">
      <View className="rounded-2xl bg-zinc-900 border border-zinc-800 p-4">
        <Text className="text-zinc-500 text-xs">{label}</Text>
        <View className="flex-row items-baseline mt-1">
          <Text className="text-2xl font-bold" style={{ color }}>
            {value}
          </Text>
          {unit ? <Text className="text-zinc-500 text-xs ml-1">{unit}</Text> : null}
        </View>
        {sub ? <Text className="text-zinc-500 text-[11px] mt-1">{sub}</Text> : null}
      </View>
    </View>
  );
}

function Seg({ pct, color }: { pct: number; color: string }) {
  if (pct <= 0) return null;
  return <View style={{ width: `${pct}%`, backgroundColor: color }} className="h-full" />;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Text className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mt-5 mb-2 px-1.5">
      {children}
    </Text>
  );
}

const SLICES: DayKind[] = ["night", "morning", "afternoon", "evening"];

export default function InsightsScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { activeProfile, isProUser } = useApp();
  const unit = activeProfile?.glucose_unit ?? "mgdl";
  const fmtG = (mgdl: number | null) =>
    mgdl == null ? "-" : formatGlucose(mgdl, unit);

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
    () => computeInsights(sugar, meals, injections, windowDays),
    [sugar, meals, injections, windowDays]
  );

  const round = (n: number | null) => (n == null ? "-" : String(Math.round(n)));
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
    () => trendVsPrevious(sugar, windowDays),
    [sugar, windowDays]
  );
  const pctile = useMemo(
    () => windowPercentiles(sugar, windowDays),
    [sugar, windowDays]
  );
  // Free users see only the 7-day basic summary fully; 30/90 render as a blurred
  // preview behind a lock (curiosity gap, not an empty screen).
  const locked = !isProUser && windowDays !== FREE_INSIGHTS_WINDOW;
  const premium = isProUser || locked;

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
  const digest = useMemo(() => weeklyDigest(sugar), [sugar]);
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

  const Header = (
    <View className="flex-row items-center px-4 py-2">
      <Pressable onPress={() => router.back()} hitSlop={10} className="p-1 mr-2">
        <Ionicons name="chevron-back" size={26} color="#a1a1aa" />
      </Pressable>
      <Text className="text-zinc-50 text-xl font-bold">{t("insights.title")}</Text>
    </View>
  );

  const isEmpty =
    data.readings === 0 && data.injectionCount === 0 && data.meals === 0;
  const maxSite = Math.max(1, ...data.siteDistribution.map((s) => s.count));
  const usedSites = data.siteDistribution
    .filter((s) => s.count > 0)
    .sort((a, b) => b.count - a.count);

  return (
    <View className="flex-1 bg-zinc-950" style={{ paddingTop: insets.top }}>
      {Header}
      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={BRAND} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Weekly digest (Pro): 2-3 descriptive sentences, this week vs last */}
          {isProUser && digest.length > 0 ? (
            <View className="rounded-2xl bg-zinc-900 border border-brand/30 p-4 mb-3">
              <View className="flex-row items-center mb-2">
                <Ionicons name="calendar-outline" size={16} color={BRAND} />
                <Text className="text-brand text-xs font-bold uppercase tracking-wider ml-2">
                  {t("insights.weeklyTitle")}
                </Text>
              </View>
              {digest.map((s, i) => (
                <View key={i} className="flex-row items-start mb-1.5">
                  <Text className="text-zinc-500 mr-2">•</Text>
                  <Text className="text-zinc-200 text-sm leading-5 flex-1">
                    {weeklyText(s)}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          {/* Window selector (30 / 90 are Pro; free previews them blurred) */}
          <View className="flex-row gap-2 mb-3">
            {INSIGHTS_WINDOWS.map((d) => {
              const active = windowDays === d;
              const isLocked = !isProUser && d !== FREE_INSIGHTS_WINDOW;
              return (
                <Pressable
                  key={d}
                  onPress={() => setWindowDays(d)}
                  className={`flex-1 flex-row items-center justify-center rounded-xl border py-2.5 ${
                    active ? "border-brand bg-brand/10" : "border-zinc-800 bg-zinc-900"
                  }`}
                >
                  <Text
                    className={
                      active ? "text-brand font-semibold" : "text-zinc-300"
                    }
                  >
                    {t("insights.windowDays", { n: d })}
                  </Text>
                  {isLocked ? (
                    <Ionicons
                      name="lock-closed"
                      size={12}
                      color="#71717a"
                      style={{ marginLeft: 4 }}
                    />
                  ) : null}
                </Pressable>
              );
            })}
          </View>

          {/* Descriptive disclaimer */}
          <View className="flex-row items-start rounded-2xl border border-zinc-800 bg-zinc-900 p-3.5 mb-2">
            <Ionicons name="information-circle-outline" size={16} color="#71717a" />
            <Text className="text-zinc-500 text-xs leading-5 ml-2.5 flex-1">
              {t("insights.disclaimer")}
            </Text>
          </View>

          {isEmpty ? (
            <View className="items-center py-12">
              <Ionicons name="analytics-outline" size={40} color="#3f3f46" />
              <Text className="text-zinc-400 text-center mt-3">
                {t("insights.empty")}
              </Text>
            </View>
          ) : (
            <View>
              <View pointerEvents={locked ? "none" : "auto"}>
              {/* ── Glucose ───────────────────────────────────────────────── */}
              {data.readings > 0 ? (
                <>
                  <View className="flex-row flex-wrap -m-1.5">
                    <Tile
                      label={t("insights.avgGlucose")}
                      value={fmtG(data.avgGlucose)}
                      unit={glucoseUnitLabel(unit)}
                      color={BRAND}
                      sub={premium ? avgTrend : undefined}
                    />
                    <Tile
                      label={t("insights.timeInRange")}
                      value={pct(data.inRangePct)}
                      unit="%"
                      color={GREEN}
                      sub={premium ? tirTrend : undefined}
                    />
                    <Tile
                      label={t("insights.readings")}
                      value={String(data.readings)}
                    />
                    <Tile label={t("insights.days")} value={String(data.days)} />
                  </View>

                  {/* Time in range bar */}
                  <View className="rounded-2xl bg-zinc-900 border border-zinc-800 p-4 mt-3">
                    <Text className="text-zinc-300 font-semibold mb-3">
                      {t("insights.timeInRange")}
                    </Text>
                    <TimeInRangeBar
                      lowPct={data.lowPct ?? 0}
                      inRangePct={data.inRangePct ?? 0}
                      highPct={data.highPct ?? 0}
                      labels={{
                        low: t("insights.low"),
                        inRange: t("insights.inRange"),
                        high: t("insights.high"),
                      }}
                    />
                    <Text className="text-zinc-600 text-[11px] mt-3">
                      {t("insights.inRange")} = {formatGlucose(70, unit)}-
                      {formatGlucose(180, unit)} {u}
                    </Text>
                  </View>

                  {/* Daily profile (AGP): median + IQR by hour of day (Pro) */}
                  {premium ? (
                    <ChartCard
                      title={t("insights.chartDailyTitle")}
                      subtitle={t("insights.chartDailySub")}
                      legend={[
                        { label: t("insights.chartMedianLegend"), color: CHART.line },
                        { label: t("insights.chartIqrLegend"), color: CHART.band, faded: true },
                        { label: t("insights.chartTargetLegend"), color: CHART.target, faded: true },
                      ]}
                      caption={dailyCaption}
                      emptyNote={
                        agp.totalReadings < AGP_MIN_READINGS
                          ? t("insights.chartNeedMore")
                          : undefined
                      }
                      height={CHART_HEIGHT.dailyProfile}
                    >
                      {(w) => (
                        <DailyProfileChart
                          agp={agp}
                          unit={unit}
                          width={w}
                          height={CHART_HEIGHT.dailyProfile}
                        />
                      )}
                    </ChartCard>
                  ) : null}

                  {/* Daily average over the window, with a neutral delta chip (Pro) */}
                  {premium ? (
                    <ChartCard
                      title={t("insights.chartTrendTitle")}
                      subtitle={t("insights.chartTrendSub")}
                      accessory={
                        avgDeltaChip ? (
                          <View className="rounded-full bg-zinc-800 px-2.5 py-1">
                            <Text className="text-zinc-300 text-[11px] font-semibold">
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
                        />
                      )}
                    </ChartCard>
                  ) : null}

                  {/* Percentile band summary (AGP numeric), Pro */}
                  {premium && pctile ? (
                    <View className="rounded-2xl bg-zinc-900 border border-zinc-800 p-4 mt-3">
                      <Text className="text-zinc-300 font-semibold mb-1">
                        {t("insights.percentileTitle")}
                      </Text>
                      <Text className="text-zinc-500 text-xs mb-3">
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
                              className={`text-base font-bold ${
                                k === "median" ? "text-brand" : "text-zinc-100"
                              }`}
                            >
                              {fmtG(v)}
                            </Text>
                            <Text className="text-zinc-500 text-[10px] mt-0.5">
                              {t(`insights.${k}`)}
                            </Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  ) : null}

                  {premium ? (
                    <>
                  {/* Period + variability + lows */}
                  <View className="flex-row flex-wrap -m-1.5 mt-1.5">
                    <Tile
                      label={t("insights.fasting")}
                      value={fmtG(data.avgFasting)}
                      unit={glucoseUnitLabel(unit)}
                    />
                    <Tile
                      label={t("insights.postMeal")}
                      value={fmtG(data.avgPostMeal)}
                      unit={glucoseUnitLabel(unit)}
                    />
                    <Tile
                      label={t("insights.variability")}
                      value={fmtG(data.glucoseSD)}
                      unit={glucoseUnitLabel(unit)}
                    />
                    <Tile
                      label={t("insights.cv")}
                      value={data.glucoseCV == null ? "-" : String(Math.round(data.glucoseCV))}
                      unit="%"
                    />
                    {/* Blue, not rose: a hypo is never shown in the colour this
                        app reserves for a high (see lib/glucose.ts). */}
                    <Tile
                      label={t("insights.lows")}
                      value={String(data.hypoCount)}
                      color={CHART.low}
                    />
                    <Tile
                      label={t("insights.gmi")}
                      value={data.gmi == null ? "-" : data.gmi.toFixed(1)}
                      unit="%"
                      color={BRAND}
                    />
                  </View>
                  <Text className="text-zinc-600 text-[11px] mt-1 px-1.5 leading-4">
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
                      />
                    )}
                  </ChartCard>

                  <Text className="text-zinc-600 text-[11px] mt-4 px-1.5 leading-4">
                    {t("insights.gmiNote")}
                  </Text>
                    </>
                  ) : null}
                </>
              ) : null}

              {/* ── Patterns (descriptive observations) ───────────────────── */}
              {premium && patterns.length > 0 ? (
                <>
                  <SectionTitle>{t("insights.patternsTitle")}</SectionTitle>
                  {patterns.map((p, i) => (
                    <View
                      key={`${p.kind}-${i}`}
                      className="flex-row items-start rounded-2xl bg-zinc-900 border border-zinc-800 p-3.5 mb-2"
                    >
                      <Ionicons name="bulb-outline" size={16} color={BRAND} />
                      <Text className="text-zinc-300 text-sm leading-5 ml-2.5 flex-1">
                        {patternText(p)}
                      </Text>
                    </View>
                  ))}
                </>
              ) : null}

              {/* ── Injections (Pro) ──────────────────────────────────────── */}
              {premium ? (
                <>
              <SectionTitle>{t("injection.title")}</SectionTitle>
              {data.injectionCount === 0 ? (
                <Text className="text-zinc-600 text-sm px-1.5 py-2">
                  {t("injection.empty")}
                </Text>
              ) : (
                <>
                  <View className="flex-row flex-wrap -m-1.5">
                    <Tile
                      label={t("insights.injectionsCount")}
                      value={String(data.injectionCount)}
                    />
                    <Tile
                      label={t("insights.avgDose")}
                      value={data.avgDailyDose == null ? "-" : num(Math.round(data.avgDailyDose * 10) / 10)}
                      unit={t("common.units")}
                    />
                  </View>

                  {/* Basal / Bolus split */}
                  {data.basalPct != null ? (
                    <View className="rounded-2xl bg-zinc-900 border border-zinc-800 p-4 mt-3">
                      <Text className="text-zinc-300 font-semibold mb-3">
                        {t("insights.basalBolus")}
                      </Text>
                      <View className="h-3 rounded-full overflow-hidden flex-row bg-zinc-800">
                        <Seg pct={data.basalPct} color={BRAND} />
                        <Seg pct={100 - data.basalPct} color={AMBER} />
                      </View>
                      <View className="flex-row justify-between mt-3">
                        <View className="flex-row items-center">
                          <View className="w-2.5 h-2.5 rounded-full mr-1.5" style={{ backgroundColor: BRAND }} />
                          <Text className="text-zinc-400 text-xs">
                            {t("insights.basal")} {num(Math.round(data.basalUnits * 10) / 10)} {t("common.units")}
                          </Text>
                        </View>
                        <View className="flex-row items-center">
                          <View className="w-2.5 h-2.5 rounded-full mr-1.5" style={{ backgroundColor: AMBER }} />
                          <Text className="text-zinc-400 text-xs">
                            {t("insights.bolus")} {num(Math.round(data.bolusUnits * 10) / 10)} {t("common.units")}
                          </Text>
                        </View>
                      </View>
                    </View>
                  ) : null}

                  {/* Most-used site */}
                  {data.mostUsedSite ? (
                    <View className="rounded-2xl bg-zinc-900 border border-zinc-800 p-4 mt-3 flex-row items-center">
                      <View className="w-10 h-10 rounded-full bg-brand/10 items-center justify-center mr-3">
                        <Ionicons name="body-outline" size={20} color={BRAND} />
                      </View>
                      <View className="flex-1">
                        <Text className="text-zinc-500 text-xs">{t("insights.mostUsedSite")}</Text>
                        <Text className="text-zinc-100 font-semibold mt-0.5">
                          {t(`injectionSite.${data.mostUsedSite}`)}
                        </Text>
                      </View>
                      <Text className="text-zinc-300 font-semibold">
                        {data.mostUsedSiteCount}
                      </Text>
                    </View>
                  ) : null}

                  {/* Site distribution */}
                  {usedSites.length > 0 ? (
                    <View className="rounded-2xl bg-zinc-900 border border-zinc-800 p-4 mt-3">
                      <Text className="text-zinc-300 font-semibold mb-3">
                        {t("insights.siteDistribution")}
                      </Text>
                      {usedSites.map((sc) => (
                        <View key={sc.site} className="flex-row items-center mb-2">
                          <Text className="text-zinc-400 text-xs w-28 pr-2" numberOfLines={1}>
                            {t(`injectionSite.${sc.site}`)}
                          </Text>
                          <View className="flex-1 h-2 rounded-full bg-zinc-800 overflow-hidden mr-2">
                            <View
                              className="h-2 rounded-full bg-brand"
                              style={{ width: `${(sc.count / maxSite) * 100}%` }}
                            />
                          </View>
                          <Text className="text-zinc-500 text-xs w-6 text-right">
                            {sc.count}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </>
              )}
                </>
              ) : null}

              {/* ── From Apple Health / Health Connect (Pro, read-only) ─────── */}
              {premium &&
              health &&
              (health.activeMinutes != null || health.insulin != null) ? (
                <>
                  <SectionTitle>{t("insights.healthTitle")}</SectionTitle>
                  <View className="flex-row flex-wrap -m-1.5">
                    {health.activeMinutes != null ? (
                      <Tile
                        label={t("insights.activeMinutes")}
                        value={String(health.activeMinutes)}
                        unit={t("insights.minShort")}
                      />
                    ) : null}
                    {health.insulin != null ? (
                      <>
                        <Tile
                          label={t("insights.healthBasal")}
                          value={num(health.insulin.basalUnits)}
                          unit={t("common.units")}
                        />
                        <Tile
                          label={t("insights.healthBolus")}
                          value={num(health.insulin.bolusUnits)}
                          unit={t("common.units")}
                        />
                      </>
                    ) : null}
                  </View>
                  <Text className="text-zinc-600 text-[11px] mt-1 px-1.5 leading-4">
                    {t("insights.healthNote")}
                  </Text>
                </>
              ) : null}

              {/* Sources link */}
              <Pressable
                onPress={() => router.push("/sources")}
                className="flex-row items-center justify-center mt-6 py-2"
              >
                <Ionicons name="information-circle-outline" size={15} color={BRAND} />
                <Text className="text-brand text-xs underline ml-1.5">
                  {t("sources.calcLink")}
                </Text>
              </Pressable>

              {/* Free 7-day: nudge to Pro for the longer windows */}
              {!premium ? (
                <Pressable
                  onPress={() => router.push("/paywall")}
                  className="rounded-2xl border border-brand/30 bg-brand/10 p-4 mt-4 flex-row items-center active:opacity-80"
                >
                  <Ionicons name="sparkles" size={18} color={BRAND} />
                  <Text className="text-brand text-sm font-medium flex-1 ml-2.5">
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
                    <View className="w-14 h-14 rounded-3xl bg-brand/20 items-center justify-center mb-3">
                      <Ionicons name="lock-closed" size={24} color={BRAND} />
                    </View>
                    <Text className="text-zinc-50 text-lg font-bold text-center">
                      {t("insights.lockedTitle")}
                    </Text>
                    <Text className="text-zinc-300 text-center mt-2 mb-5">
                      {t("insights.lockedBody")}
                    </Text>
                    <Button
                      label={t("paywall.cta")}
                      size="lg"
                      onPress={() => router.push("/paywall")}
                    />
                  </View>
                </BlurView>
              ) : null}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}
