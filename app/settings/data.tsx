import React, { useCallback, useEffect, useState } from "react";
import { Linking, Platform, Pressable, Share, Switch, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { useApp } from "../../lib/store/AppContext";
import { deleteProfile, listProfiles } from "../../lib/db/profiles";
import { clearAllLogs } from "../../lib/db/index";
import { exportLogsCsv } from "../../lib/services/export";
import { exportLogsPdf, type ReportMode } from "../../lib/services/report";
import { maybeRequestReview } from "../../lib/services/review";
import {
  cancelPostMealTimer,
  getPostMealTimerState,
} from "../../lib/services/notifications";
import { INSIGHTS_WINDOWS } from "../../lib/insights";
import { insulinModeOf, insulinModeUsesInsulin } from "../../lib/insulinMode";
import { setProOverride } from "../../lib/services/purchases";
import {
  countHealthCopies,
  getHealthBackgroundBlocker,
  getHealthBgSyncEnabled,
  getHealthConnectStatus,
  getHealthKindWriteEnabled,
  getHealthLastSync,
  getHealthPendingWriteCount,
  getHealthWriteEnabled,
  getHealthWriteStatus,
  hasHealthProvider,
  isHealthConnectPermissionBlocked,
  isHealthKindWriteSupported,
  openHealthSettings,
  requestHealthKindWritePermission,
  requestHealthWritePermission,
  retryPendingHealthWrites,
  revokeHealthCopiesBeforeDelete,
  setHealthBgSyncEnabled,
  setHealthKindWriteEnabled,
  setHealthWriteEnabled,
  type HealthBackgroundSkip,
  type HealthConnectStatus,
  type HealthWriteStatusRecord,
} from "../../lib/services/health";
import { registerHealthBackground, requestHealthBackgroundAccess } from "../../lib/services/healthBackground";
import type { HealthLastSync, HealthWriteKind } from "../../lib/services/healthTypes";
import {
  countHealthRecordCopies,
  retryHealthRecords,
  revokeHealthRecordsBeforeDelete,
} from "../../lib/healthRecords";
import { healthWriteStatusKey } from "../../lib/healthWriteRetry";
import type { GlucoseUnit } from "../../lib/db/types";
import { Row, SettingsScaffold } from "../../components/settingsUi";
import { DirIcon } from "../../components/DirIcon";
import { withAlpha } from "../../components/rich/GlassCard";
import { Button, SectionLabel, Segmented } from "../../components/ui";
import { RIPPLE_ALPHA, ROW_MIN_HEIGHT } from "../../lib/theme/uiPrimitives";
import { displayProfileName } from "../../lib/profileName";
import { ProfileSwitcher } from "../../components/ProfileSwitcher";
import { DateRangePicker, type PickedRange } from "../../components/DateRangePicker";
import { useFeedback } from "../../components/Feedback";
import { formatDate, formatLocale, formatTime, num } from "../../lib/format";
import { truncationMessage, type ExportTruncation } from "../../lib/exportLimits";
import { GLUCOSE_RICH, TABULAR, THEME, switchColors } from "../../lib/theme/tokens";
import { useHealthBackfill } from "../../lib/useHealthBackfill";
import { useHealthWriteDenied } from "../../lib/useHealthWriteDenied";
import {
  getAnalyticsConsent,
  setAnalyticsConsent,
  type ConsentChoice,
  type ConsentState,
} from "../../lib/analytics/optOut";
import { deleteMyServerRecords } from "../../lib/analytics/serverRecords";
import { getDeviceId, isInstallId } from "../../lib/identity/deviceId";
import { switchProps } from "../../lib/a11y";

const PDF_MODE_KEY = "zerospike.pdfMode";

/** Row's sub line is fixed at one line, and long translations (German at large
 *  font sizes) were cut off; this is the Row layout with a two-line sub. */
function TwoLineRow({
  icon,
  label,
  sub,
  onPress,
  right,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  sub: string;
  onPress?: () => void;
  right?: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      android_ripple={{ color: withAlpha(THEME.text, RIPPLE_ALPHA), foreground: true }}
      className="flex-row items-center bg-glass border border-hair rounded-2xl px-3 py-3 mb-2 active:opacity-80"
      style={{ minHeight: ROW_MIN_HEIGHT }}
    >
      <View
        className="w-9 h-9 rounded-xl items-center justify-center"
        style={{ backgroundColor: withAlpha(THEME.accent, 0.14) }}
      >
        <Ionicons name={icon} size={18} color={THEME.accent} />
      </View>
      <View className="flex-1 ml-3">
        <Text className="text-[15px] font-semibold" style={{ color: THEME.text }} numberOfLines={2}>
          {label}
        </Text>
        <Text className="text-mut text-[12px] mt-0.5" numberOfLines={2}>
          {sub}
        </Text>
      </View>
      {right ?? <DirIcon name="chevron-forward" size={18} color={THEME.textMuted} />}
    </Pressable>
  );
}

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
      <Ionicons name={icon} size={16} color={THEME.textMuted} style={{ marginTop: 1 }} />
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
  // Brand name shown in the UI (App Review guideline 2.5.1 / Play policy):
  // iOS reads "Apple Health", Android reads "Health Connect". The iOS name is
  // already localized under settings.healthSection; Android's is not
  // translated per language (Health Connect keeps its English name
  // everywhere), so it sits right next to it as settings.healthSectionAndroid.
  const healthName = t(
    Platform.OS === "ios" ? "settings.healthSection" : "settings.healthSectionAndroid"
  );
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

  const [exporting, setExporting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [rangePicker, setRangePicker] = useState<null | "pdf" | "csv">(null);
  const [profileSwitcherOpen, setProfileSwitcherOpen] = useState(false);
  const [pdfMode, setPdfModeState] = useState<ReportMode>("full");

  useEffect(() => {
    AsyncStorage.getItem(PDF_MODE_KEY)
      .then((v) => {
        if (v === "summary" || v === "full") setPdfModeState(v);
      })
      .catch(() => {});
  }, []);

  function setPdfMode(m: ReportMode) {
    setPdfModeState(m);
    AsyncStorage.setItem(PDF_MODE_KEY, m).catch(() => {});
  }

  const unit: GlucoseUnit = activeProfile?.glucose_unit ?? "mgdl";

  async function runCsv(range?: PickedRange) {
    if (!activeProfile) return;
    setExporting(true);
    const res = await exportLogsCsv(
      activeProfile.id,
      displayProfileName(activeProfile, t),
      unit,
      range,
      insulinModeUsesInsulin(insulinModeOf(activeProfile))
    );
    setExporting(false);
    if (!res.ok) {
      toast(res.reason === "noData" ? t("export.noData") : t("export.sharingUnavailable"), "error");
    } else if (res.truncated) {
      toast(cutNote(res.truncated), "info");
    }
  }

  function cutNote(cut: ExportTruncation): string {
    return truncationMessage((k, o) => t(k, o), cut, num(cut.limit));
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
    const res = await exportLogsPdf(activeProfile, days, range, { mode: pdfMode });
    setExportingPdf(false);
    if (res.ok) {
      toast(res.truncated ? `${t("report.created")} ${cutNote(res.truncated)}` : t("report.created"), "success");
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
    const copies =
      (await countHealthCopies(activeProfile.id)) + (await countHealthRecordCopies(activeProfile.id));
    const ok = await confirm({
      title: t("settings.clearLogs"),
      message:
        t("settings.clearLogsConfirm", { name: displayProfileName(activeProfile, t) }) +
        (copies > 0 ? `\n\n${t("settings.healthDeleteCopiesNote", { health: healthName })}` : ""),
      confirmLabel: t("common.delete"),
      destructive: true,
    });
    if (!ok) return;
    // Before the rows go: their Health ids live only on those rows.
    await revokeHealthRecordsBeforeDelete(activeProfile.id);
    await revokeHealthCopiesBeforeDelete(activeProfile.id);
    await clearAllLogs(activeProfile.id);
    // The countdown was armed for a meal in the history that was just erased:
    // leaving it running would ring for a record the user asked to be gone.
    const runningTimer = await getPostMealTimerState();
    if (runningTimer?.profileId === activeProfile.id) await cancelPostMealTimer();
    bumpData();
    toast(t("settings.clearLogsDone", { name: displayProfileName(activeProfile, t) }), "success");
  }

  async function onDeleteProfile() {
    if (!activeProfile) return;
    if (profiles.length <= 1) {
      toast(t("profiles.cannotDeleteLast"), "error");
      return;
    }
    const copies =
      (await countHealthCopies(activeProfile.id)) + (await countHealthRecordCopies(activeProfile.id));
    const ok = await confirm({
      title: t("profiles.delete"),
      message:
        t("profiles.deleteConfirm", { name: displayProfileName(activeProfile, t) }) +
        (copies > 0 ? `\n\n${t("settings.healthDeleteCopiesNote", { health: healthName })}` : ""),
      confirmLabel: t("common.delete"),
      destructive: true,
      icon: "person-remove-outline",
    });
    if (!ok) return;
    await revokeHealthCopiesBeforeDelete(activeProfile.id);
    await revokeHealthRecordsBeforeDelete(activeProfile.id);
    // Read BEFORE the delete: afterwards there is no way to tell whether the
    // countdown belonged to the profile that just went.
    const runningTimer = await getPostMealTimerState();
    const deleted = await deleteProfile(activeProfile.id);
    if (!deleted) {
      toast(t("profiles.cannotDeleteLast"), "error");
      return;
    }
    // Its owner no longer exists, so nothing can ever act on it again: the
    // alarm, the notification, the stored end and the lock-screen card all go.
    if (runningTimer?.profileId === activeProfile.id) {
      await cancelPostMealTimer();
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
    toast(t("profiles.switchedTo", { name: displayProfileName(next, t) }), "info");
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

  // Usage analytics are opt-in: the switch reads "on" only for a stored
  // "granted" (never asked and declined both read "off"). The stored answer is an
  // AsyncStorage read, so the switch shows a spinner until it resolves instead
  // of flashing a state that may be wrong.
  const [analyticsConsent, setConsentState] = useState<ConsentState>("unanswered");
  const [analyticsLoaded, setAnalyticsLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    void getAnalyticsConsent().then((state) => {
      if (!alive) return;
      setConsentState(state);
      setAnalyticsLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, []);
  const analyticsOn = analyticsConsent === "granted";
  async function onToggleAnalytics(value: boolean) {
    const previous = analyticsConsent;
    const next: ConsentChoice = value ? "granted" : "declined";
    setConsentState(next);
    try {
      await setAnalyticsConsent(next);
    } catch {
      // the choice could not be stored, so the switch must not claim it was
      setConsentState(previous);
    }
  }

  // The random installation ID the usage events, the Spike counter and the
  // subscription events are filed under, so the user can see it and quote it.
  // getDeviceId falls back to a non-UUID value when storage fails: that is not an ID.
  const [installId, setInstallId] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void getDeviceId().then((id) => {
      if (alive) setInstallId(isInstallId(id) ? id : null);
    });
    return () => {
      alive = false;
    };
  }, []);
  async function onShareInstallId() {
    if (!installId) return;
    try {
      await Share.share({ message: installId });
    } catch {
      // the share sheet could not open; the ID is still selectable on screen
    }
  }

  const [deletingServer, setDeletingServer] = useState(false);
  async function onDeleteServerRecords() {
    if (deletingServer) return;
    const ok = await confirm({
      title: t("settings.analytics.deleteConfirmTitle"),
      message: t("settings.analytics.deleteConfirmBody"),
      confirmLabel: t("common.delete"),
      destructive: true,
      icon: "cloud-offline-outline",
    });
    if (!ok) return;
    setDeletingServer(true);
    try {
      const res = await deleteMyServerRecords();
      toast(
        res.ok ? t("settings.analytics.deleteDone") : t("settings.analytics.deleteFailed"),
        res.ok ? "success" : "error"
      );
    } finally {
      setDeletingServer(false);
    }
  }

  // Opt-in "write my manual readings to Apple Health", per profile - one Health
  // account serves the device, so this switch says whether THIS profile's
  // readings go there. Free for everyone. Besides the toggle here, the write
  // permission is also asked in the Health connect flow and by a one-time
  // question after a manual reading (dashboard). A denial leaves it off.
  const [healthWrite, setHealthWrite] = useState(false);
  // AsyncStorage read: the real value is unknown on the first render, so the
  // switch shows a spinner until it resolves.
  const [healthWriteLoaded, setHealthWriteLoaded] = useState(false);
  const [healthDetailsOpen, setHealthDetailsOpen] = useState(false);
  // Last attempted mirror write's outcome (2.4 observability), re-read on
  // every focus (not just on profile switch): a foreground/manual-sync retry
  // can update it while this screen is not the one on screen, so coming back
  // to it must not show a stale answer.
  const [writeStatus, setWriteStatus] = useState<HealthWriteStatusRecord | null>(null);
  const [pendingWrites, setPendingWrites] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const backfill = useHealthBackfill();
  const onWriteDenied = useHealthWriteDenied();
  // Android-only three-state Health Connect availability (see
  // getHealthConnectStatus). iOS has no such gate, so it resolves once,
  // immediately, to "available" and never re-checks.
  const [hcStatus, setHcStatus] = useState<HealthConnectStatus>(
    Platform.OS === "android" ? "unavailable" : "available"
  );
  const [hcStatusLoaded, setHcStatusLoaded] = useState(Platform.OS !== "android");
  // Re-checked on every focus (not just mount): the two ways out of a bad
  // status - the Play Store update, or the device Settings permission screen -
  // both send the user away from the app and back, so a stale status here
  // would keep showing the update prompt after they already fixed it.
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "android") return;
      let alive = true;
      void getHealthConnectStatus().then((status) => {
        if (!alive) return;
        setHcStatus(status);
        setHcStatusLoaded(true);
      });
      return () => {
        alive = false;
      };
    }, [])
  );
  const healthWriteProfileId = activeProfile?.id ?? null;
  useEffect(() => {
    if (!healthWriteProfileId) {
      // No profile to scope the switch to, so it can only be off - settling it
      // here keeps the pending row from hanging on its spinner forever.
      setHealthWrite(false);
      setHealthWriteLoaded(true);
      return;
    }
    // Switching profiles must not leave the previous profile's answer on screen
    // while this read is in flight.
    setHealthWriteLoaded(false);
    let alive = true;
    void getHealthWriteEnabled(healthWriteProfileId).then((v) => {
      if (!alive) return;
      setHealthWrite(v);
      setHealthWriteLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [healthWriteProfileId]);
  useFocusEffect(
    useCallback(() => {
      if (!healthWriteProfileId) {
        setWriteStatus(null);
        setPendingWrites(0);
        return;
      }
      let alive = true;
      void getHealthWriteStatus(healthWriteProfileId).then((v) => {
        if (alive) setWriteStatus(v);
      });
      void getHealthPendingWriteCount(healthWriteProfileId).then((n) => {
        if (alive) setPendingWrites(n);
      });
      return () => {
        alive = false;
      };
    }, [healthWriteProfileId])
  );
  async function onToggleHealthWrite(value: boolean) {
    if (!healthWriteProfileId) return;
    if (value) {
      const granted = await requestHealthWritePermission();
      if (!granted) {
        await onWriteDenied();
        return;
      }
      await setHealthWriteEnabled(true, healthWriteProfileId);
      setHealthWrite(true);
      void backfill.offerOnce(healthWriteProfileId);
    } else {
      await setHealthWriteEnabled(false, healthWriteProfileId);
      setHealthWrite(false);
    }
  }

  // Carbohydrate and insulin mirror switches (off by default), the background
  // read switch and the last sync record, all per profile. null = still reading.
  const [kindOn, setKindOn] = useState<Record<HealthWriteKind, boolean> | null>(null);
  const [bgOn, setBgOn] = useState<boolean | null>(null);
  const [bgBlocker, setBgBlocker] = useState<HealthBackgroundSkip | null>(null);
  const [lastSync, setLastSync] = useState<HealthLastSync | null>(null);
  const insulinWritable = isHealthKindWriteSupported("insulin");
  useFocusEffect(
    useCallback(() => {
      if (!healthWriteProfileId) {
        setKindOn(null);
        setBgOn(null);
        setLastSync(null);
        return;
      }
      let alive = true;
      void (async () => {
        const [carbs, insulin, bg, last, blocker] = await Promise.all([
          getHealthKindWriteEnabled("carbs", healthWriteProfileId),
          getHealthKindWriteEnabled("insulin", healthWriteProfileId),
          getHealthBgSyncEnabled(healthWriteProfileId),
          getHealthLastSync(healthWriteProfileId),
          getHealthBackgroundBlocker(),
        ]);
        if (!alive) return;
        setKindOn({ carbs, insulin });
        setBgOn(bg);
        setLastSync(last);
        setBgBlocker(blocker);
      })();
      return () => {
        alive = false;
      };
    }, [healthWriteProfileId])
  );

  async function onToggleHealthKind(kind: HealthWriteKind, value: boolean) {
    if (!healthWriteProfileId) return;
    if (!value) {
      await setHealthKindWriteEnabled(kind, false, healthWriteProfileId);
      setKindOn((prev) => (prev ? { ...prev, [kind]: false } : prev));
      return;
    }
    const granted = await requestHealthKindWritePermission(kind);
    if (!granted) {
      // The switch is controlled, so it simply stays off; say why.
      toast(
        t(kind === "carbs" ? "settings.healthCarbsDenied" : "settings.healthInsulinDenied", {
          health: healthName,
        }),
        "info"
      );
      if (Platform.OS === "android" && isHealthConnectPermissionBlocked("write")) {
        void openHealthSettings();
      }
      return;
    }
    await setHealthKindWriteEnabled(kind, true, healthWriteProfileId);
    setKindOn((prev) => (prev ? { ...prev, [kind]: true } : prev));
  }

  async function refreshBackground() {
    await registerHealthBackground();
    setBgBlocker(await getHealthBackgroundBlocker());
  }

  async function onToggleBgSync(value: boolean) {
    if (!healthWriteProfileId) return;
    await setHealthBgSyncEnabled(value, healthWriteProfileId);
    setBgOn(value);
    await refreshBackground();
  }

  async function onRequestBackgroundAccess() {
    await requestHealthBackgroundAccess();
    setBgBlocker(await getHealthBackgroundBlocker());
  }

  const lastSyncErrorKey =
    lastSync?.error === "unavailable"
      ? "healthSync.errUnavailable"
      : lastSync?.error === "denied"
        ? "healthSync.errDenied"
        : lastSync?.error === "read_failed"
          ? "healthSync.errReadFailed"
          : null;
  const iosReadNote = Platform.OS === "ios" && lastSync?.status === "ok" && lastSync.read === 0;

  async function onRetryHealthWrites() {
    if (!healthWriteProfileId || retrying) return;
    setRetrying(true);
    try {
      const res = await retryPendingHealthWrites(healthWriteProfileId);
      await retryHealthRecords(healthWriteProfileId);
      setWriteStatus(await getHealthWriteStatus(healthWriteProfileId));
      setPendingWrites(await getHealthPendingWriteCount(healthWriteProfileId));
      toast(
        res.attempted === 0
          ? t("settings.healthRetryNone")
          : t("settings.healthRetryResult", { ok: res.succeeded, total: res.attempted }),
        res.attempted > 0 && res.succeeded === res.attempted ? "success" : "info"
      );
    } finally {
      setRetrying(false);
    }
  }

  // Exact deep link from the AH provider layer: opens Health Connect's own
  // Play Store listing. Never throws - an emulator/device with no Play Store
  // app to handle the market:// scheme just leaves the user on this screen.
  function onOpenHealthConnectUpdate() {
    Linking.openURL(
      "market://details?id=com.google.android.apps.healthdata&url=healthconnect%3A%2F%2Fonboarding"
    ).catch(() => {});
  }

  // Writing to Health is free for everyone (reading/auto-sync stays Pro and is
  // gated on the dashboard), so the section shows whenever a provider exists.
  const wantsHealthSection = hasHealthProvider();
  const healthSectionPending = hasHealthProvider() && !hcStatusLoaded;
  // Rare (very old / unsupported Android): nothing to offer, so the section
  // drops out entirely rather than showing a dead end.
  const healthUnavailable = hcStatusLoaded && hcStatus === "unavailable";
  const showsHealthUpdateRow =
    wantsHealthSection &&
    !healthSectionPending &&
    !healthUnavailable &&
    hcStatus === "update_required";
  const showsHealthFullSection =
    wantsHealthSection &&
    !healthSectionPending &&
    !healthUnavailable &&
    hcStatus !== "update_required";

  return (
    <SettingsScaffold
      scrollHintId="data"
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
      <TwoLineRow
        icon="document-text-outline"
        label={t("settings.exportCsv")}
        sub={t("settings.exportCsvSub")}
        onPress={onExport}
        right={
          exporting ? (
            <Ionicons name="hourglass-outline" size={18} color={THEME.textMuted} />
          ) : !isProUser ? (
            <Ionicons name="lock-closed" size={16} color={THEME.textMuted} />
          ) : undefined
        }
      />
      <TwoLineRow
        icon="newspaper-outline"
        label={t("settings.exportPdf")}
        sub={t("settings.exportPdfSub")}
        onPress={onExportPdf}
        right={
          exportingPdf ? (
            <Ionicons name="hourglass-outline" size={18} color={THEME.textMuted} />
          ) : !isProUser ? (
            <Ionicons name="lock-closed" size={16} color={THEME.textMuted} />
          ) : undefined
        }
      />
      <View className="bg-glass border border-hair rounded-2xl px-3 py-3 mb-2">
        <Text className="text-mut text-[12px] mb-2">{t("settings.pdfModeLabel")}</Text>
        <Segmented<ReportMode>
          options={[
            { value: "full", label: t("settings.pdfModeFull") },
            { value: "summary", label: t("settings.pdfModeSummary") },
          ]}
          value={pdfMode}
          onChange={setPdfMode}
        />
      </View>
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

      {/* Shown to everyone: writing to Health is free. Only Android's
          Health Connect status check is still in flight while pending. */}
      {healthSectionPending ? (
        <>
          <SectionLabel>{healthName}</SectionLabel>
          <View
            className="flex-row items-center bg-glass border border-hair rounded-2xl px-4 py-3.5 mb-1"
            style={{ opacity: 0.5 }}
          >
            <Ionicons name="heart-outline" size={19} color={THEME.textMuted} />
            <Text className="flex-1 ml-3 font-medium text-ink">
              {t("settings.healthWrite", { health: healthName })}
            </Text>
            <Ionicons name="hourglass-outline" size={18} color={THEME.textMuted} />
          </View>
        </>
      ) : showsHealthUpdateRow ? (
        <>
          <SectionLabel>{healthName}</SectionLabel>
          <TwoLineRow
            icon="cloud-download-outline"
            label={healthName}
            sub={t("settings.healthUpdateRequired")}
            onPress={onOpenHealthConnectUpdate}
          />
        </>
      ) : showsHealthFullSection ? (
        <>
          <SectionLabel>{healthName}</SectionLabel>
          {/* Transparency card: what Health sync reads/writes, shown BEFORE the
              write toggle below so nobody switches it on blind. Collapsed by
              default; the summary line alone already states the shape of it. */}
          <Pressable
            onPress={() => setHealthDetailsOpen((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={t("settings.healthAbout", { health: healthName })}
            accessibilityState={{ expanded: healthDetailsOpen }}
            className="bg-glass border border-hair rounded-2xl px-4 py-3.5 mb-2"
          >
            <View className="flex-row items-center">
              <Ionicons name="information-circle-outline" size={19} color={THEME.accent} />
              <Text className="flex-1 ml-3 font-medium text-ink">
                {t("settings.healthAbout", { health: healthName })}
              </Text>
              <Text className="text-mut text-[11px] mr-1">{t("settings.healthAboutToggle")}</Text>
              <Ionicons
                name={healthDetailsOpen ? "chevron-up" : "chevron-down"}
                size={16}
                color={THEME.textMuted}
              />
            </View>
            <Text className="text-mut text-xs mt-2 leading-5">
              {t("settings.healthAboutBody", { health: healthName })}
            </Text>
            {healthDetailsOpen ? (
              <View className="mt-3" style={{ gap: 10 }}>
                <HealthDetailRow
                  icon="download-outline"
                  title={t("settings.healthReadTitle")}
                  body={t(
                    Platform.OS === "android"
                      ? "settings.healthReadBodyAndroid"
                      : "settings.healthReadBody"
                  )}
                />
                <HealthDetailRow
                  icon="cloud-upload-outline"
                  title={t("settings.healthWriteDetailTitle")}
                  body={t("settings.healthWriteDetailBody", { health: healthName })}
                />
                <HealthDetailRow
                  icon="phone-portrait-outline"
                  title={t("settings.healthOnDeviceTitle")}
                  body={t("settings.healthOnDeviceBody", { health: healthName })}
                />
                <HealthDetailRow
                  icon="options-outline"
                  title={t("settings.healthPermissionsTitle")}
                  body={t("settings.healthPermissionsBody", { health: healthName })}
                />
                {__DEV__ ? (
                  <Text className="text-mut text-[11px] italic">
                    {t("settings.healthDevNote", { health: healthName })}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </Pressable>
          <View className="bg-glass border border-hair rounded-2xl px-4 py-3.5 mb-1">
            <View className="flex-row items-center">
              <Ionicons name="heart-outline" size={19} color={THEME.textMuted} />
              <Text className="flex-1 ml-3 font-medium text-ink">
                {t("settings.healthWrite", { health: healthName })}
              </Text>
              {/* The section renders before healthWriteLoaded resolves, so the
                  switch stays neutral until the real value is in - otherwise a
                  profile with the mirror ON would see it flash OFF. */}
              {healthWriteLoaded ? (
                <Switch
                  value={healthWrite}
                  onValueChange={onToggleHealthWrite}
                  {...switchProps(t("settings.healthWrite", { health: healthName }))}
                  {...switchColors()}
                />
              ) : (
                <Ionicons name="hourglass-outline" size={18} color={THEME.textMuted} />
              )}
            </View>
            <Text className="text-mut text-xs mt-2">
              {t("settings.healthWriteHint", { health: healthName })}
            </Text>
            {writeStatus ? (
              <Text className="text-mut text-[11px] mt-1.5">
                {t(healthWriteStatusKey(writeStatus)!, {
                  // Date + time, not time alone (2.3.5 fix): this record can
                  // be from an earlier day (a foreground retry, not just a
                  // just-now write), and the same locale-aware helpers every
                  // other screen uses - never an undefined locale into Intl.
                  time: `${formatDate(writeStatus.atIso)} ${formatTime(writeStatus.atIso)}`,
                  count: writeStatus.failedCount ?? 1,
                })}
              </Text>
            ) : null}
            {healthWrite && pendingWrites > 0 ? (
              <View className="flex-row items-center mt-1.5">
                <Text className="flex-1 text-mut text-[11px]">
                  {t("settings.healthPendingWrites", { count: pendingWrites })}
                </Text>
                <Button
                  variant="tertiary"
                  size="sm"
                  onPress={onRetryHealthWrites}
                  disabled={retrying}
                  label={retrying ? "..." : t("settings.healthRetryNow")}
                  className="ml-3"
                />
              </View>
            ) : null}
          </View>
          {kindOn ? (
            <View className="bg-glass border border-hair rounded-2xl px-4 py-3.5 mb-1 mt-1">
              <View className="flex-row items-center">
                <Ionicons name="restaurant-outline" size={19} color={THEME.textMuted} />
                <Text className="flex-1 ml-3 font-medium text-ink">
                  {t("settings.healthCarbs", { health: healthName })}
                </Text>
                <Switch
                  value={kindOn.carbs}
                  onValueChange={(v) => void onToggleHealthKind("carbs", v)}
                  {...switchProps(t("settings.healthCarbs", { health: healthName }))}
                  {...switchColors()}
                />
              </View>
              <Text className="text-mut text-xs mt-2">
                {t("settings.healthCarbsHint", { health: healthName })}
              </Text>
              {Platform.OS === "android" ? (
                <Text className="text-mut text-xs mt-2">
                  {t("healthSync.androidNameNote", {
                    name: t("healthSync.recordName"),
                    estimated: t("healthSync.recordNameEstimated"),
                  })}
                </Text>
              ) : null}
              {insulinWritable ? (
                <>
                  <View className="flex-row items-center mt-4">
                    <Ionicons name="water-outline" size={19} color={THEME.textMuted} />
                    <Text className="flex-1 ml-3 font-medium text-ink">
                      {t("settings.healthInsulin", { health: healthName })}
                    </Text>
                    <Switch
                      value={kindOn.insulin}
                      onValueChange={(v) => void onToggleHealthKind("insulin", v)}
                      {...switchProps(t("settings.healthInsulin", { health: healthName }))}
                      {...switchColors()}
                    />
                  </View>
                  <Text className="text-mut text-xs mt-2">
                    {t("settings.healthInsulinHint", { health: healthName })}
                  </Text>
                </>
              ) : (
                <Text className="text-mut text-xs mt-3">
                  {t("settings.healthInsulinUnsupported", { health: healthName })}
                </Text>
              )}
            </View>
          ) : null}
          {lastSync || (isProUser && bgOn !== null) ? (
            <View className="bg-glass border border-hair rounded-2xl px-4 py-3.5 mb-1 mt-1">
              {lastSync ? (
                <>
                  <Text className="text-ink text-[13px] font-medium">
                    {t("healthSync.lastSync", {
                      time: `${formatDate(lastSync.atIso)} ${formatTime(lastSync.atIso)}`,
                      source: t(`healthSync.source.${lastSync.source}`),
                    })}
                  </Text>
                  {lastSyncErrorKey ? (
                    <Text className="text-mut text-xs mt-1.5 leading-5">
                      {t(lastSyncErrorKey, { health: healthName })}
                    </Text>
                  ) : (
                    <Text className="text-mut text-xs mt-1.5">
                      {t("healthSync.lastSyncAdded", { count: lastSync.inserted })}
                    </Text>
                  )}
                  {iosReadNote ? (
                    <Text className="text-mut text-xs mt-1.5 leading-5">
                      {t("healthSync.iosReadNote", { health: healthName })}
                    </Text>
                  ) : null}
                </>
              ) : null}
              {isProUser && bgOn !== null ? (
                <>
                  <View className={`flex-row items-center ${lastSync ? "mt-4" : ""}`}>
                    <Ionicons name="sync-outline" size={19} color={THEME.textMuted} />
                    <Text className="flex-1 ml-3 font-medium text-ink">
                      {t("settings.healthBgSync")}
                    </Text>
                    <Switch
                      value={bgOn}
                      onValueChange={(v) => void onToggleBgSync(v)}
                      {...switchProps(t("settings.healthBgSync"))}
                      {...switchColors()}
                    />
                  </View>
                  <Text className="text-mut text-xs mt-2">
                    {t(
                      Platform.OS === "android"
                        ? "settings.healthBgSyncHintAndroid"
                        : "settings.healthBgSyncHint",
                      { health: healthName }
                    )}
                  </Text>
                  {Platform.OS === "android" && bgOn ? (
                    <View className="mt-3">
                      <Button
                        variant="outlined"
                        size="sm"
                        onPress={() => void onRequestBackgroundAccess()}
                        disabled={bgBlocker === null}
                        label={
                          bgBlocker === null
                            ? t("settings.healthBgAccessOn")
                            : t("settings.healthBgAccess")
                        }
                      />
                      {bgBlocker === "no_background_permission" ? (
                        <Text className="text-mut text-xs mt-1">
                          {t("settings.healthBgAccessSub", { health: healthName })}
                        </Text>
                      ) : null}
                    </View>
                  ) : null}
                </>
              ) : null}
            </View>
          ) : null}
          {healthWrite ? (
            <TwoLineRow
              icon="cloud-upload-outline"
              label={t("settings.healthBackfill")}
              sub={
                backfill.progress
                  ? t("settings.healthBackfillRunning", {
                      done: backfill.progress.done,
                      total: backfill.progress.total,
                    })
                  : t("settings.healthBackfillSub", { health: healthName })
              }
              onPress={() => {
                if (healthWriteProfileId && !backfill.progress) {
                  backfill.pickWindow(healthWriteProfileId);
                }
              }}
            />
          ) : null}
        </>
      ) : null}

      <SectionLabel>{t("settings.analytics.section")}</SectionLabel>
      <View className="bg-glass border border-hair rounded-2xl px-4 py-3.5 mb-1">
        <View className="flex-row items-center">
          <Ionicons name="stats-chart-outline" size={19} color={THEME.textMuted} />
          <Text className="flex-1 ml-3 font-medium text-ink">
            {t("settings.analytics.title")}
          </Text>
          {analyticsLoaded ? (
            <Switch
              value={analyticsOn}
              onValueChange={onToggleAnalytics}
              {...switchColors()}
              accessibilityLabel={t("settings.analytics.title")}
            />
          ) : (
            <Ionicons name="hourglass-outline" size={18} color={THEME.textMuted} />
          )}
        </View>
        <Text className="text-mut text-xs mt-2">{t("settings.analytics.hint")}</Text>
      </View>
      <View className="bg-glass border border-hair rounded-2xl px-4 py-3.5 mb-2 mt-1">
        <View className="flex-row items-center">
          <Ionicons name="finger-print-outline" size={19} color={THEME.textMuted} />
          <Text className="flex-1 ml-3 font-medium text-ink">
            {t("settings.analytics.installId")}
          </Text>
          <Pressable
            onPress={onShareInstallId}
            disabled={!installId}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={t("settings.analytics.installIdShare")}
          >
            <Ionicons
              name="share-outline"
              size={20}
              color={installId ? THEME.accent : THEME.textMuted}
            />
          </Pressable>
        </View>
        {/* Base direction pinned to LTR: in an RTL language the hyphens of a
            UUID would otherwise reorder its groups. selectable = press and hold
            copies it, on both platforms. */}
        <Text
          selectable
          className="text-ink text-xs mt-2"
          style={[TABULAR, { writingDirection: "ltr", textAlign: "left" }]}
        >
          {installId ?? "-"}
        </Text>
        <Text className="text-mut text-xs mt-2">{t("settings.analytics.installIdHint")}</Text>
      </View>
      {/* Row's sub line is fixed at one line, and the German text cuts off at 130%
          font size; this row is the Row layout with a two-line sub. */}
      <Pressable
        onPress={onDeleteServerRecords}
        accessibilityRole="button"
        accessibilityLabel={t("settings.analytics.deleteRow")}
        android_ripple={{ color: withAlpha(THEME.text, RIPPLE_ALPHA), foreground: true }}
        className="flex-row items-center bg-glass border border-hair rounded-2xl px-3 py-3 mb-2 active:opacity-80"
        style={{ minHeight: ROW_MIN_HEIGHT }}
      >
        <View
          className="w-9 h-9 rounded-xl items-center justify-center"
          style={{ backgroundColor: withAlpha(GLUCOSE_RICH.low, 0.14) }}
        >
          <Ionicons name="cloud-offline-outline" size={18} color={GLUCOSE_RICH.low} />
        </View>
        <View className="flex-1 ml-3">
          <Text
            className="text-[15px] font-semibold"
            style={{ color: GLUCOSE_RICH.low }}
            numberOfLines={2}
          >
            {t("settings.analytics.deleteRow")}
          </Text>
          <Text className="text-mut text-[12px] mt-0.5" numberOfLines={2}>
            {t("settings.analytics.deleteSub")}
          </Text>
        </View>
        {deletingServer ? (
          <Ionicons name="hourglass-outline" size={18} color={THEME.textMuted} />
        ) : (
          <DirIcon name="chevron-forward" size={18} color={THEME.textMuted} />
        )}
      </Pressable>

      {__DEV__ ? (
        <>
          <SectionLabel>{t("settings.developerSection")}</SectionLabel>
          <View className="bg-glass border border-hair rounded-2xl px-4 py-3.5 mb-1">
            <View className="flex-row items-center">
              <Ionicons name="construct-outline" size={19} color={THEME.textMuted} />
              <Text className="flex-1 ml-3 font-medium text-ink">{t("settings.simulatePro")}</Text>
              <Switch
                value={isProUser}
                onValueChange={onToggleSimPro}
                {...switchProps(t("settings.simulatePro"))}
                {...switchColors()}
              />
            </View>
            <Text className="text-mut text-xs mt-2">{t("settings.simulateProHint")}</Text>
          </View>
        </>
      ) : null}
    </SettingsScaffold>
  );
}
