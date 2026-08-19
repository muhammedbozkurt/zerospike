import React, { useCallback, useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import { listSavedMeds, upsertMedUse } from "../lib/db/meds";
import type { SavedMed } from "../lib/db/types";
import { hapticSelect } from "../lib/haptics";
import { RADIUS, THEME } from "../lib/theme/tokens";
import { SavedMedEditSheet } from "./SavedMedEditSheet";

/**
 * Trigger-row + modal-list medication name picker, same shape as
 * InsulinProductPicker / LanguagePicker (no bottom-sheet library in this
 * project). Shared by the create form (components/QuickAddSheet.tsx) and the
 * edit form (components/MedEditSheet.tsx) so both surfaces pick from the same
 * profile-scoped registry (lib/db/meds.ts) instead of free text - a saved
 * name is one tap, and there is no longer a way to log a typo.
 *
 * Owns its own fetch of the saved list (last_used_at DESC, so index 0 is
 * always "most recently used") and defaults `value` to that entry the moment
 * it loads, but only while the caller's value is still empty - it never
 * overwrites an existing selection or a record's current name.
 */
export function MedNamePicker({
  profileId,
  value,
  onChange,
}: {
  profileId: string | null | undefined;
  /** The selected medication name; empty/null while nothing has resolved yet
   *  (new profile, first load, or a genuinely empty registry). */
  value: string | null;
  onChange: (name: string) => void;
}) {
  const { t } = useTranslation();
  const [meds, setMeds] = useState<SavedMed[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addSaving, setAddSaving] = useState(false);

  const refresh = useCallback(async () => {
    if (!profileId) {
      setMeds([]);
      setLoaded(true);
      return;
    }
    const rows = await listSavedMeds(profileId);
    setMeds(rows);
    setLoaded(true);
  }, [profileId]);

  useEffect(() => {
    setLoaded(false);
    void refresh();
  }, [refresh]);

  // Mirrors the old chip pre-fill (QuickAddSheet used to fill the name field
  // with the most-recent chip as soon as it arrived): fires once the list is
  // in, but only while the caller holds no value yet, so it never clobbers an
  // edit form's existing name or a choice the user already made here.
  useEffect(() => {
    if (loaded && meds.length > 0 && !value) {
      onChange(meds[0].name);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, meds, value]);

  const known = value ? meds.some((m) => m.name === value) : true;
  // A name the caller already holds but that the registry no longer has - an
  // edit form opened on an entry whose saved name was since renamed or
  // deleted in "İlaçlarım". Shown as a normal, selected row rather than
  // dropped, so the picker never silently changes what the record says;
  // nothing is written back merely by appearing here (only handleAddSave
  // below ever writes).
  const rows: { id: string; name: string }[] = known
    ? meds
    : [{ id: "__extra__", name: value as string }, ...meds];

  async function handleAddSave(name: string) {
    if (!profileId || addSaving) return;
    setAddSaving(true);
    try {
      // Same call the create/edit forms already make after logging an entry
      // (upsertMedUse) - adds it if new, or just bumps last_used_at if the
      // typed name matches one already saved, so there is no duplicate-name
      // failure to handle here the way renaming does.
      await upsertMedUse(profileId, name, Date.now());
      await refresh();
      onChange(name.trim());
      setAddOpen(false);
    } finally {
      setAddSaving(false);
    }
  }

  function select(name: string) {
    hapticSelect();
    onChange(name);
    setOpen(false);
  }

  function openAddFromList() {
    setOpen(false);
    setAddOpen(true);
  }

  // Nothing saved yet, and nothing to preserve as a selection either: a
  // dropdown holding only an "add" row and no medication to pick reads as
  // broken, so the form goes straight to the add flow (per spec: no empty
  // dropdown).
  if (loaded && meds.length === 0 && known) {
    return (
      <View style={{ marginBottom: 14 }}>
        <Pressable
          onPress={() => setAddOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={t("meds.addSavedTitle")}
          className="flex-row items-center justify-center active:opacity-80"
          style={{
            borderRadius: RADIUS.md,
            borderWidth: 1,
            borderStyle: "dashed",
            borderColor: THEME.border,
            paddingVertical: 12,
          }}
        >
          <Ionicons name="add" size={18} color={THEME.accent} />
          <Text style={{ color: THEME.accent, marginLeft: 8, fontSize: 14, fontWeight: "700" }}>
            {t("meds.addSavedTitle")}
          </Text>
        </Pressable>

        <SavedMedEditSheet
          visible={addOpen}
          editingName={null}
          saving={addSaving}
          onClose={() => setAddOpen(false)}
          onSave={handleAddSave}
        />
      </View>
    );
  }

  return (
    <View style={{ marginBottom: 14 }}>
      <Pressable
        onPress={() => setOpen(true)}
        disabled={!loaded}
        accessibilityRole="button"
        accessibilityLabel={t("meds.entryLabel")}
        accessibilityValue={{ text: value || t("common.loading") }}
        className="flex-row items-center"
        style={{
          borderRadius: RADIUS.md,
          borderWidth: 1,
          borderColor: THEME.border,
          backgroundColor: THEME.glass,
          paddingHorizontal: 14,
          paddingVertical: 12,
          opacity: loaded ? 1 : 0.6,
        }}
      >
        <Ionicons name="medical-outline" size={16} color={THEME.muted} />
        <Text
          style={{ color: THEME.ink, marginLeft: 8, fontSize: 14, flex: 1 }}
          numberOfLines={1}
        >
          {value || t("common.loading")}
        </Text>
        <Ionicons name="chevron-down" size={16} color={THEME.muted} />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable
          className="flex-1 bg-black/70 justify-center px-6"
          onPress={() => setOpen(false)}
        >
          <Pressable
            className="rounded-3xl border border-hair p-4"
            style={{
              maxHeight: "80%",
              backgroundColor: THEME.sheet,
              shadowColor: "#000",
              shadowOpacity: 0.5,
              shadowRadius: 28,
              shadowOffset: { width: 0, height: 12 },
              elevation: 16,
            }}
            onPress={(e) => e.stopPropagation()}
          >
            <Text className="text-ink text-lg font-bold mb-3 px-1">
              {t("meds.entryLabel")}
            </Text>

            <Pressable
              onPress={openAddFromList}
              accessibilityRole="button"
              accessibilityLabel={t("meds.addSavedTitle")}
              className="flex-row items-center rounded-2xl px-3 mb-2"
              style={{
                minHeight: 44,
                borderWidth: 1,
                borderStyle: "dashed",
                borderColor: THEME.border,
              }}
            >
              <Ionicons name="add" size={18} color={THEME.accent} />
              <Text style={{ color: THEME.accent, marginLeft: 8, fontWeight: "700" }}>
                {t("meds.addSavedTitle")}
              </Text>
            </Pressable>

            <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
              {rows.map((row) => (
                <MedRow
                  key={row.id}
                  label={row.name}
                  active={row.name === value}
                  onPress={() => select(row.name)}
                />
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <SavedMedEditSheet
        visible={addOpen}
        editingName={null}
        saving={addSaving}
        onClose={() => setAddOpen(false)}
        onSave={handleAddSave}
      />
    </View>
  );
}

function MedRow({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      className={`flex-row items-center rounded-2xl px-3 mb-1.5 border ${
        active ? "bg-brand/10 border-brand/40" : "bg-glass border-transparent"
      }`}
      style={{ minHeight: 44 }}
    >
      <Text
        className={`flex-1 font-medium ${active ? "text-brand" : "text-ink"}`}
        numberOfLines={2}
      >
        {label}
      </Text>
      {active ? (
        <Ionicons name="checkmark-circle" size={20} color={THEME.accent} />
      ) : null}
    </Pressable>
  );
}
