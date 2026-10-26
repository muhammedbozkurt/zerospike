import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Linking, Pressable, Switch, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { useApp } from "../../lib/store/AppContext";
import { isScreenshotMode } from "../../lib/screenshotMode";
import {
  MAX_REMINDERS,
  createReminder,
  deleteReminder,
  listReminders,
  updateReminder,
} from "../../lib/db/reminders";
import type { GlucoseUnit, Reminder, ReminderType } from "../../lib/db/types";
import { insulinModeOf, insulinModeShowsBasal } from "../../lib/insulinMode";
import { listProfiles } from "../../lib/db/profiles";
import {
  applyNotificationPrefs,
  getNotificationPermission,
  lastReminderScheduleFailures,
  requestNotificationPermission,
  type NotificationPermission,
} from "../../lib/services/notifications";
import { getNotificationPrefs } from "../../lib/services/notificationPrefs";
import { syncLiveData } from "../../lib/services/liveData";
import { alarmModeOf, reminderDelivery } from "../../lib/alarmSelect";
import { buildUpcoming } from "../../lib/upcomingReminders";
import {
  getAlarmAuthorizationStatus,
  isAlarmKitAvailable,
  requestAlarmAuthorization,
} from "../../modules/zerospike-alarmkit";
import { NoticeBanner, SettingsScaffold } from "../../components/settingsUi";
import { Button } from "../../components/ui";
import { ReminderEditSheet, type ReminderSavePayload } from "../../components/ReminderEditSheet";
import { useFeedback } from "../../components/Feedback";
import { withAlpha } from "../../components/rich";
import { GLUCOSE_RICH, HIT_TARGET, TABULAR, THEME, switchColors } from "../../lib/theme/tokens";
import { RIPPLE_ALPHA } from "../../lib/theme/uiPrimitives";
import { hapticSuccess, hapticWarning } from "../../lib/haptics";
import { switchProps } from "../../lib/a11y";
import { runExclusive, type SaveLock } from "../../lib/saveGuard";
import { saveReminderGuarded } from "../../lib/reminderSave";

/** Type icon, matching the icon each type already carries elsewhere in the app
 *  (moon for basal, medical for oral meds, water for a glucose check). Custom
 *  gets its own neutral mark: it has no other surface to borrow one from. */
function reminderIcon(type: ReminderType): keyof typeof Ionicons.glyphMap {
  switch (type) {
    case "basal":
      return "moon-outline";
    case "med":
      return "medical-outline";
    case "glucose":
      return "water-outline";
    default:
      return "chatbubble-ellipses-outline";
  }
}

/** How far ahead a row's "today / tomorrow" mark looks. Same day-long window
 *  the dashboard's own next-reminder line uses. */
const UPCOMING_WINDOW_MS = 24 * 60 * 60 * 1000;

/** The three things the delivery mark can say: a working alarm, an alarm the
 *  device is not (yet) allowed to ring, or a plain notification. */
// "blocked" is K3-2's new state: the row is switched on and its profile gate
// is open, but this pass arms NOTHING for it - a notification-mode row on a
// device that never allowed notifications. It used to draw the plain
// notification badge and look perfectly scheduled.
type BadgeMode =
  | "alarm"
  | "alarmPending"
  | "notification"
  /** Nothing armed because the OS permission is missing. */
  | "blocked"
  /** Nothing armed because the app's OWN master switch is off. */
  | "masterOff";

/**
 * The delivery mark: an ICON, not a labelled pill (2.3.0's G18).
 *
 * The pill spelled the mode out ("Alarm", "Alarm (needs permission)") on every
 * single row, which is the same word repeated down the whole list and, in the
 * longer languages, the widest thing on the row. The icon says it in the place
 * the eye already checks, and the header line above the list is where the
 * meaning is explained once.
 *
 * Still TAPPABLE, and deliberately so: switching a reminder between alarm and
 * notification is the one control 2.3.0's default change made necessary (a user
 * who does not want the new behaviour has to be able to undo it), and the edit
 * sheet route costs three taps and a save for what is one tap here. `hitSlop`
 * carries the touch target past 44pt without making the mark itself big.
 *
 * Only the live alarm is drawn in the accent colour: "alarmPending" is an
 * intent the device cannot honour yet, so it must not look like the working
 * thing - the outline icon carries what the row is set to, the muted treatment
 * carries that it is not ringing yet.
 */
