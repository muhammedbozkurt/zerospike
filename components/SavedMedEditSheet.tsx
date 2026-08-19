import React, { useEffect, useState } from "react";
import {
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

import { GLUCOSE_RICH, HIT_TARGET, RADIUS, THEME, glow } from "../lib/theme/tokens";
import { GradientCTA } from "./rich/GradientCTA";

const inputStyle = {
  borderRadius: RADIUS.md,
  borderWidth: 1,
  borderColor: THEME.border,
  backgroundColor: THEME.glass,
  paddingHorizontal: 14,
  paddingVertical: 12,
  color: THEME.ink,
} as const;

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
                {isEdit ? t("meds.editSavedTitle") : t("meds.addSavedTitle")}
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
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder={t("meds.savedNamePlaceholder")}
                placeholderTextColor={THEME.muted}
                accessibilityLabel={t("meds.savedNamePlaceholder")}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={submit}
                style={[inputStyle, { marginBottom: 18 }]}
              />

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
