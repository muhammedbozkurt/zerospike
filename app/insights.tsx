import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { useApp } from "../lib/store/AppContext";
import { listSugarLogs, listMealLogs } from "../lib/db/logs";
import { getInjections } from "../lib/db/injections";
import type { Injection, MealLog, SugarLog } from "../lib/db/types";
import { formatGlucose, glucoseUnitLabel } from "../lib/glucose";
import {
  computeInsights,
  derivePatterns,
  INSIGHTS_WINDOW_DAYS,
  INSIGHTS_WINDOWS,
  type DayKind,
  type InsightPattern,
} from "../lib/insights";
import { Button, Segmented } from "../components/ui";
import { num } from "../lib/format";

const GREEN = "#10b981";
const ROSE = "#f43f5e";
const AMBER = "#f59e0b";
const BRAND = "#22d3ee";

function Tile({
  label,
  value,
  unit,
  color = "#fafafa",
}: {
  label: string;
  value: string;
  unit?: string;
  color?: string;
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
    mgdl == null ? "—" : formatGlucose(mgdl, unit);

  // Optional ?window=7|14|30 (e.g. from the dashboard "This week" card).
  const { window: windowParam } = useLocalSearchParams<{ window?: string }>();
  const initialWindow = (INSIGHTS_WINDOWS as readonly number[]).includes(
    Number(windowParam)
  )
    ? Number(windowParam)
    : INSIGHTS_WINDOW_DAYS;

  const [loading, setLoading] = useState(true);
  const [windowDays, setWindowDays] = useState<number>(initialWindow);
  const [sugar, setSugar] = useState<SugarLog[]>([]);
  const [meals, setMeals] = useState<MealLog[]>([]);
  const [injections, setInjections] = useState<Injection[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!isProUser || !activeProfile) {
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

  const round = (n: number | null) => (n == null ? "—" : String(Math.round(n)));
  const pct = (n: number | null) => (n == null ? "—" : `${Math.round(n)}`);

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

  const Header = (
    <View className="flex-row items-center px-4 py-2">
      <Pressable onPress={() => router.back()} hitSlop={10} className="p-1 mr-2">
        <Ionicons name="chevron-back" size={26} color="#a1a1aa" />
      </Pressable>
      <Text className="text-zinc-50 text-xl font-bold">{t("insights.title")}</Text>
    </View>
  );

  // ── Pro gate ──────────────────────────────────────────────────────────────
  if (!isProUser) {
    return (
      <View className="flex-1 bg-zinc-950" style={{ paddingTop: insets.top }}>
        {Header}
        <View className="flex-1 items-center justify-center px-8">
          <View className="w-16 h-16 rounded-3xl bg-brand/15 items-center justify-center mb-4">
            <Ionicons name="stats-chart" size={28} color={BRAND} />
          </View>
          <Text className="text-zinc-50 text-xl font-bold text-center">
            {t("insights.lockedTitle")}
          </Text>
          <Text className="text-zinc-400 text-center mt-2 mb-6">
            {t("insights.lockedBody")}
          </Text>
          <View className="w-full">
            <Button
              label={t("paywall.cta")}
              size="lg"
              onPress={() => router.push("/paywall")}
            />
          </View>
        </View>
      </View>
    );
  }

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
          {/* Window selector */}
          <Segmented
            options={INSIGHTS_WINDOWS.map((d) => ({
              value: String(d),
              label: t("insights.windowDays", { n: d }),
            }))}
            value={String(windowDays)}
            onChange={(v) => setWindowDays(Number(v))}
            className="mb-3"
          />

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
            <>
              {/* ── Glucose ───────────────────────────────────────────────── */}
              {data.readings > 0 ? (
                <>
                  <View className="flex-row flex-wrap -m-1.5">
                    <Tile
                      label={t("insights.avgGlucose")}
                      value={fmtG(data.avgGlucose)}
                      unit={glucoseUnitLabel(unit)}
                      color={BRAND}
                    />
                    <Tile
                      label={t("insights.timeInRange")}
                      value={pct(data.inRangePct)}
                      unit="%"
                      color={GREEN}
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
                    <View className="h-3 rounded-full overflow-hidden flex-row bg-zinc-800">
                      <Seg pct={data.lowPct ?? 0} color={ROSE} />
                      <Seg pct={data.inRangePct ?? 0} color={GREEN} />
                      <Seg pct={data.highPct ?? 0} color={AMBER} />
                    </View>
                    <View className="flex-row justify-between mt-3">
                      <View className="flex-row items-center">
                        <View className="w-2.5 h-2.5 rounded-full mr-1.5" style={{ backgroundColor: ROSE }} />
                        <Text className="text-zinc-400 text-xs">
                          {t("insights.low")} {pct(data.lowPct)}%
                        </Text>
                      </View>
                      <View className="flex-row items-center">
                        <View className="w-2.5 h-2.5 rounded-full mr-1.5" style={{ backgroundColor: GREEN }} />
                        <Text className="text-zinc-400 text-xs">
                          {t("insights.inRange")} {pct(data.inRangePct)}%
                        </Text>
                      </View>
                      <View className="flex-row items-center">
                        <View className="w-2.5 h-2.5 rounded-full mr-1.5" style={{ backgroundColor: AMBER }} />
                        <Text className="text-zinc-400 text-xs">
                          {t("insights.high")} {pct(data.highPct)}%
                        </Text>
                      </View>
                    </View>
                    <Text className="text-zinc-600 text-[11px] mt-3">
                      {t("insights.inRange")} = {formatGlucose(70, unit)}–
                      {formatGlucose(180, unit)} {glucoseUnitLabel(unit)}
                    </Text>
                  </View>

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
                      value={data.glucoseCV == null ? "—" : String(Math.round(data.glucoseCV))}
                      unit="%"
                    />
                    <Tile label={t("insights.lows")} value={String(data.hypoCount)} color={ROSE} />
                    <Tile
                      label={t("insights.gmi")}
                      value={data.gmi == null ? "—" : data.gmi.toFixed(1)}
                      unit="%"
                      color={BRAND}
                    />
                  </View>
                  <Text className="text-zinc-600 text-[11px] mt-1 px-1.5 leading-4">
                    {t("insights.variabilityNote")}
                  </Text>

                  {/* Average by time of day */}
                  <SectionTitle>{t("insights.hourlyTitle")}</SectionTitle>
                  <View className="flex-row flex-wrap -m-1.5">
                    {SLICES.map((slice) => (
                      <Tile
                        key={slice}
                        label={t(`insights.${slice}`)}
                        value={fmtG(data.hourly[slice])}
                        unit={glucoseUnitLabel(unit)}
                      />
                    ))}
                  </View>

                  <Text className="text-zinc-600 text-[11px] mt-4 px-1.5 leading-4">
                    {t("insights.gmiNote")}
                  </Text>
                </>
              ) : null}

              {/* ── Patterns (descriptive observations) ───────────────────── */}
              {patterns.length > 0 ? (
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

              {/* ── Injections ────────────────────────────────────────────── */}
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
                      value={data.avgDailyDose == null ? "—" : num(Math.round(data.avgDailyDose * 10) / 10)}
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
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}
