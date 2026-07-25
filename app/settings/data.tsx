import React, { useEffect, useState } from "react";
import { Platform, Switch, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { useApp } from "../../lib/store/AppContext";
import { deleteProfile } from "../../lib/db/profiles";
import { clearAllLogs } from "../../lib/db/index";
import { loadDemoData } from "../../lib/db/demo";
import { markSampleActive, clearSampleFlag } from "../../lib/sampleData";
import { exportLogsCsv } from "../../lib/services/export";
import { exportLogsPdf } from "../../lib/services/report";
import { INSIGHTS_WINDOWS } from "../../lib/insights";
import { setProOverride } from "../../lib/services/purchases";
import {
  getHealthWriteEnabled,
  setHealthWriteEnabled,
  requestHealthWritePermission,
} from "../../lib/services/health";
import type { GlucoseUnit } from "../../lib/db/types";
import { Row, SettingsScaffold } from "../../components/settingsUi";
import { SectionLabel } from "../../components/ui";
import { DateRangePicker, type PickedRange } from "../../components/DateRangePicker";
import { useFeedback } from "../../components/Feedback";
import { THEME } from "../../lib/theme/tokens";

/** Settings > Data & Export: CSV/PDF (with the custom-range picker), profile
 *  count, clear logs, delete profile, and the dev-only sample-data loader. */
export default function DataSettings() {
  const { t } = useTranslation();
  const router = useRouter();
  const { toast, confirm, actionSheet } = useFeedback();
  const { activeProfile, profiles, isProUser, bumpData, refreshPro, refreshProfiles, lang } =
    useApp();

  const [exporting, setExporting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [rangePicker, setRangePicker] = useState<null | "pdf" | "csv">(null);

  const unit: GlucoseUnit = activeProfile?.glucose_unit ?? "mgdl";

  async function runCsv(range?: PickedRange) {
    if (!activeProfile) return;
    setExporting(true);
    const res = await exportLogsCsv(activeProfile.id, activeProfile.name, unit, range);
    setExporting(false);
    if (!res.ok) {
      toast(res.reason === "noData" ? t("export.noData") : t("export.sharingUnavailable"), "error");
    }
  }

  function onExport() {
    if (!activeProfile) return;
    if (!isProUser) {
      router.push("/paywall");
      return;
    }
    actionSheet({
      title: t("settings.exportCsv"),
      actions: [
        { label: t("dashboard.filterAll"), icon: "list-outline", onPress: () => runCsv() },
        { label: t("report.customRange"), icon: "calendar-outline", onPress: () => setRangePicker("csv") },
      ],
    });
  }

  async function runPdf(days: number, range?: PickedRange) {
    if (!activeProfile) return;
    setExportingPdf(true);
    const res = await exportLogsPdf(activeProfile, days, range);
    setExportingPdf(false);
    if (res.ok) toast(t("report.created"), "success");
    else toast(res.reason === "noData" ? t("export.noData") : t("export.sharingUnavailable"), "error");
  }

  function onExportPdf() {
    if (!activeProfile) return;
    if (!isProUser) {
      router.push("/paywall");
      return;
    }
    actionSheet({
      title: t("settings.exportPdf"),
      actions: [
        ...INSIGHTS_WINDOWS.map((d) => ({
          label: t("insights.windowDays", { n: d }),
          icon: "calendar-outline" as const,
          onPress: () => runPdf(d),
        })),
        { label: t("report.customRange"), icon: "create-outline" as const, onPress: () => setRangePicker("pdf") },
      ],
    });
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
    router.back();
  }

  async function onLoadDemo() {
    if (!activeProfile) return;
    await loadDemoData(activeProfile.id);
    await markSampleActive(activeProfile.id);
    bumpData();
    toast(t("settings.demoLoaded"), "success");
  }

  async function onToggleSimPro(value: boolean) {
    await setProOverride(value);
    await refreshPro();
  }

  // H4/H5: opt-in "write my manual readings to Apple Health", default OFF. The
  // write (share) permission is requested at POINT OF USE - here, when the toggle
  // is switched on - never at onboarding. If it is denied, the toggle stays off.
  const [healthWrite, setHealthWrite] = useState(false);
  useEffect(() => {
    void getHealthWriteEnabled().then(setHealthWrite);
  }, []);
  async function onToggleHealthWrite(value: boolean) {
    if (value) {
      const granted = await requestHealthWritePermission();
      if (!granted) {
        toast(t("settings.healthWriteDenied"), "error");
        return;
      }
      await setHealthWriteEnabled(true);
      setHealthWrite(true);
    } else {
      await setHealthWriteEnabled(false);
      setHealthWrite(false);
    }
  }

  return (
    <SettingsScaffold
      title={t("settings.dataSection")}
      overlay={
        <DateRangePicker
          visible={rangePicker != null}
          minDate={activeProfile ? new Date(activeProfile.created_at) : new Date(2020, 0, 1)}
          maxDate={new Date()}
          initialStart={new Date(Date.now() - 30 * 86_400_000)}
          initialEnd={new Date()}
          locale={lang}
          onCancel={() => setRangePicker(null)}
          onConfirm={(range: PickedRange) => {
            const mode = rangePicker;
            setRangePicker(null);
            if (mode === "pdf") void runPdf(30, range);
            else if (mode === "csv") void runCsv(range);
          }}
        />
      }
    >
      <SectionLabel>{t("settings.exportCsv")}</SectionLabel>
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

      <SectionLabel>{t("settings.dataSection")}</SectionLabel>
      <Row icon="trash-outline" label={t("settings.clearLogs")} onPress={onClearLogs} danger />
      <Row icon="person-remove-outline" label={t("profiles.delete")} onPress={onDeleteProfile} danger />

      {Platform.OS === "ios" && isProUser ? (
        <>
          <SectionLabel>{t("settings.healthSection")}</SectionLabel>
          <View className="bg-glass border border-hair rounded-2xl px-4 py-3.5 mb-1">
            <View className="flex-row items-center">
              <Ionicons name="heart-outline" size={19} color={THEME.muted} />
              <Text className="flex-1 ml-3 font-medium text-ink">{t("settings.healthWrite")}</Text>
              <Switch
                value={healthWrite}
                onValueChange={onToggleHealthWrite}
                trackColor={{ true: THEME.accent, false: THEME.border }}
                thumbColor={THEME.ink}
              />
            </View>
            <Text className="text-mut text-xs mt-2">{t("settings.healthWriteHint")}</Text>
          </View>
        </>
      ) : null}

      {__DEV__ ? (
        <>
          <SectionLabel>{t("settings.developerSection")}</SectionLabel>
          <View className="bg-glass border border-hair rounded-2xl px-4 py-3.5 mb-1">
            <View className="flex-row items-center">
              <Ionicons name="construct-outline" size={19} color={THEME.muted} />
              <Text className="flex-1 ml-3 font-medium text-ink">{t("settings.simulatePro")}</Text>
              <Switch
                value={isProUser}
                onValueChange={onToggleSimPro}
                trackColor={{ true: THEME.accent, false: THEME.border }}
                thumbColor={THEME.ink}
              />
            </View>
            <Text className="text-mut text-xs mt-2">{t("settings.simulateProHint")}</Text>
          </View>
          <Row icon="flask-outline" label={t("settings.loadDemo")} onPress={onLoadDemo} />
        </>
      ) : null}
    </SettingsScaffold>
  );
}
