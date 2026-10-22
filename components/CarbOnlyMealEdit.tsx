import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useApp } from "../lib/store/AppContext";
import { deleteMealLog, getMealLog, updateMealLog } from "../lib/db/logs";
import { captureDeletion, restoreDeletion } from "../lib/db/undo";
import { applyAfterDeleteFromSnapshot, undoAfterDelete } from "../lib/afterDelete";
import { logCrash, logEvent } from "../lib/analytics";
import { parseDecimalText, sanitizeNumberText } from "../lib/numberInput";
import { carbOnlyPatch, parseCarbGrams } from "../lib/mealRoute";
import { formatTime, relativeDay } from "../lib/format";
import { hapticSuccess } from "../lib/haptics";
import { keyboardAwareScrollProps } from "../lib/keyboard";
import { AppBackground, GlassCard, GradientCTA, IconTile, withAlpha } from "./rich";
import { GLUCOSE_RICH, INPUT_TEXT, MODAL_TOP_PAD, RADIUS, TABULAR, THEME } from "../lib/theme/tokens";
import { FeedbackHost, useFeedback } from "./Feedback";
import { InlineDateTimePicker } from "./InlineDateTimePicker";
import { upper } from "../lib/upper";

const fieldStyleOf = () => ({
  borderRadius: RADIUS.md,
  borderWidth: 1,
  borderColor: THEME.border,
  backgroundColor: THEME.surface,
  paddingHorizontal: 14,
  paddingVertical: 12,
  color: THEME.text,
} as const);

function Label({ children }: { children: string }) {
  return (
    <Text
      style={{ color: THEME.textMuted, fontSize: 11, letterSpacing: 1.3, fontWeight: "800", marginBottom: 6 }}
    >
      {upper(children)}
    </Text>
  );
}

/**
 * Editor for a meal that came from a carb estimate (lib/mealRoute.ts): name,
 * carbs, time and note only. No weight, no dose arithmetic, no injection.
 */
