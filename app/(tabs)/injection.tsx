import React, { useCallback, useEffect, useMemo, useState } from "react";
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
import { useFeedback } from "../../components/Feedback";
import { Button } from "../../components/ui";
import { TagPicker } from "../../components/TagPicker";
import { INJECTION_SITES } from "../../lib/db/types";
import type { InjectionSite, Injection, InsulinPen, LogTag } from "../../lib/db/types";
import {
  getSiteUsageHistory,
  recommendNextSite,
  getInjections,
  logInjection,
  deleteInjection,
  listPens,
  getPen,
  type SiteUsage,
} from "../../lib/db/injections";
import { maybeNotifyPenLow } from "../../lib/services/notifications";
import { relativeDay, formatTime, num } from "../../lib/format";
import { hapticSuccess, hapticWarning, hapticSelect } from "../../lib/haptics";

const LOW_PEN_THRESHOLD = 20;
const USAGE_WINDOW_DAYS = 90;

/** Whole days between an ISO date and today, or null if no date. */
function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const startOf = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  return Math.round((startOf(new Date()) - startOf(new Date(iso))) / 86_400_000);
}

/** Visual-only rotation heat: recently used → warm, long-rested → cool. */
function heatBorder(days: number | null, selected: boolean): string {
  if (selected) return "border-brand bg-brand/10";
  if (days == null) return "border-zinc-800";
  if (days <= 2) return "border-rose-500/40";
  if (days >= 7) return "border-emerald-500/30";
  return "border-zinc-700";
}

