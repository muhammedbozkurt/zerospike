import React, { useState } from "react";
import { ScrollView, Text, View, Platform } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { useApp } from "../lib/store/AppContext";
import { isolateLtr } from "../lib/format";
import { updateProfile } from "../lib/db/profiles";
import { syncBasalReminderRow } from "../lib/db/reminders";
import { applyNotificationPrefs } from "../lib/services/notifications";
import {
  clampTarget,
  glucoseToDisplay,
  glucoseFromDisplay,
  glucoseUnitLabel,
  TARGET_RANGE_BOUNDS,
} from "../lib/glucose";
import { CARB_TARGET_BOUNDS, clampCarbTarget } from "../lib/insulin";
import { insulinModeShowsBasal, insulinModeShowsBolus } from "../lib/insulinMode";
import { TARGET_DEFAULTS_MGDL, CARB_TARGET_DEFAULTS_G, isNoInsulinDiabetesType } from "../lib/diabetesDefaults";
import type { DiabetesType, GlucoseUnit, InsulinMode } from "../lib/db/types";
import { FormCard, InputRow, ActionRow } from "../components/form";
import { RangeInput } from "../components/RangeInput";
import { Stepper } from "../components/Stepper";
import { InlineTimePicker } from "../components/InlineTimePicker";
import { InsulinModeSection } from "../components/InsulinModeSection";
import { Segmented } from "../components/ui";
import { keyboardAwareScrollProps } from "../lib/keyboard";
import { FeedbackHost, useFeedback } from "../components/Feedback";
import { ScreenHeader } from "../components/ScreenHeader";
import { AppBackground, ConicAvatar, GradientCTA } from "../components/rich";
import { MODAL_TOP_PAD, THEME } from "../lib/theme/tokens";
import { parseDecimalText } from "../lib/numberInput";
import { upper } from "../lib/upper";
import { useLayout } from "../lib/useLayout";

/** Two-letter mark for the conic avatar (mockup 07's profile hero). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return upper(parts[0].slice(0, 2));
  return upper(parts[0][0] + parts[1][0]);
}

/**
 * Configure a (usually freshly-created) profile's personal targets.
 *
 * Rebuilt to the mockup's 07 "Profil / kurulum" composition: an identity hero
 * (conic avatar, name, and a glass chip stating the profile in one line) sits
 * above the form, so a family managing several profiles can always see WHOSE
 * numbers they are editing. Targets are ranges, using the same band control as
 * settings and onboarding.
 */
function ProfileSetupScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { columnPad } = useLayout();
  const { activeProfile, bumpData } = useApp();
  const { toast } = useFeedback();
  // Glucose fields (targets, ISF) are stored in mg/dL but shown/entered in this
  // profile's unit, so a mmol household never sees mg/dL labels or writes mmol
  // numbers into mg/dL columns. Unlike the old read-only const, unit is now
  // asked here too (Wave 2a), so it is state, with changeUnit() re-expressing
  // whatever is already typed instead of silently reinterpreting it.
  const [unit, setUnit] = useState<GlucoseUnit>(activeProfile?.glucose_unit ?? "mgdl");
  const [diabetesType, setDiabetesType] = useState<DiabetesType>(
    activeProfile?.diabetes_type ?? "unknown"
  );
  const [insulinMode, setInsulinMode] = useState<InsulinMode>(
    activeProfile?.insulin_mode ?? "both"
  );
  const [oralMeds, setOralMeds] = useState(activeProfile?.oral_meds_enabled === 1);
  const showsBolus = insulinModeShowsBolus(insulinMode);
  const showsBasal = insulinModeShowsBasal(insulinMode);

  const [name, setName] = useState(
    activeProfile?.name ?? t("profiles.defaultName")
  );
  const [fastingMin, setFastingMin] = useState(
    String(glucoseToDisplay(activeProfile?.target_fasting_min ?? 80, unit))
  );
  const [fastingMax, setFastingMax] = useState(
    String(glucoseToDisplay(activeProfile?.target_fasting_max ?? 100, unit))
  );
  const [postmealMin, setPostmealMin] = useState(
    String(glucoseToDisplay(activeProfile?.target_postmeal_min ?? 80, unit))
  );
  const [postmealMax, setPostmealMax] = useState(
    String(glucoseToDisplay(activeProfile?.target_postmeal_max ?? 140, unit))
  );
  // Ratios / ISF are stepper-driven numbers (E.7); ISF is in the display unit.
  const [crB, setCrB] = useState(activeProfile?.carb_ratio_breakfast ?? 10);
  const [crL, setCrL] = useState(activeProfile?.carb_ratio_lunch ?? 12);
  const [crD, setCrD] = useState(activeProfile?.carb_ratio_dinner ?? 12);
  const [isf, setIsf] = useState(
    glucoseToDisplay(activeProfile?.insulin_sensitivity_factor ?? 40, unit)
  );
  const [carbMin, setCarbMin] = useState(
    String(activeProfile?.daily_carb_target_min_g ?? 160)
  );
  const [carbMax, setCarbMax] = useState(
    String(activeProfile?.daily_carb_target_g ?? 200)
  );
  // A prefilled ratio/target only becomes the user's own once they actually
  // move the control on its row - same "touched" pattern onboarding uses, so
  // picking a diabetes type never overwrites a value already hand-edited, and
  // ratios_confirmed only turns on when the steppers were genuinely touched.
  const [carbRatioTouched, setCarbRatioTouched] = useState(false);
  const [isfTouched, setIsfTouched] = useState(false);
  const [targetsTouched, setTargetsTouched] = useState(false);
  const [carbRangeTouched, setCarbRangeTouched] = useState(false);
  const [basalTime, setBasalTime] = useState("22:00");
  // Whether the user actually picked a time, vs. just seeing the "22:00"
  // placeholder - gates whether save() overwrites the device's shared basal
  // reminder time (see save()).
  const [basalTimeTouched, setBasalTimeTouched] = useState(false);
  const [showTime, setShowTime] = useState(false);
  const [saving, setSaving] = useState(false);

  function n(v: string, fallback: number): number {
    const x = (parseDecimalText(v) ?? NaN);
    return Number.isFinite(x) && x > 0 ? x : fallback;
  }

  // Re-expresses whatever is already typed in the new unit; only the
  // glucose-unit-dependent fields (targets, ISF) need converting, not the
  // carb ratios (g of carb per unit of insulin) or the carb range (grams).
  function changeUnit(next: GlucoseUnit) {
    if (next === unit) return;
    const convert = (text: string, fallbackMgdl: number) =>
      String(
        glucoseToDisplay(
          glucoseFromDisplay(n(text, glucoseToDisplay(fallbackMgdl, unit)), unit),
          next
        )
      );
    setFastingMin(convert(fastingMin, 80));
    setFastingMax(convert(fastingMax, 100));
    setPostmealMin(convert(postmealMin, 80));
    setPostmealMax(convert(postmealMax, 140));
    setIsf(glucoseToDisplay(glucoseFromDisplay(isf, unit), next));
    setUnit(next);
  }

  // Picking a diabetes type seeds the target-range (+ carb-range) defaults,
  // per the Wave 2a matrix, only while the user hasn't hand-edited a value.
  // prediabetes/none also force insulin_mode back to "none", the same way the
  // insulin segment itself works once it re-hides.
  function selectDiabetesType(next: DiabetesType) {
    setDiabetesType(next);
    if (isNoInsulinDiabetesType(next)) setInsulinMode("none");
    if (!targetsTouched) {
      const { fasting, postmeal } = TARGET_DEFAULTS_MGDL[next];
      setFastingMin(String(glucoseToDisplay(fasting.min, unit)));
      setFastingMax(String(glucoseToDisplay(fasting.max, unit)));
      setPostmealMin(String(glucoseToDisplay(postmeal.min, unit)));
      setPostmealMax(String(glucoseToDisplay(postmeal.max, unit)));
    }
    if (!carbRangeTouched) {
      const carb = CARB_TARGET_DEFAULTS_G[next];
      setCarbMin(String(carb.min));
      setCarbMax(String(carb.max));
    }
  }

  function rangeOk(minText: string, maxText: string): boolean {
    const lo = (parseDecimalText(minText) ?? NaN);
    const hi = (parseDecimalText(maxText) ?? NaN);
    return Number.isFinite(lo) && Number.isFinite(hi) && lo < hi;
  }

  /** Both ends inside the accepted band, in the unit being typed. */
  function withinBounds(
    minText: string,
    maxText: string,
    bounds: { min: number; max: number }
  ): boolean {
    const lo = (parseDecimalText(minText) ?? NaN);
    const hi = (parseDecimalText(maxText) ?? NaN);
    return (
      lo >= bounds.min && lo <= bounds.max && hi >= bounds.min && hi <= bounds.max
    );
  }

  const glucoseBounds = {
    min: glucoseToDisplay(TARGET_RANGE_BOUNDS.min, unit),
    max: glucoseToDisplay(TARGET_RANGE_BOUNDS.max, unit),
  };

  const fastingOk =
    rangeOk(fastingMin, fastingMax) &&
    withinBounds(fastingMin, fastingMax, glucoseBounds);
  const postmealOk =
    rangeOk(postmealMin, postmealMax) &&
    withinBounds(postmealMin, postmealMax, glucoseBounds);
  const carbOk =
    rangeOk(carbMin, carbMax) &&
    withinBounds(carbMin, carbMax, CARB_TARGET_BOUNDS);
  const canSave = fastingOk && postmealOk && carbOk;

  async function save() {
    if (!activeProfile || !canSave) return;
    setSaving(true);
    try {
      await updateProfile(activeProfile.id, {
        name: name.trim() || t("profiles.defaultName"),
        glucose_unit: unit,
        diabetes_type: diabetesType,
        insulin_mode: insulinMode,
        oral_meds_enabled: oralMeds ? 1 : 0,
        target_fasting_min: clampTarget(
          glucoseFromDisplay(n(fastingMin, glucoseToDisplay(80, unit)), unit)
        ),
        target_fasting_max: clampTarget(
          glucoseFromDisplay(n(fastingMax, glucoseToDisplay(100, unit)), unit)
        ),
        target_postmeal_min: clampTarget(
          glucoseFromDisplay(n(postmealMin, glucoseToDisplay(80, unit)), unit)
        ),
        target_postmeal_max: clampTarget(
          glucoseFromDisplay(n(postmealMax, glucoseToDisplay(140, unit)), unit)
        ),
        carb_ratio_breakfast: crB,
        carb_ratio_lunch: crL,
        carb_ratio_dinner: crD,
        insulin_sensitivity_factor: glucoseFromDisplay(isf, unit),
        daily_carb_target_min_g: clampCarbTarget(n(carbMin, 160)),
        daily_carb_target_g: clampCarbTarget(n(carbMax, 200)),
        // Only counts as the user's own ratios once the steppers were actually
        // touched (onboarding pattern) - walking past the prefilled defaults is
        // not a confirmation.
        ratios_confirmed: showsBolus && carbRatioTouched && isfTouched ? 1 : 0,
      });
      // The basal choice is written straight to the reminders registry, not the
      // legacy prefs.basal/basalTime bridge (lib/db/remindersBridge.ts): that
      // bridge only ever runs ONCE per device, and has almost always already
      // fired by the time a second (or reset) profile reaches this screen -
      // writing only the legacy prefs left this choice with no effect on any
      // actual reminder. basalTime itself only overwrites an EXISTING row when
      // the user actually picked one (see basalTimeTouched above): each profile
      // keeps its OWN basal row since schema v19 (lib/db/reminders.ts), so this
      // now guards only against an untouched "22:00" placeholder clobbering a
      // time THIS profile already set for itself. syncBasalReminderRow resolves
      // "this profile" from the active profile - already this one, since
      // AppContext's setActiveProfileId writes it before this screen ever
      // opens. A full reminders table (MAX_REMINDERS, per profile) blocks only
      // a brand NEW row - an existing basal row is always updated in place.
      const basalSynced = await syncBasalReminderRow(
        showsBasal,
        basalTime,
        basalTimeTouched
      );
      if (!basalSynced) {
        toast(t("reminders.limitReached"), "error");
      }
      await applyNotificationPrefs();
      bumpData();
      router.back();
    } finally {
      setSaving(false);
    }
  }

  // Bidi: writingDirection alone was verified NOT enough on-device for a
  // hyphenated range under RTL (see insights.tsx's target-band fix); this
  // string has no RTL script content at all, so the whole thing is isolated.
  const summary = isolateLtr(
    [glucoseUnitLabel(unit), `${fastingMin}-${fastingMax}`].join(" · ")
  );

  return (
    <AppBackground style={{ paddingTop: Math.max(insets.top, MODAL_TOP_PAD) }}>
      <ScreenHeader
        title={t("profiles.add")}
        onBack={() => router.back()}
        backIcon="close"
        accessibilityLabel={t("common.close")}
      />

      <ScrollView
        {...keyboardAwareScrollProps}
        contentContainerStyle={{
          paddingTop: 16,
          paddingBottom: insets.bottom + 28,
          ...columnPad(16),
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Identity hero (mockup 07) */}
        <View className="items-center mb-5" style={{ gap: 8 }}>
          <ConicAvatar label={initials(name)} size={66} />
          <Text
            style={{ color: THEME.ink, fontSize: 22, fontWeight: "800" }}
            numberOfLines={1}
          >
            {name || t("profiles.defaultName")}
          </Text>
          <View
            className="rounded-full px-3 py-1"
            style={{ backgroundColor: THEME.glass, borderWidth: 1, borderColor: THEME.border }}
          >
            {/* Bidi: "mg/dL · 70-180" holds a hyphenated number range, which
                reorders under RTL unless pinned LTR (same fix as insights'
                target-band line). */}
            <Text style={{ color: THEME.muted, fontSize: 11, writingDirection: "ltr" }}>
              {summary}
            </Text>
          </View>
          <Text
            style={{
              color: THEME.muted,
              fontSize: 11,
              lineHeight: 16,
              textAlign: "center",
              paddingHorizontal: 16,
            }}
          >
            {t("profiles.setupHint")}
          </Text>
        </View>

        <FormCard icon="person-outline" title={t("onboarding.secProfile")}>
          <InputRow
            icon="text-outline"
            label={t("onboarding.profileName")}
            value={name}
            onChangeText={setName}
            placeholder={t("profiles.newNamePlaceholder")}
            last
          />
        </FormCard>

        <FormCard icon="options-outline" title={t("settings.glucoseUnit")}>
          <View className="px-4 py-3.5">
            <Segmented
              options={[
                { value: "mgdl", label: "mg/dL" },
                { value: "mmol", label: "mmol/L" },
              ]}
              value={unit}
              onChange={(u: GlucoseUnit) => changeUnit(u)}
            />
          </View>
        </FormCard>

        <FormCard icon="medkit-outline" title={t("settings.diabetesType")}>
          <View className="px-4 py-3.5">
            <Segmented
              options={(
                ["type1", "type2", "gestational", "prediabetes", "none", "unknown"] as DiabetesType[]
              ).map((d) => ({
                value: d,
                label: d === "unknown" ? t("onboarding.diabetes_other") : t(`onboarding.diabetes_${d}`),
              }))}
              value={diabetesType}
              onChange={(d: DiabetesType) => selectDiabetesType(d)}
            />
            <Text className="text-mut text-xs mt-2 leading-4">{t("settings.diabetesTypeHint")}</Text>
          </View>
        </FormCard>

        <InsulinModeSection
          diabetesType={diabetesType}
          insulinMode={insulinMode}
          onChangeInsulinMode={setInsulinMode}
          oralMeds={oralMeds}
          onChangeOralMeds={setOralMeds}
        />

        <RangeInput
          label={t("settings.fastingRange")}
          unit={glucoseUnitLabel(unit)}
          minText={fastingMin}
          maxText={fastingMax}
          onChangeMin={(v) => {
            setFastingMin(v);
            setTargetsTouched(true);
          }}
          onChangeMax={(v) => {
            setFastingMax(v);
            setTargetsTouched(true);
          }}
          axisMin={glucoseToDisplay(50, unit)}
          axisMax={glucoseToDisplay(250, unit)}
          minLabel={t("common.rangeMin")}
          maxLabel={t("common.rangeMax")}
          invalid={!fastingOk}
          invalidMessage={t("settings.rangeInvalid")}
          bounds={glucoseBounds}
          outOfBoundsMessage={t("settings.rangeOutOfBounds", {
            min: glucoseBounds.min,
            max: glucoseBounds.max,
          })}
          decimals={unit === "mmol"}
        />
        <RangeInput
          label={t("settings.postmealRange")}
          unit={glucoseUnitLabel(unit)}
          minText={postmealMin}
          maxText={postmealMax}
          onChangeMin={(v) => {
            setPostmealMin(v);
            setTargetsTouched(true);
          }}
          onChangeMax={(v) => {
            setPostmealMax(v);
            setTargetsTouched(true);
          }}
          axisMin={glucoseToDisplay(50, unit)}
          axisMax={glucoseToDisplay(300, unit)}
          minLabel={t("common.rangeMin")}
          maxLabel={t("common.rangeMax")}
          invalid={!postmealOk}
          invalidMessage={t("settings.rangeInvalid")}
          bounds={glucoseBounds}
          outOfBoundsMessage={t("settings.rangeOutOfBounds", {
            min: glucoseBounds.min,
            max: glucoseBounds.max,
          })}
          decimals={unit === "mmol"}
        />
        <RangeInput
          label={t("settings.carbRange")}
          unit={t("common.grams")}
          minText={carbMin}
          maxText={carbMax}
          onChangeMin={(v) => {
            setCarbMin(v);
            setCarbRangeTouched(true);
          }}
          onChangeMax={(v) => {
            setCarbMax(v);
            setCarbRangeTouched(true);
          }}
          axisMin={0}
          axisMax={400}
          minLabel={t("common.rangeMin")}
          maxLabel={t("common.rangeMax")}
          invalid={!carbOk}
          invalidMessage={t("settings.rangeInvalid")}
          bounds={CARB_TARGET_BOUNDS}
          outOfBoundsMessage={t("settings.rangeOutOfBounds", {
            min: CARB_TARGET_BOUNDS.min,
            max: CARB_TARGET_BOUNDS.max,
          })}
        />

        {showsBolus ? (
          <FormCard icon="restaurant-outline" title={t("settings.carbRatios")}>
            {(
              [
                ["breakfast", crB, setCrB],
                ["lunch", crL, setCrL],
                ["dinner", crD, setCrD],
              ] as const
            ).map(([slot, value, setter]) => (
              <View key={slot} className="px-4 py-3">
                <Text className="text-mut text-xs mb-2">{t(`slot.${slot}`)}</Text>
                <Stepper
                  value={value}
                  onChange={(v) => {
                    setter(v);
                    setCarbRatioTouched(true);
                  }}
                  step={0.5}
                  longStep={1}
                  min={1}
                  max={50}
                  decimals={1}
                  suffix={t("common.carbRatioUnit")}
                  accessibilityLabel={t(`slot.${slot}`)}
                />
              </View>
            ))}
          </FormCard>
        ) : null}

        {showsBolus || showsBasal ? (
          <FormCard icon="pulse-outline" title={t("onboarding.secReminder")}>
            {showsBolus ? (
              <View className="px-4 py-3">
                <Text className="text-mut text-xs mb-2">{t("settings.isfHint")}</Text>
                <Stepper
                  value={isf}
                  onChange={(v) => {
                    setIsf(v);
                    setIsfTouched(true);
                  }}
                  step={unit === "mmol" ? 0.1 : 1}
                  longStep={unit === "mmol" ? 0.5 : 5}
                  min={unit === "mmol" ? 0.5 : 5}
                  max={unit === "mmol" ? 30 : 500}
                  decimals={unit === "mmol" ? 1 : 0}
                  suffix={glucoseUnitLabel(unit)}
                  accessibilityLabel={t("settings.isf")}
                />
              </View>
            ) : null}
            {showsBasal ? (
              <ActionRow
                icon="alarm-outline"
                label={t("settings.basalTime")}
                value={basalTime}
                onPress={() => setShowTime((s) => !s)}
                last
              />
            ) : null}
          </FormCard>
        ) : null}
        <InlineTimePicker
          visible={showTime}
          value={basalTime}
          onChange={(v) => {
            setBasalTime(v);
            setBasalTimeTouched(true);
          }}
          onClose={() => setShowTime(false)}
        />

        <View className="h-2" />
        <GradientCTA
          label={t("common.save")}
          disabled={saving || !canSave}
          onPress={save}
        />
      </ScrollView>
      <FeedbackHost />
    </AppBackground>
  );
}

export default function ProfileSetupRoute() {
  return (
    <SafeAreaProvider>
      <ProfileSetupScreen />
    </SafeAreaProvider>
  );
}
