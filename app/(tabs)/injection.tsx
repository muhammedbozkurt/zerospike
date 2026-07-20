import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { useApp } from "../../lib/store/AppContext";
import { ProfileSwitcher } from "../../components/ProfileSwitcher";
import { InjectionEditSheet } from "../../components/InjectionEditSheet";
import { useFeedback } from "../../components/Feedback";
import { keyboardAwareScrollProps } from "../../lib/keyboard";
import { Button } from "../../components/ui";
import { TagPicker } from "../../components/TagPicker";
import { InjectionBodyMap } from "../../components/InjectionBodyMap";
import type { InjectionSite, Injection, InsulinType, LogTag } from "../../lib/db/types";
import {
  getSiteUsageHistory,
  recommendNextSite,
  getInjections,
  logInjection,
  deleteInjection,
  type SiteUsage,
} from "../../lib/db/injections";
import { logEvent } from "../../lib/analytics";
import { noteLogAndMaybeReview } from "../../lib/services/review";
import { relativeDay, formatTime, num } from "../../lib/format";
import { hapticSuccess, hapticWarning, hapticSelect } from "../../lib/haptics";

// Heat-map / rotation usage window (days). The prompt's "last 30 days" heat map.
const USAGE_WINDOW_DAYS = 30;

export default function InjectionScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { activeProfile, isProUser, dataVersion, bumpData } = useApp();
  const { toast, confirm, actionSheet } = useFeedback();

  const [usage, setUsage] = useState<SiteUsage[]>([]);
  const [recommended, setRecommended] = useState<InjectionSite | null>(null);
  const [history, setHistory] = useState<Injection[]>([]);

  const [selectedSite, setSelectedSite] = useState<InjectionSite | null>(null);
  const [dose, setDose] = useState("");
  const [insulinType, setInsulinType] = useState<InsulinType>("bolus");
  const [note, setNote] = useState("");
  const [tags, setTags] = useState<LogTag[]>([]);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Injection | null>(null);

  // Seed the type picker once from the most recent injection (last-used default).
  const typeSeeded = useRef(false);

  const dateLabels = { today: t("common.today"), yesterday: t("common.yesterday") };

  const load = useCallback(async () => {
    if (!activeProfile) return;
    const [u, rec, hist] = await Promise.all([
      getSiteUsageHistory(activeProfile.id, USAGE_WINDOW_DAYS),
      recommendNextSite(activeProfile.id),
      getInjections(activeProfile.id, 100),
    ]);
    setUsage(u);
    setRecommended(rec);
    setHistory(hist);
    if (!typeSeeded.current && hist[0]?.insulin_type) {
      setInsulinType(hist[0].insulin_type);
      typeSeeded.current = true;
    }
  }, [activeProfile]);

  useEffect(() => {
    load();
  }, [load, dataVersion]);

  async function save() {
    if (!activeProfile || !selectedSite || saving) return;
    setSaving(true);
    try {
      const doseNum = parseFloat(dose.replace(",", "."));
      await logInjection({
        profile_id: activeProfile.id,
        site: selectedSite,
        dose_units: Number.isFinite(doseNum) && doseNum > 0 ? doseNum : null,
        insulin_type: insulinType,
        note: note.trim() || null,
        tags,
      });
      logEvent("log_added", { kind: "insulin", source: "manual" });
      void noteLogAndMaybeReview();
      hapticSuccess();
      toast(t("injection.saved"), "success");
      setSelectedSite(null);
      setDose("");
      setNote("");
      setTags([]);
      bumpData();
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(id: string) {
    const ok = await confirm({
      message: t("injection.deleteEntry"),
      confirmLabel: t("common.delete"),
      destructive: true,
    });
    if (!ok) return;
    hapticWarning();
    await deleteInjection(id);
    bumpData();
  }

  // Long press = edit/delete menu (the built-in cancel row closes it).
  function onRowLongPress(inj: Injection) {
    actionSheet({
      actions: [
        {
          label: t("common.edit"),
          icon: "create-outline",
          onPress: () => setEditing(inj),
        },
        {
          label: t("common.delete"),
          icon: "trash-outline",
          destructive: true,
          onPress: () => {
            void onDelete(inj.id);
          },
        },
      ],
    });
  }

  return (
    <View className="flex-1 bg-black" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center justify-between px-4 pt-2 pb-3">
        <Text className="text-zinc-50 text-2xl font-bold">{t("injection.title")}</Text>
        <ProfileSwitcher />
      </View>

      <ScrollView
        {...keyboardAwareScrollProps}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Rotation card (Pro) */}
        {isProUser ? (
          <View className="rounded-2xl bg-zinc-900 border border-zinc-800 p-4 mb-4">
            <View className="flex-row items-center mb-2">
              <Ionicons name="sync-outline" size={18} color="#22d3ee" />
              <Text className="text-zinc-300 font-semibold ml-2">
                {t("injection.rotationTitle")}
              </Text>
            </View>
            <Text className="text-zinc-500 text-xs">{t("injection.recommendedSite")}</Text>
            <Text className="text-zinc-50 text-xl font-bold mt-0.5">
              {recommended ? t(`injectionSite.${recommended}`) : "-"}
            </Text>
            <Text className="text-amber-200/70 text-[11px] leading-4 mt-2">
              {t("injection.rotationDisclaimer")}
            </Text>
            {recommended ? (
              <Pressable
                onPress={() => {
                  hapticSelect();
                  setSelectedSite(recommended);
                }}
                className="flex-row items-center justify-center rounded-xl bg-brand/15 active:bg-brand/25 py-2.5 mt-3"
              >
                <Ionicons name="arrow-down-outline" size={16} color="#22d3ee" />
                <Text className="text-brand font-semibold ml-2 text-sm">
                  {t("injection.useThisSite")}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <Pressable
            onPress={() => {
              hapticWarning();
              router.push({ pathname: "/paywall", params: { reason: "rotation" } });
            }}
            className="rounded-2xl bg-zinc-900 border border-zinc-800 p-4 mb-4 flex-row items-center active:bg-zinc-800"
          >
            <View className="w-10 h-10 rounded-full bg-zinc-800 items-center justify-center mr-3">
              <Ionicons name="lock-closed" size={18} color="#71717a" />
            </View>
            <View className="flex-1">
              <Text className="text-zinc-200 font-semibold">
                {t("injection.rotationTitle")}
              </Text>
              <Text className="text-zinc-500 text-xs mt-0.5">
                {t("paywall.limitTitleRotation")}
              </Text>
            </View>
            <View className="rounded-full bg-brand px-2 py-0.5">
              <Text className="text-black text-[10px] font-bold">{t("common.pro")}</Text>
            </View>
          </Pressable>
        )}

        {/* Site heat map (tap a region to select it for the log) */}
        <Text className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
          {t("injection.selectSite")}
        </Text>
        <View className="mb-4">
          <InjectionBodyMap
            usage={usage}
            selected={selectedSite}
            onSelect={setSelectedSite}
            windowDays={USAGE_WINDOW_DAYS}
          />
        </View>

        {/* Log form */}
        <View className="rounded-2xl bg-zinc-900 border border-zinc-800 p-4 mt-1 mb-4">
          {/* Dose (optional) */}
          <Text className="text-sm font-medium text-zinc-400 mb-1.5">
            {t("injection.dose")}
          </Text>
          <View className="flex-row items-center mb-4">
            <TextInput
              value={dose}
              onChangeText={(s) =>
                setDose(s.replace(/[^0-9.,]/g, "").replace(/(\..*)\./g, "$1"))
              }
              keyboardType="decimal-pad"
              placeholder="-"
              placeholderTextColor="#52525b"
              maxLength={5}
              className="flex-1 rounded-xl bg-zinc-800/80 border border-zinc-700 px-4 py-3 text-zinc-50"
            />
            <Text className="text-zinc-500 ml-2">{t("common.units")}</Text>
          </View>

          {/* Insulin type */}
          <Text className="text-sm font-medium text-zinc-400 mb-1.5">
            {t("injection.insulinType")}
          </Text>
          <View className="flex-row gap-2 mb-4">
            {(["basal", "bolus"] as const).map((type) => (
              <Pressable
                key={type}
                onPress={() => {
                  hapticSelect();
                  setInsulinType(type);
                }}
                className={`flex-1 rounded-xl border px-3 py-2.5 items-center ${
                  insulinType === type
                    ? "border-brand bg-brand/10"
                    : "border-zinc-700 bg-zinc-800/60"
                }`}
              >
                <Text
                  className={
                    insulinType === type ? "text-brand font-medium" : "text-zinc-300"
                  }
                >
                  {type === "basal" ? t("injection.typeBasal") : t("injection.typeBolus")}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Note */}
          <Text className="text-sm font-medium text-zinc-400 mb-1.5">{t("common.note")}</Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder={t("injection.notePlaceholder")}
            placeholderTextColor="#52525b"
            className="rounded-xl bg-zinc-800/80 border border-zinc-700 px-4 py-3 text-zinc-50 mb-4"
          />

          <TagPicker value={tags} onChange={setTags} className="mb-4" />

          <Button
            label={t("injection.logInjection")}
            size="lg"
            loading={saving}
            disabled={!selectedSite}
            onPress={save}
          />
        </View>

        {/* History */}
        <Text className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
          {t("injection.history")}
        </Text>
        {history.length === 0 ? (
          <View className="items-center py-8">
            <Ionicons name="document-text-outline" size={36} color="#3f3f46" />
            <Text className="text-zinc-600 text-center mt-2">{t("injection.empty")}</Text>
          </View>
        ) : (
          history.map((inj) => (
            <Pressable
              key={inj.id}
              onPress={() => setEditing(inj)}
              onLongPress={() => onRowLongPress(inj)}
              className="rounded-2xl bg-zinc-900 border border-zinc-800 p-3.5 mb-2 flex-row items-center active:bg-zinc-800"
            >
              <View className="w-9 h-9 rounded-full bg-brand/10 items-center justify-center mr-3">
                <Ionicons name="medkit-outline" size={16} color="#22d3ee" />
              </View>
              <View className="flex-1">
                <Text className="text-zinc-100 font-semibold">
                  {t(`injectionSite.${inj.site}`)}
                </Text>
                <Text className="text-zinc-500 text-xs mt-0.5">
                  {relativeDay(inj.logged_at, dateLabels)} · {formatTime(inj.logged_at)}
                  {inj.insulin_type
                    ? ` · ${
                        inj.insulin_type === "basal"
                          ? t("injection.typeBasal")
                          : t("injection.typeBolus")
                      }`
                    : ""}
                </Text>
              </View>
              {inj.dose_units != null ? (
                <Text className="text-zinc-300 font-semibold ml-2">
                  {num(inj.dose_units)} {t("common.units")}
                </Text>
              ) : null}
            </Pressable>
          ))
        )}

        {/* Bottom links */}
        <View className="mt-4 gap-2">
          <Pressable
            onPress={() => router.push("/injection-guide")}
            className="rounded-2xl bg-zinc-900 border border-zinc-800 p-4 flex-row items-center active:bg-zinc-800"
          >
            <View className="w-10 h-10 rounded-full bg-brand/10 items-center justify-center mr-3">
              <Ionicons name="medkit-outline" size={20} color="#22d3ee" />
            </View>
            <Text className="text-zinc-100 font-semibold flex-1">
              {t("injection.guideLink")}
            </Text>
            <Ionicons name="chevron-forward" size={18} color="#52525b" />
          </Pressable>
        </View>

        {/* Medical disclaimer - logged doses are the user's own records, not advice */}
        <View className="flex-row items-start rounded-xl border border-amber-500/25 bg-amber-500/10 px-3.5 py-3 mt-5">
          <Ionicons name="medical-outline" size={15} color="#f59e0b" />
          <Text className="text-amber-200/80 text-xs leading-4 ml-2.5 flex-1">
            {t("disclaimer.short")}
          </Text>
        </View>
      </ScrollView>

      <InjectionEditSheet
        visible={editing != null}
        injection={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          bumpData();
        }}
      />
    </View>
  );
}
