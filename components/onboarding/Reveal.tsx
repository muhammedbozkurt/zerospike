import React, { useMemo } from "react";
import { ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import { GLUCOSE_RICH, RADIUS, TABULAR, THEME } from "../../lib/theme/tokens";
import { pct } from "../../lib/format";
import { upper } from "../../lib/upper";
import { FadeSlideIn, useCountUp } from "./motion";
import { computeAgp } from "../../lib/agp";
import { formatGlucose, glucoseUnitLabel } from "../../lib/glucose";
import type { GlucoseUnit, SugarLog } from "../../lib/db/types";
import { hapticSuccess } from "../../lib/haptics";
import { GlassCard } from "../rich/GlassCard";
import { GlucoseChip } from "../rich/GlucoseChip";
import { GradientAreaChart } from "../rich/GradientAreaChart";
import { GradientCTA } from "../rich/GradientCTA";
import type { RevealPlanItem, RevealPlanKind } from "../../lib/revealPlan";

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
    <Text style={[TABULAR, { color: GLUCOSE_RICH.target, fontSize: 20, fontWeight: "800" }]}>
      {formatGlucose(value, unit)}
    </Text>
  );
}

/** The small caps caption both closing cards open with. */
function CardCaption({ children }: { children: string }) {
  return (
    <Text
      style={{
        color: THEME.textMuted,
        fontSize: 11,
        lineHeight: 14,
        letterSpacing: 1.2,
        fontWeight: "600",
        marginBottom: 12,
      }}
    >
      {upper(children)}
    </Text>
  );
}

/** One target band, as a row: what it is on the left, the band on the right. */
function TargetRow({
  label,
  minMgdl,
  maxMgdl,
  unit,
  onSettle,
}: {
  label: string;
  minMgdl: number;
  maxMgdl: number;
  unit: GlucoseUnit;
  onSettle?: () => void;
}) {
  return (
    <View
      className="flex-row items-baseline justify-between"
      style={{ marginBottom: 12 }}
      accessible
      accessibilityLabel={`${label}, ${formatGlucose(minMgdl, unit)} - ${formatGlucose(maxMgdl, unit)} ${glucoseUnitLabel(unit)}`}
    >
      <Text style={{ color: THEME.text, fontSize: 15 }}>{label}</Text>
      <View className="flex-row items-baseline" style={{ gap: 4 }}>
        <RangeEnd mgdl={minMgdl} unit={unit} onSettle={onSettle} />
        <Text style={{ color: THEME.textMuted, fontSize: 16, fontWeight: "700" }}>-</Text>
        <RangeEnd mgdl={maxMgdl} unit={unit} />
        <Text style={{ color: THEME.textMuted, fontSize: 12, marginLeft: 2 }}>
          {glucoseUnitLabel(unit)}
        </Text>
      </View>
    </View>
  );
}

/**
 * One line of the plan card. `mode` is only set for real reminder rows: it says
 * how they will be DELIVERED, drawn from the same decision applyReminders arms
 * with (see lib/revealPlan.ts), so a device that cannot ring an alarm shows the
 * notification mark instead. The check mark stays what it always was: this is
 * set up.
 */
function PlanRow({
  icon,
  label,
  value,
  valueTone = "ink",
  mode,
  wantsAlarm,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  /** The row's own right-hand value: a stored "HH:MM", or a descriptor for the
   *  two rows that have no clock time of their own. */
  value?: string;
  valueTone?: "ink" | "muted";
  mode?: "alarm" | "notification" | null;
  wantsAlarm?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View className="flex-row items-center" style={{ gap: 10, marginBottom: 12 }}>
      <Ionicons name={icon} size={18} color={THEME.accent} />
      <Text style={{ color: THEME.text, fontSize: 15, flex: 1 }} numberOfLines={2}>
        {label}
      </Text>
      {mode ? (
        // Three states, as everywhere else: a working alarm, an alarm this
        // device cannot ring yet (the permission was refused or never asked),
        // and a plain notification. `wantsAlarm` is the stored intent, `mode`
        // is what will really happen.
        <Ionicons
          name={mode === "alarm" ? "alarm" : wantsAlarm ? "alarm-outline" : "notifications-outline"}
          size={14}
          color={mode === "alarm" ? THEME.accent : THEME.textMuted}
          accessibilityLabel={
            mode === "alarm" ? t("reminders.modeAlarm") : t("reminders.modeNotification")
          }
        />
      ) : null}
      {value ? (
        <Text
          style={[
            TABULAR,
            {
              color: valueTone === "muted" ? THEME.textMuted : THEME.text,
              fontSize: 15,
              fontWeight: valueTone === "muted" ? "400" : "700",
            },
          ]}
        >
          {value}
        </Text>
      ) : null}
    </View>
  );
}

