import React, { useEffect, useState } from "react";
import { Linking, Pressable, Switch, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
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
import {
  applyNotificationPrefs,
  getNotificationPermission,
  requestNotificationPermission,
  type NotificationPermission,
} from "../../lib/services/notifications";
import { syncLiveData } from "../../lib/services/liveData";
import { Row, SettingsScaffold } from "../../components/settingsUi";
import { ReminderEditSheet, type ReminderSavePayload } from "../../components/ReminderEditSheet";
import { useFeedback } from "../../components/Feedback";
import { withAlpha } from "../../components/rich";
import { GLUCOSE_RICH, HIT_TARGET, THEME } from "../../lib/theme/tokens";
import { hapticSuccess, hapticWarning } from "../../lib/haptics";
import { useLayout } from "../../lib/useLayout";

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
  const { activeProfile } = useApp();
  const { columnPad } = useLayout();
  const { confirm, toast } = useFeedback();

  const unit: GlucoseUnit = activeProfile?.glucose_unit ?? "mgdl";
  const showsBasal = insulinModeShowsBasal(insulinModeOf(activeProfile));
  const showsMeds = activeProfile?.oral_meds_enabled === 1;

  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | null>(null);

  // The sheet is shared by add and edit: null editingReminder means "adding".
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingReminder, setEditingReminder] = useState<Reminder | null>(null);
  const [sheetSaving, setSheetSaving] = useState(false);

  /** The row's own label: the user's text for custom/med (falling back to the
   *  type name when a med reminder was never given one), and the type name for
   *  glucose/basal - those two carry no per-row label at all. */
  function reminderRowLabel(row: Reminder): string {
    if (row.type === "custom") {
      return row.label && row.label.trim() ? row.label : t("reminders.typeCustom");
    }
    if (row.type === "med") {
      return row.label && row.label.trim() ? row.label : t("reminders.typeMed");
    }
    if (row.type === "basal") return t("reminders.typeBasal");
    return t("reminders.typeGlucose");
  }

  useEffect(() => {
    (async () => {
      const [list, perm] = await Promise.all([listReminders(), getNotificationPermission()]);
      setReminders(list);
      setPermission(perm);
      setLoaded(true);
    })();
  }, []);

  /** Re-reads the table, re-applies the schedule, and re-syncs the widget - the
   *  same three steps the notifications screen runs after every change, now
   *  shared by every mutation below (save, toggle, delete). */
  async function afterChange() {
    const [list, perm] = await Promise.all([listReminders(), getNotificationPermission()]);
    setReminders(list);
    setPermission(perm);
    await applyNotificationPrefs();
    if (activeProfile) void syncLiveData(activeProfile.id, unit);
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
    setSheetSaving(true);
    try {
      if (editingReminder) {
        await updateReminder(editingReminder.id, input);
      } else {
        await createReminder(input);
        await requestNotificationPermission();
      }
      await afterChange();
      hapticSuccess();
      setSheetOpen(false);
    } catch (e) {
      hapticWarning();
      // createReminder is the only call above that can actually throw (a full
      // table - see MAX_REMINDERS in lib/db/reminders.ts); anything else (a
      // write failure, afterChange's own re-read) is not the limit and must
      // not be misreported as one. No other locale key fits a generic save
      // failure here, so that case stays a silent log with the sheet left
      // open, rather than a wrong toast telling the user their list is full.
      const isLimitError =
        !editingReminder && e instanceof Error && e.message.includes("reminders reached");
      if (isLimitError) {
        toast(t("reminders.limitReached"), "error");
      } else {
        console.error("reminder save failed", e);
      }
    } finally {
      setSheetSaving(false);
    }
  }

  const atLimit = reminders.length >= MAX_REMINDERS;

  return (
    <SettingsScaffold
      title={t("settings.remindersTitle")}
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
      <View style={columnPad()}>
        <Text style={{ color: THEME.muted, fontSize: 13, lineHeight: 18, marginBottom: 14 }}>
          {t("settings.remindersHint")}
        </Text>

        {/* Store screenshots must never show a "permission not granted" banner
            (App Store 2.3.3 - a store frame has to look like a real, working
            account), regardless of the simulator's actual OS permission state -
            hence the isScreenshotMode() gate ahead of the real condition rather
            than instead of it. Real users never hit this branch. */}
        {!isScreenshotMode() && permission && permission !== "granted" ? (
          <Pressable
            onPress={() => void retryPermission()}
            className="rounded-2xl px-4 py-3 mb-3"
            style={{
              borderWidth: 1,
              borderColor: withAlpha(GLUCOSE_RICH.high, 0.3),
              backgroundColor: withAlpha(GLUCOSE_RICH.high, 0.1),
            }}
          >
            <Text style={{ color: THEME.ink, fontSize: 13, lineHeight: 19, opacity: 0.9 }}>
              {permission === "deniedPermanently"
                ? t("notifications.permissionDeniedPermanently")
                : t("notifications.permissionDenied")}
            </Text>
            <Text style={{ color: THEME.accent, fontSize: 12, fontWeight: "700", marginTop: 4 }}>
              {t("settings.openSystemSettings")}
            </Text>
          </Pressable>
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
            <Text style={{ color: THEME.muted, fontSize: 12, lineHeight: 17 }}>
              {t("reminders.empty")}
            </Text>
          </View>
        ) : (
          reminders.map((row) => (
            <Row
              key={row.id}
              icon={reminderIcon(row.type)}
              label={reminderRowLabel(row)}
              value={row.time}
              onPress={() => openEditSheet(row)}
              onLongPress={() => void confirmDelete(row)}
              right={
                <View className="flex-row items-center">
                  {row.alarm_enabled === 1 ? (
                    // Small, ONLY visual, distinguishing mark for a row that
                    // rings as a real AlarmKit alarm instead of a plain
                    // notification (2.2.0's A1) - never the row's own tap
                    // target, applyReminders is still the single source of
                    // truth for whether an alarm actually gets armed (OS
                    // version, authorization).
                    <Ionicons
                      name="alarm"
                      size={14}
                      color={THEME.accent}
                      style={{ marginRight: 8 }}
                      accessibilityLabel={t("reminders.playAsAlarm")}
                    />
                  ) : null}
                  <Switch
                    value={row.enabled === 1}
                    onValueChange={(v) => void toggleEnabled(row, v)}
                    trackColor={{ true: THEME.accent, false: THEME.border }}
                    thumbColor={THEME.ink}
                  />
                </View>
              }
            />
          ))
        )}

        {atLimit ? (
          <Text style={{ color: THEME.muted, fontSize: 12, textAlign: "center", marginTop: 4 }}>
            {t("reminders.limitReached")}
          </Text>
        ) : (
          <Pressable
            onPress={openAddSheet}
            accessibilityRole="button"
            accessibilityLabel={t("reminders.addTitle")}
            className="flex-row items-center justify-center rounded-2xl py-3.5 mb-2 active:opacity-80"
            style={{
              borderWidth: 1,
              borderStyle: "dashed",
              borderColor: THEME.border,
              minHeight: HIT_TARGET + 8,
            }}
          >
            <Ionicons name="add" size={18} color={THEME.accent} />
            <Text style={{ color: THEME.accent, marginLeft: 8, fontSize: 13, fontWeight: "700" }}>
              {t("reminders.addTitle")}
            </Text>
          </Pressable>
        )}
      </View>
    </SettingsScaffold>
  );
}
