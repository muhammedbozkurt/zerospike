import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { useApp } from "../../lib/store/AppContext";
import { ProfileSwitcher } from "../../components/ProfileSwitcher";
import { InjectionEditSheet } from "../../components/InjectionEditSheet";
import { useFeedback } from "../../components/Feedback";
import { keyboardAwareScrollProps } from "../../lib/keyboard";
import { TagPicker } from "../../components/TagPicker";
import {
  InjectionBodyMap,
  type PointSelection,
} from "../../components/InjectionBodyMap";
import {
  AppBackground,
  GlassCard,
  GradientCTA,
  IconTile,
} from "../../components/rich";
import type { Injection, InsulinType, LogTag } from "../../lib/db/types";
import {
  getSiteUsageHistory,
  leastRecentlyUsedPoint,
  getInjections,
  logInjection,
  deleteInjection,
  type SiteUsage,
} from "../../lib/db/injections";
import { checkDose } from "../../lib/insulin";
import { logEvent } from "../../lib/analytics";
import { noteLogAndMaybeReview } from "../../lib/services/review";
import { relativeDay, formatTime, num } from "../../lib/format";
import { hapticSuccess, hapticWarning, hapticSelect } from "../../lib/haptics";
import { GLUCOSE_RICH, RADIUS, TABULAR, THEME, glow } from "../../lib/theme/tokens";
import { withAlpha } from "../../components/rich/GlassCard";

// Heat-map / rotation usage window (days). The prompt's "last 30 days" heat map.
const USAGE_WINDOW_DAYS = 30;

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

