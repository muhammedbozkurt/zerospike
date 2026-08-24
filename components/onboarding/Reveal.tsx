import React, { useMemo } from "react";
import { ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import { GLUCOSE_RICH, TABULAR, THEME } from "../../lib/theme/tokens";
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
import { IconTile } from "../rich/IconTile";
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
    <Text style={[TABULAR, { color: THEME.accent, fontSize: 22, fontWeight: "800" }]}>
      {formatGlucose(value, unit)}
    </Text>
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
  mode,
  wantsAlarm,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  mode?: "alarm" | "notification" | null;
  wantsAlarm?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View className="flex-row items-center py-1.5">
      <IconTile icon={icon} size={26} radius={9} />
      <Text style={{ color: THEME.ink, fontSize: 13, marginLeft: 10, flex: 1 }} numberOfLines={2}>
        {label}
      </Text>
      {mode ? (
        // Three states, as everywhere else: a working alarm, an alarm this
        // device cannot ring yet (the permission was refused or never asked),
        // and a plain notification. `wantsAlarm` is the stored intent, `mode`
        // is what will really happen.
        <Ionicons
          name={mode === "alarm" ? "alarm" : wantsAlarm ? "alarm-outline" : "notifications-outline"}
          size={13}
          color={mode === "alarm" ? THEME.accent : THEME.muted}
          accessibilityLabel={
            mode === "alarm" ? t("reminders.modeAlarm") : t("reminders.modeNotification")
          }
          style={{ marginRight: 8 }}
        />
      ) : null}
      <Ionicons name="checkmark-circle" size={16} color={GLUCOSE_RICH.target} />
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

  /** The line's text: the reminder's OWN name when it has one (every preset row
   *  is named after its part of the day - see lib/reminderPresets), the type's
   *  generic name otherwise, then the row's stored "HH:MM" - the same string
   *  Settings > Reminders shows, so the two can never disagree. */
  function planLabel(item: RevealPlanItem): string {
    if (item.kind === "postMeal") {
      return item.minutes != null
        ? `${t("onboarding.planPostMeal")} · ${t("settings.minutes", { n: item.minutes })}`
        : t("onboarding.planPostMeal");
    }
    if (item.kind === "lowFollowup") return t("onboarding.planLowFollow");
    const name =
      item.label ??
      t(
        item.kind === "med"
          ? "reminders.typeMed"
          : item.kind === "basal"
            ? "reminders.typeBasal"
            : "reminders.typeGlucose"
      );
    return item.time ? `${name} · ${item.time}` : name;
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
              color: THEME.muted,
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
                fontSize: 11,
                letterSpacing: 1.3,
                fontWeight: "800",
                marginBottom: 10,
              }}
            >
              {upper(t("onboarding.revealTargetsTitle"))}
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
                fontSize: 11,
                letterSpacing: 1.3,
                fontWeight: "800",
                marginBottom: 4,
              }}
            >
              {upper(t("onboarding.revealPlanTitle"))}
            </Text>
            {plan.map((item) => (
              <PlanRow
                key={item.id}
                icon={PLAN_ICONS[item.kind]}
                label={planLabel(item)}
                mode={item.mode}
                wantsAlarm={item.wantsAlarm}
              />
            ))}
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
