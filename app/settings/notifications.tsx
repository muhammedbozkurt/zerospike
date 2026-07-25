import React, { useEffect, useState } from "react";
import { Linking, Pressable, Switch, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import { useApp } from "../../lib/store/AppContext";
import type { GlucoseUnit } from "../../lib/db/types";
import { glucoseToDisplay, glucoseUnitLabel } from "../../lib/glucose";
import { insulinModeOf, insulinModeShowsBasal } from "../../lib/insulinMode";
import {
  applyNotificationPrefs,
  hasNotificationPermission,
  getNotificationPermission,
  checkReminderReliability,
  remindersMayBeLimited,
  type NotificationPermission,
  type ReminderReliability,
} from "../../lib/services/notifications";
import {
  getNotificationPrefs,
  setNotificationPrefs,
  type NotificationPrefs,
} from "../../lib/services/notificationPrefs";
import { Segmented } from "../../components/ui";
import { InlineTimePicker } from "../../components/InlineTimePicker";
import { Row, SettingsScaffold } from "../../components/settingsUi";
import { GLUCOSE_RICH, THEME } from "../../lib/theme/tokens";
import { withAlpha } from "../../components/rich/GlassCard";

/** Settings > Notifications. Moved from the single-scroll screen; behaviour is
 *  unchanged (permission row, master toggle, timers, thresholds, reliability). */
export default function NotificationSettings() {
  const { t } = useTranslation();
  const { activeProfile, lang } = useApp();

  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [reliability, setReliability] = useState<ReminderReliability | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const [notifDenied, setNotifDenied] = useState(false);
  const [openPicker, setOpenPicker] = useState<"basal" | "glucose" | "weekly" | null>(null);

  const unit: GlucoseUnit = activeProfile?.glucose_unit ?? "mgdl";
  const showsBasal = insulinModeShowsBasal(insulinModeOf(activeProfile));

  useEffect(() => {
    (async () => {
      const p = await getNotificationPrefs();
      setPrefs(p);
      const granted = await hasNotificationPermission();
      setNotifDenied(p.enabled && !granted);
      setPermission(await getNotificationPermission());
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
    setPermission(await getNotificationPermission());
    setReliability(await checkReminderReliability());
  }

  return (
    <SettingsScaffold title={t("settings.notificationsSection")}>
      {permission ? (
        <Row
          icon={permission === "granted" ? "notifications" : "notifications-off-outline"}
          label={t("settings.notifPermissionRow")}
          value={t(`settings.notifPerm_${permission}`)}
          onPress={permission === "granted" ? undefined : () => Linking.openSettings()}
          right={
            permission === "granted" ? (
              <Ionicons name="checkmark-circle" size={18} color={GLUCOSE_RICH.target} />
            ) : undefined
          }
        />
      ) : null}

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
                    onPress={() => setOpenPicker((p) => (p === "basal" ? null : "basal"))}
                  />
                  <InlineTimePicker
                    visible={openPicker === "basal"}
                    value={prefs.basalTime}
                    onChange={(v) => updatePrefs({ basalTime: v })}
                    onClose={() => setOpenPicker(null)}
                  />
                </>
              ) : null}

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
                    onPress={() => setOpenPicker((p) => (p === "glucose" ? null : "glucose"))}
                  />
                  <InlineTimePicker
                    visible={openPicker === "glucose"}
                    value={prefs.glucoseTime}
                    onChange={(v) => updatePrefs({ glucoseTime: v })}
                    onClose={() => setOpenPicker(null)}
                  />
                </>
              ) : null}

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
                  <Text className="text-mut text-xs mb-2">{t("settings.postMealDelay")}</Text>
                  <Segmented
                    options={[90, 120, 150].map((m) => ({
                      value: String(m),
                      label: t("settings.minutes", { n: m }),
                    }))}
                    value={String(prefs.postMealMinutes)}
                    onChange={(v) => updatePrefs({ postMealMinutes: Number(v) as 90 | 120 | 150 })}
                  />
                </View>
              ) : null}

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
                    <Text className="text-mut text-xs mb-2">{t("settings.reminderDay")}</Text>
                    <View className="flex-row justify-between">
                      {/* Locale week start: Monday-first for tr/de/es/fr. */}
                      {(lang === "en" ? [1, 2, 3, 4, 5, 6, 7] : [2, 3, 4, 5, 6, 7, 1]).map((d) => {
                        const on = prefs.weeklyDay === d;
                        return (
                          <Pressable
                            key={d}
                            onPress={() => updatePrefs({ weeklyDay: d })}
                            accessibilityRole="button"
                            accessibilityState={{ selected: on }}
                            className={`w-9 h-9 rounded-full items-center justify-center ${
                              on ? "bg-brand" : "bg-glass"
                            }`}
                          >
                            <Text className={`text-xs font-semibold ${on ? "text-black" : "text-ink"}`}>
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
                    onPress={() => setOpenPicker((p) => (p === "weekly" ? null : "weekly"))}
                  />
                  <InlineTimePicker
                    visible={openPicker === "weekly"}
                    value={prefs.weeklyTime}
                    onChange={(v) => updatePrefs({ weeklyTime: v })}
                    onClose={() => setOpenPicker(null)}
                  />
                </>
              ) : null}

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
                    onChange={(v) => updatePrefs({ lowThresholdMgdl: Number(v) })}
                  />
                </View>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
    </SettingsScaffold>
  );
}
