import React, { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useTranslation } from "react-i18next";

import { useApp } from "../../lib/store/AppContext";
import {
  deleteSavedMed,
  listSavedMeds,
  renameMed,
  upsertMedUse,
} from "../../lib/db/meds";
import type { SavedMed } from "../../lib/db/types";
import { Field } from "../../components/ui";
import { InlineConfigCard, Row, SettingsScaffold } from "../../components/settingsUi";
import { useFeedback } from "../../components/Feedback";
import { GradientCTA, withAlpha } from "../../components/rich";
import { HIT_TARGET, THEME } from "../../lib/theme/tokens";
import { useLayout } from "../../lib/useLayout";

/**
 * Settings > My medications (schema v18): the per-profile saved-name registry
 * (lib/db/meds.ts) that lets the medication entry form (components/QuickAddSheet.tsx,
 * components/MedEditSheet.tsx) offer tap-to-fill chips instead of retyping.
 * Rename and delete here only ever touch this list - see the delete confirm
 * copy (meds.deleteSavedConfirm) for why past med_logs entries are never at risk.
 */
export default function MedicationsScreen() {
  const { t } = useTranslation();
  const { activeProfile } = useApp();
  const { columnPad } = useLayout();
  const { confirm, toast } = useFeedback();

  const [meds, setMeds] = useState<SavedMed[]>([]);
  const [loaded, setLoaded] = useState(false);

  // The row currently showing its inline rename Field (the built-in cancel/blur
  // commits it), mirroring app/settings/reminders.tsx's own "one open at a
  // time" editingId pattern.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const [adding, setAdding] = useState(false);
  const [addName, setAddName] = useState("");
  const [savingAdd, setSavingAdd] = useState(false);

  const refresh = useCallback(async () => {
    if (!activeProfile) {
      setMeds([]);
      setLoaded(true);
      return;
    }
    const rows = await listSavedMeds(activeProfile.id);
    setMeds(rows);
    setLoaded(true);
  }, [activeProfile]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Logging a medication elsewhere (the dashboard's quick-add, or the journal's
  // edit sheet) can add or re-sort this very list while this screen is not
  // mounted; re-reading on focus keeps it from showing a stale snapshot.
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  function openEditor(row: SavedMed) {
    if (editingId === row.id) {
      void commitRename(row);
      setEditingId(null);
      return;
    }
    setEditingId(row.id);
    setEditName(row.name);
  }

  async function commitRename(row: SavedMed) {
    const trimmed = editName.trim();
    if (!trimmed || trimmed === row.name) return;
    try {
      await renameMed(row.id, trimmed);
      await refresh();
    } catch {
      // The table's own UNIQUE(profile_id, name) constraint - the new name
      // already belongs to another saved medication on this profile.
      toast(t("meds.duplicateName"), "error");
    }
  }

  async function confirmDelete(row: SavedMed) {
    const ok = await confirm({
      message: t("meds.deleteSavedConfirm", { name: row.name }),
      confirmLabel: t("common.delete"),
      destructive: true,
    });
    if (!ok) return;
    if (editingId === row.id) setEditingId(null);
    await deleteSavedMed(row.id);
    await refresh();
  }

  function resetAddForm() {
    setAdding(false);
    setAddName("");
  }

  async function submitAdd() {
    if (!activeProfile || savingAdd) return;
    const trimmed = addName.trim();
    if (!trimmed) return;
    setSavingAdd(true);
    try {
      await upsertMedUse(activeProfile.id, trimmed, Date.now());
      await refresh();
      resetAddForm();
    } finally {
      setSavingAdd(false);
    }
  }

  return (
    <SettingsScaffold title={t("meds.manageTitle")}>
      <View style={columnPad()}>
        <Text style={{ color: THEME.muted, fontSize: 13, lineHeight: 18, marginBottom: 14 }}>
          {t("meds.manageHint")}
        </Text>

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
        ) : meds.length === 0 ? (
          <View className="rounded-2xl bg-glass border border-hair px-3.5 py-3.5 mb-3">
            <Text style={{ color: THEME.muted, fontSize: 12, lineHeight: 17 }}>
              {t("meds.empty")}
            </Text>
          </View>
        ) : (
          meds.map((row) => (
            <React.Fragment key={row.id}>
              <Row
                icon="medical-outline"
                label={row.name}
                onPress={() => openEditor(row)}
                onLongPress={() => void confirmDelete(row)}
              />
              {editingId === row.id ? (
                <InlineConfigCard icon="medical-outline">
                  <Field
                    value={editName}
                    onChangeText={setEditName}
                    onBlur={() => void commitRename(row)}
                    placeholder={t("meds.savedNamePlaceholder")}
                    autoFocus
                  />
                </InlineConfigCard>
              ) : null}
            </React.Fragment>
          ))
        )}

        {adding ? (
          <>
            <InlineConfigCard icon="add-circle-outline">
              <Field
                value={addName}
                onChangeText={setAddName}
                placeholder={t("meds.savedNamePlaceholder")}
                autoFocus
              />
            </InlineConfigCard>
            <GradientCTA
              label={t("meds.addSavedTitle")}
              onPress={submitAdd}
              disabled={savingAdd || !addName.trim()}
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
            accessibilityLabel={t("meds.addSavedTitle")}
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
              {t("meds.addSavedTitle")}
            </Text>
          </Pressable>
        )}
      </View>
    </SettingsScaffold>
  );
}
