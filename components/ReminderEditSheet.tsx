import React, { useEffect, useMemo, useState } from "react";
import {
  Animated,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { OverlayModal as Modal } from "./OverlayModal";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";

import type { Reminder, ReminderType } from "../lib/db/types";
import { Button, Segmented } from "./ui";
import { InlineTimePicker } from "./InlineTimePicker";
import { MedNamePicker } from "./MedNamePicker";
import { GLUCOSE_RICH, HIT_TARGET, RADIUS, THEME, glow, switchColors } from "../lib/theme/tokens";
import { SCRIM } from "./SheetShell";
import { useSheetKeyboard } from "../lib/useSheetKeyboard";
import { STACK_AT_SCALE } from "../lib/layoutForFontScale";
import { useFontScale } from "../lib/useFontScale";
import { sheetFrame } from "../lib/sheetLayout";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useLayout } from "../lib/useLayout";
import { sheetBoxStyle } from "../lib/tabletLayout";
import { GradientCTA } from "./rich/GradientCTA";
import {
  getAlarmAuthorizationStatus,
  isAlarmKitAvailable,
  requestAlarmAuthorization,
} from "../modules/zerospike-alarmkit";
import { reminderLabelFields, resolveReminderLabel } from "../lib/reminderLabel";
import { switchProps } from "../lib/a11y";

const inputStyle = () => ({
  borderRadius: RADIUS.md,
  borderWidth: 1,
  borderColor: THEME.border,
  backgroundColor: THEME.surface,
  paddingHorizontal: 14,
  paddingVertical: 12,
  color: THEME.text,
});

const DEFAULT_TIME = "08:00";


