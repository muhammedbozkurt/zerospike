import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, Pressable, Switch, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useFocusEffect, useRouter } from "expo-router";

import { useApp } from "../../lib/store/AppContext";
import { isScreenshotMode } from "../../lib/screenshotMode";
import type { GlucoseUnit, Lang } from "../../lib/db/types";
import {
  applyNotificationPrefs,
  applyPostMealAlarmModeChange,
  cancelPostMealTimer,
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
import {
  getAlarmAuthorizationStatus,
  isAlarmKitAvailable,
  requestAlarmAuthorization,
  type AlarmAuthorizationStatus,
} from "../../modules/zerospike-alarmkit";
import { POST_MEAL_WINDOW_MIN } from "../../lib/postMealTimer";
import { switchProps } from "../../lib/a11y";
import { InlineTimePicker } from "../../components/InlineTimePicker";
import { InlineConfigCard, NoticeBanner, Row, SettingsScaffold } from "../../components/settingsUi";
import { GLUCOSE_RICH, THEME, switchColors } from "../../lib/theme/tokens";
import { withAlpha } from "../../components/rich/GlassCard";
import { useLayout } from "../../lib/useLayout";

/** Week-start day for the weekly-reminder day picker, by language: the app's
 *  own weekday ids are 1=Sunday..7=Saturday (see lib/i18n weekdayShort_*), so
 *  this is just that range rotated to start on each language's own first day
 *  of the week - ar starts Saturday, ja/en start Sunday, every other bundle
 *  starts Monday. */
function weekOrder(l: Lang): number[] {
  if (l === "ar") return [7, 1, 2, 3, 4, 5, 6];
  if (l === "ja" || l === "en") return [1, 2, 3, 4, 5, 6, 7];
  return [2, 3, 4, 5, 6, 7, 1];
}

/** Settings > Notifications. Moved from the single-scroll screen; behaviour is
 *  unchanged (permission row, master toggle, timers, thresholds, reliability).
 *  2.1.0 wave 2b: the basal/med/glucose rows moved into their own reminders
 *  hub (settings/reminders.tsx, one row for all of them plus any custom one),
 *  and the low-follow-up threshold picker was dropped - that threshold is now
 *  always the active profile's own low threshold from Profile (UX#1). */
export default function NotificationSettings() {
  const { t } = useTranslation();
  const { activeProfile, lang } = useApp();
  const { columnPad } = useLayout();
  const router = useRouter();

  // Starts unknown (not DEFAULT_PREFS): a user who turned any of these off
  // would otherwise see the DEFAULTS drawn for one frame - wrong switch
  // positions, not just an empty list - before the real stored prefs replace
  // them.
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [reliability, setReliability] = useState<ReminderReliability | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const [notifDenied, setNotifDenied] = useState(false);
  const [openPicker, setOpenPicker] = useState<"weekly" | null>(null);

  // The post-meal delivery choice (2.3.0's B) exists only where AlarmKit does
  // (iOS 26+); everywhere else the countdown is always a notification and the
  // row would be a promise the OS cannot keep. A plain sync native call, like
  // the same check in components/ReminderEditSheet.tsx.
  const alarmKitAvailable = useMemo(() => isAlarmKitAvailable(), []);
  const [alarmDenied, setAlarmDenied] = useState(false);
  const [alarmBusy, setAlarmBusy] = useState(false);
  // The AlarmKit authorization behind the switch. The preference defaults to ON
  // (2.3.0's B) and is stored device-independently, so on a phone that never
  // granted the permission the switch sits on while the countdown in fact
  // arrives as a notification - the same gap the per-row badge in
  // app/settings/reminders.tsx opens its third state for. Read once on mount,
  // like the same check there.
  const [alarmAuthorized, setAlarmAuthorized] = useState(
    () => isAlarmKitAvailable() && getAlarmAuthorizationStatus() === "authorized"
  );
  // The row's own status, read the same way as the notification permission
  // row above it. Re-read on every focus (see the useFocusEffect below) so a
  // user coming back from iOS Settings sees the row update, the same gap the
  // per-row alarm badge in reminders.tsx closes with its own reload.
  const [alarmPermState, setAlarmPermState] = useState<AlarmAuthorizationStatus>(() =>
    getAlarmAuthorizationStatus()
  );

  const unit: GlucoseUnit = activeProfile?.glucose_unit ?? "mgdl";

  const reload = useCallback(async () => {
    const p = await getNotificationPrefs();
    setPrefs(p);
    const granted = await hasNotificationPermission();
    setNotifDenied(p.enabled && !granted);
    setPermission(await getNotificationPermission());
    setReliability(await checkReminderReliability());
    const alarmStatus = getAlarmAuthorizationStatus();
    setAlarmPermState(alarmStatus);
    setAlarmAuthorized(alarmStatus === "authorized");
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // A return from iOS Settings (having granted or refused the alarm
  // permission there) is not caught by the mount effect above; re-reading on
  // every focus is what makes the row - and the post-meal hint below it -
  // reflect the real state again instead of the stale one from launch.
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload])
  );

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

    // The moment every glanceable surface counts down to is derived from these
    // preferences (master switch, basal/med/glucose toggles and their times, and
    // the post-meal countdown's delivery), so ANY save here can move it. One
    // unconditional sync rather than a list of "which patch keys matter": that
    // list drifts the day a reminder is added, and the widget then keeps showing
    // a countdown to a reminder the user already turned off. Runs last so it
    // reads the state applyNotificationPrefs and the re-arm above left behind.
    if (activeProfile) void syncLiveData(activeProfile.id, unit);

    const granted = await hasNotificationPermission();
    setNotifDenied(next.enabled && !granted);
    setPermission(await getNotificationPermission());
    setReliability(await checkReminderReliability());
  }

  /**
   * Post-meal delivery switch. Turning it ON is the explicit action that earns
   * the AlarmKit prompt (same rule, and same denied-then-system-settings
   * fallback, as the per-reminder switch in components/ReminderEditSheet.tsx);
   * a refusal leaves the preference off rather than storing a choice the OS
   * would silently ignore. A countdown already running is re-armed in the new
   * mode without moving its end - see applyPostMealAlarmModeChange.
   */
  async function togglePostMealAlarm(value: boolean) {
    if (value) {
      setAlarmBusy(true);
      try {
        let status = getAlarmAuthorizationStatus();
        if (status !== "authorized") status = await requestAlarmAuthorization();
        setAlarmAuthorized(status === "authorized");
        if (status !== "authorized") {
          setAlarmDenied(true);
          return;
        }
        setAlarmDenied(false);
      } finally {
        setAlarmBusy(false);
      }
    } else {
      setAlarmDenied(false);
    }
    await updatePrefs({ postMealAlarm: value });
    await applyPostMealAlarmModeChange();
  }

  /**
   * The permission row/banner's tap target. Tries the OS prompt again first -
   * requestNotificationPermission only actually raises it when the OS still
   * can (undetermined, or Android's one extra chance before a refusal is
   * final) - and falls back to system settings only once the outcome is
   * permanently denied. Replaces jumping straight to system settings on every
   * tap regardless of state, which is what left a still-askable Android user
   * with no way back to the prompt and nothing to find in system settings.
   */
  async function retryPermission() {
    const result = await requestNotificationPermission();
    setPermission(result);
    if (result === "deniedPermanently") Linking.openSettings();
    const granted = result === "granted";
    // X6: actually ARM what the badge is about to call scheduled. Granting the
    // permission changes what applyReminders can deliver, and without this pass
    // the rows only became real on the next unrelated write.
    if (granted) await applyNotificationPrefs();
    setNotifDenied((prefs?.enabled ?? false) && !granted);
    setReliability(await checkReminderReliability());
  }

  /** Maps the AlarmKit status to the same notifPerm_* value strings the
   *  notification permission row above already uses (granted/undetermined/
   *  permanently-off): the wording is generic enough to describe either
   *  permission, and AlarmKit has no soft "denied" - a refusal is permanent
   *  the moment it happens (see requestAlarmPermission below), so it maps
   *  straight to notifPerm_deniedPermanently rather than notifPerm_denied. */
  function alarmPermValueKey(
    status: AlarmAuthorizationStatus
  ): "granted" | "deniedPermanently" | "undetermined" | "unavailable" {
    if (status === "authorized") return "granted";
    if (status === "denied") return "deniedPermanently";
    if (status === "notDetermined") return "undetermined";
    return "unavailable";
  }

  /**
   * The alarm permission row's tap target. iOS only ever shows the AlarmKit
   * prompt once (see modules/zerospike-alarmkit's isAvailable/getAuthorizationStatus
   * pair and its Swift-side counterpart): a "notDetermined" tap can still
   * raise it, but a "denied" tap cannot, and requestAuthorization would just
   * return "denied" again without showing anything - so a denied tap goes
   * straight to system settings instead of silently doing nothing.
   */
  async function requestAlarmPermission() {
    if (alarmPermState === "denied") {
      Linking.openSettings();
      return;
    }
    const status = await requestAlarmAuthorization();
    setAlarmPermState(status);
    setAlarmAuthorized(status === "authorized");
  }

  return (
    <SettingsScaffold title={t("settings.notificationsSection")}>
      <View style={columnPad()}>
      {permission ? (
        <Row
          icon={permission === "granted" ? "notifications" : "notifications-off-outline"}
          label={t("settings.notifPermissionRow")}
          value={t(`settings.notifPerm_${permission}`)}
          onPress={permission === "granted" ? undefined : () => void retryPermission()}
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
          <Text className="flex-1 ml-3 text-[15px] font-semibold" style={{ color: THEME.text }}>
            {t("settings.notifPermissionRow")}
          </Text>
        </View>
      )}

      {/* Alarm (AlarmKit) permission row, the symmetric counterpart of the
          notification permission row above. Only where AlarmKit itself
          exists (iOS 26+): on Android and older iOS this permission does not
          exist at all, so the row would just be dead. A permanent, always-
          visible surface for it - unlike the conditional hints inside the
          post-meal card below and in reminders.tsx, which only appear once a
          specific alarm-mode reminder is already in play - because a denied
          AlarmKit prompt cannot be re-shown by this app at all; the only way
          back is iOS Settings, and this row is where a user who refused it
          during onboarding can find that out again later. */}
      {alarmKitAvailable ? (
        <Row
          icon={alarmPermState === "authorized" ? "alarm" : "alarm-outline"}
          label={t("alarmTour.step2Title")}
          value={t(`settings.notifPerm_${alarmPermValueKey(alarmPermState)}`)}
          onPress={
            alarmPermState === "authorized" ? undefined : () => void requestAlarmPermission()
          }
          right={
            alarmPermState === "authorized" ? (
              <Ionicons name="checkmark-circle" size={18} color={GLUCOSE_RICH.target} />
            ) : undefined
          }
        />
      ) : null}

      {/* iOS shows the AlarmKit prompt only once; a refusal cannot be
          re-asked from inside the app, only from system settings. Says that
          plainly so a denied tap on the row above does not look like it did
          nothing - it already opened settings. Hidden in screenshot mode, the
          same store-frame reasoning as the notification banner right below. */}
      {!isScreenshotMode() && alarmKitAvailable && alarmPermState === "denied" ? (
        <NoticeBanner onPress={() => void requestAlarmPermission()}>
          <Text style={{ color: THEME.text, fontSize: 13, lineHeight: 19, opacity: 0.9 }}>
            {t("reminders.alarmPermissionDenied")}
          </Text>
          <Text style={{ color: THEME.accent, fontSize: 12, fontWeight: "700", marginTop: 4 }}>
            {t("settings.openSystemSettings")}
          </Text>
        </NoticeBanner>
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
                {...switchProps(t("settings.notificationsAll"))}
                {...switchColors()}
              />
            }
          />

          {/* Store screenshots must never show a "permission not granted"
              banner (App Store 2.3.3 - a store frame has to look like a real,
              working account), regardless of the simulator's actual OS
              permission state - hence the isScreenshotMode() gate ahead of
              the real condition rather than instead of it. Real users never
              hit this branch. */}
          {!isScreenshotMode() && prefs.enabled && notifDenied ? (
            <NoticeBanner onPress={() => void retryPermission()}>
              <Text style={{ color: THEME.text, fontSize: 13, lineHeight: 19, opacity: 0.9 }}>
                {permission === "deniedPermanently"
                  ? t("notifications.permissionDeniedPermanently")
                  : t("notifications.permissionDenied")}
              </Text>
              <Text style={{ color: THEME.accent, fontSize: 12, fontWeight: "700", marginTop: 4 }}>
                {t("settings.openSystemSettings")}
              </Text>
            </NoticeBanner>
          ) : null}

          {prefs.enabled && !notifDenied && reliability && remindersMayBeLimited(reliability) ? (
            <NoticeBanner onPress={() => Linking.openSettings()}>
              <Text style={{ color: THEME.text, fontSize: 13, fontWeight: "700" }}>
                {t("settings.exactAlarmTitle")}
              </Text>
              <Text style={{ color: THEME.text, fontSize: 12, lineHeight: 17, marginTop: 2, opacity: 0.85 }}>
                {t("settings.exactAlarmBody")}
              </Text>
              <Text style={{ color: THEME.accent, fontSize: 12, fontWeight: "700", marginTop: 6 }}>
                {t("settings.openSystemSettings")}
              </Text>
            </NoticeBanner>
          ) : null}

          {prefs.enabled ? (
            <>
              <Row
                icon="notifications-outline"
                label={t("settings.remindersTitle")}
                onPress={() => router.push("/settings/reminders")}
              />

              <Row
                icon="time-outline"
                label={t("settings.reminderPostMeal")}
                right={
                  <Switch
                    value={prefs.postMeal}
                    onValueChange={(v) => updatePrefs({ postMeal: v })}
                    {...switchProps(t("settings.reminderPostMeal"))}
                    {...switchColors()}
                  />
                }
              />
              {/* Deliberately NOT behind prefs.postMeal: that switch only
                  decides whether logging a meal ARMS the countdown by itself,
                  while the dashboard button starts one either way - so the
                  window and its delivery apply to every user and hiding them
                  here left the alarm choice unreachable for anyone who had
                  turned the automatic start off.
                  No length picker (2.3.0's G15): the window is a fixed two
                  hours, so the only thing left to choose here is how it is
                  delivered. "I started eating late" is answered on the
                  dashboard, where the meal actually is. */}
                <InlineConfigCard icon="time-outline">
                  <Text className="text-mut text-xs mb-2">
                    {t("settings.postMealFixedNote", { n: POST_MEAL_WINDOW_MIN })}
                  </Text>

                  {alarmKitAvailable ? (
                    <View className="mt-1">
                      <View className="flex-row items-center justify-between">
                        <Text
                          className="text-ink text-sm flex-1"
                          style={{ marginRight: 10 }}
                        >
                          {t("settings.postMealAlarm")}
                        </Text>
                        <Switch
                          value={prefs.postMealAlarm}
                          onValueChange={(v) => void togglePostMealAlarm(v)}
                          disabled={alarmBusy}
                          {...switchProps(t("settings.postMealAlarm"))}
                          {...switchColors()}
                        />
                      </View>
                      <Text className="text-mut text-xs mt-1">
                        {t("settings.postMealAlarmHint")}
                      </Text>
                      {/* Also shown when the switch is simply ON without the
                          permission (the default on an upgrading phone that
                          never granted it), not only right after a refusal:
                          otherwise the row promised an alarm the OS would not
                          ring, with nothing on screen saying why. */}
                      {!isScreenshotMode() &&
                      (alarmDenied || (prefs.postMealAlarm && !alarmAuthorized)) ? (
                        <Pressable
                          onPress={() => Linking.openSettings()}
                          accessibilityRole="button"
                          hitSlop={8}
                          className="mt-2"
                        >
                          <Text className="text-mut text-xs">
                            {t("reminders.alarmPermissionDenied")}{" "}
                            <Text style={{ color: THEME.accent, fontWeight: "700" }}>
                              {t("settings.openSystemSettings")}
                            </Text>
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : null}
                </InlineConfigCard>

              <Row
                icon="journal-outline"
                label={t("settings.reminderIdle")}
                right={
                  <Switch
                    value={prefs.idleReminder}
                    onValueChange={(v) => updatePrefs({ idleReminder: v })}
                    {...switchProps(t("settings.reminderIdle"))}
                    {...switchColors()}
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
                    {...switchProps(t("settings.reminderWeekly"))}
                    {...switchColors()}
                  />
                }
              />
              {prefs.weekly ? (
                <>
                  <InlineConfigCard icon="calendar-outline">
                    <Text className="text-mut text-xs mb-2">{t("settings.reminderDay")}</Text>
                    <View className="flex-row justify-between">
                      {/* Locale week start: ar Saturday, ja/en Sunday, else Monday. */}
                      {weekOrder(lang).map((d) => {
                        const on = prefs.weeklyDay === d;
                        return (
                          <Pressable
                            key={d}
                            onPress={() => updatePrefs({ weeklyDay: d })}
                            hitSlop={4}
                            accessibilityRole="button"
                            accessibilityState={{ selected: on }}
                            className={`w-9 h-9 rounded-full items-center justify-center ${
                              on ? "bg-brand" : "bg-glass"
                            }`}
                          >
                            <Text className={`text-xs font-semibold ${on ? "text-onAccent" : "text-ink"}`}>
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
                    {...switchProps(t("settings.reminderLowFollow"))}
                    {...switchColors()}
                  />
                }
              />
              {prefs.lowFollowup ? (
                <View className="bg-glass border border-hair rounded-2xl px-4 py-3 mb-2">
                  <Text className="text-mut text-xs">
                    {t("settings.lowFollowupThresholdNote")}
                  </Text>
                </View>
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
