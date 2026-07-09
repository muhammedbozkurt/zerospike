import React, { useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Svg, { Path, Line } from "react-native-svg";

import { useApp } from "../lib/store/AppContext";
import { updateProfile } from "../lib/db/profiles";
import {
  applyNotificationPrefs,
  requestNotificationPermission,
} from "../lib/services/notifications";
import {
  DEFAULT_PREFS,
  setNotificationPrefs,
} from "../lib/services/notificationPrefs";
import type { GlucoseUnit, SugarLog } from "../lib/db/types";
import {
  glucoseToDisplay,
  glucoseFromDisplay,
  glucoseUnitLabel,
  formatGlucose,
} from "../lib/glucose";
import { computeAgp } from "../lib/agp";
import { logEvent } from "../lib/analytics";
import { Button, Segmented } from "../components/ui";
import { InputRow, AcceptCheck } from "../components/form";
import { InlineTimePicker } from "../components/InlineTimePicker";
import { Logo } from "../components/Logo";
import { DisclaimerBanner } from "../components/Disclaimer";

const DIABETES_KEY = "zerospike.diabetesContext";

// Sensible defaults used by the "I'm not sure" path (never blocks a new user).
const DEFAULT_CARB_RATIO = 10;
const DEFAULT_ISF_MGDL = 40;

type StepId =
  | "value1"
  | "value2"
  | "value3"
  | "name"
  | "unit"
  | "diabetes"
  | "fasting"
  | "postmeal"
  | "carbRatio"
  | "isf"
  | "basal"
  | "disclaimer"
  | "preview";

const STEPS: StepId[] = [
  "value1",
  "value2",
  "value3",
  "name",
  "unit",
  "diabetes",
  "fasting",
  "postmeal",
  "carbRatio",
  "isf",
  "basal",
  "disclaimer",
  "preview",
];

const DIABETES_OPTIONS = ["type1", "type2", "gestational", "prediabetes", "other"] as const;
type DiabetesOption = (typeof DIABETES_OPTIONS)[number];

// ── Demo Insights preview (uses the real AGP infra on in-memory data) ────────

// A plausible 14-day glucose curve so the preview looks like real Insights.
// Math.sin/Math.random are fine in app runtime (only workflow scripts forbid them).
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
    <View className="rounded-2xl bg-zinc-900 border border-zinc-800 p-4">
      <Text className="text-brand text-[11px] font-semibold uppercase tracking-wider mb-3">
        {t("onboarding.previewTag")}
      </Text>

      {/* Stat tiles */}
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
          <Text className="text-zinc-500 text-[10px] mt-3.5">
            {t("insights.days")}
          </Text>
        </View>
      </View>

      {/* Mini AGP band */}
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        <Line x1={0} y1={y(180)} x2={W} y2={y(180)} stroke="#3f3f46" strokeWidth={1} strokeDasharray="4 4" />
        <Line x1={0} y1={y(70)} x2={W} y2={y(70)} stroke="#3f3f46" strokeWidth={1} strokeDasharray="4 4" />
        <Path d={bandArea()} fill="#22d3ee" fillOpacity={0.15} />
        <Path d={line("p50")} stroke="#22d3ee" strokeWidth={2} fill="none" />
      </Svg>

      <Text className="text-zinc-500 text-[11px] mt-2 text-center">
        {t("onboarding.previewCaption")}
      </Text>
    </View>
  );
}

