import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { useApp } from "../lib/store/AppContext";
import { listSugarLogs, listMealLogs } from "../lib/db/logs";
import { formatGlucose, glucoseUnitLabel } from "../lib/glucose";
import {
  computeInsights,
  type Insights,
  INSIGHTS_WINDOW_DAYS,
} from "../lib/insights";
import { Button } from "../components/ui";

const GREEN = "#10b981";
const ROSE = "#f43f5e";
const AMBER = "#f59e0b";

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

export default function InsightsScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { activeProfile, isProUser } = useApp();
  const unit = activeProfile?.glucose_unit ?? "mgdl";
  const fmtG = (mgdl: number | null) =>
    mgdl == null ? "—" : formatGlucose(mgdl, unit);

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<Insights | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!isProUser || !activeProfile) {
        setLoading(false);
        return;
      }
      const [sugar, meals] = await Promise.all([
        listSugarLogs(activeProfile.id, 1000),
        listMealLogs(activeProfile.id, 1000),
      ]);
      if (!alive) return;
      setData(computeInsights(sugar, meals));
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [isProUser, activeProfile]);

  const round = (n: number | null) => (n == null ? "—" : String(Math.round(n)));
  const pct = (n: number | null) => (n == null ? "—" : `${Math.round(n)}`);

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
            <Ionicons name="stats-chart" size={28} color="#22d3ee" />
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

  return (
    <View className="flex-1 bg-zinc-950" style={{ paddingTop: insets.top }}>
      {Header}
      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#22d3ee" />
        </View>
      ) : !data || data.readings === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Ionicons name="analytics-outline" size={40} color="#3f3f46" />
          <Text className="text-zinc-400 text-center mt-3">
            {t("insights.empty")}
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
          showsVerticalScrollIndicator={false}
        >
          <Text className="text-zinc-500 text-xs uppercase tracking-wider mb-2 px-1.5">
            {t("insights.subtitle")}
          </Text>

          {/* Summary tiles */}
          <View className="flex-row flex-wrap -m-1.5">
            <Tile
              label={t("insights.avgGlucose")}
              value={fmtG(data.avgGlucose)}
              unit={glucoseUnitLabel(unit)}
              color="#22d3ee"
            />
            <Tile
              label={t("insights.timeInRange")}
              value={pct(data.inRangePct)}
              unit="%"
              color={GREEN}
            />
            <Tile label={t("insights.readings")} value={String(data.readings)} />
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

          {/* Period averages */}
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
              label={t("insights.avgCarbs")}
              value={round(data.avgDailyCarbs)}
              unit="g"
            />
            <Tile
              label={t("insights.gmi")}
              value={data.gmi == null ? "—" : data.gmi.toFixed(1)}
              unit="%"
              color="#22d3ee"
            />
          </View>

          <Text className="text-zinc-600 text-[11px] mt-4 px-1.5 leading-4">
            {t("insights.gmiNote")}
          </Text>
        </ScrollView>
      )}
    </View>
  );
}
