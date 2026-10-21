import React, { useMemo } from "react";
import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useReducedMotion } from "react-native-reanimated";

import { GlassCard, withAlpha } from "../rich/GlassCard";
import { GlucoseChip } from "../rich/GlucoseChip";
import { GlucoseRing } from "../rich/GlucoseRing";
import { GradientAreaChart } from "../rich/GradientAreaChart";
import { RADIUS, THEME } from "../../lib/theme/tokens";
import { formatGlucose, glucoseUnitLabel } from "../../lib/glucose";
import { onboardingExample } from "../../lib/onboardingExample";
import { getLocales } from "expo-localization";
import { pct } from "../../lib/format";
import { upper } from "../../lib/upper";
import { useCountUp } from "./motion";
import { ClipReveal } from "./ClipReveal";

// Fixed sample values: these previews never show the user's data.
const SAMPLE_TIR = 72;
const SAMPLE_CURVE = [
  118, 112, 106, 102, 100, 104, 126, 152, 138, 118, 110, 108, 124, 148, 134, 116, 110, 112, 128,
  150, 136, 120, 114, 112,
];

const CARD_PAD = 14;
const INNER_WIDTH = 240;
const CARD_WIDTH = INNER_WIDTH + CARD_PAD * 2;

/** Marks a preview as sample data: the values drawn above it are never the
 *  user's own. */
function ExampleBadge() {
  const { t } = useTranslation();
  return (
    <View
      style={{
        alignSelf: "center",
        marginTop: 8,
        borderRadius: RADIUS.full,
        borderWidth: 1,
        borderColor: withAlpha(THEME.textMuted, 0.5),
        paddingHorizontal: 10,
        paddingVertical: 2,
      }}
    >
      <Text style={{ color: THEME.textMuted, fontSize: 11, lineHeight: 15, fontWeight: "700", letterSpacing: 1 }}>
        {upper(t("onboarding.exampleBadge"))}
      </Text>
    </View>
  );
}

function RingPreview({ active }: { active: boolean }) {
  const reduced = useReducedMotion();
  const example = useMemo(() => onboardingExample(getLocales()[0]?.regionCode), []);
  const value = useCountUp(active || reduced ? example.mgdl : 0);
  return (
    <GlucoseRing
      value={value}
      display={formatGlucose(value, example.unit)}
      caption={glucoseUnitLabel(example.unit)}
      size={112}
      strokeWidth={9}
    />
  );
}

function CurvePreview({ active }: { active: boolean }) {
  return (
    <GlassCard style={{ width: CARD_WIDTH, padding: CARD_PAD }}>
      <ClipReveal height={72} width={INNER_WIDTH} active={active}>
        {(w) => (
          <GradientAreaChart
            data={SAMPLE_CURVE}
            width={w}
            height={72}
            targetBand={{ min: 90, max: 140 }}
          />
        )}
      </ClipReveal>
    </GlassCard>
  );
}

function ReportPreview() {
  const { t } = useTranslation();
  return (
    <GlassCard style={{ width: CARD_WIDTH, padding: CARD_PAD }}>
      <View style={{ width: INNER_WIDTH, flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Ionicons name="document-text-outline" size={18} color={THEME.accent} />
        <Text style={{ color: THEME.text, fontSize: 13, lineHeight: 17, fontWeight: "700", flex: 1 }}>
          {t("paywall.featureShortPdf")}
        </Text>
      </View>
      <GlucoseChip
        status="normal"
        dot={false}
        label={`${t("insights.inRange")} ${pct(SAMPLE_TIR)}`}
        style={{ marginTop: 10 }}
      />
      {[0.92, 0.7, 0.82].map((frac) => (
        <View
          key={frac}
          style={{
            height: 6,
            width: Math.round(INNER_WIDTH * frac),
            borderRadius: RADIUS.full,
            backgroundColor: withAlpha(THEME.textMuted, 0.4),
            marginTop: 10,
          }}
        />
      ))}
    </GlassCard>
  );
}

/**
 * The live mini preview each welcome slide carries in place of an icon. Purely
 * decorative sample data, so it is hidden from touch and from screen readers
 * (the slide's own title and body already say what the page is about), except
 * the PDF card, which keeps one label because its chip text is real content.
 */
export function WelcomePreview({ slide, active }: { slide: 0 | 1 | 2; active: boolean }) {
  const { t } = useTranslation();
  const label = `${t("paywall.featureShortPdf")}. ${t("insights.inRange")} ${pct(SAMPLE_TIR)}`;
  return (
    <View
      pointerEvents="none"
      accessible={slide === 2}
      accessibilityLabel={slide === 2 ? label : undefined}
      importantForAccessibility={slide === 2 ? "yes" : "no-hide-descendants"}
      style={{ alignItems: "center", width: "100%" }}
    >
      {slide === 0 ? <RingPreview active={active} /> : null}
      {slide === 1 ? <CurvePreview active={active} /> : null}
      {slide !== 2 ? <ExampleBadge /> : null}
      {slide === 2 ? <ReportPreview /> : null}
    </View>
  );
}
