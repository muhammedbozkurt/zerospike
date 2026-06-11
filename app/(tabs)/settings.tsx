import React, { useEffect, useState } from "react";
import { Linking, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Constants from "expo-constants";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { useApp } from "../../lib/store/AppContext";
import { updateProfile, deleteProfile } from "../../lib/db/profiles";
import { clearAllLogs } from "../../lib/db/index";
import { loadDemoData } from "../../lib/db/demo";
import { exportLogsCsv } from "../../lib/services/export";
import { setProOverride } from "../../lib/services/purchases";
import { scheduleBasalReminder } from "../../lib/services/notifications";
import type { Lang } from "../../lib/db/types";
import { SectionLabel } from "../../components/ui";
import { FormCard, InputRow, ActionRow } from "../../components/form";
import { InlineTimePicker } from "../../components/InlineTimePicker";
import { LanguagePicker } from "../../components/LanguagePicker";
import { ProfileSwitcher } from "../../components/ProfileSwitcher";
import { DisclaimerBanner } from "../../components/Disclaimer";
import { useFeedback } from "../../components/Feedback";

const PRIVACY_URL = "https://greeneyeapp.com/legal/zerospike-privacy";
const TERMS_URL = "https://greeneyeapp.com/legal/zerospike-terms";

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
  const { toast, confirm } = useFeedback();
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
  const [basalTime, setBasalTime] = useState("22:00");
  const [showTime, setShowTime] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!activeProfile) return;
    setName(activeProfile.name);
    setIsf(String(activeProfile.insulin_sensitivity_factor));
    setCrB(String(activeProfile.carb_ratio_breakfast));
    setCrL(String(activeProfile.carb_ratio_lunch));
    setCrD(String(activeProfile.carb_ratio_dinner));
    setFasting(String(activeProfile.target_fasting_max));
    setPostmeal(String(activeProfile.target_postmeal_max));
    setDailyCarb(String(activeProfile.daily_carb_target_g));
  }, [activeProfile?.id]);

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

  async function onToggleSimPro(value: boolean) {
    await setProOverride(value);
    await refreshPro();
  }

  async function onLoadDemo() {
    if (!activeProfile) return;
    await loadDemoData(activeProfile.id);
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
    // Refresh the basal reminder so its text matches the new language.
    await scheduleBasalReminder(basalTime);
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

        {/* Targets */}
        <FormCard icon="speedometer-outline" title={t("onboarding.secTargets")}>
          <InputRow
            icon="sunny-outline"
            label={t("period.fasting")}
            value={fasting}
            onChangeText={setFasting}
            keyboardType="number-pad"
            suffix={t("common.mgdl")}
            maxLength={3}
            onEndEditing={() =>
              persist({ target_fasting_max: Math.round(n(fasting, 100)) })
            }
          />
          <InputRow
            icon="time-outline"
            label={t("period.post_meal_2h")}
            value={postmeal}
            onChangeText={setPostmeal}
            keyboardType="number-pad"
            suffix={t("common.mgdl")}
            maxLength={3}
            onEndEditing={() =>
              persist({ target_postmeal_max: Math.round(n(postmeal, 140)) })
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
            suffix="g/ü"
            onEndEditing={() => persist({ carb_ratio_breakfast: n(crB, 10) })}
          />
          <InputRow
            icon="partly-sunny-outline"
            label={t("slot.lunch")}
            value={crL}
            onChangeText={setCrL}
            keyboardType="decimal-pad"
            suffix="g/ü"
            onEndEditing={() => persist({ carb_ratio_lunch: n(crL, 12) })}
          />
          <InputRow
            icon="moon-outline"
            label={t("slot.dinner")}
            value={crD}
            onChangeText={setCrD}
            keyboardType="decimal-pad"
            suffix="g/ü"
            onEndEditing={() => persist({ carb_ratio_dinner: n(crD, 12) })}
            last
          />
        </FormCard>

        {/* Insulin & reminder */}
        <FormCard icon="pulse-outline" title={t("onboarding.secReminder")}>
          <InputRow
            icon="pulse-outline"
            label={t("settings.isf")}
            hint={t("settings.isfHint")}
            value={isf}
            onChangeText={setIsf}
            keyboardType="number-pad"
            suffix={t("common.mgdl")}
            maxLength={3}
            onEndEditing={() =>
              persist({ insulin_sensitivity_factor: n(isf, 40) })
            }
          />
          <ActionRow
            icon="alarm-outline"
            label={t("settings.basalTime")}
            value={basalTime}
            onPress={() => setShowTime((s) => !s)}
            last
          />
        </FormCard>
        <InlineTimePicker
          visible={showTime}
          value={basalTime}
          onChange={(v) => {
            setBasalTime(v);
            scheduleBasalReminder(v);
          }}
          onClose={() => setShowTime(false)}
        />

        {/* Language */}
        <SectionLabel>{t("settings.language")}</SectionLabel>
        <LanguagePicker value={lang} onChange={onChangeLang} />

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
          onPress={() => Linking.openURL(PRIVACY_URL)}
        />
        <Row
          icon="reader-outline"
          label={t("settings.terms")}
          onPress={() => Linking.openURL(TERMS_URL)}
        />
        <View className="my-3">
          <DisclaimerBanner full />
        </View>

        {/* Developer — dev builds only; hidden in production */}
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