function ModeMark({ mode, onPress }: { mode: BadgeMode; onPress: () => void }) {
  const { t } = useTranslation();
  const live = mode === "alarm";
  return (
    <Pressable
      onPress={onPress}
      hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
      accessibilityRole="button"
      accessibilityLabel={t(
        mode === "alarm"
          ? "reminders.modeAlarm"
          : mode === "alarmPending"
            ? "reminders.modeAlarmPending"
            : mode === "blocked" || mode === "masterOff"
              ? "reminders.modeBlocked"
              : "reminders.modeNotification"
      )}
      className="px-1"
    >
      <Ionicons
        name={
          mode === "blocked" || mode === "masterOff"
            ? "notifications-off-outline"
            : mode === "notification"
              ? "notifications-outline"
              : live
                ? "alarm"
                : "alarm-outline"
        }
        size={15}
        color={live ? THEME.accent : THEME.textMuted}
      />
    </Pressable>
  );
}

/**
 * One reminder in the list (2.3.0's G18).
 *
 * Three zones, nothing else: the type icon, the reminder's own NAME with its
 * time and delivery mark under it, and the on/off switch. The previous version
 * put the time on the title line and a labelled mode pill on the second one,
 * which meant four competing pieces of text per row; the name is the thing
 * being scanned for, so it gets the line to itself.
 *
 * The subline reads "08:00 · tomorrow" - the day only when it is worth saying,
 * and without repeating the word "next" on every row.
 */
function ReminderRow({
  row,
  label,
  day,
  badge,
  onPress,
  onLongPress,
  onToggleMode,
  onToggleEnabled,
}: {
  row: Reminder;
  label: string;
  /** "today" / "tomorrow", already localized; absent for a row this pass would
   *  not schedule at all (disabled, or behind a closed profile gate). */
  day?: string;
  /** null where AlarmKit does not exist: no mark is drawn at all there. */
  badge: BadgeMode | null;
  onPress: () => void;
  onLongPress: () => void;
  onToggleMode: () => void;
  onToggleEnabled: (value: boolean) => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      android_ripple={{ color: withAlpha(THEME.text, RIPPLE_ALPHA), foreground: true }}
      className="flex-row items-center bg-glass border border-hair rounded-2xl px-3 py-2.5 mb-2 active:opacity-80"
      style={{ minHeight: HIT_TARGET + 12 }}
    >
      <View
        className="w-9 h-9 rounded-xl items-center justify-center"
        style={{ backgroundColor: withAlpha(THEME.accent, 0.14) }}
      >
        <Ionicons name={reminderIcon(row.type)} size={18} color={THEME.accent} />
      </View>

      <View className="flex-1 ml-3" style={{ gap: 2 }}>
        <Text
          numberOfLines={1}
          style={{ color: THEME.text, fontSize: 15, fontWeight: "600" }}
        >
          {label}
        </Text>
        <View className="flex-row items-center" style={{ gap: 6 }}>
          <Text style={[TABULAR, { color: THEME.textMuted, fontSize: 12 }]}>
            {day ? `${row.time} · ${day}` : row.time}
          </Text>
          {badge ? <ModeMark mode={badge} onPress={onToggleMode} /> : null}
        </View>
      </View>

      <View className="ml-2">
        <Switch
          value={row.enabled === 1}
          onValueChange={onToggleEnabled}
          {...switchProps(label)}
          {...switchColors()}
        />
      </View>
    </Pressable>
  );
}

/**
 * Settings > Reminders hub (2.1.0 wave 2b; modal editor added 2.2.0's A2/A3):
 * every reminder the reminders registry backs (lib/db/reminders.ts), in one
 * list, replacing the old fixed basal/med/glucose rows that used to live
 * directly on the notifications screen. The list itself is already
 * profile-scoped (schema v19 - listReminders defaults to the active profile),
 * so this screen only ever shows and edits ONE profile's rows.
 *
 * Add / edit both go through components/ReminderEditSheet.tsx - a modal, not
 * an inline card/row editor - and write straight to the table only on its own
 * Kaydet; applyReminders (lib/services/notifications.ts) is what actually
 * turns a row into a scheduled OS notification, so every mutation here
 * re-applies preferences and re-syncs the widget the same way the
 * notifications screen already does.
 */
