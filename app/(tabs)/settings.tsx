import React, { useEffect, useState } from "react";
import { Linking, Platform, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Constants from "expo-constants";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
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
import type { Lang, GlucoseUnit } from "../../lib/db/types";
import {
  glucoseToDisplay,
  glucoseFromDisplay,
  glucoseUnitLabel,
} from "../../lib/glucose";
import { SectionLabel, Segmented } from "../../components/ui";
import { FormCard, InputRow } from "../../components/form";
import { InlineTimePicker } from "../../components/InlineTimePicker";
import { LanguagePicker } from "../../components/LanguagePicker";
import { ProfileSwitcher } from "../../components/ProfileSwitcher";
import { DisclaimerBanner } from "../../components/Disclaimer";
import { useFeedback } from "../../components/Feedback";
import { privacyUrl, termsUrl } from "../../lib/legal";

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
      className="flex-row items-center bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3.5 mb-2"
    >
      <Ionicons name={icon} size={19} color={danger ? "#fb7185" : "#a1a1aa"} />
      <Text
        className={`flex-1 ml-3 font-medium ${danger ? "text-rose-400" : "text-zinc-100"}`}
      >
        {label}
      </Text>
      {value ? <Text className="text-zinc-500 mr-1">{value}</Text> : null}
      {right ?? (onPress ? (
        <Ionicons name="chevron-forward" size={18} color="#52525b" />
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
  const [fasting, setFasting] = useState("");
  const [postmeal, setPostmeal] = useState("");
  const [dailyCarb, setDailyCarb] = useState("");
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [openPicker, setOpenPicker] = useState<
    "basal" | "glucose" | "weekly" | null
  >(null);
  const [notifDenied, setNotifDenied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const unit: GlucoseUnit = activeProfile?.glucose_unit ?? "mgdl";

  useEffect(() => {
    if (!activeProfile) return;
    const u = activeProfile.glucose_unit ?? "mgdl";
    setName(activeProfile.name);
    setIsf(String(glucoseToDisplay(activeProfile.insulin_sensitivity_factor, u)));
    setCrB(String(activeProfile.carb_ratio_breakfast));
    setCrL(String(activeProfile.carb_ratio_lunch));
    setCrD(String(activeProfile.carb_ratio_dinner));
    // Targets are stored in mg/dL - show them in the profile's unit.
    setFasting(String(glucoseToDisplay(activeProfile.target_fasting_max, u)));
    setPostmeal(String(glucoseToDisplay(activeProfile.target_postmeal_max, u)));
    setDailyCarb(String(activeProfile.daily_carb_target_g));
  }, [activeProfile?.id, activeProfile?.glucose_unit]);

  // Load notification preferences + current permission state.
  useEffect(() => {
    (async () => {
      const p = await getNotificationPrefs();
      setPrefs(p);
      const granted = await hasNotificationPermission();
      setNotifDenied(p.enabled && !granted);
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

  async function onExport() {
    if (!activeProfile) return;
    if (!isProUser) {
      router.push("/paywall");
      return;
    }
    setExporting(true);
    const res = await exportLogsCsv(activeProfile.id, activeProfile.name);
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
    <View className="flex-1 bg-black" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center justify-between px-4 pt-2 pb-3">
        <Text className="text-zinc-50 text-2xl font-bold">{t("settings.title")}</Text>
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

        {/* Targets */}
        <FormCard icon="speedometer-outline" title={t("onboarding.secTargets")}>
          <InputRow
            icon="sunny-outline"
            label={t("period.fasting")}
            value={fasting}
            onChangeText={setFasting}
            keyboardType="decimal-pad"
            suffix={glucoseUnitLabel(unit)}
            maxLength={5}
            onEndEditing={() =>
              persist({
                target_fasting_max: glucoseFromDisplay(
                  n(fasting, glucoseToDisplay(100, unit)),
                  unit
                ),
              })
            }
          />
          <InputRow
            icon="time-outline"
            label={t("period.post_meal_2h")}
            value={postmeal}
            onChangeText={setPostmeal}
            keyboardType="decimal-pad"
            suffix={glucoseUnitLabel(unit)}
            maxLength={5}
            onEndEditing={() =>
              persist({
                target_postmeal_max: glucoseFromDisplay(
                  n(postmeal, glucoseToDisplay(140, unit)),
                  unit
                ),
              })
            }
          />
          <InputRow
            icon="pie-chart-outline"
            label={t("settings.dailyCarbTarget")}
            value={dailyCarb}
            onChangeText={setDailyCarb}
            keyboardType="number-pad"
            suffix={t("common.grams")}
            onEndEditing={() =>
              persist({ daily_carb_target_g: Math.round(n(dailyCarb, 200)) })
            }
          />
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
              persist({
                insulin_sensitivity_factor: glucoseFromDisplay(
                  n(isf, glucoseToDisplay(40, unit)),
                  unit
                ),
              })
            }
            last
          />
        </FormCard>

        {/* Carb ratios */}
        <FormCard icon="restaurant-outline" title={t("settings.carbRatios")}>
          <InputRow
            icon="cafe-outline"
            label={t("slot.breakfast")}
            value={crB}
            onChangeText={setCrB}
            keyboardType="decimal-pad"
            suffix={t("common.carbRatioUnit")}
            onEndEditing={() => persist({ carb_ratio_breakfast: n(crB, 10) })}
          />
          <InputRow
            icon="partly-sunny-outline"
            label={t("slot.lunch")}
            value={crL}
            onChangeText={setCrL}
            keyboardType="decimal-pad"
            suffix={t("common.carbRatioUnit")}
            onEndEditing={() => persist({ carb_ratio_lunch: n(crL, 12) })}
          />
          <InputRow
            icon="moon-outline"
            label={t("slot.dinner")}
            value={crD}
            onChangeText={setCrD}
            keyboardType="decimal-pad"
            suffix={t("common.carbRatioUnit")}
            onEndEditing={() => persist({ carb_ratio_dinner: n(crD, 12) })}
            last
          />
        </FormCard>

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
                  trackColor={{ true: "#22d3ee", false: "#3f3f46" }}
                  thumbColor="#fafafa"
                />
              }
            />

            {prefs.enabled && notifDenied ? (
              <Pressable
                onPress={() => Linking.openSettings()}
                className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 mb-2"
              >
                <Text className="text-amber-200/90 text-sm leading-5">
                  {t("notifications.permissionDenied")}
                </Text>
                <Text className="text-brand text-xs font-semibold mt-1">
                  {t("settings.openSystemSettings")}
                </Text>
              </Pressable>
            ) : null}

            {prefs.enabled ? (
              <>
                {/* Night insulin */}
                <Row
                  icon="moon-outline"
                  label={t("settings.reminderBasal")}
                  right={
                    <Switch
                      value={prefs.basal}
                      onValueChange={(v) => updatePrefs({ basal: v })}
                      trackColor={{ true: "#22d3ee", false: "#3f3f46" }}
                      thumbColor="#fafafa"
                    />
                  }
                />
                {prefs.basal ? (
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
                      trackColor={{ true: "#22d3ee", false: "#3f3f46" }}
                      thumbColor="#fafafa"
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
                      trackColor={{ true: "#22d3ee", false: "#3f3f46" }}
                      thumbColor="#fafafa"
                    />
                  }
                />
                {prefs.postMeal ? (
                  <View className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3 mb-2">
                    <Text className="text-zinc-400 text-xs mb-2">
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
                      trackColor={{ true: "#22d3ee", false: "#3f3f46" }}
                      thumbColor="#fafafa"
                    />
                  }
                />
                {prefs.weekly ? (
                  <>
                    <View className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3 mb-2">
                      <Text className="text-zinc-400 text-xs mb-2">
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
                                on ? "bg-brand" : "bg-zinc-800"
                              }`}
                            >
                              <Text
                                className={`text-xs font-semibold ${
                                  on ? "text-black" : "text-zinc-300"
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
                      trackColor={{ true: "#22d3ee", false: "#3f3f46" }}
                      thumbColor="#fafafa"
                    />
                  }
                />
                {prefs.lowFollowup ? (
                  <View className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3 mb-2">
                    <Text className="text-zinc-400 text-xs mb-2">
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

        {/* Injection */}
        <SectionLabel>{t("injection.title")}</SectionLabel>
        <Row
          icon="medkit-outline"
          label={t("injection.guideLink")}
          onPress={() => router.push("/injection-guide")}
        />

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
            right={<Ionicons name="sparkles" size={18} color="#22d3ee" />}
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
              <Ionicons name="hourglass-outline" size={18} color="#52525b" />
            ) : undefined
          }
        />
        <Row
          icon="document-text-outline"
          label={t("settings.exportCsv")}
          onPress={onExport}
          right={
            exporting ? (
              <Ionicons name="hourglass-outline" size={18} color="#52525b" />
            ) : !isProUser ? (
              <Ionicons name="lock-closed" size={16} color="#52525b" />
            ) : undefined
          }
        />
        <Row
          icon="newspaper-outline"
          label={t("settings.exportPdf")}
          onPress={onExportPdf}
          right={
            exportingPdf ? (
              <Ionicons name="hourglass-outline" size={18} color="#52525b" />
            ) : !isProUser ? (
              <Ionicons name="lock-closed" size={16} color="#52525b" />
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
            <View className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-3.5 mb-1">
              <View className="flex-row items-center">
                <Ionicons name="construct-outline" size={19} color="#a1a1aa" />
                <Text className="flex-1 ml-3 font-medium text-zinc-100">
                  {t("settings.simulatePro")}
                </Text>
                <Switch
                  value={isProUser}
                  onValueChange={onToggleSimPro}
                  trackColor={{ true: "#22d3ee", false: "#3f3f46" }}
                  thumbColor="#fafafa"
                />
              </View>
              <Text className="text-zinc-500 text-xs mt-2">
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