export default function InjectionScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { activeProfile, isProUser, dataVersion, bumpData } = useApp();
  const { toast, confirm, actionSheet } = useFeedback();

  const [usage, setUsage] = useState<SiteUsage[]>([]);
  const [leastUsed, setLeastUsed] = useState<PointSelection | null>(null);
  const [history, setHistory] = useState<Injection[]>([]);

  const [selected, setSelected] = useState<PointSelection | null>(null);
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
    const [u, least, hist] = await Promise.all([
      getSiteUsageHistory(activeProfile.id, USAGE_WINDOW_DAYS),
      leastRecentlyUsedPoint(activeProfile.id),
      getInjections(activeProfile.id, 100),
    ]);
    setUsage(u);
    setLeastUsed(least);
    setHistory(hist);
    if (!typeSeeded.current && hist[0]?.insulin_type) {
      setInsulinType(hist[0].insulin_type);
      typeSeeded.current = true;
    }
  }, [activeProfile]);

  useEffect(() => {
    load();
  }, [load, dataVersion]);

  /**
   * SAFETY: a typed dose only had to be "> 0" before, so a stray digit (60
   * instead of 6) was stored without a word. The calculator has flagged unusual
   * estimates at 25 units for a long time; the same threshold now applies to a
   * hand-entered dose. Nothing is ever refused - refusing would lose the record
   * of a legitimate outlier - it just has to be confirmed, and a value above the
   * plausible ceiling takes a second confirmation.
   */
  async function confirmDose(units: number): Promise<boolean> {
    const check = checkDose(units);
    if (check === "ok") return true;

    const first = await confirm({
      title: t("injection.doseCheckTitle", { n: num(units) }),
      message: t("injection.doseCheckBody"),
      confirmLabel: t("injection.doseCheckConfirm"),
      icon: "help-circle-outline",
    });
    if (!first) return false;
    if (check === "high") return true;

    return confirm({
      title: t("injection.doseCheckTitle", { n: num(units) }),
      message: t("injection.doseImplausibleBody"),
      confirmLabel: t("injection.doseCheckConfirm"),
      icon: "help-circle-outline",
    });
  }

  async function save() {
    if (!activeProfile || !selected || saving) return;
    const doseNum = parseFloat(dose.replace(",", "."));
    const hasDose = Number.isFinite(doseNum) && doseNum > 0;
    if (hasDose && !(await confirmDose(doseNum))) return;

    setSaving(true);
    try {
      await logInjection({
        profile_id: activeProfile.id,
        site: selected.site,
        site_point: selected.point,
        dose_units: hasDose ? doseNum : null,
        insulin_type: insulinType,
        note: note.trim() || null,
        tags,
      });
      logEvent("log_added", { kind: "insulin", source: "manual" });
      void noteLogAndMaybeReview();
      hapticSuccess();
      toast(t("injection.saved"), "success");
      setSelected(null);
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

  const selectedLabel = selected
    ? t("injection.siteWithPoint", {
        site: t(`injectionSite.${selected.site}`),
        n: selected.point,
      })
    : null;

  return (
    <AppBackground style={{ paddingTop: insets.top }}>
      {/* Header (mockup B03: screen title left, actions right) */}
      <View className="flex-row items-center justify-between px-4 pt-2 pb-3">
        <Text style={{ color: THEME.ink, fontSize: 24, fontWeight: "800" }}>
          {t("injection.title")}
        </Text>
        <View className="flex-row items-center" style={{ gap: 10 }}>
          <Pressable
            onPress={() => router.push("/injection-guide")}
            hitSlop={8}
            accessibilityLabel={t("injection.guideLink")}
          >
            <IconTile icon="help-circle" size={32} radius={10} />
          </Pressable>
          <ProfileSwitcher />
        </View>
      </View>

      <ScrollView
        {...keyboardAwareScrollProps}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero: the point-level usage map */}
        <View className="mb-4">
          <InjectionBodyMap
            usage={usage}
            selected={selected}
            onSelect={setSelected}
            windowDays={USAGE_WINDOW_DAYS}
          />
        </View>

        {/* Rotation card (Pro) - point-level, same neutral framing as before */}
        {isProUser ? (
          <GlassCard style={{ marginBottom: 16 }}>
            <View className="flex-row items-center mb-2">
              <Ionicons name="sync-outline" size={16} color={THEME.accent} />
              <Text style={{ color: THEME.ink, fontWeight: "700", marginLeft: 8 }}>
                {t("injection.rotationTitle")}
              </Text>
            </View>
            <Text style={{ color: THEME.muted, fontSize: 11 }}>
              {t("injection.leastUsedPoint")}
            </Text>
            <Text style={{ color: THEME.ink, fontSize: 18, fontWeight: "800", marginTop: 2 }}>
              {leastUsed
                ? t("injection.siteWithPoint", {
                    site: t(`injectionSite.${leastUsed.site}`),
                    n: leastUsed.point,
                  })
                : "-"}
            </Text>
            <Text style={{ color: THEME.muted, fontSize: 11, lineHeight: 16, marginTop: 8 }}>
              {t("injection.rotationDisclaimer")}
            </Text>
            {leastUsed ? (
              <Pressable
                onPress={() => {
                  hapticSelect();
                  setSelected(leastUsed);
                }}
                className="flex-row items-center justify-center rounded-xl py-2.5 mt-3"
                style={{ backgroundColor: withAlpha(THEME.accent, 0.15) }}
              >
                <Ionicons name="arrow-down-outline" size={16} color={THEME.accent} />
                <Text style={{ color: THEME.accent, fontWeight: "700", marginLeft: 8, fontSize: 13 }}>
                  {t("injection.useThisSite")}
                </Text>
              </Pressable>
            ) : null}
          </GlassCard>
        ) : (
          <Pressable
            onPress={() => {
              hapticWarning();
              router.push({ pathname: "/paywall", params: { reason: "rotation" } });
            }}
            className="rounded-2xl bg-glass border border-hair p-4 mb-4 flex-row items-center active:opacity-80"
          >
            <IconTile icon="lock-closed" size={36} radius={12} tint={THEME.muted} style={{ marginRight: 12 }} />
            <View className="flex-1">
              <Text style={{ color: THEME.ink, fontWeight: "700" }}>
                {t("injection.rotationTitle")}
              </Text>
              <Text style={{ color: THEME.muted, fontSize: 11, marginTop: 2 }}>
                {t("paywall.limitTitleRotation")}
              </Text>
            </View>
            <View className="rounded-full bg-brand px-2 py-0.5">
              <Text className="text-black text-[10px] font-bold">{t("common.pro")}</Text>
            </View>
          </Pressable>
        )}

        {/* Log form, rebuilt on the glass/token language */}
        <GlassCard style={{ marginBottom: 16 }}>
          <Text
            style={{
              color: THEME.muted,
              fontSize: 9,
              letterSpacing: 1.3,
              textTransform: "uppercase",
              fontWeight: "800",
              marginBottom: 10,
            }}
          >
            {t("injection.formTitle")}
          </Text>

          {/* The chosen region + point, echoed so the chain is never ambiguous */}
          <View
            className="flex-row items-center rounded-xl px-3 py-2.5 mb-4"
            style={{
              borderWidth: 1,
              borderColor: selected ? withAlpha(THEME.accent, 0.4) : THEME.border,
              backgroundColor: selected ? withAlpha(THEME.accent, 0.1) : THEME.glass,
            }}
          >
            <Ionicons
              name="location-outline"
              size={15}
              color={selected ? THEME.accent : THEME.muted}
            />
            <Text
              style={{
                color: selected ? THEME.accent : THEME.muted,
                fontSize: 13,
                fontWeight: "700",
                marginLeft: 8,
                flex: 1,
              }}
            >
              {selectedLabel ?? t("injection.tapRegion")}
            </Text>
          </View>

          <FieldLabel>{t("injection.dose")}</FieldLabel>
          <View className="flex-row items-center mb-4">
            <TextInput
              value={dose}
              onChangeText={(s) =>
                setDose(s.replace(/[^0-9.,]/g, "").replace(/(\..*)\./g, "$1"))
              }
              keyboardType="decimal-pad"
              placeholder="-"
              placeholderTextColor="rgba(137,163,176,0.5)"
              maxLength={5}
              style={[inputStyle, { flex: 1 }]}
            />
            <Text style={{ color: THEME.muted, marginLeft: 8 }}>{t("common.units")}</Text>
          </View>

          <FieldLabel>{t("injection.insulinType")}</FieldLabel>
          <View className="flex-row mb-4" style={{ gap: 8 }}>
            {(["basal", "bolus"] as const).map((type) => {
              const on = insulinType === type;
              return (
                <Pressable
                  key={type}
                  onPress={() => {
                    hapticSelect();
                    setInsulinType(type);
                  }}
                  className="flex-1 items-center rounded-xl px-3 py-2.5"
                  style={[
                    {
                      borderWidth: 1,
                      borderColor: on ? THEME.accent : THEME.border,
                      backgroundColor: on ? withAlpha(THEME.accent, 0.12) : THEME.glass,
                    },
                    on ? glow(THEME.accent, 12, 0.35) : undefined,
                  ]}
                >
                  <Text
                    style={{
                      color: on ? THEME.accent : THEME.muted,
                      fontWeight: on ? "800" : "600",
                    }}
                  >
                    {type === "basal" ? t("injection.typeBasal") : t("injection.typeBolus")}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <FieldLabel>{t("common.note")}</FieldLabel>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder={t("injection.notePlaceholder")}
            placeholderTextColor="rgba(137,163,176,0.5)"
            style={[inputStyle, { marginBottom: 16 }]}
          />

          <TagPicker value={tags} onChange={setTags} className="mb-4" />

          <GradientCTA
            label={t("injection.logInjection")}
            disabled={!selected || saving}
            onPress={save}
          />
        </GlassCard>

        {/* History as the mockup's colour-coded rows */}
        <Text className="text-xs font-semibold uppercase tracking-wider text-mut mb-2">
          {t("injection.history")}
        </Text>
        {history.length === 0 ? (
          <View className="items-center py-8">
            <Ionicons name="document-text-outline" size={36} color={THEME.muted} />
            <Text style={{ color: THEME.muted, textAlign: "center", marginTop: 8 }}>
              {t("injection.empty")}
            </Text>
          </View>
        ) : (
          history.map((inj) => (
            <Pressable
              key={inj.id}
              onPress={() => setEditing(inj)}
              onLongPress={() => onRowLongPress(inj)}
              className="flex-row items-center rounded-xl bg-glass border border-hair px-3 py-2.5 mb-2 active:opacity-80"
            >
              <View
                className="rounded-lg px-2 py-1"
                style={[
                  { backgroundColor: withAlpha(THEME.accent, 0.16) },
                  glow(THEME.accent, 10, 0.35),
                ]}
              >
                <Text style={[TABULAR, { color: THEME.accent, fontWeight: "800", fontSize: 11 }]}>
                  {inj.dose_units != null
                    ? `${num(inj.dose_units)}${t("common.units").slice(0, 1)}`
                    : "-"}
                </Text>
              </View>
              <View className="flex-1 ml-3">
                <Text style={{ color: THEME.ink, fontSize: 13, fontWeight: "700" }} numberOfLines={1}>
                  {inj.insulin_type
                    ? `${inj.insulin_type === "basal" ? t("injection.typeBasal") : t("injection.typeBolus")} · `
                    : ""}
                  {inj.site_point != null
                    ? t("injection.siteWithPoint", {
                        site: t(`injectionSite.${inj.site}`),
                        n: inj.site_point,
                      })
                    : t(`injectionSite.${inj.site}`)}
                </Text>
                <Text style={{ color: THEME.muted, fontSize: 11, marginTop: 1 }}>
                  {relativeDay(inj.logged_at, dateLabels)} · {formatTime(inj.logged_at)}
                  {inj.source === "calculator" ? ` · ${t("injection.fromCalculator")}` : ""}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={THEME.muted} />
            </Pressable>
          ))
        )}

        {/* Medical disclaimer - logged doses are the user's own records, not advice */}
        <View
          className="flex-row items-start rounded-xl px-3.5 py-3 mt-5"
          style={{
            borderWidth: 1,
            borderColor: withAlpha(GLUCOSE_RICH.high, 0.3),
            backgroundColor: withAlpha(GLUCOSE_RICH.high, 0.1),
          }}
        >
          <Ionicons name="medical-outline" size={15} color={GLUCOSE_RICH.high} />
          <Text style={{ color: THEME.ink, fontSize: 12, lineHeight: 17, marginLeft: 10, flex: 1, opacity: 0.85 }}>
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
    </AppBackground>
  );
}
