import React, { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";

import { RADIUS, SPACE, THEME, TYPE, glow } from "../lib/theme/tokens";
import { Button, Txt } from "./ui";
import { SCRIM } from "./SheetShell";
import { useLayout } from "../lib/useLayout";
import { GradientCTA } from "./rich/GradientCTA";

/** Widest the sheet gets on a tablet before it stops stretching and centres
 *  (same cap as components/GlucoseInputSheet.tsx's SHEET_MAX_WIDTH). */
const SHEET_MAX_WIDTH = 600;

const inputStyle = () => ({
  borderRadius: RADIUS.md,
  borderWidth: 1,
  borderColor: THEME.border,
  backgroundColor: THEME.surface,
  paddingHorizontal: SPACE.md,
  paddingVertical: SPACE.md,
  fontSize: TYPE.body.fontSize,
  color: THEME.text,
});

/**
 * Modal editor for one saved medication name (app/settings/medications.tsx),
 * doubling as the "add" form when `editingName` is null. Same Modal-over-tab
 * structure as components/MedEditSheet.tsx / InjectionEditSheet.tsx (rendered
 * from a settings sub-page, not a modal route, so a plain RN Modal is fine).
 *
 * Replaces the previous bare inline Field that appeared under the row with no
 * explicit save/cancel affordance and committed on every keystroke - nothing
 * here is written until Kaydet (save) is pressed, and closing this sheet any
 * other way (X, backdrop, Vazgeç) discards the typed name entirely.
 */
export function SavedMedEditSheet({
  visible,
  editingName,
  saving,
  onClose,
  onSave,
  onDelete,
}: {
  visible: boolean;
  /** The current name to prefill when editing an existing saved medication;
   *  null when this sheet is adding a brand-new one. */
  editingName: string | null;
  /** True while a save is in flight - keeps Kaydet disabled and out of a
   *  double-submit race. */
  saving: boolean;
  onClose: () => void;
  /** Called with the trimmed name on Kaydet. The caller owns the actual
   *  write (rename vs. add) and any duplicate-name toast; this sheet only
   *  closes once the caller's promise resolves. */
  onSave: (name: string) => Promise<void>;
  /** Present only in edit mode. Closes this sheet first, then hands off to
   *  the screen's own confirm-and-delete flow (app/settings/medications.tsx),
   *  so the destructive confirmation appears over the plain screen rather
   *  than stacked on top of this Modal. */
  onDelete?: () => void;
}) {
  const { t } = useTranslation();
  const { isWide } = useLayout();
  const [name, setName] = useState("");
  const isEdit = editingName != null;

  useEffect(() => {
    if (visible) setName(editingName ?? "");
  }, [visible, editingName]);

  const trimmed = name.trim();
  const canSave = trimmed.length > 0 && !saving;

  function submit() {
    if (!canSave) return;
    void onSave(trimmed);
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1"
      >
        <Pressable
          style={{ flex: 1, justifyContent: "flex-end", backgroundColor: SCRIM }}
          onPress={onClose}
          accessible={false}
          focusable={false}
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
                paddingHorizontal: SPACE.lg,
                paddingTop: 8,
                paddingBottom: 8,
              },
              glow(THEME.accent, 30, 0.3),
              isWide ? { width: "100%", maxWidth: SHEET_MAX_WIDTH, alignSelf: "center" } : undefined,
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
              <Txt kind="subtitle" numberOfLines={1} style={{ flexShrink: 1, minWidth: 0 }}>
                {isEdit ? t("meds.editSavedTitle") : t("meds.addSavedTitle")}
              </Txt>
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
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder={t("meds.savedNamePlaceholder")}
                placeholderTextColor={THEME.textMuted}
                accessibilityLabel={t("meds.savedNamePlaceholder")}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={submit}
                style={[inputStyle(), { marginBottom: SPACE.lg }]}
              />

              <GradientCTA
                label={t("common.save")}
                disabled={!canSave}
                onPress={submit}
                style={{ marginBottom: SPACE.sm }}
              />
              <Button label={t("common.cancel")} variant="tertiary" onPress={onClose} />

              {isEdit ? (
                <Button
                  label={t("common.delete")}
                  variant="destructive"
                  onPress={() => {
                    onClose();
                    onDelete?.();
                  }}
                  icon={<Ionicons name="trash-outline" size={15} color={THEME.danger} />}
                  className="mt-2"
                />
              ) : null}
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
