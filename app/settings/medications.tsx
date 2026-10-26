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
import { Row, SettingsScaffold } from "../../components/settingsUi";
import { Button } from "../../components/ui";
import { SavedMedEditSheet } from "../../components/SavedMedEditSheet";
import { useFeedback } from "../../components/Feedback";
import { withAlpha } from "../../components/rich";
import { HIT_TARGET, THEME } from "../../lib/theme/tokens";

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
  const { confirm, toast } = useFeedback();

  const [meds, setMeds] = useState<SavedMed[]>([]);
  const [loaded, setLoaded] = useState(false);

  // The one sheet used for both "add" and "edit": sheetTarget null means add
  // (a blank form), set means edit (prefilled, plus the Sil action). Nothing
  // is written to the DB until Kaydet is pressed inside the sheet - closing it
  // any other way (X, backdrop, Vazgeç) discards whatever was typed.
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetTarget, setSheetTarget] = useState<SavedMed | null>(null);
  const [sheetSaving, setSheetSaving] = useState(false);

  const refresh = useCallback(async () => {
    if (!activeProfile) {
      setMeds([]);
      setLoaded(true);
      return;
    }
    try {
      setMeds(await listSavedMeds(activeProfile.id));
    } catch {
      setMeds([]);
    }
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
    setSheetTarget(row);
    setSheetOpen(true);
  }

  function openAdd() {
    setSheetTarget(null);
    setSheetOpen(true);
  }

  async function confirmDelete(row: SavedMed) {
    const ok = await confirm({
      message: t("meds.deleteSavedConfirm", { name: row.name }),
      confirmLabel: t("common.delete"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteSavedMed(row.id);
      await refresh();
    } catch {
      toast(t("common.saveFailed"), "error");
    }
  }

  // Shared by both sheet modes: sheetTarget set = rename, null = add a new
  // saved name. Stays open (sheetOpen untouched) on a duplicate-name failure
  // so the user can see the toast and fix the name; otherwise closes on save.
  async function saveSheet(name: string) {
    if (sheetSaving) return;
    setSheetSaving(true);
    try {
      if (sheetTarget) {
        if (name !== sheetTarget.name) {
          try {
            await renameMed(sheetTarget.id, name);
          } catch {
            // The table's own UNIQUE(profile_id, name) constraint - the new
            // name already belongs to another saved medication on this profile.
            toast(t("meds.duplicateName"), "error");
            return;
          }
        }
      } else {
        if (!activeProfile) return;
        await upsertMedUse(activeProfile.id, name, Date.now());
      }
      await refresh();
      setSheetOpen(false);
    } catch {
      toast(t("common.saveFailed"), "error");
    } finally {
      setSheetSaving(false);
    }
  }

  return (
    <SettingsScaffold
      title={t("meds.manageTitle")}
      overlay={
        <SavedMedEditSheet
          visible={sheetOpen}
          editingName={sheetTarget?.name ?? null}
          saving={sheetSaving}
          onClose={() => setSheetOpen(false)}
          onSave={saveSheet}
          onDelete={sheetTarget ? () => void confirmDelete(sheetTarget) : undefined}
        />
      }
    >
      <Text style={{ color: THEME.textMuted, fontSize: 13, lineHeight: 18, marginBottom: 14 }}>
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
          <Text style={{ color: THEME.textMuted, fontSize: 12, lineHeight: 17 }}>
            {t("meds.empty")}
          </Text>
        </View>
      ) : (
        meds.map((row) => (
          <Row
            key={row.id}
            icon="medical-outline"
            label={row.name}
            onPress={() => openEditor(row)}
            onLongPress={() => void confirmDelete(row)}
          />
        ))
      )}

      <Button
        variant="outlined"
        onPress={openAdd}
        label={t("meds.addSavedTitle")}
        icon={<Ionicons name="add" size={18} color={THEME.accent} />}
        className="mb-2"
      />
    </SettingsScaffold>
  );
}
