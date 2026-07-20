import React, { useMemo } from "react";
import { ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import Svg, { Path, Line, Rect } from "react-native-svg";

import { Button } from "../ui";
import { GLUCOSE_RICH, THEME, glow } from "../../lib/theme/tokens";
import { FadeSlideIn, useCountUp } from "./motion";
import { computeAgp } from "../../lib/agp";
import {
  formatGlucose,
  glucoseUnitLabel,
} from "../../lib/glucose";
import type { GlucoseUnit, SugarLog } from "../../lib/db/types";
import { hapticSuccess } from "../../lib/haptics";

// Cascade timing (ms): a gentle staggered reveal, mirroring result.tsx.
const D_TITLE = 0;
const D_SUBTITLE = 100;
const D_TARGETS = 360;
const D_AGP = 660;
const D_PLAN = 960;
const D_CTA = 1220;

// ── Sample Insights preview (real AGP infra on in-memory data) ───────────────
// A plausible 14-day curve so the preview looks like real Insights. It is
// labelled "sample data" and never mixes with the user's own records.
function demoSugar(): SugarLog[] {
  const out: Partial<SugarLog>[] = [];
  const now = Date.now();
  for (let day = 0; day < 14; day++) {
    for (let h = 0; h < 24; h++) {
      let base = 112 + 18 * Math.sin(((h - 3) / 24) * 2 * Math.PI);
      if (h === 8 || h === 13 || h === 19) base += 46;
      if (h === 9 || h === 14 || h === 20) base += 28;
      const noise = Math.sin(day * 2.3 + h * 1.1) * 22;
      const v = Math.max(60, Math.min(255, Math.round(base + noise)));
      const d = new Date(now - day * 86_400_000);
      d.setHours(h, 0, 0, 0);
      out.push({ glucose_level_mgdl: v, logged_at: d.toISOString() });
    }
  }
  return out as SugarLog[];
}

function AgpPreview({ unit }: { unit: GlucoseUnit }) {
  const { t } = useTranslation();
  const { bands, avg, tir } = useMemo(() => {
    const readings = demoSugar();
    const agp = computeAgp(readings, 14);
    const vals = readings.map((r) => r.glucose_level_mgdl);
    const mean = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    const inRange = vals.filter((v) => v >= 70 && v <= 180).length;
    return {
      bands: agp.bands,
      avg: mean,
      tir: Math.round((inRange / vals.length) * 100),
    };
  }, []);

  const W = 300;
  const H = 120;
  const GMIN = 40;
  const GMAX = 260;
  const x = (h: number) => (h / 23) * W;
  const y = (g: number) => H - ((g - GMIN) / (GMAX - GMIN)) * H;

  const line = (key: "p25" | "p50" | "p75") =>
    bands
      .map((b, i) => `${i === 0 ? "M" : "L"} ${x(b.hour).toFixed(1)} ${y(b[key]).toFixed(1)}`)
      .join(" ");
  const bandArea = () => {
    if (bands.length === 0) return "";
    const top = bands.map((b) => `L ${x(b.hour).toFixed(1)} ${y(b.p75).toFixed(1)}`).join(" ");
    const bottom = [...bands]
      .reverse()
      .map((b) => `L ${x(b.hour).toFixed(1)} ${y(b.p25).toFixed(1)}`)
      .join(" ");
    const start = `M ${x(bands[0].hour).toFixed(1)} ${y(bands[0].p75).toFixed(1)}`;
    return `${start} ${top} ${bottom} Z`;
  };

  return (
    <View className="rounded-2xl bg-glass border border-hair p-4">
      <View className="flex-row items-center justify-between mb-3">
        <Text className="text-brand text-[11px] font-semibold uppercase tracking-wider">
          {t("onboarding.previewTag")}
        </Text>
        <View className="rounded-full bg-zinc-800 px-2 py-0.5">
          <Text className="text-zinc-400 text-[10px] font-semibold uppercase tracking-wider">
            {t("onboarding.sampleBadge")}
          </Text>
        </View>
      </View>

      <View className="flex-row justify-between mb-4">
        <View className="items-center flex-1">
          <Text className="text-zinc-50 text-xl font-bold">
            {formatGlucose(avg, unit)}
          </Text>
          <Text className="text-zinc-500 text-[10px] mt-0.5">
            {glucoseUnitLabel(unit)}
          </Text>
          <Text className="text-zinc-500 text-[10px]">{t("insights.avgGlucose")}</Text>
        </View>
        <View className="items-center flex-1">
          <Text className="text-emerald-400 text-xl font-bold">{tir}%</Text>
          <Text className="text-zinc-500 text-[10px] mt-3.5">
            {t("insights.timeInRange")}
          </Text>
        </View>
        <View className="items-center flex-1">
          <Text className="text-zinc-50 text-xl font-bold">14</Text>
          <Text className="text-zinc-500 text-[10px] mt-3.5">{t("insights.days")}</Text>
        </View>
      </View>

      <View style={glow(THEME.accent, 10, 0.4)}>
        <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
          {/* Green target band (70-180) behind the curve */}
          <Rect x={0} y={y(180)} width={W} height={y(70) - y(180)} fill={GLUCOSE_RICH.target} opacity={0.1} />
          <Line x1={0} y1={y(180)} x2={W} y2={y(180)} stroke="rgba(255,255,255,0.14)" strokeWidth={1} strokeDasharray="4 4" />
          <Line x1={0} y1={y(70)} x2={W} y2={y(70)} stroke="rgba(255,255,255,0.14)" strokeWidth={1} strokeDasharray="4 4" />
          <Path d={bandArea()} fill="#2ee6ff" fillOpacity={0.18} />
          <Path d={line("p50")} stroke="#2ee6ff" strokeWidth={2.5} fill="none" />
        </Svg>
      </View>

      <Text className="text-zinc-500 text-[11px] mt-2 text-center">
        {t("onboarding.previewCaption")}
      </Text>
    </View>
  );
}

/** A single target value with a count-up (formatted through the unit helper). */
function TargetValue({
  label,
  mgdl,
  unit,
  onSettle,
}: {
  label: string;
  mgdl: number;
  unit: GlucoseUnit;
  onSettle?: () => void;
}) {
  const value = useCountUp(mgdl, undefined, onSettle);
  return (
    <View className="flex-1 items-center">
      <Text className="text-zinc-500 text-xs mb-1">{label}</Text>
      <Text className="text-brand text-2xl font-extrabold">
        {formatGlucose(value, unit)}
      </Text>
      <Text className="text-zinc-500 text-[10px] mt-0.5">
        {glucoseUnitLabel(unit)}
      </Text>
    </View>
  );
}

function PlanRow({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  return (
    <View className="flex-row items-center py-1.5">
      <Ionicons name={icon} size={16} color="#2ee6ff" />
      <Text className="text-zinc-200 text-[13px] ml-3 flex-1">{label}</Text>
      <Ionicons name="checkmark-circle" size={16} color="#2ee6ff" />
    </View>
  );
}

/**
 * The reveal: a staggered summary built purely from the user's own answers
 * (their target range, in their unit) plus a labelled sample-data Insights
 * preview and the reminder plan they set. Ends with a CTA into the paywall.
 */
export function Reveal({
  unit,
  fastingMgdl,
  postmealMgdl,
  hasInsulin,
  basalTime,
  onContinue,
  saving,
}: {
  unit: GlucoseUnit;
  fastingMgdl: number;
  postmealMgdl: number;
  hasInsulin: boolean;
  basalTime: string;
  onContinue: () => void;
  saving?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <View className="flex-1">
      <ScrollView
        contentContainerStyle={{ paddingBottom: 16 }}
        showsVerticalScrollIndicator={false}
      >
        <FadeSlideIn delay={D_TITLE}>
          <Text className="text-zinc-50 text-3xl font-extrabold">
            {t("onboarding.revealTitle")}
          </Text>
        </FadeSlideIn>
        <FadeSlideIn delay={D_SUBTITLE}>
          <Text className="text-zinc-400 mt-2 mb-6 leading-5">
            {t("onboarding.revealSubtitle")}
          </Text>
        </FadeSlideIn>

        <FadeSlideIn delay={D_TARGETS}>
          <View className="rounded-2xl bg-glass border border-hair p-4 mb-4">
            <Text className="text-zinc-500 text-[11px] font-semibold uppercase tracking-wider mb-3">
              {t("onboarding.revealTargetsTitle")}
            </Text>
            <View className="flex-row">
              <TargetValue
                label={t("period.fasting")}
                mgdl={fastingMgdl}
                unit={unit}
                onSettle={hapticSuccess}
              />
              <View className="w-px bg-zinc-800" />
              <TargetValue
                label={t("period.post_meal_2h")}
                mgdl={postmealMgdl}
                unit={unit}
              />
            </View>
          </View>
        </FadeSlideIn>

        <FadeSlideIn delay={D_AGP}>
          <View className="mb-4">
            <AgpPreview unit={unit} />
          </View>
        </FadeSlideIn>

        <FadeSlideIn delay={D_PLAN}>
          <View className="rounded-2xl bg-glass border border-hair p-4">
            <Text className="text-zinc-500 text-[11px] font-semibold uppercase tracking-wider mb-1">
              {t("onboarding.revealPlanTitle")}
            </Text>
            <PlanRow icon="restaurant-outline" label={t("onboarding.planPostMeal")} />
            <PlanRow icon="pulse-outline" label={t("onboarding.planLowFollow")} />
            {hasInsulin ? (
              <PlanRow
                icon="moon-outline"
                label={`${t("onboarding.planBasal")} · ${basalTime}`}
              />
            ) : null}
          </View>
        </FadeSlideIn>
      </ScrollView>

      <FadeSlideIn delay={D_CTA} style={{ marginTop: 12 }}>
        <Button
          label={t("onboarding.continue")}
          size="lg"
          loading={saving}
          onPress={onContinue}
        />
      </FadeSlideIn>
    </View>
  );
}
