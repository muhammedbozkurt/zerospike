import React, { useEffect, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";

import { updateMed, upsertMedUse } from "../lib/db/meds";
import { InlineDateTimePicker } from "./InlineDateTimePicker";
import { MedNamePicker } from "./MedNamePicker";
import { useApp } from "../lib/store/AppContext";
import { FeedbackHost, useFeedback } from "./Feedback";
import { hapticSuccess } from "../lib/haptics";
import { logEvent } from "../lib/analytics";
import { formatTime, relativeDay } from "../lib/format";
import { GLUCOSE_RICH, RADIUS, THEME, glow } from "../lib/theme/tokens";
import { useLayout } from "../lib/useLayout";
import { GradientCTA } from "./rich/GradientCTA";

/** The stored medication entry being corrected (structurally matches MedEntry
 *  from lib/db/journal.ts). */
export interface MedEditTarget {
  id: string;
  name: string | null;
  note: string | null;
  logged_at: string;
}

const inputStyle = {
  borderRadius: RADIUS.md,
  borderWidth: 1,
  borderColor: THEME.border,
  backgroundColor: THEME.glass,
  paddingHorizontal: 14,
  paddingVertical: 12,
  color: THEME.ink,
} as const;

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text style={{ color: THEME.muted, fontSize: 12, fontWeight: "700", marginBottom: 6 }}>
      {children}
    </Text>
  );
}

/** Widest the sheet gets on a tablet before it stops stretching and centres
 *  (same cap as components/GlucoseInputSheet.tsx's SHEET_MAX_WIDTH). */
const SHEET_MAX_WIDTH = 600;

/**
 * Bottom sheet for correcting a medication entry: name, time and note - the
 * same three fields the create form (components/QuickAddSheet.tsx) collects.
 * Follows the same Modal-over-tab structure as components/InjectionEditSheet.tsx
 * (rendered from tab screens, which are not modal routes, so a plain RN Modal
 * is fine here).
 *
 * Saving also calls upsertMedUse (lib/db/meds.ts) with the entry's own logged
 * time, exactly like the create form: an edited name is worth remembering as a
 * shortcut too, and a backdated time should sort the saved name by when it was
 * actually taken, not by when the edit happened.
 */
export function MedEditSheet({
  visible,
  med,
  onClose,
  onSaved,
  onDelete,
}: {
  visible: boolean;
  med: MedEditTarget | null;
  onClose: () => void;
  onSaved: () => void;
  /** Destructive "Delete" action (2.3.1 P4): confirms first, then fires this so
   *  the caller can run the same undo-toast delete every other surface uses.
   *  Left undefined, no delete button is drawn. */
  onDelete?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { activeProfile } = useApp();
  const { confirm } = useFeedback();
  const { isWide } = useLayout();
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [loggedAt, setLoggedAt] = useState(new Date());
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible && med) {
      setName(med.name ?? "");
      setNote(med.note ?? "");
      setLoggedAt(new Date(med.logged_at));
      setTimePickerOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, med?.id]);

  async function save() {
    if (!med || saving) return;
    setSaving(true);
    try {
      const trimmedName = name.trim();
      const takenAt = loggedAt.getTime();
      await updateMed(med.id, {
        name: trimmedName || null,
        note: note.trim() || null,
        taken_at: takenAt,
      });
      if (activeProfile && trimmedName) {
        await upsertMedUse(activeProfile.id, trimmedName, takenAt);
      }
      logEvent("log_edited");
      hapticSuccess();
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  /** Same confirm dialog as the row's own swipe delete (useJournalRows.tsx's
   *  confirmAndDelete) and InjectionEditSheet's: a plain factual question,
   *  destructive styling, no second line - a medication entry never has an
   *  Apple Health mirror to warn about. */
  async function handleDelete() {
    if (!med || !onDelete) return;
    const ok = await confirm({
      message: t("journal.deleteEntry"),
      confirmLabel: t("common.delete"),
      cancelLabel: t("common.cancel"),
      destructive: true,
      icon: "trash-outline",
    });
    if (!ok) return;
    onDelete();
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
              isWide ? { width: "100%", maxWidth: SHEET_MAX_WIDTH, alignSelf: "center" } : undefined,
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
                {t("calculator.editTitle")}
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
              // flexShrink, not flex: 1 - this sheet hugs its content (no fixed
              // height, unlike InjectionEditSheet's two-step layout), so a
              // flex:1 child would fight the container's own auto sizing. Same
              // fix as GlucoseInputSheet's body ScrollView.
              style={{ flexShrink: 1 }}
              bounces={false}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 24 }}
            >
              <FieldLabel>{t("calculator.loggedTime")}</FieldLabel>
              <Pressable
                onPress={() => {
                  Keyboard.dismiss();
                  setTimePickerOpen((v) => !v);
                }}
                className="flex-row items-center mb-5"
                style={inputStyle}
              >
                <Ionicons name="time-outline" size={16} color={THEME.muted} />
                <Text style={{ color: THEME.ink, marginLeft: 8, fontSize: 13 }}>
                  {relativeDay(loggedAt.toISOString(), {
                    today: t("common.today"),
                    yesterday: t("common.yesterday"),
                  })}
                  {" · "}
                  {formatTime(loggedAt.toISOString())}
                </Text>
              </Pressable>
              <InlineDateTimePicker
                visible={timePickerOpen}
                value={loggedAt}
                max={new Date()}
                locale={i18n.language}
                onChange={setLoggedAt}
                onClose={() => setTimePickerOpen(false)}
              />

              <MedNamePicker
                profileId={activeProfile?.id ?? null}
                value={name}
                onChange={setName}
              />

              <FieldLabel>{t("common.note")}</FieldLabel>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder={t("injection.notePlaceholder")}
                placeholderTextColor={THEME.muted}
                accessibilityLabel={t("injection.notePlaceholder")}
                returnKeyType="done"
                style={[inputStyle, { marginBottom: 20 }]}
              />

              <GradientCTA label={t("common.save")} disabled={saving} onPress={save} />

              {onDelete ? (
                <Pressable
                  onPress={handleDelete}
                  accessibilityRole="button"
                  accessibilityLabel={t("common.delete")}
                  hitSlop={8}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    minHeight: 44,
                    marginTop: 14,
                  }}
                >
                  <Ionicons name="trash-outline" size={16} color={GLUCOSE_RICH.low} />
                  <Text
                    style={{ color: GLUCOSE_RICH.low, fontSize: 13, fontWeight: "700", marginLeft: 6 }}
                  >
                    {t("common.delete")}
                  </Text>
                </Pressable>
              ) : null}
            </ScrollView>
          </Pressable>
        </Pressable>
      {/* This sheet is an RN <Modal>, i.e. its own view controller. The
          FeedbackHost a SCREEN renders lives in the screen's controller, which
          is UNDERNEATH this one - so a confirm() raised from here used to be
          painted behind the sheet: invisible, untappable, and the promise it
          returns never settled, which left the action that awaited it hanging.
          Hosts are a stack and only the topmost one paints (lib/feedback.ts
          activeHostId), so mounting one here while the sheet is open puts the
          dialog in the right controller and hands it back to the screen on
          close. Guarded on `visible` so a closed sheet never takes the stack. */}
      {visible ? <FeedbackHost /> : null}
      </KeyboardAvoidingView>
    </Modal>
  );
}
