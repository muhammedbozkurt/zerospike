import React, { useCallback, useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { useApp } from "../lib/store/AppContext";
import { useFeedback } from "../components/Feedback";
import { Button, Field, Segmented } from "../components/ui";
import type { InsulinPen, InsulinType } from "../lib/db/types";
import {
  listPens,
  createPen,
  deletePen,
  getActivePenCount,
  FREE_PEN_LIMIT,
} from "../lib/db/injections";
import { num } from "../lib/format";
import { hapticSuccess, hapticWarning } from "../lib/haptics";

const LOW_PEN_THRESHOLD = 20;

export default function PensScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { activeProfile, isProUser, dataVersion, bumpData } = useApp();
  const { confirm } = useFeedback();

  const [pens, setPens] = useState<InsulinPen[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<InsulinType>("bolus");
  const [total, setTotal] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!activeProfile) return;
    setPens(await listPens(activeProfile.id));
  }, [activeProfile]);

  useEffect(() => {
    load();
  }, [load, dataVersion]);

  const totalNum = parseFloat(total.replace(",", "."));
  const canSave = Number.isFinite(totalNum) && totalNum > 0;

  async function onAdd() {
    if (!activeProfile || !canSave || saving) return;
    // Free tier keeps a single active pen; a second one needs Pro.
    if (!isProUser && (await getActivePenCount(activeProfile.id)) >= FREE_PEN_LIMIT) {
      hapticWarning();
      router.push({ pathname: "/paywall", params: { reason: "pens" } });
      return;
    }
    setSaving(true);
    try {
      await createPen(activeProfile.id, name, type, totalNum);
      hapticSuccess();
      setName("");
      setTotal("");
      setType("bolus");
      setAdding(false);
      bumpData();
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(pen: InsulinPen) {
    const ok = await confirm({
      title: t("pen.delete"),
      message: t("pen.deleteConfirm"),
      confirmLabel: t("common.delete"),
      destructive: true,
    });
    if (!ok) return;
    hapticWarning();
    await deletePen(pen.id);
    bumpData();
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      className="flex-1 bg-zinc-950"
      style={{ paddingTop: insets.top }}
    >
      {/* Header */}
      <View className="flex-row items-center justify-between px-4 py-3 border-b border-zinc-900">
        <Text className="text-zinc-50 text-lg font-bold flex-1" numberOfLines={1}>
          {t("pen.title")}
        </Text>
        <Pressable onPress={() => router.back()} hitSlop={10} className="p-1">
          <Ionicons name="close" size={24} color="#a1a1aa" />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Pen list */}
        {pens.length === 0 && !adding ? (
          <View className="items-center py-10">
            <Ionicons name="albums-outline" size={40} color="#3f3f46" />
            <Text className="text-zinc-600 text-center mt-3 px-6">{t("pen.empty")}</Text>
          </View>
        ) : (
          pens.map((pen) => {
            const low = pen.remaining_units < LOW_PEN_THRESHOLD;
            return (
              <View
                key={pen.id}
                className="rounded-2xl bg-zinc-900 border border-zinc-800 p-4 mb-3"
              >
                <View className="flex-row items-center">
                  <View className="flex-1">
                    <Text className="text-zinc-50 font-bold text-base">{pen.name}</Text>
                    <Text className="text-zinc-500 text-xs mt-0.5">
                      {pen.insulin_type === "basal" ? t("pen.basal") : t("pen.bolus")}
                    </Text>
                  </View>
                  <View className="items-end mr-2">
                    <Text className="text-zinc-100 font-semibold">
                      {num(pen.remaining_units)} / {num(pen.total_units)}
                    </Text>
                    <Text className="text-zinc-500 text-xs">{t("pen.remaining")}</Text>
                  </View>
                  <Pressable onPress={() => onDelete(pen)} hitSlop={8} className="p-1">
                    <Ionicons name="trash-outline" size={18} color="#fb7185" />
                  </Pressable>
                </View>
                {low ? (
                  <View className="flex-row items-center mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                    <Ionicons name="warning-outline" size={14} color="#f59e0b" />
                    <Text className="text-amber-200/90 text-xs ml-2">
                      {t("pen.lowWarning", { n: Math.round(pen.remaining_units) })}
                    </Text>
                  </View>
                ) : null}
              </View>
            );
          })
        )}

        {/* Add form */}
        {adding ? (
          <View className="rounded-2xl bg-zinc-900 border border-zinc-800 p-4 mt-1">
            <Field
              label={t("pen.name")}
              value={name}
              onChangeText={setName}
              placeholder={t("pen.namePlaceholder")}
            />
            <Text className="text-sm font-medium text-zinc-300 mb-1.5">{t("pen.type")}</Text>
            <Segmented
              options={[
                { value: "basal", label: t("pen.basal") },
                { value: "bolus", label: t("pen.bolus") },
              ]}
              value={type}
              onChange={setType}
              className="mb-3"
            />
            <Field
              label={t("pen.totalUnits")}
              value={total}
              onChangeText={(s) => setTotal(s.replace(/[^0-9.,]/g, ""))}
              keyboardType="decimal-pad"
              placeholder="300"
            />
            <View className="flex-row gap-3 mt-1">
              <Pressable
                onPress={() => {
                  setAdding(false);
                  setName("");
                  setTotal("");
                }}
                className="flex-1 rounded-2xl bg-zinc-800 active:bg-zinc-700 py-3.5 items-center"
              >
                <Text className="text-zinc-100 font-semibold">{t("common.cancel")}</Text>
              </Pressable>
              <View className="flex-1">
                <Button
                  label={t("common.save")}
                  loading={saving}
                  disabled={!canSave}
                  onPress={onAdd}
                />
              </View>
            </View>
          </View>
        ) : (
          <Pressable
            onPress={() => setAdding(true)}
            className="flex-row items-center justify-center rounded-2xl border border-dashed border-zinc-700 py-4 mt-1 active:bg-zinc-900"
          >
            <Ionicons name="add-circle-outline" size={18} color="#22d3ee" />
            <Text className="text-brand font-semibold ml-2">{t("pen.add")}</Text>
          </Pressable>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
