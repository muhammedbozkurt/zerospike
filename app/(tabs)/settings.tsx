import React, { useEffect, useState } from "react";
import { Linking, Platform, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Constants from "expo-constants";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { AppBackgroundFill } from "../../components/rich";
import { useTranslation } from "react-i18next";

import { useApp } from "../../lib/store/AppContext";
import { updateProfile, deleteProfile } from "../../lib/db/profiles";
import { clearAllLogs } from "../../lib/db/index";
import { loadDemoData } from "../../lib/db/demo";
import { markSampleActive, clearSampleFlag } from "../../lib/sampleData";
import { exportLogsCsv } from "../../lib/services/export";
import { exportLogsPdf } from "../../lib/services/report";
import { INSIGHTS_WINDOWS } from "../../lib/insights";
import { setProOverride, presentCodeRedemption, restore } from "../../lib/services/purchases";
import {
  applyNotificationPrefs,
  hasNotificationPermission,
} from "../../lib/services/notifications";
import {
  getNotificationPrefs,
  setNotificationPrefs,
  type NotificationPrefs,
} from "../../lib/services/notificationPrefs";
import type {
  Lang,
  GlucoseUnit,
  DiabetesType,
  InsulinMode,
} from "../../lib/db/types";
import {
  clampHypoThreshold,
  clampTarget,
  glucoseToDisplay,
  glucoseFromDisplay,
  glucoseUnitLabel,
  TARGET_RANGE_BOUNDS,
} from "../../lib/glucose";
import { CARB_TARGET_BOUNDS, clampCarbTarget } from "../../lib/insulin";
import {
  insulinModeOf,
  insulinModeShowsBasal,
  insulinModeShowsBolus,
  insulinModeUsesInsulin,
} from "../../lib/insulinMode";
import { SectionLabel, Segmented } from "../../components/ui";
import { FormCard, InputRow } from "../../components/form";
import { RangeInput } from "../../components/RangeInput";
import {
  checkReminderReliability,
  remindersMayBeLimited,
  type ReminderReliability,
} from "../../lib/services/notifications";
import { GLUCOSE_RICH, THEME } from "../../lib/theme/tokens";
import { withAlpha } from "../../components/rich/GlassCard";
import { InlineTimePicker } from "../../components/InlineTimePicker";
import { LanguagePicker } from "../../components/LanguagePicker";
import { ProfileSwitcher } from "../../components/ProfileSwitcher";
import { DisclaimerBanner } from "../../components/Disclaimer";
import { useFeedback } from "../../components/Feedback";
import { privacyUrl, termsUrl } from "../../lib/legal";
import { isConfigured as spikeConfigured } from "../../lib/ai/spikeClient";

function Row({
  icon,
  label,
  value,
  onPress,
  danger,
  right,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
  right?: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center bg-glass border border-hair rounded-2xl px-3 py-3 mb-2 active:opacity-80"
    >
      <View
        className="w-9 h-9 rounded-xl items-center justify-center"
        style={{ backgroundColor: withAlpha(danger ? GLUCOSE_RICH.low : THEME.accent, 0.14) }}
      >
        <Ionicons name={icon} size={18} color={danger ? GLUCOSE_RICH.low : THEME.accent} />
      </View>
      <Text
        className="flex-1 ml-3 text-[15px] font-semibold"
        style={{ color: danger ? GLUCOSE_RICH.low : THEME.ink }}
      >
        {label}
      </Text>
      {value ? <Text className="text-mut text-[13px] mr-1 font-medium">{value}</Text> : null}
      {right ?? (onPress ? (
        <Ionicons name="chevron-forward" size={18} color={THEME.muted} />
      ) : null)}
    </Pressable>
  );
}

export default function SettingsScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { toast, confirm, actionSheet } = useFeedback();
  const {
    activeProfile,
    profiles,
    isProUser,
    lang,
    setLanguage,
    bumpData,
    refreshPro,
    refreshProfiles,
  } = useApp();

  // Local editable copies of the profile fields.
  const [name, setName] = useState("");
  const [isf, setIsf] = useState("");
  const [crB, setCrB] = useState("");
  const [crL, setCrL] = useState("");
  const [crD, setCrD] = useState("");
  const [fastingMin, setFastingMin] = useState("");
  const [fastingMax, setFastingMax] = useState("");
  const [postmealMin, setPostmealMin] = useState("");
  const [postmealMax, setPostmealMax] = useState("");
  const [carbMin, setCarbMin] = useState("");
  const [carbMax, setCarbMax] = useState("");
  const [reliability, setReliability] = useState<ReminderReliability | null>(null);
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [openPicker, setOpenPicker] = useState<
    "basal" | "glucose" | "weekly" | null
  >(null);
  const [notifDenied, setNotifDenied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const unit: GlucoseUnit = activeProfile?.glucose_unit ?? "mgdl";
  // The accepted band, expressed in the unit the user is actually typing in.
  const glucoseBounds = {
    min: glucoseToDisplay(TARGET_RANGE_BOUNDS.min, unit),
    max: glucoseToDisplay(TARGET_RANGE_BOUNDS.max, unit),
  };
  const insulinMode = insulinModeOf(activeProfile);
  const showsBolus = insulinModeShowsBolus(insulinMode);
  const showsBasal = insulinModeShowsBasal(insulinMode);
  const usesInsulin = insulinModeUsesInsulin(insulinMode);

  useEffect(() => {
    if (!activeProfile) return;
    const u = activeProfile.glucose_unit ?? "mgdl";
    setName(activeProfile.name);
    setIsf(String(glucoseToDisplay(activeProfile.insulin_sensitivity_factor, u)));
    setCrB(String(activeProfile.carb_ratio_breakfast));
    setCrL(String(activeProfile.carb_ratio_lunch));
    setCrD(String(activeProfile.carb_ratio_dinner));
    // Targets are stored in mg/dL - show them in the profile's unit.
    setFastingMin(String(glucoseToDisplay(activeProfile.target_fasting_min, u)));
    setFastingMax(String(glucoseToDisplay(activeProfile.target_fasting_max, u)));
    setPostmealMin(String(glucoseToDisplay(activeProfile.target_postmeal_min, u)));
    setPostmealMax(String(glucoseToDisplay(activeProfile.target_postmeal_max, u)));
    setCarbMin(String(activeProfile.daily_carb_target_min_g));
    setCarbMax(String(activeProfile.daily_carb_target_g));
  }, [activeProfile?.id, activeProfile?.glucose_unit]);

  // Load notification preferences + current permission state.
  useEffect(() => {
    (async () => {
      const p = await getNotificationPrefs();
      setPrefs(p);
      const granted = await hasNotificationPermission();
      setNotifDenied(p.enabled && !granted);
      setReliability(await checkReminderReliability());
    })();
  }, []);

  async function updatePrefs(patch: Partial<NotificationPrefs>) {
    const base = prefs ?? (await getNotificationPrefs());
    const next = { ...base, ...patch };
    setPrefs(next);
    await setNotificationPrefs(next);
    await applyNotificationPrefs(next);
    const granted = await hasNotificationPermission();
    setNotifDenied(next.enabled && !granted);
    setReliability(await checkReminderReliability());
  }

  function n(v: string, fallback: number): number {
    const x = parseFloat(v.replace(",", "."));
    return Number.isFinite(x) && x > 0 ? x : fallback;
  }

  async function persist(patch: Record<string, string | number>) {
    if (!activeProfile) return;
    await updateProfile(activeProfile.id, patch);
    bumpData();
  }

  /**
   * Saving a ratio is the user telling us this IS their number, so it also
   * clears the "running on defaults" state the calculator surfaces. Until they
   * do, a default must never be presented as if they had chosen it.
   */
  async function persistRatio(patch: Record<string, number>) {
    await persist({ ...patch, ratios_confirmed: 1 });
  }

  /** Both ends parse and the low end is genuinely below the high one. */
  function rangeOk(minText: string, maxText: string): boolean {
    const lo = parseFloat(minText.replace(",", "."));
    const hi = parseFloat(maxText.replace(",", "."));
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return false;
    return lo < hi;
  }

  /** Whether both ends sit inside the accepted band (display unit). */
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

  // Ranges are only written once both ends are coherent, so a half-typed pair
  // never lands in the database and starts miscolouring readings.
  async function persistRange(which: "fasting" | "postmeal") {
    const minText = which === "fasting" ? fastingMin : postmealMin;
    const maxText = which === "fasting" ? fastingMax : postmealMax;
    // Out-of-band input is reported on the control and NOT stored: clamping it
    // silently would leave the field showing a number the profile never got.
    if (!rangeOk(minText, maxText)) return;
    if (!withinBounds(minText, maxText, glucoseBounds)) return;
    const lo = clampTarget(glucoseFromDisplay(n(minText, 80), unit));
    const hi = clampTarget(glucoseFromDisplay(n(maxText, 140), unit));
    if (lo >= hi) return;
    await persist(
      which === "fasting"
        ? { target_fasting_min: lo, target_fasting_max: hi }
        : { target_postmeal_min: lo, target_postmeal_max: hi }
    );
  }

  async function persistCarbRange() {
    if (!rangeOk(carbMin, carbMax)) return;
    if (!withinBounds(carbMin, carbMax, CARB_TARGET_BOUNDS)) return;
    const lo = clampCarbTarget(n(carbMin, 160));
    const hi = clampCarbTarget(n(carbMax, 200));
    if (lo >= hi) return;
    await persist({ daily_carb_target_min_g: lo, daily_carb_target_g: hi });
  }

  async function onExport() {
    if (!activeProfile) return;
    if (!isProUser) {
      router.push("/paywall");
      return;
    }
    setExporting(true);
    const res = await exportLogsCsv(activeProfile.id, activeProfile.name, unit);
    setExporting(false);
    if (!res.ok) {
      toast(
        res.reason === "noData"
          ? t("export.noData")
          : t("export.sharingUnavailable"),
        "error"
      );
    }
  }

  async function runPdf(days: number) {
    if (!activeProfile) return;
    setExportingPdf(true);
    const res = await exportLogsPdf(activeProfile, days);
    setExportingPdf(false);
    if (res.ok) {
      toast(t("report.created"), "success");
    } else {
      toast(
        res.reason === "noData"
          ? t("export.noData")
          : t("export.sharingUnavailable"),
        "error"
      );
    }
  }

  function onExportPdf() {
    if (!activeProfile) return;
    if (!isProUser) {
      router.push("/paywall");
      return;
    }
    actionSheet({
      title: t("settings.exportPdf"),
      actions: INSIGHTS_WINDOWS.map((d) => ({
        label: t("insights.windowDays", { n: d }),
        icon: "calendar-outline" as const,
        onPress: () => runPdf(d),
      })),
    });
  }

  async function onToggleSimPro(value: boolean) {
    await setProOverride(value);
    await refreshPro();
  }

  async function onRedeemCode() {
    if (Platform.OS === "android") {
      Linking.openURL("https://play.google.com/redeem");
      return;
    }
    await presentCodeRedemption();
    await refreshPro();
  }

  // Restore prior purchases. Same service + toast keys as the paywall so the
  // feedback is identical wherever a user restores from.
  async function onRestore() {
    if (restoring) return;
    setRestoring(true);
    try {
      const result = await restore();
      await refreshPro();
      if (result === "restored") toast(t("paywall.restored"), "success");
      else if (result === "none") toast(t("paywall.nothingToRestore"), "info");
      else toast(t("paywall.restoreFailed"), "error");
    } finally {
      setRestoring(false);
    }
  }

  async function onLoadDemo() {
    if (!activeProfile) return;
    await loadDemoData(activeProfile.id);
    await markSampleActive(activeProfile.id);
    bumpData();
    toast(t("settings.demoLoaded"), "success");
  }

  async function onClearLogs() {
    const ok = await confirm({
      title: t("settings.clearLogs"),
      message: t("settings.clearLogsConfirm"),
      confirmLabel: t("common.delete"),
      destructive: true,
    });
    if (!ok) return;
    await clearAllLogs();
    if (activeProfile) await clearSampleFlag(activeProfile.id);
    bumpData();
    toast(t("settings.saved"), "success");
  }

  async function onDeleteProfile() {
    if (!activeProfile) return;
    if (profiles.length <= 1) {
      toast(t("profiles.cannotDeleteLast"), "error");
      return;
    }
    const ok = await confirm({
      title: t("profiles.delete"),
      message: t("profiles.deleteConfirm"),
      confirmLabel: t("common.delete"),
      destructive: true,
      icon: "person-remove-outline",
    });
    if (!ok) return;
    await deleteProfile(activeProfile.id);
    await refreshProfiles();
    bumpData();
  }

  async function onChangeLang(next: Lang) {
    await setLanguage(next);
    // Reschedule so reminder text matches the new language.
    await applyNotificationPrefs();
  }

  const version =
    Constants.expoConfig?.version ?? "1.0.0";

  return (
    <View className="flex-1" style={{ paddingTop: insets.top }}>
      <AppBackgroundFill />
      <View className="flex-row items-center justify-between px-4 pt-2 pb-3">
        <Text className="text-ink text-2xl font-bold">{t("settings.title")}</Text>
        <ProfileSwitcher />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Profile */}
        <FormCard icon="person-outline" title={t("onboarding.secProfile")}>
          <InputRow
            icon="text-outline"
            label={t("settings.name")}
            value={name}
            onChangeText={setName}
            onEndEditing={() => persist({ name: name.trim() || "Profil" })}
            last
          />
        </FormCard>

        {/* Glucose unit */}
        <FormCard icon="options-outline" title={t("settings.glucoseUnit")}>
          <View className="px-4 py-3.5">
            <Segmented
              options={[
                { value: "mgdl", label: "mg/dL" },
                { value: "mmol", label: "mmol/L" },
              ]}
              value={unit}
              onChange={(u: GlucoseUnit) => persist({ glucose_unit: u })}
            />
          </View>
        </FormCard>

        {/* What the user actually uses - the answers that shape the whole UI */}
        <SectionLabel>{t("settings.insulinMode")}</SectionLabel>
        <View className="bg-glass border border-hair rounded-2xl px-4 py-3 mb-2">
          <Segmented
            options={(["none", "basal", "bolus", "both"] as InsulinMode[]).map((m) => ({
              value: m,
              label: t(`onboarding.insulin_${m}`),
            }))}
            value={insulinMode}
            onChange={(m: InsulinMode) => persist({ insulin_mode: m })}
          />
          <Text className="text-mut text-xs mt-2 leading-4">
            {t("settings.insulinModeHint")}
          </Text>
        </View>

        <View className="bg-glass border border-hair rounded-2xl px-4 py-3 mb-3">
          <Text className="text-mut text-xs mb-2">{t("settings.diabetesType")}</Text>
          <Segmented
            options={(
              ["type1", "type2", "gestational", "prediabetes", "unknown"] as DiabetesType[]
            ).map((d) => ({
              value: d,
              label:
                d === "unknown"
                  ? t("onboarding.diabetes_other")
                  : t(`onboarding.diabetes_${d}`),
            }))}
            value={activeProfile?.diabetes_type ?? "unknown"}
            onChange={(d: DiabetesType) => persist({ diabetes_type: d })}
          />
          <Text className="text-mut text-xs mt-2 leading-4">
            {t("settings.diabetesTypeHint")}
          </Text>
        </View>

        {/* Targets: RANGES, not single ceilings */}
        <SectionLabel>{t("settings.targetsSection")}</SectionLabel>
        <RangeInput
          label={t("settings.fastingRange")}
          unit={glucoseUnitLabel(unit)}
          minText={fastingMin}
          maxText={fastingMax}
          onChangeMin={setFastingMin}
          onChangeMax={setFastingMax}
          onBlur={() => persistRange("fasting")}
          axisMin={glucoseToDisplay(50, unit)}
          axisMax={glucoseToDisplay(250, unit)}
          minLabel={t("common.rangeMin")}
          maxLabel={t("common.rangeMax")}
          invalid={!rangeOk(fastingMin, fastingMax)}
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
          onBlur={() => persistRange("postmeal")}
          axisMin={glucoseToDisplay(50, unit)}
          axisMax={glucoseToDisplay(300, unit)}
          minLabel={t("common.rangeMin")}
          maxLabel={t("common.rangeMax")}
          invalid={!rangeOk(postmealMin, postmealMax)}
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
          onBlur={persistCarbRange}
          axisMin={0}
          axisMax={400}
          minLabel={t("common.rangeMin")}
          maxLabel={t("common.rangeMax")}
          invalid={!rangeOk(carbMin, carbMax)}
          invalidMessage={t("settings.rangeInvalid")}
          bounds={CARB_TARGET_BOUNDS}
          outOfBoundsMessage={t("settings.rangeOutOfBounds", {
            min: CARB_TARGET_BOUNDS.min,
            max: CARB_TARGET_BOUNDS.max,
          })}
        />

        {/* The user's own low threshold - the boundary "low" is measured from */}
        <View className="bg-glass border border-hair rounded-2xl px-4 py-3 mb-3">
          <Text className="text-mut text-xs mb-2">
            {t("settings.hypoThreshold")} ({glucoseUnitLabel(unit)})
          </Text>
          <Segmented
            options={[54, 60, 65, 70, 75, 80].map((mgdl) => ({
              value: String(mgdl),
              label: String(glucoseToDisplay(mgdl, unit)),
            }))}
            value={String(activeProfile?.hypo_threshold_mgdl ?? 70)}
            onChange={(v) =>
              void persist({ hypo_threshold_mgdl: clampHypoThreshold(Number(v)) })
            }
          />
          <Text className="text-mut text-xs mt-2 leading-4">
            {t("settings.hypoThresholdHint")}
          </Text>
        </View>

        {/* Insulin sensitivity sits with the ratios it belongs to */}
        {showsBolus ? (
          <FormCard icon="pulse-outline" title={t("settings.isf")}>
            <InputRow
              icon="pulse-outline"
              label={t("settings.isf")}
              hint={t("settings.isfHint")}
              value={isf}
              onChangeText={setIsf}
              keyboardType="decimal-pad"
              suffix={glucoseUnitLabel(unit)}
              maxLength={5}
              onEndEditing={() =>
                persistRatio({
                  insulin_sensitivity_factor: glucoseFromDisplay(
                    n(isf, glucoseToDisplay(40, unit)),
                    unit
                  ),
                })
              }
              last
            />
          </FormCard>
        ) : null}

        {/* Carb ratios (mealtime insulin only) */}
        {showsBolus ? (
        <FormCard icon="restaurant-outline" title={t("settings.carbRatios")}>
          <InputRow
            icon="cafe-outline"
            label={t("slot.breakfast")}
            value={crB}
            onChangeText={setCrB}
            keyboardType="decimal-pad"
            suffix={t("common.carbRatioUnit")}
            onEndEditing={() => persistRatio({ carb_ratio_breakfast: n(crB, 10) })}
          />
          <InputRow
            icon="partly-sunny-outline"
            label={t("slot.lunch")}
            value={crL}
            onChangeText={setCrL}
            keyboardType="decimal-pad"
            suffix={t("common.carbRatioUnit")}
            onEndEditing={() => persistRatio({ carb_ratio_lunch: n(crL, 12) })}
          />
          <InputRow
            icon="moon-outline"
            label={t("slot.dinner")}
            value={crD}
            onChangeText={setCrD}
            keyboardType="decimal-pad"
            suffix={t("common.carbRatioUnit")}
            onEndEditing={() => persistRatio({ carb_ratio_dinner: n(crD, 12) })}
            last
          />
        </FormCard>
        ) : null}

        {/* Notifications */}
        <SectionLabel>{t("settings.notificationsSection")}</SectionLabel>
        {prefs ? (
          <>
            <Row
              icon="notifications-outline"
              label={t("settings.notificationsAll")}
              right={
                <Switch
                  value={prefs.enabled}
                  onValueChange={(v) => updatePrefs({ enabled: v })}
                  trackColor={{ true: THEME.accent, false: THEME.border }}
                  thumbColor={THEME.ink}
                />
              }
            />

            {prefs.enabled && notifDenied ? (
              <Pressable
                onPress={() => Linking.openSettings()}
                className="rounded-2xl px-4 py-3 mb-2"
                style={{
                  borderWidth: 1,
                  borderColor: withAlpha(GLUCOSE_RICH.high, 0.3),
                  backgroundColor: withAlpha(GLUCOSE_RICH.high, 0.1),
                }}
              >
                <Text style={{ color: THEME.ink, fontSize: 13, lineHeight: 19, opacity: 0.9 }}>
                  {t("notifications.permissionDenied")}
                </Text>
                <Text style={{ color: THEME.accent, fontSize: 12, fontWeight: "700", marginTop: 4 }}>
                  {t("settings.openSystemSettings")}
                </Text>
              </Pressable>
            ) : null}

            {/* Reminders can quietly stop arriving after the fact: a revoked
                permission, a turned-down Android channel, or (Android 12+) the
                exact-alarm setting we cannot read from here. Neutral wording,
                one route into system settings. */}
            {prefs.enabled && !notifDenied && reliability && remindersMayBeLimited(reliability) ? (
              <Pressable
                onPress={() => Linking.openSettings()}
                className="rounded-2xl px-4 py-3 mb-2"
                style={{
                  borderWidth: 1,
                  borderColor: withAlpha(GLUCOSE_RICH.high, 0.3),
                  backgroundColor: withAlpha(GLUCOSE_RICH.high, 0.1),
                }}
              >
                <Text style={{ color: THEME.ink, fontSize: 13, fontWeight: "700" }}>
                  {t("settings.exactAlarmTitle")}
                </Text>
                <Text style={{ color: THEME.ink, fontSize: 12, lineHeight: 17, marginTop: 2, opacity: 0.85 }}>
                  {t("settings.exactAlarmBody")}
                </Text>
                <Text style={{ color: THEME.accent, fontSize: 12, fontWeight: "700", marginTop: 6 }}>
                  {t("settings.openSystemSettings")}
                </Text>
              </Pressable>
            ) : null}

            {prefs.enabled ? (
              <>
                {/* Night insulin (only for users who take a long-acting dose) */}
                {showsBasal ? (
                <Row
                  icon="moon-outline"
                  label={t("settings.reminderBasal")}
                  right={
                    <Switch
                      value={prefs.basal}
                      onValueChange={(v) => updatePrefs({ basal: v })}
                      trackColor={{ true: THEME.accent, false: THEME.border }}
                      thumbColor={THEME.ink}
                    />
                  }
                />
                ) : null}
                {showsBasal && prefs.basal ? (
                  <>
                    <Row
                      icon="alarm-outline"
                      label={t("settings.reminderTime")}
                      value={prefs.basalTime}
                      onPress={() =>
                        setOpenPicker((p) => (p === "basal" ? null : "basal"))
                      }
                    />
                    <InlineTimePicker
                      visible={openPicker === "basal"}
                      value={prefs.basalTime}
                      onChange={(v) => updatePrefs({ basalTime: v })}
                      onClose={() => setOpenPicker(null)}
                    />
                  </>
                ) : null}

                {/* Glucose check */}
                <Row
                  icon="water-outline"
                  label={t("settings.reminderGlucose")}
                  right={
                    <Switch
                      value={prefs.glucose}
                      onValueChange={(v) => updatePrefs({ glucose: v })}
                      trackColor={{ true: THEME.accent, false: THEME.border }}
                      thumbColor={THEME.ink}
                    />
                  }
                />
                {prefs.glucose ? (
                  <>
                    <Row
                      icon="alarm-outline"
                      label={t("settings.reminderTime")}
                      value={prefs.glucoseTime}
                      onPress={() =>
                        setOpenPicker((p) => (p === "glucose" ? null : "glucose"))
                      }
                    />
                    <InlineTimePicker
                      visible={openPicker === "glucose"}
                      value={prefs.glucoseTime}
                      onChange={(v) => updatePrefs({ glucoseTime: v })}
                      onClose={() => setOpenPicker(null)}
                    />
                  </>
                ) : null}

                {/* Post-meal check */}
                <Row
                  icon="time-outline"
                  label={t("settings.reminderPostMeal")}
                  right={
                    <Switch
                      value={prefs.postMeal}
                      onValueChange={(v) => updatePrefs({ postMeal: v })}
                      trackColor={{ true: THEME.accent, false: THEME.border }}
                      thumbColor={THEME.ink}
                    />
                  }
                />
                {prefs.postMeal ? (
                  <View className="bg-glass border border-hair rounded-2xl px-4 py-3 mb-2">
                    <Text className="text-mut text-xs mb-2">
                      {t("settings.postMealDelay")}
                    </Text>
                    <Segmented
                      options={[90, 120, 150].map((m) => ({
                        value: String(m),
                        label: t("settings.minutes", { n: m }),
                      }))}
                      value={String(prefs.postMealMinutes)}
                      onChange={(v) =>
                        updatePrefs({
                          postMealMinutes: Number(v) as 90 | 120 | 150,
                        })
                      }
                    />
                  </View>
                ) : null}

                {/* Weekly summary */}
                <Row
                  icon="calendar-outline"
                  label={t("settings.reminderWeekly")}
                  right={
                    <Switch
                      value={prefs.weekly}
                      onValueChange={(v) => updatePrefs({ weekly: v })}
                      trackColor={{ true: THEME.accent, false: THEME.border }}
                      thumbColor={THEME.ink}
                    />
                  }
                />
                {prefs.weekly ? (
                  <>
                    <View className="bg-glass border border-hair rounded-2xl px-4 py-3 mb-2">
                      <Text className="text-mut text-xs mb-2">
                        {t("settings.reminderDay")}
                      </Text>
                      <View className="flex-row justify-between">
                        {[1, 2, 3, 4, 5, 6, 7].map((d) => {
                          const on = prefs.weeklyDay === d;
                          return (
                            <Pressable
                              key={d}
                              onPress={() => updatePrefs({ weeklyDay: d })}
                              className={`w-9 h-9 rounded-full items-center justify-center ${
                                on ? "bg-brand" : "bg-glass"
                              }`}
                            >
                              <Text
                                className={`text-xs font-semibold ${
                                  on ? "text-black" : "text-ink"
                                }`}
                              >
                                {t(`settings.weekdayShort_${d}`)}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>
                    <Row
                      icon="alarm-outline"
                      label={t("settings.reminderTime")}
                      value={prefs.weeklyTime}
                      onPress={() =>
                        setOpenPicker((p) => (p === "weekly" ? null : "weekly"))
                      }
                    />
                    <InlineTimePicker
                      visible={openPicker === "weekly"}
                      value={prefs.weeklyTime}
                      onChange={(v) => updatePrefs({ weeklyTime: v })}
                      onClose={() => setOpenPicker(null)}
                    />
                  </>
                ) : null}

                {/* Low reading follow-up (neutral, user-thresholded) */}
                <Row
                  icon="pulse-outline"
                  label={t("settings.reminderLowFollow")}
                  right={
                    <Switch
                      value={prefs.lowFollowup}
                      onValueChange={(v) => updatePrefs({ lowFollowup: v })}
                      trackColor={{ true: THEME.accent, false: THEME.border }}
                      thumbColor={THEME.ink}
                    />
                  }
                />
                {prefs.lowFollowup ? (
                  <View className="bg-glass border border-hair rounded-2xl px-4 py-3 mb-2">
                    <Text className="text-mut text-xs mb-2">
                      {t("settings.lowThreshold")} ({glucoseUnitLabel(unit)})
                    </Text>
                    <Segmented
                      options={[60, 65, 70, 75, 80].map((mgdl) => ({
                        value: String(mgdl),
                        label: String(glucoseToDisplay(mgdl, unit)),
                      }))}
                      value={String(prefs.lowThresholdMgdl)}
                      onChange={(v) =>
                        updatePrefs({ lowThresholdMgdl: Number(v) })
                      }
                    />
                  </View>
                ) : null}
              </>
            ) : null}
          </>
        ) : null}

        {/* Language */}
        <SectionLabel>{t("settings.language")}</SectionLabel>
        <LanguagePicker value={lang} onChange={onChangeLang} />

        {/* Spike AI - hidden entirely until the function URL is configured */}
        {spikeConfigured ? (
          <>
            <SectionLabel>{t("spike.title")}</SectionLabel>
            <Row
              icon="sparkles-outline"
              label={t("spike.settingsRow")}
              onPress={() => router.push("/spike")}
            />
          </>
        ) : null}

        {/* Injection */}
        {usesInsulin ? (
          <>
            <SectionLabel>{t("injection.title")}</SectionLabel>
            <Row
              icon="medkit-outline"
              label={t("injection.guideLink")}
              onPress={() => router.push("/injection-guide")}
            />
          </>
        ) : null}

        {/* Emergency / SOS */}
        <SectionLabel>{t("sos.title")}</SectionLabel>
        <Row
          icon="people-outline"
          label={t("emergency.title")}
          onPress={() => router.push("/emergency-contacts")}
        />
        <Row
          icon="medical-outline"
          label={t("sos.openScreen")}
          onPress={() => router.push("/sos")}
        />

        {/* Pro */}
        <SectionLabel>{t("settings.proSection")}</SectionLabel>
        {isProUser ? (
          <Row
            icon="checkmark-circle"
            label={t("settings.proActive")}
            right={<Ionicons name="sparkles" size={18} color={THEME.accent} />}
          />
        ) : (
          <Row
            icon="sparkles-outline"
            label={t("settings.goPro")}
            onPress={() => router.push("/paywall")}
          />
        )}
        {!isProUser ? (
          <Row
            icon="pricetag-outline"
            label={t("settings.redeemCode")}
            onPress={onRedeemCode}
          />
        ) : null}
        <Row
          icon="refresh-outline"
          label={t("settings.restorePurchases")}
          onPress={onRestore}
          right={
            restoring ? (
              <Ionicons name="hourglass-outline" size={18} color={THEME.muted} />
            ) : undefined
          }
        />
        <Row
          icon="document-text-outline"
          label={t("settings.exportCsv")}
          onPress={onExport}
          right={
            exporting ? (
              <Ionicons name="hourglass-outline" size={18} color={THEME.muted} />
            ) : !isProUser ? (
              <Ionicons name="lock-closed" size={16} color={THEME.muted} />
            ) : undefined
          }
        />
        <Row
          icon="newspaper-outline"
          label={t("settings.exportPdf")}
          onPress={onExportPdf}
          right={
            exportingPdf ? (
              <Ionicons name="hourglass-outline" size={18} color={THEME.muted} />
            ) : !isProUser ? (
              <Ionicons name="lock-closed" size={16} color={THEME.muted} />
            ) : undefined
          }
        />
        <Row
          icon="people-outline"
          label={t("settings.multiProfile")}
          value={String(profiles.length)}
          right={<View />}
        />

        {/* Data */}
        <SectionLabel>{t("settings.dataSection")}</SectionLabel>
        <Row
          icon="trash-outline"
          label={t("settings.clearLogs")}
          onPress={onClearLogs}
          danger
        />
        <Row
          icon="person-remove-outline"
          label={t("profiles.delete")}
          onPress={onDeleteProfile}
          danger
        />

        {/* Legal */}
        <SectionLabel>{t("settings.legalSection")}</SectionLabel>
        <Row
          icon="shield-checkmark-outline"
          label={t("settings.privacy")}
          onPress={() => Linking.openURL(privacyUrl())}
        />
        <Row
          icon="reader-outline"
          label={t("settings.terms")}
          onPress={() => Linking.openURL(termsUrl())}
        />
        <Row
          icon="medkit-outline"
          label={t("sources.link")}
          onPress={() => router.push("/sources")}
        />
        <View className="my-3">
          <DisclaimerBanner full />
        </View>

        {/* Developer - dev builds only; hidden in production */}
        {__DEV__ ? (
          <>
            <SectionLabel>{t("settings.developerSection")}</SectionLabel>
            <View className="bg-glass border border-hair rounded-2xl px-4 py-3.5 mb-1">
              <View className="flex-row items-center">
                <Ionicons name="construct-outline" size={19} color={THEME.muted} />
                <Text className="flex-1 ml-3 font-medium text-ink">
                  {t("settings.simulatePro")}
                </Text>
                <Switch
                  value={isProUser}
                  onValueChange={onToggleSimPro}
                  trackColor={{ true: THEME.accent, false: THEME.border }}
                  thumbColor={THEME.ink}
                />
              </View>
              <Text className="text-mut text-xs mt-2">
                {t("settings.simulateProHint")}
              </Text>
            </View>
            <Row
              icon="flask-outline"
              label={t("settings.loadDemo")}
              onPress={onLoadDemo}
            />
          </>
        ) : null}

        {/* About */}
        <SectionLabel>{t("settings.aboutSection")}</SectionLabel>
        <Row
          icon="information-circle-outline"
          label={t("settings.version")}
          value={version}
          right={<View />}
        />
      </ScrollView>
    </View>
  );
}
