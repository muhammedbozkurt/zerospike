import React, { useEffect, useState } from "react";
import { Linking, Pressable, Switch, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import { useApp } from "../../lib/store/AppContext";
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
import { Field, Segmented } from "../../components/ui";
import { InlineTimePicker } from "../../components/InlineTimePicker";
import { InlineConfigCard, Row, SettingsScaffold } from "../../components/settingsUi";
import { useFeedback } from "../../components/Feedback";
import { GradientCTA, withAlpha } from "../../components/rich";
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

const DEFAULT_ADD_TIME = "08:00";

/**
 * Settings > Reminders hub (2.1.0 wave 2b): every reminder the reminders
 * registry backs (lib/db/reminders.ts), in one list, replacing the old fixed
 * basal/med/glucose rows that used to live directly on the notifications
 * screen. Add / edit / delete all write straight to that table; applyReminders
 * (lib/services/notifications.ts) is what actually turns a row into a
 * scheduled OS notification, so every mutation here re-applies preferences and
 * re-syncs the widget the same way the notifications screen already does.
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

  // The row currently showing its inline time (+ label) editor, and the label
  // draft for it - mirrors InlineTimePicker's own "one open at a time" pattern
  // from the notifications screen (openPicker there).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");

  const [adding, setAdding] = useState(false);
  const [addType, setAddType] = useState<ReminderType>("glucose");
  const [addTime, setAddTime] = useState(DEFAULT_ADD_TIME);
  const [addTimePickerOpen, setAddTimePickerOpen] = useState(false);
  const [addLabel, setAddLabel] = useState("");
  const [savingAdd, setSavingAdd] = useState(false);

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
   *  shared by every mutation below (add, time, label, toggle, delete). */
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

  function openEditor(row: Reminder) {
    if (editingId === row.id) {
      // Belt and suspenders alongside the Field's own onBlur: closing the
      // panel by tapping the row again must not lose a label edit the user
      // never explicitly blurred out of.
      void commitEditLabel(row);
      setEditingId(null);
      return;
    }
    setEditingId(row.id);
    setEditLabel(row.label ?? "");
  }

  async function commitEditLabel(row: Reminder) {
    if (row.type !== "custom" && row.type !== "med") return;
    const trimmed = editLabel.trim();
    if (trimmed === (row.label ?? "")) return;
    await updateReminder(row.id, { label: trimmed || null });
    await afterChange();
  }

  async function changeTime(row: Reminder, time: string) {
    await updateReminder(row.id, { time });
    await afterChange();
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
    if (editingId === row.id) setEditingId(null);
    await deleteReminder(row.id);
    await afterChange();
  }

  const typeOptions: { value: ReminderType; label: string }[] = [
    { value: "glucose", label: t("reminders.typeGlucose") },
    ...(showsMeds ? [{ value: "med" as ReminderType, label: t("reminders.typeMed") }] : []),
    ...(showsBasal ? [{ value: "basal" as ReminderType, label: t("reminders.typeBasal") }] : []),
    { value: "custom", label: t("reminders.typeCustom") },
  ];

  const atLimit = reminders.length >= MAX_REMINDERS;
  const addLabelRequired = addType === "custom";
  const addBlocked = savingAdd || (addLabelRequired && !addLabel.trim());

  function resetAddForm() {
    setAdding(false);
    setAddType("glucose");
    setAddTime(DEFAULT_ADD_TIME);
    setAddTimePickerOpen(false);
    setAddLabel("");
  }

  async function submitAdd() {
    if (atLimit || addBlocked) return;
    setSavingAdd(true);
    try {
      const usesLabel = addType === "custom" || addType === "med";
      await createReminder({
        type: addType,
        label: usesLabel && addLabel.trim() ? addLabel.trim() : null,
        time: addTime,
      });
      await requestNotificationPermission();
      await afterChange();
      hapticSuccess();
      resetAddForm();
    } catch {
      hapticWarning();
      toast(t("reminders.limitReached"), "error");
    } finally {
      setSavingAdd(false);
    }
  }

  return (
    <SettingsScaffold title={t("settings.remindersTitle")}>
      <View style={columnPad()}>
        <Text style={{ color: THEME.muted, fontSize: 13, lineHeight: 18, marginBottom: 14 }}>
          {t("settings.remindersHint")}
        </Text>

        {permission && permission !== "granted" ? (
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
            <React.Fragment key={row.id}>
              <Row
                icon={reminderIcon(row.type)}
                label={reminderRowLabel(row)}
                value={row.time}
                onPress={() => openEditor(row)}
                onLongPress={() => void confirmDelete(row)}
                right={
                  <Switch
                    value={row.enabled === 1}
                    onValueChange={(v) => void toggleEnabled(row, v)}
                    trackColor={{ true: THEME.accent, false: THEME.border }}
                    thumbColor={THEME.ink}
                  />
                }
              />
              {editingId === row.id ? (
                <InlineConfigCard icon={reminderIcon(row.type)}>
                  {row.type === "custom" || row.type === "med" ? (
                    <Field
                      value={editLabel}
                      onChangeText={setEditLabel}
                      onBlur={() => void commitEditLabel(row)}
                      placeholder={
                        row.type === "custom"
                          ? t("reminders.labelPlaceholder")
                          : t("meds.nameOptional")
                      }
                    />
                  ) : null}
                  <InlineTimePicker
                    visible
                    value={row.time}
                    onChange={(v) => void changeTime(row, v)}
                    onClose={() => {
                      void commitEditLabel(row);
                      setEditingId(null);
                    }}
                  />
                </InlineConfigCard>
              ) : null}
            </React.Fragment>
          ))
        )}

        {atLimit ? (
          <Text style={{ color: THEME.muted, fontSize: 12, textAlign: "center", marginTop: 4 }}>
            {t("reminders.limitReached")}
          </Text>
        ) : adding ? (
          <>
            <InlineConfigCard icon="add-circle-outline">
              <Segmented
                options={typeOptions}
                value={addType}
                onChange={(v) => {
                  setAddType(v);
                  if (v !== "custom" && v !== "med") setAddLabel("");
                }}
              />
              {addType === "custom" || addType === "med" ? (
                <Field
                  value={addLabel}
                  onChangeText={setAddLabel}
                  placeholder={
                    addType === "custom"
                      ? t("reminders.labelPlaceholder")
                      : t("meds.nameOptional")
                  }
                  style={{ marginTop: 12 }}
                  autoFocus
                />
              ) : null}
            </InlineConfigCard>
            <Row
              icon="alarm-outline"
              label={t("settings.reminderTime")}
              value={addTime}
              onPress={() => setAddTimePickerOpen((v) => !v)}
            />
            <InlineTimePicker
              visible={addTimePickerOpen}
              value={addTime}
              onChange={setAddTime}
              onClose={() => setAddTimePickerOpen(false)}
            />
            <GradientCTA
              label={t("reminders.addTitle")}
              onPress={submitAdd}
              disabled={addBlocked}
              style={{ marginTop: 4, marginBottom: 10 }}
            />
            <Pressable
              onPress={resetAddForm}
              accessibilityRole="button"
              className="items-center py-1 mb-2"
              style={{ minHeight: HIT_TARGET }}
            >
              <Text style={{ color: THEME.muted, fontSize: 13 }}>{t("common.cancel")}</Text>
            </Pressable>
          </>
        ) : (
          <Pressable
            onPress={() => setAdding(true)}
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