export default function InjectionScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { activeProfile, isProUser, dataVersion, bumpData } = useApp();
  const { toast, confirm } = useFeedback();

  const [usage, setUsage] = useState<SiteUsage[]>([]);
  const [recommended, setRecommended] = useState<InjectionSite | null>(null);
  const [pens, setPens] = useState<InsulinPen[]>([]);
  const [history, setHistory] = useState<Injection[]>([]);

  const [selectedSite, setSelectedSite] = useState<InjectionSite | null>(null);
  const [dose, setDose] = useState("");
  const [selectedPenId, setSelectedPenId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [tags, setTags] = useState<LogTag[]>([]);
  const [saving, setSaving] = useState(false);

  const dateLabels = { today: t("common.today"), yesterday: t("common.yesterday") };

  const load = useCallback(async () => {
    if (!activeProfile) return;
    const [u, rec, penList, hist] = await Promise.all([
      getSiteUsageHistory(activeProfile.id, USAGE_WINDOW_DAYS),
      recommendNextSite(activeProfile.id),
      listPens(activeProfile.id),
      getInjections(activeProfile.id, 100),
    ]);
    setUsage(u);
    setRecommended(rec);
    setPens(penList);
    setHistory(hist);
  }, [activeProfile]);

  useEffect(() => {
    load();
  }, [load, dataVersion]);

  const usageBySite = useMemo(() => {
    const m = new Map<InjectionSite, SiteUsage>();
    usage.forEach((u) => m.set(u.site, u));
    return m;
  }, [usage]);

  const activePens = useMemo(() => pens.filter((p) => p.is_active === 1), [pens]);
  const lowPen = useMemo(
    () => activePens.some((p) => p.remaining_units < LOW_PEN_THRESHOLD),
    [activePens]
  );
  const penName = useCallback(
    (id: string | null) => (id ? pens.find((p) => p.id === id)?.name ?? null : null),
    [pens]
  );

  async function save() {
    if (!activeProfile || !selectedSite || saving) return;
    setSaving(true);
    try {
      const pen = selectedPenId
        ? activePens.find((p) => p.id === selectedPenId) ?? null
        : null;
      const doseNum = parseFloat(dose.replace(",", "."));
      await logInjection({
        profile_id: activeProfile.id,
        site: selectedSite,
        dose_units: Number.isFinite(doseNum) && doseNum > 0 ? doseNum : null,
        pen_id: pen ? pen.id : null,
        insulin_type: pen ? pen.insulin_type : null,
        note: note.trim() || null,
        tags,
      });
      hapticSuccess();
      toast(t("injection.saved"), "success");
      // After the pen's balance dropped, alert once if it just went low.
      if (pen) {
        const fresh = await getPen(pen.id);
        if (fresh) {
          await maybeNotifyPenLow({
            id: fresh.id,
            name: fresh.name,
            remaining_units: fresh.remaining_units,
          });
        }
      }
      setSelectedSite(null);
      setDose("");
      setSelectedPenId(null);
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

  return (
    <View className="flex-1 bg-black" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center justify-between px-4 pt-2 pb-3">
        <Text className="text-zinc-50 text-2xl font-bold">{t("injection.title")}</Text>
        <ProfileSwitcher />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Low-pen banner (any active pen under threshold) */}
        {lowPen ? (
          <View className="flex-row items-center rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 mb-4">
            <Ionicons name="warning-outline" size={16} color="#f59e0b" />
            <Text className="text-amber-200/90 text-sm ml-2.5 flex-1">
              {t("injection.lowPenBanner")}
            </Text>
          </View>
        ) : null}

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

        {/* Site picker grid (2 columns) */}
        <Text className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
          {t("injection.selectSite")}
        </Text>
        <View className="flex-row flex-wrap justify-between">
          {INJECTION_SITES.map((site) => {
            const u = usageBySite.get(site);
            const d = daysSince(u?.lastUsedAt ?? null);
            const selected = selectedSite === site;
            return (
              <Pressable
                key={site}
                onPress={() => {
                  hapticSelect();
                  setSelectedSite(site);
                }}
                className={`w-[48%] rounded-2xl border p-3.5 mb-3 active:opacity-80 ${heatBorder(
                  d,
                  selected
                )} ${selected ? "" : "bg-zinc-900"}`}
              >
                <View className="flex-row items-start justify-between">
                  <Text className="text-zinc-100 font-semibold flex-1 pr-1" numberOfLines={2}>
                    {t(`injectionSite.${site}`)}
                  </Text>
                  {u && u.count > 0 ? (
                    <View className="rounded-full bg-zinc-800 px-1.5 py-0.5 ml-1">
                      <Text className="text-zinc-400 text-[10px] font-semibold">
                        {u.count}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Text className="text-zinc-500 text-[11px] mt-1.5">
                  {u?.lastUsedAt
                    ? `${t("injection.lastUsed")} · ${relativeDay(u.lastUsedAt, dateLabels)}`
                    : t("injection.neverUsed")}
                </Text>
              </Pressable>
            );
          })}
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

          {/* Pen picker */}
          <Text className="text-sm font-medium text-zinc-400 mb-1.5">
            {t("injection.selectPen")}
          </Text>
          <View className="flex-row flex-wrap gap-2 mb-4">
            <Pressable
              onPress={() => {
                hapticSelect();
                setSelectedPenId(null);
              }}
              className={`rounded-xl border px-3 py-2 ${
                selectedPenId === null
                  ? "border-brand bg-brand/10"
                  : "border-zinc-700 bg-zinc-800/60"
              }`}
            >
              <Text
                className={selectedPenId === null ? "text-brand font-medium" : "text-zinc-300"}
              >
                {t("injection.noPen")}
              </Text>
            </Pressable>
            {activePens.map((p) => (
              <Pressable
                key={p.id}
                onPress={() => {
                  hapticSelect();
                  setSelectedPenId(p.id);
                }}
                className={`rounded-xl border px-3 py-2 ${
                  selectedPenId === p.id
                    ? "border-brand bg-brand/10"
                    : "border-zinc-700 bg-zinc-800/60"
                }`}
              >
                <Text
                  className={selectedPenId === p.id ? "text-brand font-medium" : "text-zinc-300"}
                >
                  {p.name}
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
              onLongPress={() => onDelete(inj.id)}
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
                  {penName(inj.pen_id) ? ` · ${penName(inj.pen_id)}` : ""}
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
            onPress={() => router.push("/pens")}
            className="rounded-2xl bg-zinc-900 border border-zinc-800 p-4 flex-row items-center active:bg-zinc-800"
          >
            <View className="w-10 h-10 rounded-full bg-brand/10 items-center justify-center mr-3">
              <Ionicons name="albums-outline" size={20} color="#22d3ee" />
            </View>
            <Text className="text-zinc-100 font-semibold flex-1">{t("pen.title")}</Text>
            <Ionicons name="chevron-forward" size={18} color="#52525b" />
          </Pressable>
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

        {/* Medical disclaimer — logged doses are the user's own records, not advice */}
        <View className="flex-row items-start rounded-xl border border-amber-500/25 bg-amber-500/10 px-3.5 py-3 mt-5">
          <Ionicons name="medical-outline" size={15} color="#f59e0b" />
          <Text className="text-amber-200/80 text-xs leading-4 ml-2.5 flex-1">
            {t("disclaimer.short")}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
