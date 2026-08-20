import React, { useEffect, useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";

import type { Reminder, ReminderType } from "../lib/db/types";
import { Segmented } from "./ui";
import { InlineTimePicker } from "./InlineTimePicker";
import { MedNamePicker } from "./MedNamePicker";
import { GLUCOSE_RICH, HIT_TARGET, RADIUS, THEME, glow } from "../lib/theme/tokens";
import { GradientCTA } from "./rich/GradientCTA";
import {
  getAlarmAuthorizationStatus,
  isAlarmKitAvailable,
  requestAlarmAuthorization,
} from "../modules/zerospike-alarmkit";

const inputStyle = {
  borderRadius: RADIUS.md,
  borderWidth: 1,
  borderColor: THEME.border,
  backgroundColor: THEME.glass,
  paddingHorizontal: 14,
  paddingVertical: 12,
  color: THEME.ink,
} as const;

const DEFAULT_TIME = "08:00";

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text style={{ color: THEME.muted, fontSize: 12, fontWeight: "700", marginBottom: 6 }}>
      {children}
    </Text>
  );
}

export interface ReminderSavePayload {
  type: ReminderType;
  time: string;
  /** null for glucose/basal (no name field at all); trimmed text for
   *  custom (required, so this is never blank when type is "custom") and
   *  med (optional - null means the generic "İlaç" label). */
  label: string | null;
  /** 2.2.0's A1 (AlarmKit) opt-in - see ReminderUpdate.alarmEnabled in
   *  lib/db/reminders.ts. Always false on a device/OS where AlarmKit does not
   *  exist (the row below is never even shown there), and only ever true once
   *  the user has actually been asked and granted the AlarmKit permission -
   *  see the "Play as alarm" row below. */
  alarmEnabled: boolean;
}

/**
 * Modal editor for one reminder (app/settings/reminders.tsx), doubling as the
 * "add" form when `editingReminder` is null - same Modal-over-tab structure and
 * visual language as components/SavedMedEditSheet.tsx / components/MedEditSheet.tsx
 * (rendered from a settings sub-page, not a modal route, so a plain RN Modal is
 * fine).
 *
 * Replaces the previous inline add-card and inline per-row editor: nothing here
 * is written to the reminders table until Kaydet (save) is pressed - the caller
 * owns the actual create/update call (and any limit-reached toast) via `onSave`,
 * this sheet only closes once that promise resolves. Closing any other way (X,
 * backdrop, Vazgeç) discards every typed/selected value.
 */
