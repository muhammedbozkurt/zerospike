import React, { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { useApp } from "../lib/store/AppContext";
import { updateProfile } from "../lib/db/profiles";
import { scheduleBasalReminder } from "../lib/services/notifications";
import {
  clampTarget,
  glucoseToDisplay,
  glucoseFromDisplay,
  glucoseUnitLabel,
  TARGET_RANGE_BOUNDS,
} from "../lib/glucose";
import { CARB_TARGET_BOUNDS, clampCarbTarget } from "../lib/insulin";
import { insulinModeShowsBasal, insulinModeShowsBolus } from "../lib/insulinMode";
import { FormCard, InputRow, ActionRow } from "../components/form";
import { RangeInput } from "../components/RangeInput";
import { InlineTimePicker } from "../components/InlineTimePicker";
import { keyboardAwareScrollProps } from "../lib/keyboard";
import { FeedbackHost } from "../components/Feedback";
import { ScreenHeader } from "../components/ScreenHeader";
import { AppBackground, ConicAvatar, GradientCTA } from "../components/rich";
import { THEME } from "../lib/theme/tokens";

/** Two-letter mark for the conic avatar (mockup 07's profile hero). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
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
export default function ProfileSetupScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { activeProfile, bumpData } = useApp();
  // Glucose fields (targets, ISF) are stored in mg/dL but shown/entered in this
  // profile's unit, so a mmol household never sees mg/dL labels or writes mmol
  // numbers into mg/dL columns.
  const unit = activeProfile?.glucose_unit ?? "mgdl";
  const showsBolus = insulinModeShowsBolus(activeProfile?.insulin_mode);
  const showsBasal = insulinModeShowsBasal(activeProfile?.insulin_mode);

  const [name, setName] = useState(activeProfile?.name ?? "Profil");
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
  const [crB, setCrB] = useState(String(activeProfile?.carb_ratio_breakfast ?? 10));
  const [crL, setCrL] = useState(String(activeProfile?.carb_ratio_lunch ?? 12));
  const [crD, setCrD] = useState(String(activeProfile?.carb_ratio_dinner ?? 12));
  const [isf, setIsf] = useState(
    String(glucoseToDisplay(activeProfile?.insulin_sensitivity_factor ?? 40, unit))
  );
  const [carbMin, setCarbMin] = useState(
    String(activeProfile?.daily_carb_target_min_g ?? 160)
  );
  const [carbMax, setCarbMax] = useState(
    String(activeProfile?.daily_carb_target_g ?? 200)
  );
  const [basalTime, setBasalTime] = useState("22:00");
  const [showTime, setShowTime] = useState(false);
  const [saving, setSaving] = useState(false);

  function n(v: string, fallback: number): number {
    const x = parseFloat(v.replace(",", "."));
    return Number.isFinite(x) && x > 0 ? x : fallback;
  }

  function rangeOk(minText: string, maxText: string): boolean {
    const lo = parseFloat(minText.replace(",", "."));
    const hi = parseFloat(maxText.replace(",", "."));
    return Number.isFinite(lo) && Number.isFinite(hi) && lo < hi;
  }

  /** Both ends inside the accepted band, in the unit being typed. */
  function withinBounds(
    minText: string,
    maxText: string,
    bounds: { min: number; max: number }
  ): boolean {
    const lo = parseFloat(minText.replace(",", "."));
    const hi = parseFloat(maxText.replace(",", "."));
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
        name: name.trim() || "Profil",
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
        carb_ratio_breakfast: n(crB, 10),
        carb_ratio_lunch: n(crL, 12),
        carb_ratio_dinner: n(crD, 12),
        insulin_sensitivity_factor: glucoseFromDisplay(
          n(isf, glucoseToDisplay(40, unit)),
          unit
        ),
        daily_carb_target_min_g: clampCarbTarget(n(carbMin, 160)),
        daily_carb_target_g: clampCarbTarget(n(carbMax, 200)),
        // These are values the user has now explicitly entered for this profile,
        // so they stop counting as defaults the app assumed on their behalf.
        ratios_confirmed: showsBolus ? 1 : 0,
      });
      if (showsBasal) await scheduleBasalReminder(basalTime);
      bumpData();
      router.back();
    } finally {
      setSaving(false);
    }
  }

  const summary = [glucoseUnitLabel(unit), `${fastingMin}-${fastingMax}`].join(" · ");

  return (
    <AppBackground style={{ paddingTop: insets.top }}>
      <ScreenHeader
        title={t("profiles.add")}
        onBack={() => router.back()}
        backIcon="close"
        accessibilityLabel={t("common.close")}
      />

      <ScrollView
        {...keyboardAwareScrollProps}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 28 }}
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
            <Text style={{ color: THEME.muted, fontSize: 11 }}>{summary}</Text>
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

        <RangeInput
          label={t("settings.fastingRange")}
          unit={glucoseUnitLabel(unit)}
          minText={fastingMin}
          maxText={fastingMax}
          onChangeMin={setFastingMin}
          onChangeMax={setFastingMax}
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
          onChangeMin={setPostmealMin}
          onChangeMax={setPostmealMax}
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
          onChangeMin={setCarbMin}
          onChangeMax={setCarbMax}
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
            <InputRow
              icon="cafe-outline"
              label={t("slot.breakfast")}
              value={crB}
              onChangeText={setCrB}
              keyboardType="decimal-pad"
              suffix={t("common.carbRatioUnit")}
            />
            <InputRow
              icon="partly-sunny-outline"
              label={t("slot.lunch")}
              value={crL}
              onChangeText={setCrL}
              keyboardType="decimal-pad"
              suffix={t("common.carbRatioUnit")}
            />
            <InputRow
              icon="moon-outline"
              label={t("slot.dinner")}
              value={crD}
              onChangeText={setCrD}
              keyboardType="decimal-pad"
              suffix={t("common.carbRatioUnit")}
              last
            />
          </FormCard>
        ) : null}

        {showsBolus || showsBasal ? (
          <FormCard icon="pulse-outline" title={t("onboarding.secReminder")}>
            {showsBolus ? (
              <InputRow
                icon="pulse-outline"
                label={t("settings.isf")}
                hint={t("settings.isfHint")}
                value={isf}
                onChangeText={setIsf}
                keyboardType="decimal-pad"
                suffix={glucoseUnitLabel(unit)}
                maxLength={5}
                last={!showsBasal}
              />
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
          onChange={setBasalTime}
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