export default function OnboardingScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { activeProfile, bumpData } = useApp();

  const [stepIdx, setStepIdx] = useState(0);
  const step = STEPS[stepIdx];

  const [name, setName] = useState(
    activeProfile?.name ?? t("profiles.defaultName")
  );
  const [unit, setUnit] = useState<GlucoseUnit>(
    activeProfile?.glucose_unit ?? "mgdl"
  );
  const [diabetes, setDiabetes] = useState<DiabetesOption | null>(null);
  const [fasting, setFasting] = useState(
    String(glucoseToDisplay(activeProfile?.target_fasting_max ?? 100, unit))
  );
  const [postmeal, setPostmeal] = useState(
    String(glucoseToDisplay(activeProfile?.target_postmeal_max ?? 140, unit))
  );
  const [carbRatio, setCarbRatio] = useState(
    String(activeProfile?.carb_ratio_breakfast ?? DEFAULT_CARB_RATIO)
  );
  const [isf, setIsf] = useState(
    String(glucoseToDisplay(activeProfile?.insulin_sensitivity_factor ?? DEFAULT_ISF_MGDL, unit))
  );
  const [basalTime, setBasalTime] = useState("22:00");
  const [showTime, setShowTime] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [saving, setSaving] = useState(false);

  function num(v: string, fallback: number): number {
    const x = parseFloat(v.replace(",", "."));
    return Number.isFinite(x) && x > 0 ? x : fallback;
  }

  function changeUnit(next: GlucoseUnit) {
    if (next === unit) return;
    const fMgdl = glucoseFromDisplay(num(fasting, glucoseToDisplay(100, unit)), unit);
    const pMgdl = glucoseFromDisplay(num(postmeal, glucoseToDisplay(140, unit)), unit);
    const iMgdl = glucoseFromDisplay(num(isf, glucoseToDisplay(DEFAULT_ISF_MGDL, unit)), unit);
    setFasting(String(glucoseToDisplay(fMgdl, next)));
    setPostmeal(String(glucoseToDisplay(pMgdl, next)));
    setIsf(String(glucoseToDisplay(iMgdl, next)));
    setUnit(next);
  }

  function goTo(idx: number) {
    const clamped = Math.max(0, Math.min(STEPS.length - 1, idx));
    setStepIdx(clamped);
    logEvent("onboarding_step", { step: STEPS[clamped] });
  }
  const next = () => goTo(stepIdx + 1);
  const back = () => goTo(stepIdx - 1);
  const skipIntro = () => goTo(STEPS.indexOf("name"));

  // Leaving the basal step: the on-screen rationale has been shown, so trigger
  // the OS notification prompt here (contextual), then advance.
  async function nextFromBasal() {
    await requestNotificationPermission().catch(() => {});
    next();
  }

  // Save the profile, then hand off to the soft paywall. Onboarding is marked
  // complete downstream (paywall/downsell) so the app never bounces mid-flow.
  async function finishToPaywall() {
    if (!activeProfile || saving) return;
    setSaving(true);
    try {
      await updateProfile(activeProfile.id, {
        name: name.trim() || t("profiles.defaultName"),
        target_fasting_max: glucoseFromDisplay(num(fasting, glucoseToDisplay(100, unit)), unit),
        target_postmeal_max: glucoseFromDisplay(num(postmeal, glucoseToDisplay(140, unit)), unit),
        carb_ratio_breakfast: num(carbRatio, DEFAULT_CARB_RATIO),
        carb_ratio_lunch: num(carbRatio, DEFAULT_CARB_RATIO),
        carb_ratio_dinner: num(carbRatio, DEFAULT_CARB_RATIO),
        insulin_sensitivity_factor: glucoseFromDisplay(
          num(isf, glucoseToDisplay(DEFAULT_ISF_MGDL, unit)),
          unit
        ),
        glucose_unit: unit,
      });
      if (diabetes) {
        await AsyncStorage.setItem(DIABETES_KEY, diabetes).catch(() => {});
      }
      // Contextual notification permission at basal-time setup (unchanged).
      await setNotificationPrefs({ ...DEFAULT_PREFS, basalTime });
      await applyNotificationPrefs();
      bumpData();
      logEvent("onboarding_done", {});
      router.replace({ pathname: "/paywall", params: { context: "onboarding" } });
    } finally {
      setSaving(false);
    }
  }

  const progress = (stepIdx + 1) / STEPS.length;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      className="flex-1 bg-black"
      style={{ paddingTop: insets.top }}
    >
      {/* Progress + optional skip on the value slides */}
      <View className="px-6 pt-2 pb-1 flex-row items-center">
        {stepIdx > 0 ? (
          <Pressable onPress={back} hitSlop={10} className="pr-3 py-1">
            <Ionicons name="chevron-back" size={22} color="#71717a" />
          </Pressable>
        ) : (
          <View className="w-8" />
        )}
        <View className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
          <View
            className="h-full rounded-full bg-brand"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </View>
        {stepIdx < 3 ? (
          <Pressable onPress={skipIntro} hitSlop={10} className="pl-3 py-1">
            <Text className="text-zinc-500 text-sm font-medium">
              {t("onboarding.skip")}
            </Text>
          </Pressable>
        ) : (
          <View className="w-8" />
        )}
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 24, paddingBottom: insets.bottom + 24, flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View className="flex-1 justify-center">
          {/* ── Value slides ─────────────────────────────────────────── */}
          {step === "value1" || step === "value2" || step === "value3" ? (
            <View className="items-center">
              <View className="w-24 h-24 rounded-3xl bg-brand/10 border border-brand/20 items-center justify-center mb-8">
                {step === "value1" ? (
                  <Logo size={60} />
                ) : (
                  <Ionicons
                    name={step === "value2" ? "pulse-outline" : "people-outline"}
                    size={56}
                    color="#22d3ee"
                  />
                )}
              </View>
              <Text className="text-zinc-50 text-center text-2xl font-extrabold">
                {t(`onboarding.${step}Title`)}
              </Text>
              <Text className="text-zinc-400 mt-3 text-center text-base leading-6">
                {t(`onboarding.${step}Body`)}
              </Text>
              {step === "value2" ? (
                <View className="w-full rounded-2xl bg-brand/10 border border-brand/30 p-4 mt-8">
                  <Text className="text-brand text-[11px] font-semibold uppercase tracking-wider">
                    {t("calculator.estimatedDose")}
                  </Text>
                  <View className="flex-row justify-between items-center mt-2.5">
                    <Text className="text-zinc-300 font-semibold">
                      {t("calculator.totalDose")}
                    </Text>
                    <View className="flex-row items-baseline">
                      <Text className="text-brand font-bold" style={{ fontSize: 24, lineHeight: 30 }}>
                        2.5
                      </Text>
                      <Text className="text-brand text-sm font-medium"> {t("common.units")}</Text>
                    </View>
                  </View>
                  <Text className="text-brand/60 text-[11px] mt-2 text-center">
                    {t("calculator.overrideHint")}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {/* ── Questions ────────────────────────────────────────────── */}
          {step === "name" ? (
            <QuestionShell title={t("onboarding.qName")} hint={t("onboarding.qNameHint")}>
              <InputRow
                icon="text-outline"
                label={t("onboarding.profileName")}
                value={name}
                onChangeText={setName}
                placeholder={t("onboarding.profileNamePlaceholder")}
                last
              />
            </QuestionShell>
          ) : null}

          {step === "unit" ? (
            <QuestionShell title={t("onboarding.qUnit")} hint={t("onboarding.qUnitHint")}>
              <View className="px-1 py-2">
                <Segmented
                  options={[
                    { value: "mgdl", label: "mg/dL" },
                    { value: "mmol", label: "mmol/L" },
                  ]}
                  value={unit}
                  onChange={changeUnit}
                />
              </View>
            </QuestionShell>
          ) : null}

          {step === "diabetes" ? (
            <QuestionShell title={t("onboarding.qDiabetes")} hint={t("onboarding.qDiabetesHint")}>
              <View className="flex-row flex-wrap gap-2 mt-1">
                {DIABETES_OPTIONS.map((opt) => {
                  const on = diabetes === opt;
                  return (
                    <Pressable
                      key={opt}
                      onPress={() => setDiabetes(on ? null : opt)}
                      className={`rounded-xl border px-3.5 py-2.5 ${
                        on ? "border-brand bg-brand/10" : "border-zinc-700 bg-zinc-900"
                      }`}
                    >
                      <Text className={on ? "text-brand font-medium" : "text-zinc-300"}>
                        {t(`onboarding.diabetes_${opt}`)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </QuestionShell>
          ) : null}

          {step === "fasting" ? (
            <QuestionShell title={t("onboarding.qFasting")} hint={t("onboarding.qFastingHint")}>
              <InputRow
                icon="sunny-outline"
                label={t("period.fasting")}
                value={fasting}
                onChangeText={setFasting}
                keyboardType="decimal-pad"
                suffix={glucoseUnitLabel(unit)}
                maxLength={5}
                last
              />
            </QuestionShell>
          ) : null}

          {step === "postmeal" ? (
            <QuestionShell title={t("onboarding.qPostmeal")} hint={t("onboarding.qPostmealHint")}>
              <InputRow
                icon="time-outline"
                label={t("period.post_meal_2h")}
                value={postmeal}
                onChangeText={setPostmeal}
                keyboardType="decimal-pad"
                suffix={glucoseUnitLabel(unit)}
                maxLength={5}
                last
              />
            </QuestionShell>
          ) : null}

          {step === "carbRatio" ? (
            <QuestionShell title={t("onboarding.qCarbRatio")} hint={t("onboarding.qCarbRatioHint")}>
              <InputRow
                icon="restaurant-outline"
                label={t("settings.carbRatios")}
                value={carbRatio}
                onChangeText={setCarbRatio}
                keyboardType="decimal-pad"
                suffix="g/ü"
                maxLength={4}
                last
              />
            </QuestionShell>
          ) : null}

          {step === "isf" ? (
            <QuestionShell title={t("onboarding.qIsf")} hint={t("onboarding.qIsfHint")}>
              <InputRow
                icon="pulse-outline"
                label={t("settings.isf")}
                value={isf}
                onChangeText={setIsf}
                keyboardType="decimal-pad"
                suffix={glucoseUnitLabel(unit)}
                maxLength={5}
                last
              />
            </QuestionShell>
          ) : null}

          {step === "basal" ? (
            <QuestionShell title={t("onboarding.qBasal")} hint={t("onboarding.qBasalHint")}>
              <Pressable
                onPress={() => setShowTime((s) => !s)}
                className="flex-row items-center justify-between rounded-xl bg-zinc-900 border border-zinc-800 px-4 py-3.5"
              >
                <View className="flex-row items-center">
                  <Ionicons name="alarm-outline" size={18} color="#22d3ee" />
                  <Text className="text-zinc-200 ml-2.5">{t("onboarding.basalTime")}</Text>
                </View>
                <Text className="text-zinc-50 font-semibold">{basalTime}</Text>
              </Pressable>
              <InlineTimePicker
                visible={showTime}
                value={basalTime}
                onChange={setBasalTime}
                onClose={() => setShowTime(false)}
              />
              {/* Rationale shown before the OS notification prompt (which fires
                  on Continue). Descriptive, no alarm language. */}
              <View className="flex-row items-start rounded-xl border border-zinc-800 bg-zinc-900 p-3.5 mt-4">
                <Ionicons name="notifications-outline" size={16} color="#71717a" />
                <Text className="text-zinc-400 text-xs leading-5 ml-2.5 flex-1">
                  {t("onboarding.notifRationale")}
                </Text>
              </View>
            </QuestionShell>
          ) : null}

          {/* ── Disclaimer ───────────────────────────────────────────── */}
          {step === "disclaimer" ? (
            <View>
              <Text className="text-zinc-50 text-2xl font-bold mb-1">
                {t("onboarding.qDisclaimer")}
              </Text>
              <View className="mt-3 mb-4">
                <DisclaimerBanner full />
              </View>
              <AcceptCheck
                checked={accepted}
                onToggle={() => setAccepted((a) => !a)}
                label={t("disclaimer.accept")}
              />
            </View>
          ) : null}

          {/* ── Demo preview ─────────────────────────────────────────── */}
          {step === "preview" ? (
            <View>
              <Text className="text-zinc-50 text-2xl font-bold">
                {t("onboarding.previewTitle")}
              </Text>
              <Text className="text-zinc-400 mt-2 mb-5 leading-5">
                {t("onboarding.previewSubtitle")}
              </Text>
              <AgpPreview unit={unit} />
            </View>
          ) : null}
        </View>

        {/* ── Footer actions ──────────────────────────────────────────── */}
        <View className="mt-8">
          {step === "carbRatio" || step === "isf" ? (
            <Pressable
              onPress={() => {
                if (step === "carbRatio") setCarbRatio(String(DEFAULT_CARB_RATIO));
                else setIsf(String(glucoseToDisplay(DEFAULT_ISF_MGDL, unit)));
                next();
              }}
              className="py-2.5 items-center"
            >
              <Text className="text-zinc-400 font-medium">{t("onboarding.notSure")}</Text>
            </Pressable>
          ) : null}

          {step === "preview" ? (
            <Button
              label={t("onboarding.seePlans")}
              size="lg"
              loading={saving}
              onPress={finishToPaywall}
            />
          ) : step === "disclaimer" ? (
            <Button
              label={t("onboarding.continue")}
              size="lg"
              disabled={!accepted}
              onPress={next}
            />
          ) : step === "basal" ? (
            <Button
              label={t("onboarding.continue")}
              size="lg"
              onPress={nextFromBasal}
            />
          ) : (
            <Button
              label={stepIdx < 3 ? t("onboarding.next") : t("onboarding.continue")}
              size="lg"
              onPress={next}
            />
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function QuestionShell({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View>
      <Text className="text-zinc-50 text-2xl font-bold">{title}</Text>
      {hint ? (
        <Text className="text-zinc-400 mt-2 mb-5 leading-5">{hint}</Text>
      ) : (
        <View className="mb-5" />
      )}
      {children}
    </View>
  );
}