export function ReminderEditSheet({
  visible,
  editingReminder,
  showsBasal,
  showsMeds,
  profileId,
  saving,
  onClose,
  onSave,
  onDelete,
}: {
  visible: boolean;
  /** The reminder being edited; null when this sheet is adding a brand-new
   *  one. */
  editingReminder: Reminder | null;
  /** Gates whether "basal"/"med" appear as selectable types - mirrors the
   *  active profile's insulin mode / oral-meds flag, exactly like the type
   *  list the old inline add form used. */
  showsBasal: boolean;
  showsMeds: boolean;
  /** For MedNamePicker's own profile-scoped saved-medication list. */
  profileId: string | null | undefined;
  /** True while a save is in flight - keeps Kaydet disabled and out of a
   *  double-submit race. */
  saving: boolean;
  onClose: () => void;
  /** Called on Kaydet. The caller owns the actual write (create vs. update)
   *  and any limit-reached toast; this sheet only closes once the caller's
   *  promise resolves. */
  onSave: (input: ReminderSavePayload) => Promise<void>;
  /** Present only in edit mode. Closes this sheet first, then hands off to
   *  the screen's own confirm-and-delete flow (app/settings/reminders.tsx),
   *  so the destructive confirmation appears over the plain screen rather
   *  than stacked on top of this Modal - same pattern as
   *  components/SavedMedEditSheet.tsx's onDelete. */
  onDelete?: () => void;
}) {
  const { t } = useTranslation();
  const isEdit = editingReminder != null;

  const typeOptions = useMemo(() => {
    const base: { value: ReminderType; label: string }[] = [
      { value: "glucose", label: t("reminders.typeGlucose") },
      ...(showsMeds ? [{ value: "med" as ReminderType, label: t("reminders.typeMed") }] : []),
      ...(showsBasal ? [{ value: "basal" as ReminderType, label: t("reminders.typeBasal") }] : []),
      { value: "custom", label: t("reminders.typeCustom") },
    ];
    // Keep an existing row's own (now-hidden) type selectable: a med/basal
    // reminder created while that surface was shown must not render with no
    // chip highlighted just because the profile stopped showing it since.
    if (editingReminder && !base.some((o) => o.value === editingReminder.type)) {
      const label =
        editingReminder.type === "med" ? t("reminders.typeMed") : t("reminders.typeBasal");
      base.splice(1, 0, { value: editingReminder.type, label });
    }
    return base;
  }, [showsMeds, showsBasal, editingReminder, t]);

  const [type, setType] = useState<ReminderType>("glucose");
  const [time, setTime] = useState(DEFAULT_TIME);
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [customLabel, setCustomLabel] = useState("");
  const [medName, setMedName] = useState("");

  // "Play as alarm" (2.2.0's A1) - the row itself only ever renders when
  // AlarmKit exists on this OS (iOS 26+); this is a plain sync native call
  // (like isLiveActivityAvailable), so it needs no effect/loading state of its
  // own and cannot change while the sheet is open.
  const alarmKitAvailable = useMemo(() => isAlarmKitAvailable(), []);
  const [alarmEnabled, setAlarmEnabled] = useState(false);
  const [alarmDenied, setAlarmDenied] = useState(false);
  const [alarmBusy, setAlarmBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    if (editingReminder) {
      setType(editingReminder.type);
      setTime(editingReminder.time);
      setCustomLabel(editingReminder.type === "custom" ? editingReminder.label ?? "" : "");
      setMedName(editingReminder.type === "med" ? editingReminder.label ?? "" : "");
      setAlarmEnabled(editingReminder.alarm_enabled === 1);
    } else {
      setType(typeOptions[0]?.value ?? "glucose");
      setTime(DEFAULT_TIME);
      setCustomLabel("");
      setMedName("");
      setAlarmEnabled(false);
    }
    setTimePickerOpen(false);
    setAlarmDenied(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, editingReminder?.id]);

  /**
   * Turning the switch ON is the explicit user action that earns the AlarmKit
   * permission prompt - mirrors requestNotificationPermission's own "only an
   * explicit action prompts" rule (see app/settings/reminders.tsx's
   * toggleEnabled). Already-granted skips straight to enabling; a fresh denial
   * (or one from an earlier session) leaves the switch off and shows the
   * system-settings hint instead of silently doing nothing. Turning it back
   * OFF never touches the permission at all.
   */
  async function onToggleAlarm(value: boolean) {
    if (!value) {
      setAlarmEnabled(false);
      setAlarmDenied(false);
      return;
    }
    setAlarmBusy(true);
    try {
      let status = getAlarmAuthorizationStatus();
      if (status !== "authorized") status = await requestAlarmAuthorization();
      if (status === "authorized") {
        setAlarmEnabled(true);
        setAlarmDenied(false);
      } else {
        setAlarmEnabled(false);
        setAlarmDenied(true);
      }
    } finally {
      setAlarmBusy(false);
    }
  }

  const trimmedCustom = customLabel.trim();
  const canSave = !saving && (type !== "custom" || trimmedCustom.length > 0);

  function submit() {
    if (!canSave) return;
    const label =
      type === "custom" ? trimmedCustom : type === "med" ? medName.trim() || null : null;
    void onSave({ type, time, label, alarmEnabled: alarmKitAvailable && alarmEnabled });
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1"
      >
        <Pressable
          style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.72)" }}
          onPress={onClose}
        >
          <Pressable
            style={[
              {
                borderTopLeftRadius: 26,
                borderTopRightRadius: 26,
                borderTopWidth: 1,
                borderLeftWidth: 1,
                borderRightWidth: 1,
                borderColor: THEME.border,
                backgroundColor: THEME.bg.g1,
                paddingHorizontal: 18,
                paddingTop: 8,
                paddingBottom: 8,
              },
              glow(THEME.accent, 30, 0.3),
            ]}
            onPress={(e) => e.stopPropagation()}
          >
            <View className="items-center mb-1.5">
              <View style={{ width: 38, height: 4, borderRadius: 9, backgroundColor: THEME.border }} />
            </View>
            <View className="flex-row items-center justify-between mb-4">
              <Text
                numberOfLines={1}
                style={{ color: THEME.ink, fontSize: 17, fontWeight: "800", flexShrink: 1 }}
              >
                {isEdit ? t("reminders.editTitle") : t("reminders.addTitle")}
              </Text>
              <Pressable
                onPress={onClose}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel={t("common.close")}
                className="p-1"
              >
                <Ionicons name="close" size={22} color={THEME.muted} />
              </Pressable>
            </View>

            <ScrollView
              style={{ flexShrink: 1 }}
              bounces={false}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 24 }}
            >
              <View style={{ marginBottom: 16 }}>
                <Segmented options={typeOptions} value={type} onChange={setType} />
              </View>

              <FieldLabel>{t("settings.reminderTime")}</FieldLabel>
              <Pressable
                onPress={() => setTimePickerOpen((v) => !v)}
                className="flex-row items-center mb-1"
                style={inputStyle}
              >
                <Ionicons name="alarm-outline" size={16} color={THEME.muted} />
                <Text style={{ color: THEME.ink, marginLeft: 8, fontSize: 14 }}>{time}</Text>
              </Pressable>
              <View style={{ marginBottom: 16 }}>
                <InlineTimePicker
                  visible={timePickerOpen}
                  value={time}
                  onChange={setTime}
                  onClose={() => setTimePickerOpen(false)}
                />
              </View>

              {type === "custom" ? (
                <TextInput
                  value={customLabel}
                  onChangeText={setCustomLabel}
                  placeholder={t("reminders.labelPlaceholder")}
                  placeholderTextColor={THEME.muted}
                  accessibilityLabel={t("reminders.labelPlaceholder")}
                  returnKeyType="done"
                  style={[inputStyle, { marginBottom: 18 }]}
                />
              ) : type === "med" ? (
                <MedNamePicker
                  profileId={profileId}
                  value={medName}
                  onChange={setMedName}
                  autoFillFirst={false}
                  emptyLabel={t("meds.nameOptional")}
                />
              ) : null}

              {alarmKitAvailable ? (
                <View style={{ marginTop: 4, marginBottom: 18 }}>
                  <View
                    className="flex-row items-center justify-between"
                    style={inputStyle}
                  >
                    <View className="flex-row items-center" style={{ flex: 1, marginRight: 8 }}>
                      <Ionicons name="alarm" size={16} color={THEME.muted} />
                      <Text
                        style={{ color: THEME.ink, marginLeft: 8, fontSize: 14, flexShrink: 1 }}
                      >
                        {t("reminders.playAsAlarm")}
                      </Text>
                    </View>
                    <Switch
                      value={alarmEnabled}
                      onValueChange={(v) => void onToggleAlarm(v)}
                      disabled={alarmBusy}
                      trackColor={{ true: THEME.accent, false: THEME.border }}
                      thumbColor={THEME.ink}
                    />
                  </View>
                  {alarmDenied ? (
                    <Pressable onPress={() => Linking.openSettings()} className="mt-2 px-1">
                      <Text style={{ color: THEME.muted, fontSize: 12, lineHeight: 17 }}>
                        {t("reminders.alarmPermissionDenied")}{" "}
                        <Text style={{ color: THEME.accent, fontWeight: "700" }}>
                          {t("settings.openSystemSettings")}
                        </Text>
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}

              <GradientCTA
                label={t("common.save")}
                disabled={!canSave}
                onPress={submit}
                style={{ marginBottom: 10 }}
              />
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                className="items-center py-1"
                style={{ minHeight: HIT_TARGET }}
              >
                <Text style={{ color: THEME.muted, fontSize: 13 }}>{t("common.cancel")}</Text>
              </Pressable>

              {isEdit ? (
                <Pressable
                  onPress={() => {
                    onClose();
                    onDelete?.();
                  }}
                  accessibilityRole="button"
                  className="flex-row items-center justify-center py-1 mt-2"
                  style={{ minHeight: HIT_TARGET }}
                >
                  <Ionicons name="trash-outline" size={15} color={GLUCOSE_RICH.low} />
                  <Text style={{ color: GLUCOSE_RICH.low, fontSize: 13, fontWeight: "600", marginLeft: 6 }}>
                    {t("common.delete")}
                  </Text>
                </Pressable>
              ) : null}
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