export default function RemindersScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { activeProfile } = useApp();
  const { confirm, toast } = useFeedback();

  const unit: GlucoseUnit = activeProfile?.glucose_unit ?? "mgdl";
  const showsBasal = insulinModeShowsBasal(insulinModeOf(activeProfile));
  const showsMeds = activeProfile?.oral_meds_enabled === 1;

  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | null>(null);

  // Delivery badge (2.3.0's A). alarm_enabled is kept platform-independently
  // (see lib/db/reminders.ts), so a row can read 1 on a device that cannot ring
  // it: the two facts below are what tell a stored intent apart from a working
  // alarm (see badgeModeOf), and the badge is hidden outright where AlarmKit
  // does not exist.
  const alarmKitAvailable = useMemo(() => isAlarmKitAvailable(), []);
  const [alarmAuthorized, setAlarmAuthorized] = useState(
    () => isAlarmKitAvailable() && getAlarmAuthorizationStatus() === "authorized"
  );

  // What the "Coming up" card needs beyond the rows themselves (2.3.0's K2-A):
  // the master switch, a running post-meal window and its own delivery
  // preference. `nowTs` is sampled, not ticked - the card lists fixed daily
  // times, and a per-second clock would re-render the whole list to move
  // nothing. It is re-sampled on every refresh and on screen focus.
  const [masterEnabled, setMasterEnabled] = useState(true);
  const [profileCount, setProfileCount] = useState(1);
  const [nowTs, setNowTs] = useState(() => Date.now());

  // The sheet is shared by add and edit: null editingReminder means "adding".
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingReminder, setEditingReminder] = useState<Reminder | null>(null);
  const [sheetSaving, setSheetSaving] = useState(false);
  const saveLockRef = useRef<SaveLock>({ current: false });

  /** The row's own label: the user's text for custom/med (falling back to the
   *  type name when a med reminder was never given one), and the type name for
   *  glucose/basal - those two carry no per-row label at all. */
  function reminderRowLabel(row: Reminder): string {
    // A row's OWN name wins for every type that can carry one. Measurement rows
    // created by the ready-made layout are named after their part of the day
    // (lib/reminderPresets), so a three-line layout no longer arrives as three
    // rows all called "Glucose check"; an older, unnamed row still falls back to
    // the type name exactly as before.
    if (row.label && row.label.trim() && row.type !== "basal") return row.label;
    if (row.type === "custom") return t("reminders.typeCustom");
    if (row.type === "med") return t("reminders.typeMed");
    if (row.type === "basal") return t("reminders.typeBasal");
    return t("reminders.typeGlucose");
  }

  /** Everything the screen draws from, re-read in one pass. Also re-samples the
   *  AlarmKit authorization, which the user can change from system settings
   *  without this screen ever unmounting. */
  const reload = useCallback(async () => {
    const [list, perm, prefs, profiles] = await Promise.all([
      listReminders(),
      getNotificationPermission(),
      getNotificationPrefs(),
      listProfiles(),
    ]);
    setProfileCount(profiles.length);
    setReminders(list);
    setPermission(perm);
    setMasterEnabled(prefs.enabled);
    setNowTs(Date.now());
    setAlarmAuthorized(isAlarmKitAvailable() && getAlarmAuthorizationStatus() === "authorized");
  }, []);

  useEffect(() => {
    void reload().then(() => setLoaded(true));
  }, [reload]);

  // Coming back from another SCREEN (the dashboard, having started a countdown)
  // has to redraw both the badges and the "Coming up" card. A return from
  // SYSTEM settings is not a focus change and is not caught here - see the
  // known limits in docs/plan-2.3.0.md section 14.
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload])
  );

  /** Re-reads the table, re-applies the schedule, and re-syncs the widget - the
   *  same three steps the notifications screen runs after every change, now
   *  shared by every mutation below (save, toggle, delete). */
  async function afterChange() {
    await reload();
    await applyNotificationPrefs();
    if (activeProfile) void syncLiveData(activeProfile.id, unit);
  }

  /** The AlarmKit authorization every badge is read against. A store frame has
   *  to look like a real, working account (App Store 2.3.3), and the simulator
   *  that captures it has granted nothing. */
  const alarmGranted = isScreenshotMode() ? true : alarmAuthorized;

  /** Store frames must look like a working account (App Store 2.3.3), the same
   *  reasoning as `alarmGranted` above. Declared HERE, above badgeModeOf, because
   *  that function reads it. */
  const notifGranted = isScreenshotMode() ? true : permission === "granted";

  /** What the badge says, in three states rather than two.
   *
   *  The stored intent (alarm_enabled, schema v21) is what it SHOWS and what a
   *  tap flips - drawing the delivery reality instead meant that on a device
   *  which never granted the AlarmKit permission every badge read
   *  "Notification" while nearly every row was in fact stored as an alarm, so a
   *  tap could only ever try to switch to the alarm and there was no way left to
   *  record the opposite choice at all.
   *
   *  The reality is not dropped, it is a state of its own: an alarm-intent row
   *  that this device cannot ring reads "Alarm (needs permission)" - which is
   *  still alarmModeOf, the same three-way AND applyReminders arms from, so the
   *  badge can never claim a working alarm the row would not get. */
  function badgeModeOf(row: Reminder): BadgeMode {
    // K3-2: before anything else, will this pass arm the row at all? The same
    // decision applyReminders makes, so the badge and the scheduler can never
    // disagree about whether a reminder exists.
    const gateOpen =
      row.type === "basal" ? showsBasal : row.type === "med" ? showsMeds : true;
    const delivery = reminderDelivery({
      masterEnabled,
      rowEnabled: row.enabled === 1,
      visibilityGateOpen: gateOpen,
      alarmEnabled: row.alarm_enabled === 1,
      alarmKitAvailable,
      alarmAuthorized: alarmGranted,
      notificationPermission: notifGranted,
    });
    if (delivery === "none" && row.enabled === 1 && gateOpen) {
      // WHY nothing is armed decides what to tell the user, and the two causes
      // need opposite fixes: the app's own master switch is one tap away in
      // Settings > Notifications, while a refused OS permission can only be
      // changed in system settings. Saying "allow notifications" to someone who
      // simply turned the app's own switch off sends them to the wrong place.
      return masterEnabled ? "blocked" : "masterOff";
    }
    if (row.alarm_enabled !== 1) return "notification";
    if (!alarmKitAvailable) return "notification";
    return alarmModeOf({
      alarmEnabled: true,
      alarmKitAvailable,
      alarmAuthorized: alarmGranted,
    }) === "alarm"
      ? "alarm"
      : "alarmPending";
  }

  /** Any row that wants an alarm this device will not ring - what the hint
   *  under the header is for. */
  const anyAlarmPending = reminders.some((r) => badgeModeOf(r) === "alarmPending");

  /** Any row this pass will not arm at all, split by CAUSE - the two hints
   *  below send the user to two different places. */
  const anyBlocked = reminders.some((r) => badgeModeOf(r) === "blocked");
  const anyMasterOff = reminders.some((r) => badgeModeOf(r) === "masterOff");

  /** The next 24 hours, computed from the SAME rows and gates applyReminders
   *  schedules from (see lib/upcomingReminders.ts for why this is derived from
   *  the table rather than read back from the OS queues). */
  const upcoming = useMemo(
    () =>
      buildUpcoming({
        rows: reminders,
        now: nowTs,
        windowMs: UPCOMING_WINDOW_MS,
        masterEnabled,
        notificationPermission: notifGranted,
        showsBasal,
        showsMeds,
        alarmKitAvailable,
        alarmAuthorized: alarmGranted,
      }),
    [
      reminders,
      nowTs,
      masterEnabled,
      notifGranted,
      showsBasal,
      showsMeds,
      alarmKitAvailable,
      alarmGranted,
    ]
  );

  /** Which DAY a row's next occurrence falls on, or undefined for a row this
   *  pass would not schedule at all (disabled, or behind a closed profile
   *  gate). Just the day: the time is right next to it on the row. */
  function dayFor(row: Reminder): string | undefined {
    const item = upcoming.find((i) => i.kind === "reminder" && i.id === row.id);
    if (!item) return undefined;
    const tomorrow = new Date(nowTs);
    tomorrow.setHours(24, 0, 0, 0);
    return t(item.at >= tomorrow.getTime() ? "reminders.dayTomorrow" : "reminders.dayToday");
  }

  /** Raises the AlarmKit dialog when the OS is still willing to ask, and points
   *  at system settings once it is not. Mirrors ReminderEditSheet's own switch. */
  async function askAlarmPermission() {
    let status = getAlarmAuthorizationStatus();
    if (status !== "authorized") status = await requestAlarmAuthorization();
    setAlarmAuthorized(status === "authorized");
    if (status === "denied") Linking.openSettings();
  }

  /**
   * The badge's tap: flips this ONE reminder's stored delivery intent and
   * records that the choice is the user's own (alarm_user_set, schema v21) so
   * no later default change can move it back.
   *
   * The permission is asked for where it is actually needed and nowhere else:
   * a row already stored as an alarm on an unauthorized device has nothing to
   * flip - the badge says what the user wants and the hint says why it still
   * arrives as a notification - so the tap is the way to grant what is missing.
   * Turning the intent ON asks too, since that is the explicit user action that
   * earns the dialog. Turning it OFF asks nothing: a notification needs no
   * alarm permission, and a refusal must never be able to swallow the choice
   * the user just made.
   */
  async function toggleAlarmMode(row: Reminder) {
    const intended = row.alarm_enabled === 1;
    if (intended && !alarmGranted) {
      await askAlarmPermission();
      await afterChange();
      return;
    }
    if (!intended) await askAlarmPermission();
    await updateReminder(row.id, { alarmEnabled: !intended, alarmUserSet: true });
    await afterChange();
  }

  /**
   * The permission banner's tap target - mirrors settings/notifications.tsx's
   * retryPermission: try the OS prompt again first (it only actually shows one
   * when the OS still can), and only fall back to system settings once that
   * comes back permanently denied. A denial the OS was still willing to
   * re-prompt for used to go straight to system settings on every tap here too.
   */
  async function retryPermission() {
    const result = await requestNotificationPermission();
    setPermission(result);
    if (result === "deniedPermanently") Linking.openSettings();
    // X6: granting the permission changes what applyReminders can deliver, so
    // re-run the pass and re-read the rows. Without it the badges flipped to
    // "scheduled" while nothing had actually been armed until the next
    // unrelated write.
    if (result === "granted") await afterChange();
  }

  function openAddSheet() {
    setEditingReminder(null);
    setSheetOpen(true);
  }

  function openEditSheet(row: Reminder) {
    setEditingReminder(row);
    setSheetOpen(true);
  }

  async function toggleEnabled(row: Reminder, value: boolean) {
    await updateReminder(row.id, { enabled: value });
    // Turning a reminder ON is the explicit user action that earns the OS
    // permission prompt (applyNotificationPrefs itself never prompts).
    if (value) await requestNotificationPermission();
    await afterChange();
  }

  async function confirmDelete(row: Reminder) {
    const ok = await confirm({
      message: t("reminders.deleteConfirm"),
      confirmLabel: t("common.delete"),
      destructive: true,
    });
    if (!ok) return;
    hapticWarning();
    await deleteReminder(row.id);
    await afterChange();
  }

  async function saveSheet(input: ReminderSavePayload) {
    await runExclusive(saveLockRef.current, async () => {
      setSheetSaving(true);
      try {
        const outcome = await saveReminderGuarded({
          isCreate: !editingReminder,
          write: async () => {
            if (editingReminder) {
              await updateReminder(editingReminder.id, input);
            } else {
              await createReminder(input);
            }
          },
          afterWrite: async () => {
            if (!editingReminder) await requestNotificationPermission();
            await afterChange();
            if (lastReminderScheduleFailures() > 0) {
              throw new Error("reminder schedule failed");
            }
          },
        });
        if (outcome === "limit") {
          hapticWarning();
          toast(t("reminders.limitReached"), "error");
          return;
        }
        if (outcome === "writeFailed") {
          hapticWarning();
          toast(t("common.saveFailed"), "error");
          return;
        }
        setSheetOpen(false);
        if (outcome === "scheduleFailed") {
          hapticWarning();
          toast(t("reminders.scheduleFailed"), "error");
        } else {
          hapticSuccess();
        }
      } finally {
        setSheetSaving(false);
      }
    });
  }

  const atLimit = reminders.length >= MAX_REMINDERS;

  return (
    <SettingsScaffold
      title={t("settings.remindersTitle")}
      fillHeight
      overlay={
        <ReminderEditSheet
          visible={sheetOpen}
          editingReminder={editingReminder}
          showsBasal={showsBasal}
          showsMeds={showsMeds}
          profileId={activeProfile?.id}
          saving={sheetSaving}
          onClose={() => setSheetOpen(false)}
          onSave={saveSheet}
          onDelete={editingReminder ? () => void confirmDelete(editingReminder) : undefined}
        />
      }
    >
      <Text style={{ color: THEME.textMuted, fontSize: 13, lineHeight: 18, marginBottom: 14 }}>
        {t("settings.remindersHint")}
        {alarmKitAvailable ? ` ${t("reminders.modeHint")}` : ""}
        {/* The one place that says why a row set to "Alarm" still arrives as
            a notification - the same sentence the edit sheet uses for the
            same state, rather than a second wording for one fact. */}
        {anyAlarmPending ? ` ${t("reminders.alarmPermissionHint")}` : ""}
        {/* K3-2: a row that will not be delivered at all. Different fix from
            the alarm hint above (the NOTIFICATION permission, not the alarm
            one), so it is its own sentence rather than a reworded share. */}
        {anyBlocked ? ` ${t("reminders.notifPermissionHint")}` : ""}
        {/* Only with a second profile: reminders are per profile and the
            inactive one's are silent, which is deliberate but was written
            down nowhere the user could see. Saying it on a single-profile
            device would only raise a question nobody has. */}
        {profileCount > 1 ? ` ${t("reminders.profileScopeNote")}` : ""}
      </Text>

      {/* K3-2/X4: nothing is being armed because the app's OWN master switch
          is off, not because the OS refused anything. A separate row from the
          permission banner below on purpose: the fix is one tap away in
          Settings > Notifications, and sending this user to system settings
          would be sending them to the wrong place. */}
      {anyMasterOff ? (
        <NoticeBanner
          onPress={() => router.push("/settings/notifications")}
          accessibilityLabel={t("reminders.masterOffHint")}
          className="mb-3"
        >
          <Text style={{ color: THEME.text, fontSize: 13, lineHeight: 19, opacity: 0.9 }}>
            {t("reminders.masterOffHint")}
          </Text>
          <Text style={{ color: THEME.accent, fontSize: 12, fontWeight: "700", marginTop: 4 }}>
            {t("reminders.masterOffCta")}
          </Text>
        </NoticeBanner>
      ) : null}

      {/* Store screenshots must never show a "permission not granted" banner
          (App Store 2.3.3 - a store frame has to look like a real, working
          account), regardless of the simulator's actual OS permission state -
          hence the isScreenshotMode() gate ahead of the real condition rather
          than instead of it. Real users never hit this branch. */}
      {!isScreenshotMode() && permission && permission !== "granted" ? (
        <NoticeBanner onPress={() => void retryPermission()} className="mb-3">
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

      {!loaded ? (
        <>
          {[0, 1, 2].map((i) => (
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
      ) : reminders.length === 0 ? (
        <View className="rounded-2xl bg-glass border border-hair px-3.5 py-3.5 mb-3">
          <Text style={{ color: THEME.textMuted, fontSize: 12, lineHeight: 17 }}>
            {t("reminders.empty")}
          </Text>
        </View>
      ) : (
        reminders.map((row) => (
          <ReminderRow
            key={row.id}
            row={row}
            label={reminderRowLabel(row)}
            day={dayFor(row)}
            badge={alarmKitAvailable ? badgeModeOf(row) : null}
            onPress={() => openEditSheet(row)}
            onLongPress={() => void confirmDelete(row)}
            onToggleMode={() => void toggleAlarmMode(row)}
            onToggleEnabled={(v) => void toggleEnabled(row, v)}
          />
        ))
      )}

      {atLimit ? (
        <Text style={{ color: THEME.textMuted, fontSize: 12, textAlign: "center", marginTop: 4 }}>
          {t("reminders.limitReached")}
        </Text>
      ) : (
        <Button
          variant="outlined"
          onPress={openAddSheet}
          label={t("reminders.addTitle")}
          icon={<Ionicons name="add" size={18} color={THEME.accent} />}
          className="mb-2"
        />
      )}
    </SettingsScaffold>
  );
}
