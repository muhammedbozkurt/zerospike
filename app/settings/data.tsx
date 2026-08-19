import React, { useEffect, useState } from "react";
import { Platform, Pressable, Switch, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { useApp } from "../../lib/store/AppContext";
import { deleteProfile, listProfiles } from "../../lib/db/profiles";
import { clearAllLogs } from "../../lib/db/index";
import { exportLogsCsv } from "../../lib/services/export";
import { exportLogsPdf } from "../../lib/services/report";
import { maybeRequestReview } from "../../lib/services/review";
import { INSIGHTS_WINDOWS } from "../../lib/insights";
import { insulinModeOf, insulinModeUsesInsulin } from "../../lib/insulinMode";
import { setProOverride } from "../../lib/services/purchases";
import {
  getHealthWriteEnabled,
  setHealthWriteEnabled,
  requestHealthWritePermission,
} from "../../lib/services/health";
import type { GlucoseUnit } from "../../lib/db/types";
import { Row, SettingsScaffold } from "../../components/settingsUi";
import { SectionLabel } from "../../components/ui";
import { ProfileSwitcher } from "../../components/ProfileSwitcher";
import { DateRangePicker, type PickedRange } from "../../components/DateRangePicker";
import { useFeedback } from "../../components/Feedback";
import { formatLocale } from "../../lib/format";
import { THEME } from "../../lib/theme/tokens";
import { useLayout } from "../../lib/useLayout";

/** One bullet inside the Apple Health transparency card's expanded detail. */
function HealthDetailRow({
  icon,
  title,
  body,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
}) {
  return (
    <View className="flex-row items-start">
      <Ionicons name={icon} size={16} color={THEME.muted} style={{ marginTop: 1 }} />
      <View className="flex-1 ml-2.5">
        <Text className="text-ink text-xs font-semibold">{title}</Text>
        <Text className="text-mut text-xs mt-0.5 leading-5">{body}</Text>
      </View>
    </View>
  );
}

/** Settings > Data & Export: CSV/PDF (with the custom-range picker), profile
 *  count, clear logs, delete profile, and the dev-only sample-data loader. */
export default function DataSettings() {
  const { t } = useTranslation();
  const router = useRouter();
  const { toast, confirm, actionSheet } = useFeedback();
  const {
    activeProfile,
    profiles,
    isProUser,
    bumpData,
    refreshPro,
    refreshProfiles,
    setActiveProfileId,
  } = useApp();
  const { columnPad } = useLayout();

  const [exporting, setExporting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [rangePicker, setRangePicker] = useState<null | "pdf" | "csv">(null);
  const [profileSwitcherOpen, setProfileSwitcherOpen] = useState(false);

  const unit: GlucoseUnit = activeProfile?.glucose_unit ?? "mgdl";

  async function runCsv(range?: PickedRange) {
    if (!activeProfile) return;
    setExporting(true);
    const res = await exportLogsCsv(
      activeProfile.id,
      activeProfile.name,
      unit,
      range,
      insulinModeUsesInsulin(insulinModeOf(activeProfile))
    );
    setExporting(false);
    if (!res.ok) {
      toast(res.reason === "noData" ? t("export.noData") : t("export.sharingUnavailable"), "error");
    }
  }

  function onExport() {
    if (!activeProfile) return;
    if (!isProUser) {
      router.push({ pathname: "/paywall", params: { reason: "export" } });
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
    if (res.ok) {
      toast(t("report.created"), "success");
      void maybeRequestReview("pdf_export_success");
    } else {
      toast(res.reason === "noData" ? t("export.noData") : t("export.sharingUnavailable"), "error");
    }
  }

  function onExportPdf() {
    if (!activeProfile) return;
    if (!isProUser) {
      router.push({ pathname: "/paywall", params: { reason: "export" } });
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

  // The dialog names the profile it is about, and the delete is scoped to that
  // profile alone: on a family install this row is reached from a screen that
  // shows one person's data, so it may never touch anybody else's history.
  async function onClearLogs() {
    if (!activeProfile) return;
    const ok = await confirm({
      title: t("settings.clearLogs"),
      message: t("settings.clearLogsConfirm", { name: activeProfile.name }),
      confirmLabel: t("common.delete"),
      destructive: true,
    });
    if (!ok) return;
    await clearAllLogs(activeProfile.id);
    bumpData();
    toast(t("settings.clearLogsDone", { name: activeProfile.name }), "success");
  }

  async function onDeleteProfile() {
    if (!activeProfile) return;
    if (profiles.length <= 1) {
      toast(t("profiles.cannotDeleteLast"), "error");
      return;
    }
    const ok = await confirm({
      title: t("profiles.delete"),
      message: t("profiles.deleteConfirm", { name: activeProfile.name }),
      confirmLabel: t("common.delete"),
      destructive: true,
      icon: "person-remove-outline",
    });
    if (!ok) return;
    const deleted = await deleteProfile(activeProfile.id);
    if (!deleted) {
      toast(t("profiles.cannotDeleteLast"), "error");
      return;
    }
    // The app cannot stay pointed at a row that no longer exists: every screen
    // would read an empty history and write logs keyed to a deleted profile.
    const remaining = await listProfiles();
    await refreshProfiles();
    bumpData();
    const next = remaining[0];
    if (!next) {
      router.replace("/profile-setup");
      return;
    }
    await setActiveProfileId(next.id);
    toast(t("profiles.switchedTo", { name: next.name }), "info");
    router.back();
  }

  // Opens the shared ProfileSwitcher sheet (same picker as the tab-bar pill);
  // a free/single-profile user is routed to the paywall instead, mirroring the
  // pill's own gating so this row never opens a switch list with nothing to
  // switch to.
  function onMultiProfilePress() {
    if (!isProUser && profiles.length <= 1) {
      router.push({ pathname: "/paywall", params: { reason: "profiles" } });
      return;
    }
    setProfileSwitcherOpen(true);
  }

  async function onToggleSimPro(value: boolean) {
    await setProOverride(value);
    await refreshPro();
  }

  // H4/H5: opt-in "write my manual readings to Apple Health", default OFF. The
  // write (share) permission is requested at POINT OF USE - here, when the toggle
  // is switched on - never at onboarding. If it is denied, the toggle stays off.
  const [healthWrite, setHealthWrite] = useState(false);
  // AsyncStorage read, so the real value cannot be known on the first render. A
  // non-Pro user with the mirror already on must never see the section vanish
  // even for one frame, so until this resolves the section renders in a
  // pending state instead of committing to shown/hidden.
  const [healthWriteLoaded, setHealthWriteLoaded] = useState(false);
  const [healthDetailsOpen, setHealthDetailsOpen] = useState(false);
  useEffect(() => {
    void getHealthWriteEnabled().then((v) => {
      setHealthWrite(v);
      setHealthWriteLoaded(true);
    });
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
          locale={formatLocale()}
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
      <View style={columnPad()}>
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
        onPress={onMultiProfilePress}
      />
      <ProfileSwitcher
        hideTrigger
        open={profileSwitcherOpen}
        onOpenChange={setProfileSwitcherOpen}
      />

      <SectionLabel>{t("settings.dataSection")}</SectionLabel>
      <Row icon="trash-outline" label={t("settings.clearLogs")} onPress={onClearLogs} danger />
      <Row icon="person-remove-outline" label={t("profiles.delete")} onPress={onDeleteProfile} danger />

      {/* Also shown to a lapsed-Pro user while the write mirror is still on:
          the mirror keeps running off its stored flag, so the switch to turn it
          off must never disappear behind the paywall. Pro status is already
          known synchronously; only a non-Pro user's stored healthWrite is
          still in flight, so ONLY that combination gets the pending row below
          instead of a premature "hidden". */}
      {Platform.OS === "ios" && !isProUser && !healthWriteLoaded ? (
        <>
          <SectionLabel>{t("settings.healthSection")}</SectionLabel>
          <View
            className="flex-row items-center bg-glass border border-hair rounded-2xl px-4 py-3.5 mb-1"
            style={{ opacity: 0.5 }}
          >
            <Ionicons name="heart-outline" size={19} color={THEME.muted} />
            <Text className="flex-1 ml-3 font-medium text-ink">{t("settings.healthWrite")}</Text>
            <Ionicons name="hourglass-outline" size={18} color={THEME.muted} />
          </View>
        </>
      ) : Platform.OS === "ios" && (isProUser || healthWrite) ? (
        <>
          <SectionLabel>{t("settings.healthSection")}</SectionLabel>
          {/* Transparency card: what Health sync reads/writes, shown BEFORE the
              write toggle below so nobody switches it on blind. Collapsed by
              default; the summary line alone already states the shape of it. */}
          <Pressable
            onPress={() => setHealthDetailsOpen((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={t("settings.healthAbout")}
            accessibilityState={{ expanded: healthDetailsOpen }}
            className="bg-glass border border-hair rounded-2xl px-4 py-3.5 mb-2"
          >
            <View className="flex-row items-center">
              <Ionicons name="information-circle-outline" size={19} color={THEME.accent} />
              <Text className="flex-1 ml-3 font-medium text-ink">{t("settings.healthAbout")}</Text>
              <Text className="text-mut text-[11px] mr-1">{t("settings.healthAboutToggle")}</Text>
              <Ionicons
                name={healthDetailsOpen ? "chevron-up" : "chevron-down"}
                size={16}
                color={THEME.muted}
              />
            </View>
            <Text className="text-mut text-xs mt-2 leading-5">{t("settings.healthAboutBody")}</Text>
            {healthDetailsOpen ? (
              <View className="mt-3" style={{ gap: 10 }}>
                <HealthDetailRow
                  icon="download-outline"
                  title={t("settings.healthReadTitle")}
                  body={t("settings.healthReadBody")}
                />
                <HealthDetailRow
                  icon="cloud-upload-outline"
                  title={t("settings.healthWriteDetailTitle")}
                  body={t("settings.healthWriteDetailBody")}
                />
                <HealthDetailRow
                  icon="phone-portrait-outline"
                  title={t("settings.healthOnDeviceTitle")}
                  body={t("settings.healthOnDeviceBody")}
                />
                <HealthDetailRow
                  icon="options-outline"
                  title={t("settings.healthPermissionsTitle")}
                  body={t("settings.healthPermissionsBody")}
                />
                {__DEV__ ? (
                  <Text className="text-mut text-[11px] italic">
                    {t("settings.healthDevNote")}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </Pressable>
          <View className="bg-glass border border-hair rounded-2xl px-4 py-3.5 mb-1">
            <View className="flex-row items-center">
              <Ionicons name="heart-outline" size={19} color={THEME.muted} />
              <Text className="flex-1 ml-3 font-medium text-ink">{t("settings.healthWrite")}</Text>
              {/* A Pro user reaches this branch before healthWriteLoaded resolves
                  too (isProUser alone already makes the section visible), so the
                  switch itself must stay neutral until the real value is in -
                  otherwise a Pro user with the mirror ON would see it flash OFF. */}
              {healthWriteLoaded ? (
                <Switch
                  value={healthWrite}
                  onValueChange={onToggleHealthWrite}
                  trackColor={{ true: THEME.accent, false: THEME.border }}
                  thumbColor={THEME.ink}
                />
              ) : (
                <Ionicons name="hourglass-outline" size={18} color={THEME.muted} />
              )}
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
        </>
      ) : null}
      </View>
    </SettingsScaffold>
  );
}