export function CarbOnlyMealEdit({ mealLogId }: { mealLogId: string }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { lang, bumpData } = useApp();
  const { confirm, toast } = useFeedback();

  const [ready, setReady] = useState(false);
  const [name, setName] = useState("");
  const [carbsText, setCarbsText] = useState("");
  const [note, setNote] = useState("");
  const [loggedAt, setLoggedAt] = useState<Date>(new Date());
  const [timeOpen, setTimeOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [prefillIso, setPrefillIso] = useState<string | null>(null);

  function failLoad() {
    toast(t("common.saveFailed"), "error");
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/food");
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const log = await getMealLog(mealLogId);
        if (!alive) return;
        if (!log) {
          failLoad();
          return;
        }
        setName(log.custom_food_name ?? "");
        setCarbsText(String(Math.round(log.calculated_carbs_g * 10) / 10));
        setNote(log.personal_note ?? "");
        setLoggedAt(new Date(log.logged_at));
        setPrefillIso(new Date(log.logged_at).toISOString());
        setReady(true);
      } catch (err) {
        logCrash(err, { screen: "carbOnlyMeal", step: "load" });
        if (alive) failLoad();
      }
    })();
    return () => {
      alive = false;
    };
  }, [mealLogId]);

  const carbs = parseCarbGrams(parseDecimalText(carbsText));
  const canSave = ready && !saving && carbs != null && name.trim() !== "";

  function dismiss() {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/food");
  }

  async function handleClose() {
    if (dirty) {
      const proceed = await confirm({
        title: t("calculator.discardTitle"),
        message: t("calculator.discardBody"),
        confirmLabel: t("calculator.discardConfirm"),
        destructive: true,
        icon: "close-circle-outline",
      });
      if (!proceed) return;
    }
    dismiss();
  }

  async function save() {
    if (!canSave || carbs == null) return;
    setSaving(true);
    try {
      const iso = loggedAt.toISOString();
      await updateMealLog(
        mealLogId,
        carbOnlyPatch({
          carbs,
          name,
          note,
          loggedAtIso: iso !== prefillIso ? iso : null,
        })
      );
      logEvent("log_edited", { kind: "meal" });
      hapticSuccess();
      bumpData();
      dismiss();
    } catch (err) {
      logCrash(err, { screen: "carbOnlyMeal", step: "save" });
      toast(t("calculator.saveFailed"), "error");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (saving) return;
    const ok = await confirm({
      message: t("journal.deleteEntry"),
      confirmLabel: t("common.delete"),
      cancelLabel: t("common.cancel"),
      destructive: true,
      icon: "trash-outline",
    });
    if (!ok) return;
    setSaving(true);
    try {
      const snapshot = await captureDeletion("meal", mealLogId);
      await deleteMealLog(mealLogId);
      const aftermath = await applyAfterDeleteFromSnapshot(snapshot);
      bumpData();
      toast(t("journal.deleted"), "success", {
        label: t("common.undo"),
        onPress: () => {
          void (async () => {
            await restoreDeletion(snapshot);
            await undoAfterDelete(aftermath);
            bumpData();
            toast(t("calculator.undone"), "info");
          })();
        },
      });
      dismiss();
    } catch (err) {
      logCrash(err, { screen: "carbOnlyMeal", step: "delete" });
      toast(t("calculator.saveFailed"), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppBackground>
      <View className="flex-1" style={{ paddingTop: Math.max(insets.top, MODAL_TOP_PAD) }}>
        <View className="flex-row items-center justify-between px-4 py-3">
          <Pressable
            onPress={handleClose}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t("common.close")}
          >
            <IconTile icon="close" size={30} radius={10} tint={THEME.textMuted} />
          </Pressable>
          <Text style={{ color: THEME.text, fontSize: 16, fontWeight: "800" }} numberOfLines={1}>
            {t("calculator.editTitle")}
          </Text>
          <View style={{ width: 30 }} />
        </View>

        <ScrollView
          {...keyboardAwareScrollProps}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 28 }}
          showsVerticalScrollIndicator={false}
        >
          <GlassCard style={{ marginBottom: 12 }}>
            <Label>{t("calculator.carbOnlyName")}</Label>
            <TextInput
              value={name}
              onChangeText={(s) => {
                setName(s);
                setDirty(true);
              }}
              maxLength={120}
              style={[fieldStyleOf(), INPUT_TEXT, { marginBottom: 14 }]}
              accessibilityLabel={t("calculator.carbOnlyName")}
            />
            <Label>{t("calculator.carbOnlyCarbs")}</Label>
            <TextInput
              value={carbsText}
              onChangeText={(s) => {
                setCarbsText(sanitizeNumberText(s, true));
                setDirty(true);
              }}
              keyboardType="decimal-pad"
              maxLength={6}
              style={[fieldStyleOf(), INPUT_TEXT, TABULAR]}
              accessibilityLabel={t("calculator.carbOnlyCarbs")}
            />
          </GlassCard>

          <Label>{t("calculator.loggedTime")}</Label>
          <Pressable
            onPress={() => setTimeOpen((v) => !v)}
            accessibilityRole="button"
            className="flex-row items-center mb-4"
            style={fieldStyleOf()}
          >
            <Ionicons name="time-outline" size={16} color={THEME.textMuted} />
            <Text style={{ color: THEME.text, marginLeft: 8, fontSize: 13 }}>
              {relativeDay(loggedAt.toISOString(), {
                today: t("common.today"),
                yesterday: t("common.yesterday"),
              })}
              {" · "}
              {formatTime(loggedAt.toISOString())}
            </Text>
          </Pressable>
          <InlineDateTimePicker
            visible={timeOpen}
            value={loggedAt}
            max={new Date()}
            locale={lang}
            onChange={(d) => {
              setLoggedAt(d);
              setDirty(true);
            }}
            onClose={() => setTimeOpen(false)}
          />

          <Label>{t("calculator.personalNote")}</Label>
          <TextInput
            value={note}
            onChangeText={(s) => {
              setNote(s);
              setDirty(true);
            }}
            placeholder={t("calculator.notePlaceholder")}
            placeholderTextColor={withAlpha(THEME.textMuted, 0.7)}
            multiline
            style={[fieldStyleOf(), INPUT_TEXT, { marginBottom: 12, minHeight: 72 }]}
            textAlignVertical="top"
          />

          <Text style={{ color: THEME.textMuted, fontSize: 12, lineHeight: 17, marginBottom: 16 }}>
            {t("carbEstimate.note")}
          </Text>

          <GradientCTA label={t("calculator.saveChanges")} disabled={!canSave} onPress={save} />

          <Pressable
            onPress={remove}
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
            <Text style={{ color: GLUCOSE_RICH.low, fontSize: 13, fontWeight: "700", marginLeft: 6 }}>
              {t("common.delete")}
            </Text>
          </Pressable>
        </ScrollView>
      </View>
      <FeedbackHost />
    </AppBackground>
  );
}
