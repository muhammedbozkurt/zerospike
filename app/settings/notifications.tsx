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
  applyPostMealWindowChange,
  getPostMealTimerEnd,
  hasNotificationPermission,
  getNotificationPermission,
  requestNotificationPermission,
  checkReminderReliability,
  remindersMayBeLimited,
  type NotificationPermission,
  type ReminderReliability,
} from "../../lib/services/notifications";
import { syncLiveData } from "../../lib/services/liveData";
import {
  DEFAULT_PREFS,
  getNotificationPrefs,
  setNotificationPrefs,
  type NotificationPrefs,
} from "../../lib/services/notificationPrefs";
import { Segmented } from "../../components/ui";
import { InlineTimePicker } from "../../components/InlineTimePicker";
import { InlineConfigCard, Row, SettingsScaffold } from "../../components/settingsUi";
import { GLUCOSE_RICH, THEME } from "../../lib/theme/tokens";
import { withAlpha } from "../../components/rich/GlassCard";
import { useLayout } from "../../lib/useLayout";

/** Settings > Notifications. Moved from the single-scroll screen; behaviour is
 *  unchanged (permission row, master toggle, timers, thresholds, reliability). */
export default function NotificationSettings() {
  const { t } = useTranslation();
  const { activeProfile, lang } = useApp();
  const { contentColumn } = useLayout();

  // Starts unknown (not DEFAULT_PREFS): a user who turned the basal reminder
  // off or moved the post-meal window would otherwise see the DEFAULTS drawn
  // for one frame - wrong switch positions, not just an empty list - before
  // the real stored prefs replace them.
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [reliability, setReliability] = useState<ReminderReliability | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const [notifDenied, setNotifDenied] = useState(false);
  const [openPicker, setOpenPicker] = useState<
    "basal" | "med" | "glucose" | "weekly" | null
  >(null);
  // A post-meal timer is counting down right now. Only then does the delay note
  // have anything to describe, so it stays out of the way the rest of the time.
  const [postMealRunning, setPostMealRunning] = useState(false);

  const unit: GlucoseUnit = activeProfile?.glucose_unit ?? "mgdl";
  const showsBasal = insulinModeShowsBasal(insulinModeOf(activeProfile));
  const showsMeds = activeProfile?.oral_meds_enabled === 1;

  useEffect(() => {
    (async () => {
      const p = await getNotificationPrefs();
      setPrefs(p);
      const granted = await hasNotificationPermission();
      setNotifDenied(p.enabled && !granted);
      setPermission(await getNotificationPermission());
      setReliability(await checkReminderReliability());
      setPostMealRunning((await getPostMealTimerEnd()) != null);
    })();
  }, []);

  async function updatePrefs(patch: Partial<NotificationPrefs>) {
    const base = prefs ?? (await getNotificationPrefs());
    const next = { ...base, ...patch };
    setPrefs(next);
    await setNotificationPrefs(next);

    // Asking for permission belongs to an explicit user action, and this screen
    // is one of the two that qualify: applyNotificationPrefs itself is silent
    // now (it also runs on launch and on a profile switch), so turning a
    // reminder ON here is where the OS dialog is raised. A choice already made
    // comes back without a second dialog, so this can never nag.
    if (next.enabled && Object.values(patch).some((v) => v === true)) {
      await requestNotificationPermission();
    }
    await applyNotificationPrefs(next);

    // A running timer belongs to a meal that already happened, so a new window
    // length is measured from THAT meal: the elapsed part is kept and only the
    // remaining time is re-derived. Without this the countdown, the reminder and
    // the lock-screen activity all stayed on the length the timer was armed with.
    if (
      patch.postMealMinutes != null &&
      patch.postMealMinutes !== base.postMealMinutes
    ) {
      await applyPostMealWindowChange(patch.postMealMinutes, base.postMealMinutes);
    }

    // The moment every glanceable surface counts down to is derived from these
    // preferences (master switch, basal/med/glucose toggles and their times, the
    // post-meal window just re-armed above), so ANY save here can move it. One
    // unconditional sync rather than a list of "which patch keys matter": that
    // list drifts the day a reminder is added, and the widget then keeps showing
    // a countdown to a reminder the user already turned off. Runs last so it
    // reads the state applyNotificationPrefs and the window change left behind.
    if (activeProfile) void syncLiveData(activeProfile.id, unit);

    const granted = await hasNotificationPermission();
    setNotifDenied(next.enabled && !granted);
    setPermission(await getNotificationPermission());
    setReliability(await checkReminderReliability());
    setPostMealRunning((await getPostMealTimerEnd()) != null);
  }

  return (
    <SettingsScaffold title={t("settings.notificationsSection")}>
      <View style={contentColumn}>
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
      ) : (
        // Permission status isn't known yet: a same-shaped placeholder row
        // instead of nothing, so the screen doesn't flash empty under the title.
        <View
          className="flex-row items-center bg-glass border border-hair rounded-2xl px-3 py-3 mb-2"
          style={{ opacity: 0.5 }}
        >
          <View
            className="w-9 h-9 rounded-xl items-center justify-center"
            style={{ backgroundColor: withAlpha(THEME.accent, 0.14) }}
          >
            <Ionicons name="notifications-outline" size={18} color={THEME.accent} />
          </View>
          <Text className="flex-1 ml-3 text-[15px] font-semibold" style={{ color: THEME.ink }}>
            {t("settings.notifPermissionRow")}
          </Text>
        </View>
      )}

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

              {showsMeds ? (
                <Row
                  icon="medical-outline"
                  label={t("notifications.medReminderLabel")}
                  right={
                    <Switch
                      value={prefs.med}
                      onValueChange={(v) => updatePrefs({ med: v })}
                      trackColor={{ true: THEME.accent, false: THEME.border }}
                      thumbColor={THEME.ink}
                    />
                  }
                />
              ) : null}
              {showsMeds && prefs.med ? (
                <>
                  <Row
                    icon="alarm-outline"
                    label={t("settings.reminderTime")}
                    value={prefs.medTime}
                    onPress={() => setOpenPicker((p) => (p === "med" ? null : "med"))}
                  />
                  <InlineTimePicker
                    visible={openPicker === "med"}
                    value={prefs.medTime}
                    onChange={(v) => updatePrefs({ medTime: v })}
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
                <InlineConfigCard icon="time-outline">
                  <Text className="text-mut text-xs mb-2">{t("settings.postMealDelay")}</Text>
                  <Segmented
                    options={[90, 120, 150].map((m) => ({
                      value: String(m),
                      label: t("settings.minutes", { n: m }),
                    }))}
                    value={String(prefs.postMealMinutes)}
                    onChange={(v) => updatePrefs({ postMealMinutes: Number(v) as 90 | 120 | 150 })}
                  />
                  {/* Only while a timer is actually counting down: otherwise the
                      note describes something that is not happening. */}
                  {postMealRunning ? (
                    <Text className="text-mut text-xs mt-2">
                      {t("settings.postMealDelayRunningNote")}
                    </Text>
                  ) : null}
                </InlineConfigCard>
              ) : null}

              <Row
                icon="journal-outline"
                label={t("settings.reminderIdle")}
                right={
                  <Switch
                    value={prefs.idleReminder}
                    onValueChange={(v) => updatePrefs({ idleReminder: v })}
                    trackColor={{ true: THEME.accent, false: THEME.border }}
                    thumbColor={THEME.ink}
                  />
                }
              />
              {prefs.idleReminder ? (
                <View className="bg-glass border border-hair rounded-2xl px-4 py-3 mb-2">
                  <Text className="text-mut text-xs">{t("settings.reminderIdleHint")}</Text>
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
                  <InlineConfigCard icon="calendar-outline">
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
                  </InlineConfigCard>
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
                <InlineConfigCard icon="pulse-outline">
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
                </InlineConfigCard>
              ) : null}
            </>
          ) : null}
        </>
      ) : (
        // Prefs not loaded yet: same-shaped rows as the permission placeholder
        // above (no switch drawn, so no position can be wrong), reserving
        // roughly the space the settled list will take instead of popping in.
        <>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <View
              key={i}
              className="flex-row items-center bg-glass border border-hair rounded-2xl px-3 py-3 mb-2"
              style={{ opacity: 0.5 }}
            >
              <View
                className="w-9 h-9 rounded-xl"
                style={{ backgroundColor: withAlpha(THEME.accent, 0.14) }}
              />
              <View
                className="flex-1 ml-3"
                style={{ height: 14, borderRadius: 7, backgroundColor: THEME.track }}
              />
            </View>
          ))}
        </>
      )}
      </View>
    </SettingsScaffold>
  );
}