function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text style={{ color: THEME.textMuted, fontSize: 12, fontWeight: "700", marginBottom: 6 }}>
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
  /** How the reminder should be delivered - see ReminderUpdate.alarmEnabled in
   *  lib/db/reminders.ts. Stored as the user's PREFERENCE, independent of what
   *  this device can do: a phone with no AlarmKit (where the row below is not
   *  even drawn) still saves the default, so moving to iOS 26 later starts
   *  ringing without every reminder having to be edited again. */
  alarmEnabled: boolean;
  /** Only sent once the switch below has actually been touched (schema v21's
   *  alarm_user_set): saving a sheet the user never opened that row on must
   *  not count as them choosing the delivery. */
  alarmUserSet?: boolean;
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
  const { isWide, width: layoutWidth, height: layoutHeight } = useLayout();
  const { height: windowH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { hostRef, onHostLayout, hostHeight, lift, liftAnim, keyboardOpen } = useSheetKeyboard(visible);
  // Large text: Save is pinned under the scrolling body so it never scrolls off
  // behind the keyboard.
  const pinSave = useFontScale() > STACK_AT_SCALE;
  // Title and close stay on screen: the sheet is capped at what the keyboard
  // and the status-bar inset leave (counted once, lib/sheetLayout.ts).
  const sheetAvail = sheetFrame({
    hostHeight,
    windowHeight: windowH,
    lift,
    keyboardOpen,
    insetTop: insets.top,
    insetBottom: insets.bottom,
    contentHeight: 0,
    maxHeightRatio: 1,
  }).sheetMaxHeight;
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
  // Measurement rows carry a name too since 2.3.0's G16 (the ready-made layout
  // names them after the part of the day). Optional, exactly like a medication
  // name: left blank, the row falls back to the plain type label.
  const [glucoseName, setGlucoseName] = useState("");

  // "Play as alarm" (2.2.0's A1) - the row itself only ever renders when
  // AlarmKit exists on this OS (iOS 26+); this is a plain sync native call
  // (like isLiveActivityAvailable), so it needs no effect/loading state of its
  // own and cannot change while the sheet is open.
  const alarmKitAvailable = useMemo(() => isAlarmKitAvailable(), []);
  const [alarmEnabled, setAlarmEnabled] = useState(true);
  const [alarmDenied, setAlarmDenied] = useState(false);
  const [alarmBusy, setAlarmBusy] = useState(false);
  // Whether the user touched the switch during THIS sheet session - what
  // decides if the save records a deliberate choice (schema v21).
  const [alarmTouched, setAlarmTouched] = useState(false);
  // The AlarmKit permission is still missing while the switch sits on: the
  // reminder will be saved as an alarm and simply arrive as a notification
  // until it is granted, so the sheet says so instead of implying it will ring.
  const [alarmAuthorized, setAlarmAuthorized] = useState(false);

  useEffect(() => {
    if (!visible) return;
    if (editingReminder) {
      setType(editingReminder.type);
      setTime(editingReminder.time);
      // EVERY type's own name is loaded, not just custom/med: a measurement
      // row created by the ready-made layout carries one ("Morning glucose
      // check"), and reading only two types meant opening such a row to change
      // its time and saving it back with label = null - the rename the plan
      // promises, silently undone by the save it was made through.
      const fields = reminderLabelFields(editingReminder.type, editingReminder.label);
      setCustomLabel(fields.custom);
      setMedName(fields.med);
      setGlucoseName(fields.glucose);
      setAlarmEnabled(editingReminder.alarm_enabled === 1);
    } else {
      setType(typeOptions[0]?.value ?? "glucose");
      setTime(DEFAULT_TIME);
      setCustomLabel("");
      setMedName("");
      setGlucoseName("");
      // A brand-new reminder is born as an alarm (schema v21's default), the
      // same way it is born enabled.
      setAlarmEnabled(true);
    }
    setTimePickerOpen(false);
    setAlarmDenied(false);
    setAlarmTouched(false);
    setAlarmAuthorized(
      alarmKitAvailable && getAlarmAuthorizationStatus() === "authorized"
    );
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
    setAlarmTouched(true);
    if (!value) {
      setAlarmEnabled(false);
      setAlarmDenied(false);
      return;
    }
    setAlarmBusy(true);
    try {
      let status = getAlarmAuthorizationStatus();
      if (status !== "authorized") status = await requestAlarmAuthorization();
      // The switch stays ON either way: what it records is the user's CHOICE,
      // and a refused permission does not unmake it (the same rule the list's
      // own mark follows - the row reads "alarm, not allowed yet" and starts
      // ringing the moment the permission is granted). Only the hint below
      // changes, so the screen still says why it is not ringing today.
      setAlarmEnabled(true);
      setAlarmAuthorized(status === "authorized");
      setAlarmDenied(status !== "authorized");
    } finally {
      setAlarmBusy(false);
    }
  }

  const trimmedCustom = customLabel.trim();
  const canSave = !saving && (type !== "custom" || trimmedCustom.length > 0);

  function submit() {
    if (!canSave) return;
    // One expression, every type that can hold a name. `null` only where the
    // user really left it blank - which is what makes the row show its type
    // name again, rather than an accident of which types this line remembers.
    const label = resolveReminderLabel(type, {
      custom: customLabel,
      med: medName,
      glucose: glucoseName,
    });
    // The preference is saved as-is, without folding this device's AlarmKit
    // availability in: it is what the user wants, not what this phone can do
    // today (see lib/db/reminders.ts). shouldUseAlarm decides the rest at
    // schedule time.
    void onSave({
      type,
      time,
      label,
      alarmEnabled,
      ...(alarmTouched ? { alarmUserSet: true } : {}),
    });
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View ref={hostRef} collapsable={false} onLayout={onHostLayout} style={{ flex: 1 }}>
        <Animated.View style={{ flex: 1, paddingBottom: liftAnim }}>
        <Pressable
          style={{ flex: 1, justifyContent: "flex-end", backgroundColor: SCRIM }}
          onPress={onClose}
          accessible={false}
          focusable={false}
        >
          <Pressable
            style={[
              {
                maxHeight: sheetAvail,
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
              sheetBoxStyle(layoutWidth, isWide, layoutHeight, sheetAvail),
            ]}
            onPress={(e) => e.stopPropagation()}
            accessible={false}
            focusable={false}
            importantForAccessibility="auto"
          >
            <View className="items-center mb-1.5">
              <View style={{ width: 38, height: 4, borderRadius: 9, backgroundColor: THEME.border }} />
            </View>
            <View className="flex-row items-center justify-between mb-4">
              <Text
                numberOfLines={1}
                style={{ color: THEME.text, fontSize: 17, fontWeight: "800", flexShrink: 1 }}
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
                <Ionicons name="close" size={22} color={THEME.textMuted} />
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
                accessibilityRole="button"
                accessibilityLabel={`${t("settings.reminderTime")}: ${time}`}
                className="flex-row items-center mb-1"
                style={inputStyle()}
              >
                <Ionicons name="alarm-outline" size={16} color={THEME.textMuted} />
                <Text style={{ color: THEME.text, marginLeft: 8, fontSize: 14 }}>{time}</Text>
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
                <>
                  <TextInput
                    value={customLabel}
                    onChangeText={setCustomLabel}
                    placeholder={t("reminders.labelPlaceholder")}
                    placeholderTextColor={THEME.placeholder}
                    accessibilityLabel={t("reminders.labelPlaceholder")}
                    returnKeyType="done"
                    style={[inputStyle(), { marginBottom: trimmedCustom.length === 0 ? 6 : 18 }]}
                  />
                  {trimmedCustom.length === 0 ? (
                    <Text
                      className="px-1"
                      style={{ color: THEME.textMuted, fontSize: 12, lineHeight: 17, marginBottom: 18 }}
                    >
                      {t("reminders.customNeedsName")}
                    </Text>
                  ) : null}
                </>
              ) : type === "med" ? (
                <MedNamePicker
                  profileId={profileId}
                  value={medName}
                  onChange={setMedName}
                  autoFillFirst={false}
                  emptyLabel={t("meds.nameOptional")}
                />
              ) : type === "glucose" ? (
                <TextInput
                  value={glucoseName}
                  onChangeText={setGlucoseName}
                  placeholder={t("reminders.namePlaceholderOptional")}
                  placeholderTextColor={THEME.placeholder}
                  accessibilityLabel={t("reminders.namePlaceholderOptional")}
                  returnKeyType="done"
                  style={[inputStyle(), { marginBottom: 18 }]}
                />
              ) : null}

              {alarmKitAvailable ? (
                <View style={{ marginTop: 4, marginBottom: 18 }}>
                  <View
                    className="flex-row items-center justify-between"
                    style={inputStyle()}
                  >
                    <View className="flex-row items-center" style={{ flex: 1, marginRight: 8 }}>
                      <Ionicons name="alarm" size={16} color={THEME.textMuted} />
                      <Text
                        style={{ color: THEME.text, marginLeft: 8, fontSize: 14, flexShrink: 1 }}
                      >
                        {t("reminders.playAsAlarm")}
                      </Text>
                    </View>
                    <Switch
                      value={alarmEnabled}
                      onValueChange={(v) => void onToggleAlarm(v)}
                      disabled={alarmBusy}
                      {...switchProps(t("reminders.playAsAlarm"))}
                      {...switchColors()}
                    />
                  </View>
                  {alarmDenied ? (
                    <Pressable
                      onPress={() => Linking.openSettings()}
                      accessibilityRole="button"
                      className="mt-2 px-1"
                    >
                      <Text style={{ color: THEME.textMuted, fontSize: 12, lineHeight: 17 }}>
                        {t("reminders.alarmPermissionDenied")}{" "}
                        <Text style={{ color: THEME.accent, fontWeight: "700" }}>
                          {t("settings.openSystemSettings")}
                        </Text>
                      </Text>
                    </Pressable>
                  ) : alarmEnabled && !alarmAuthorized ? (
                    // Switch on, permission not (yet) granted: the row below is
                    // the only place that says why it will still arrive as a
                    // notification for now.
                    <Text
                      className="mt-2 px-1"
                      style={{ color: THEME.textMuted, fontSize: 12, lineHeight: 17 }}
                    >
                      {t("reminders.alarmPermissionHint")}
                    </Text>
                  ) : !isEdit ? (
                    <Text
                      className="mt-2 px-1"
                      style={{ color: THEME.textMuted, fontSize: 12, lineHeight: 17 }}
                    >
                      {t("reminders.alarmDefaultHint")}
                    </Text>
                  ) : null}
                </View>
              ) : null}

              {pinSave ? null : (
<GradientCTA
                label={t("common.save")}
                disabled={!canSave}
                onPress={submit}
                style={{ marginBottom: 10 }}
              />
)}
              <Button variant="tertiary" onPress={onClose} label={t("common.cancel")} />

              {isEdit ? (
                <Button
                  variant="destructive"
                  onPress={() => {
                    onClose();
                    onDelete?.();
                  }}
                  label={t("common.delete")}
                  icon={<Ionicons name="trash-outline" size={15} color={GLUCOSE_RICH.low} />}
                  className="mt-2"
                />
              ) : null}
            </ScrollView>
{pinSave ? (
<View style={{ paddingTop: 8 }}>
<GradientCTA
                label={t("common.save")}
                disabled={!canSave}
                onPress={submit}
                style={{ marginBottom: 10 }}
              />
</View>
) : null}
          </Pressable>
        </Pressable>
      </Animated.View>
      </View>
    </Modal>
  );
}