const PLAN_ICONS: Record<RevealPlanKind, keyof typeof Ionicons.glyphMap> = {
  glucose: "water-outline",
  med: "medical-outline",
  basal: "moon-outline",
  postMeal: "restaurant-outline",
  lowFollowup: "pulse-outline",
};

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
  plan,
  onContinue,
  saving,
}: {
  unit: GlucoseUnit;
  fastingMinMgdl: number;
  fastingMgdl: number;
  postmealMinMgdl: number;
  postmealMgdl: number;
  /** What was ACTUALLY set up, built by lib/revealPlan.ts from the rows that
   *  now exist - not a fixed list. A user who skipped the reminder layout has
   *  no measurement line here, and one who accepted it sees their own times. */
  plan: RevealPlanItem[];
  onContinue: () => void;
  saving?: boolean;
}) {
  const { t } = useTranslation();

  /** The line, split into what it is and when it happens: the reminder's OWN
   *  name when it has one (every preset row is named after its part of the day
   *  - see lib/reminderPresets), the type's generic name otherwise, and the
   *  row's stored "HH:MM" as the right-hand value - the same string Settings >
   *  Reminders shows, so the two can never disagree. The two rows with no clock
   *  time of their own carry a descriptor there instead. */
  function planLine(item: RevealPlanItem): {
    label: string;
    value?: string;
    valueTone?: "ink" | "muted";
  } {
    if (item.kind === "postMeal") {
      return {
        label: t("onboarding.planPostMeal"),
        value: item.minutes != null ? t("settings.minutes", { n: item.minutes }) : undefined,
        valueTone: "muted",
      };
    }
    if (item.kind === "lowFollowup") return { label: t("onboarding.planLowFollow") };
    const name =
      item.label ??
      t(
        item.kind === "med"
          ? "reminders.typeMed"
          : item.kind === "basal"
            ? "reminders.typeBasal"
            : "reminders.typeGlucose"
      );
    return { label: name, value: item.time ?? undefined };
  }

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
              color: THEME.textMuted,
              fontSize: 10,
              letterSpacing: 1.4,
              fontWeight: "800",
              textAlign: "center",
            }}
          >
            {upper(t("onboarding.previewTag"))}
          </Text>
        </FadeSlideIn>
        <FadeSlideIn delay={D_TITLE}>
          <Text
            style={{
              color: THEME.text,
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
              color: THEME.textMuted,
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
                  color: THEME.textMuted,
                  fontSize: 11,
                  letterSpacing: 1.3,
                  fontWeight: "800",
                }}
              >
                {upper(t("onboarding.sampleBadge"))}
              </Text>
              <GlucoseChip
                status="normal"
                dot={false}
                label={`${t("insights.timeInRange")} ${pct(tir)}`}
              />
            </View>
            {/* No fixed width: the card's inner width is what this has to fill.
                It used to draw a 300pt canvas inside a container the style
                below stretched to 100%, so on any device whose card is
                narrower than 300pt (a 375pt screen, once the column and card
                padding are taken off) the curve ran past the right edge and
                was cut off there. Measured instead, the series is SCALED to
                fit - seriesPoints already insets both ends by 3pt, so the
                stroke's round caps sit inside the canvas symmetrically. */}
            <GradientAreaChart
              data={curve}
              height={84}
              targetBand={band}
              style={{ alignSelf: "stretch", width: "100%" }}
            />
            <Text style={{ color: THEME.textMuted, fontSize: 11, marginTop: 8, textAlign: "center" }}>
              {t("onboarding.previewCaption")}
            </Text>
          </GlassCard>
        </FadeSlideIn>

        {/* The user's own range, one band per row */}
        <FadeSlideIn delay={D_TARGETS}>
          <GlassCard radius={RADIUS.xl} style={{ marginBottom: 12, padding: 20 }}>
            <CardCaption>{t("onboarding.revealTargetsTitle")}</CardCaption>
            <TargetRow
              label={t("period.fasting")}
              minMgdl={fastingMinMgdl}
              maxMgdl={fastingMgdl}
              unit={unit}
              onSettle={hapticSuccess}
            />
            <TargetRow
              label={t("period.post_meal_2h")}
              minMgdl={postmealMinMgdl}
              maxMgdl={postmealMgdl}
              unit={unit}
            />
          </GlassCard>
        </FadeSlideIn>

        <FadeSlideIn delay={D_PLAN}>
          <GlassCard radius={RADIUS.xl} style={{ padding: 20 }}>
            <CardCaption>{t("onboarding.revealPlanTitle")}</CardCaption>
            {plan.map((item) => {
              const line = planLine(item);
              return (
                <PlanRow
                  key={item.id}
                  icon={PLAN_ICONS[item.kind]}
                  label={line.label}
                  value={line.value}
                  valueTone={line.valueTone}
                  mode={item.mode}
                  wantsAlarm={item.wantsAlarm}
                />
              );
            })}
            {/* Descriptive only, and only next to a basal row that is really
                there: this states what the reminder's own tap already does,
                never a new promise of its own. */}
            {plan.some((item) => item.kind === "basal") ? (
              <Text style={{ color: THEME.textMuted, fontSize: 12, lineHeight: 16 }}>
                {t("onboarding.revealBasalTip")}
              </Text>
            ) : null}
          </GlassCard>
        </FadeSlideIn>
      </ScrollView>

      <FadeSlideIn delay={D_CTA} style={{ marginTop: 12 }}>
        <GradientCTA
          label={t("onboarding.getStarted")}
          size="lg"
          style={{ borderRadius: RADIUS.full }}
          disabled={saving}
          onPress={onContinue}
        />
      </FadeSlideIn>
    </View>
  );
}
