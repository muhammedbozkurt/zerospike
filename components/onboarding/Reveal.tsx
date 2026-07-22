import React, { useMemo } from "react";
import { ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import { GLUCOSE_RICH, TABULAR, THEME } from "../../lib/theme/tokens";
import { FadeSlideIn, useCountUp } from "./motion";
import { computeAgp } from "../../lib/agp";
import { formatGlucose, glucoseUnitLabel } from "../../lib/glucose";
import type { GlucoseUnit, SugarLog } from "../../lib/db/types";
import { hapticSuccess } from "../../lib/haptics";
import { GlassCard } from "../rich/GlassCard";
import { GlucoseChip } from "../rich/GlucoseChip";
import { GradientAreaChart } from "../rich/GradientAreaChart";
import { GradientCTA } from "../rich/GradientCTA";
import { IconTile } from "../rich/IconTile";

// Cascade timing (ms): a gentle staggered reveal.
const D_LABEL = 0;
const D_TITLE = 100;
const D_HERO = 340;
const D_TARGETS = 620;
const D_PLAN = 900;
const D_CTA = 1160;

// ── Sample preview (real AGP infra on in-memory data) ────────────────────────
// A plausible 14-day curve so the preview looks like real Insights. It is
// labelled as sample data and never mixes with the user's own records.
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

/** A count-up range end, formatted through the unit helper. */
function RangeEnd({
  mgdl,
  unit,
  onSettle,
}: {
  mgdl: number;
  unit: GlucoseUnit;
  onSettle?: () => void;
}) {
  const value = useCountUp(mgdl, undefined, onSettle);
  return (
    <Text style={[TABULAR, { color: THEME.accent, fontSize: 22, fontWeight: "800" }]}>
      {formatGlucose(value, unit)}
    </Text>
  );
}

function PlanRow({
  icon,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
}) {
  return (
    <View className="flex-row items-center py-1.5">
      <IconTile icon={icon} size={26} radius={9} />
      <Text style={{ color: THEME.ink, fontSize: 13, marginLeft: 10, flex: 1 }}>
        {label}
      </Text>
      <Ionicons name="checkmark-circle" size={16} color={GLUCOSE_RICH.target} />
    </View>
  );
}

/**
 * The reveal, rebuilt to the mockup's B02 composition: a small "ready for you"
 * label, a large title, then ONE glowing hero card carrying the headline
 * time-in-range chip over a gradient area curve with the target band behind it.
 * The user's own range and reminder plan follow as supporting cards, and a
 * single full-width gradient CTA closes it.
 *
 * Everything shown is either the user's own answer (their range, their plan) or
 * clearly labelled sample data. Nothing here is an outcome promise.
 */
export function Reveal({
  unit,
  fastingMinMgdl,
  fastingMgdl,
  postmealMinMgdl,
  postmealMgdl,
  hasInsulin,
  basalTime,
  onContinue,
  saving,
}: {
  unit: GlucoseUnit;
  fastingMinMgdl: number;
  fastingMgdl: number;
  postmealMinMgdl: number;
  postmealMgdl: number;
  hasInsulin: boolean;
  basalTime: string;
  onContinue: () => void;
  saving?: boolean;
}) {
  const { t } = useTranslation();

  const { curve, tir, band } = useMemo(() => {
    const readings = demoSugar();
    const agp = computeAgp(readings, 14);
    const vals = readings.map((r) => r.glucose_level_mgdl);
    const inRange = vals.filter(
      (v) => v >= fastingMinMgdl && v <= postmealMgdl
    ).length;
    return {
      curve: agp.bands.map((b) => b.p50),
      tir: Math.round((inRange / vals.length) * 100),
      band: { min: fastingMinMgdl, max: postmealMgdl },
    };
  }, [fastingMinMgdl, postmealMgdl]);

  return (
    <View className="flex-1">
      <ScrollView
        contentContainerStyle={{ paddingBottom: 16 }}
        showsVerticalScrollIndicator={false}
      >
        <FadeSlideIn delay={D_LABEL}>
          <Text
            style={{
              color: THEME.muted,
              fontSize: 10,
              letterSpacing: 1.4,
              textTransform: "uppercase",
              fontWeight: "800",
              textAlign: "center",
            }}
          >
            {t("onboarding.previewTag")}
          </Text>
        </FadeSlideIn>
        <FadeSlideIn delay={D_TITLE}>
          <Text
            style={{
              color: THEME.ink,
              fontSize: 26,
              fontWeight: "800",
              textAlign: "center",
              marginTop: 4,
            }}
          >
            {t("onboarding.revealTitle")}
          </Text>
          <Text
            style={{
              color: THEME.muted,
              textAlign: "center",
              marginTop: 6,
              marginBottom: 16,
              lineHeight: 19,
            }}
          >
            {t("onboarding.revealSubtitle")}
          </Text>
        </FadeSlideIn>

        {/* Hero: the mockup's glowing preview card */}
        <FadeSlideIn delay={D_HERO}>
          <GlassCard glow style={{ marginBottom: 12 }}>
            <View className="flex-row items-center justify-between mb-2">
              <Text
                style={{
                  color: THEME.muted,
                  fontSize: 9,
                  letterSpacing: 1.3,
                  textTransform: "uppercase",
                  fontWeight: "800",
                }}
              >
                {t("onboarding.sampleBadge")}
              </Text>
              <GlucoseChip
                status="normal"
                dot={false}
                label={`${t("insights.timeInRange")} ${tir}%`}
              />
            </View>
            <GradientAreaChart
              data={curve}
              width={300}
              height={84}
              targetBand={band}
              style={{ alignSelf: "stretch", width: "100%" }}
            />
            <Text style={{ color: THEME.muted, fontSize: 11, marginTop: 8, textAlign: "center" }}>
              {t("onboarding.previewCaption")}
            </Text>
          </GlassCard>
        </FadeSlideIn>

        {/* The user's own range, as a range */}
        <FadeSlideIn delay={D_TARGETS}>
          <GlassCard style={{ marginBottom: 12 }}>
            <Text
              style={{
                color: THEME.muted,
                fontSize: 9,
                letterSpacing: 1.3,
                textTransform: "uppercase",
                fontWeight: "800",
                marginBottom: 10,
              }}
            >
              {t("onboarding.revealTargetsTitle")}
            </Text>
            <View className="flex-row">
              <View className="flex-1 items-center">
                <Text style={{ color: THEME.muted, fontSize: 11, marginBottom: 2 }}>
                  {t("period.fasting")}
                </Text>
                <View className="flex-row items-baseline" style={{ gap: 4 }}>
                  <RangeEnd mgdl={fastingMinMgdl} unit={unit} onSettle={hapticSuccess} />
                  <Text style={{ color: THEME.muted, fontSize: 16 }}>-</Text>
                  <RangeEnd mgdl={fastingMgdl} unit={unit} />
                </View>
                <Text style={{ color: THEME.muted, fontSize: 10, marginTop: 2 }}>
                  {glucoseUnitLabel(unit)}
                </Text>
              </View>
              <View style={{ width: 1, backgroundColor: THEME.border }} />
              <View className="flex-1 items-center">
                <Text style={{ color: THEME.muted, fontSize: 11, marginBottom: 2 }}>
                  {t("period.post_meal_2h")}
                </Text>
                <View className="flex-row items-baseline" style={{ gap: 4 }}>
                  <RangeEnd mgdl={postmealMinMgdl} unit={unit} />
                  <Text style={{ color: THEME.muted, fontSize: 16 }}>-</Text>
                  <RangeEnd mgdl={postmealMgdl} unit={unit} />
                </View>
                <Text style={{ color: THEME.muted, fontSize: 10, marginTop: 2 }}>
                  {glucoseUnitLabel(unit)}
                </Text>
              </View>
            </View>
          </GlassCard>
        </FadeSlideIn>

        <FadeSlideIn delay={D_PLAN}>
          <GlassCard>
            <Text
              style={{
                color: THEME.muted,
                fontSize: 9,
                letterSpacing: 1.3,
                textTransform: "uppercase",
                fontWeight: "800",
                marginBottom: 4,
              }}
            >
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
          </GlassCard>
        </FadeSlideIn>
      </ScrollView>

      <FadeSlideIn delay={D_CTA} style={{ marginTop: 12 }}>
        <GradientCTA
          label={t("onboarding.continue")}
          disabled={saving}
          onPress={onContinue}
        />
      </FadeSlideIn>
    </View>
  );
}
