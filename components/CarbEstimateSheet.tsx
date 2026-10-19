import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  BackHandler,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import {
  CARB_TEXT_MAX,
  canAddEstimate,
  carbErrorCode,
  editableFromEstimate,
  editableTotal,
  enterGuard,
  estimateCarbs,
  itemCountBucket,
  prepareMealText,
  screenshotCarbSample,
  shouldCountEstimate,
  carbErrorCharged,
  type EditableItem,
} from "../lib/ai/carbEstimateClient";
import {
  getCarbUsage,
  markCarbExhausted,
  noteCarbEstimate,
} from "../lib/ai/carbEstimateLimit";
import { logEvent } from "../lib/analytics";
import { num } from "../lib/format";
import { hapticSelect } from "../lib/haptics";
import { keyboardAwareScrollProps } from "../lib/keyboard";
import { useProCta } from "../lib/proCta";
import { grantSpikeConsent, hasSpikeConsent } from "../lib/services/spikeConsent";
import { HIT_TARGET, INPUT_TEXT, TABULAR, THEME } from "../lib/theme/tokens";
import { upper } from "../lib/upper";
import { GradientCTA } from "./rich";

export type CarbEstimateSource = "food_tab" | "meal_sheet";

type ErrorKind = "limit" | "busy" | "failed" | "input" | "noFood";

const ERROR_KEY: Record<ErrorKind, string> = {
  limit: "carbEstimate.errorLimit",
  busy: "carbEstimate.errorBusy",
  failed: "carbEstimate.errorFailed",
  input: "carbEstimate.errorInput",
  noFood: "carbEstimate.errorNoFood",
};

/** A function: THEME resolves the active scheme at read time, a module-level const froze the first one. */
const fieldStyle = () => [
  INPUT_TEXT,
  {
    minHeight: 40,
    color: THEME.text,
    fontSize: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: THEME.border,
    backgroundColor: THEME.surface,
    paddingHorizontal: 10,
  },
];

function ItemRow({
  item,
  onChange,
  onRemove,
}: {
  item: EditableItem;
  onChange: (patch: Partial<EditableItem>) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View className="rounded-2xl bg-glass border border-hair px-3 py-2.5 mb-2">
      <View className="flex-row items-center" style={{ columnGap: 8 }}>
        <TextInput
          value={item.name}
          onChangeText={(name) => onChange({ name })}
          maxLength={60}
          accessibilityLabel={t("carbEstimate.itemName")}
          placeholder={t("carbEstimate.itemName")}
          placeholderTextColor={THEME.textMuted}
          style={[...fieldStyle(), { flex: 1, fontWeight: "700" }]}
        />
        <Pressable
          onPress={onRemove}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`${t("mealCompose.remove")}: ${item.name}`}
          style={{ minWidth: 32, minHeight: 32, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="close-circle" size={20} color={THEME.textMuted} />
        </Pressable>
      </View>
      <View className="flex-row items-center" style={{ marginTop: 8, columnGap: 8 }}>
        <TextInput
          value={item.quantityText}
          onChangeText={(quantityText) => onChange({ quantityText })}
          keyboardType="decimal-pad"
          selectTextOnFocus
          maxLength={7}
          accessibilityLabel={`${t("carbEstimate.itemQuantity")}: ${item.name}`}
          placeholder={t("carbEstimate.itemQuantity")}
          placeholderTextColor={THEME.textMuted}
          style={[...fieldStyle(), TABULAR, { width: 70, textAlign: "center" }]}
        />
        <TextInput
          value={item.unit}
          onChangeText={(unit) => onChange({ unit })}
          maxLength={20}
          accessibilityLabel={`${t("carbEstimate.itemUnit")}: ${item.name}`}
          placeholder={t("carbEstimate.itemUnit")}
          placeholderTextColor={THEME.textMuted}
          style={[...fieldStyle(), { flex: 1 }]}
        />
        <TextInput
          value={item.gramsText}
          onChangeText={(gramsText) => onChange({ gramsText })}
          keyboardType="decimal-pad"
          selectTextOnFocus
          maxLength={6}
          accessibilityLabel={`${t("carbEstimate.itemCarbs")} (${t("common.grams")}): ${item.name}`}
          style={[
            ...fieldStyle(),
            TABULAR,
            { width: 64, textAlign: "center", fontWeight: "800", color: THEME.accent },
          ]}
        />
        <Text style={{ color: THEME.textMuted, fontSize: 12 }}>{t("common.grams")}</Text>
      </View>
    </View>
  );
}

/**
 * Carb estimate from a typed meal description. Presentational about the
 * journal: the caller writes the meal when onAdd fires, and onAdd fires only
 * from the "Add to log" button, never when a result arrives. Consent comes
 * first: without the current Spike consent no text is sent. The typed text
 * lives in this component's state only and is never stored or logged.
 */
export function CarbEstimateSheet({
  source,
  isPro,
  locale,
  saving,
  screenshotResult,
  onClose,
  onAdd,
}: {
  source: CarbEstimateSource;
  isPro: boolean;
  locale: string;
  saving: boolean;
  /** Store capture only (honoured in screenshot mode): open on the filled sample result. */
  screenshotResult?: boolean;
  onClose: () => void;
  onAdd: (items: EditableItem[]) => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const anim = useRef(new Animated.Value(0)).current;
  const aborter = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const [consented, setConsented] = useState<boolean | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorKind | null>(null);
  const [items, setItems] = useState<EditableItem[] | null>(null);
  const proCta = useProCta(!isPro);
  const tier = isPro ? "pro" : "free";

  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [anim]);

  useEffect(() => {
    if (!screenshotResult) return;
    const sample = screenshotCarbSample(locale);
    if (!sample) return;
    setConsented(true);
    setText(sample.text);
    setItems(editableFromEstimate(sample.estimate.items));
  }, [screenshotResult, locale]);

  useEffect(() => {
    let alive = true;
    void hasSpikeConsent().then((ok) => {
      if (alive) setConsented((prev) => (prev === true && screenshotResult ? true : ok));
    });
    return () => {
      alive = false;
      aborter.current?.abort();
    };
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);

  const blocked = useCallback((reason: "quota" | "filtered" | "error") => {
    logEvent("carb_estimate_blocked", { reason });
  }, []);

  async function accept() {
    await grantSpikeConsent();
    setConsented(await hasSpikeConsent());
  }

  async function submit() {
    const prepared = prepareMealText(text);
    if (prepared === null) {
      setError("input");
      return;
    }
    if (!enterGuard(inFlight)) return;
    const controller = new AbortController();
    aborter.current = controller;
    setError(null);
    setBusy(true);
    try {
      const usage = await getCarbUsage(isPro);
      if (controller.signal.aborted) return;
      if (usage.remaining <= 0) {
        setError("limit");
        blocked("quota");
        return;
      }
      const result = await estimateCarbs({
        text: prepared,
        locale,
        tier,
        signal: controller.signal,
      });
      if (shouldCountEstimate(result)) await noteCarbEstimate(isPro).catch(() => {});
      if (result.filtered || result.items.length === 0) {
        setError("noFood");
        blocked("filtered");
        return;
      }
      setItems(editableFromEstimate(result.items));
      logEvent("carb_estimate_used", {
        tier,
        item_count: itemCountBucket(result.items.length),
        source,
      });
    } catch (e) {
      const code = carbErrorCode(e);
      if (carbErrorCharged(e)) await noteCarbEstimate(isPro).catch(() => {});
      if (code === "aborted") return;
      if (code === "consent_required") {
        setConsented(false);
        return;
      }
      if (code === "limit") {
        await markCarbExhausted(isPro);
        setError("limit");
        blocked("quota");
      } else if (code === "input") {
        setError("input");
      } else {
        setError(code === "busy" ? "busy" : "failed");
        blocked("error");
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function close() {
    aborter.current?.abort();
    onClose();
  }

  function patchItem(key: string, patch: Partial<EditableItem>) {
    setItems((prev) => prev && prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }

  function removeItem(key: string) {
    setItems((prev) => {
      const next = prev ? prev.filter((it) => it.key !== key) : prev;
      return next && next.length === 0 ? null : next;
    });
  }

  const resultShown = items !== null;
  const canAdd = canAddEstimate({ resultShown, items: items ?? [], saving });
  const total = items ? editableTotal(items) : 0;

  let body: React.ReactNode;
  if (consented === null) {
    body = <ActivityIndicator color={THEME.accent} style={{ marginVertical: 24 }} />;
  } else if (!consented) {
    body = (
      <View>
        <Text
          accessibilityRole="header"
          style={{ color: THEME.text, fontSize: 17, fontWeight: "800", marginBottom: 10 }}
        >
          {t("spike.consentTitle")}
        </Text>
        <View style={{ rowGap: 8, marginBottom: 14 }}>
          <Text style={{ color: THEME.text, fontSize: 13, lineHeight: 20 }}>{t("spike.consentSent")}</Text>
          <Text style={{ color: THEME.text, fontSize: 13, lineHeight: 20 }}>{t("spike.consentRecipient")}</Text>
          <Text style={{ color: THEME.text, fontSize: 13, lineHeight: 20 }}>{t("spike.consentNotSent")}</Text>
          <Text style={{ color: THEME.text, fontSize: 13, lineHeight: 20 }}>{t("spike.consentCarb")}</Text>
          <Text style={{ color: THEME.textMuted, fontSize: 12, lineHeight: 18 }}>{t("spike.consentScope")}</Text>
        </View>
        <GradientCTA label={t("spike.accept")} onPress={() => void accept()} />
        <Pressable onPress={onClose} hitSlop={8} style={{ alignItems: "center", paddingVertical: 12 }}>
          <Text style={{ color: THEME.textMuted, fontSize: 13 }}>{t("spike.notNow")}</Text>
        </Pressable>
      </View>
    );
  } else if (items) {
    body = (
      <View>
        <Text
          accessibilityRole="header"
          style={{ color: THEME.text, fontSize: 17, fontWeight: "800", marginBottom: 4 }}
        >
          {t("carbEstimate.title")}
        </Text>
        <Text style={{ color: THEME.textMuted, fontSize: 12, marginBottom: 10 }}>
          {t("carbEstimate.edit")}
        </Text>
        {items.map((item) => (
          <ItemRow
            key={item.key}
            item={item}
            onChange={(patch) => patchItem(item.key, patch)}
            onRemove={() => removeItem(item.key)}
          />
        ))}
        <View
          className="flex-row items-center justify-between rounded-2xl bg-glass border border-hair px-3.5 py-3 mb-2 mt-1"
          accessible
          accessibilityLabel={`${t("carbEstimate.total")}: ${num(total)} ${t("common.grams")}`}
        >
          <Text
            className="text-xs font-semibold tracking-wider text-mut"
            style={{ flexShrink: 1, paddingRight: 8 }}
          >
            {upper(t("carbEstimate.total"))}
          </Text>
          <Text style={[TABULAR, { color: THEME.accent, fontSize: 20, fontWeight: "800" }]}>
            {num(total)}
            <Text style={{ color: THEME.textMuted, fontSize: 12, fontWeight: "600" }}>
              {t("common.grams")}
            </Text>
          </Text>
        </View>
        <Text style={{ color: THEME.textMuted, fontSize: 12, lineHeight: 18, marginBottom: 12 }}>
          {t("carbEstimate.note")}
        </Text>
        <GradientCTA
          label={t("carbEstimate.add")}
          disabled={!canAdd}
          onPress={() => {
            if (canAdd && items) onAdd(items);
          }}
        />
      </View>
    );
  } else {
    const len = [...text].length;
    body = (
      <View>
        <Text
          accessibilityRole="header"
          style={{ color: THEME.text, fontSize: 17, fontWeight: "800", marginBottom: 6 }}
        >
          {t("carbEstimate.title")}
        </Text>
        <Text style={{ color: THEME.textMuted, fontSize: 12, lineHeight: 18, marginBottom: 12 }}>
          {t("carbEstimate.help")}
        </Text>
        <TextInput
          value={text}
          onChangeText={(next) => {
            setText(next);
            if (error === "input") setError(null);
          }}
          multiline
          maxLength={CARB_TEXT_MAX}
          editable={!busy}
          placeholder={t("carbEstimate.placeholder")}
          placeholderTextColor={THEME.textMuted}
          accessibilityLabel={t("carbEstimate.title")}
          style={[
            INPUT_TEXT,
            {
              minHeight: 88,
              maxHeight: 160,
              textAlignVertical: "top",
              color: THEME.text,
              fontSize: 14,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: THEME.border,
              backgroundColor: THEME.surface,
              paddingHorizontal: 14,
              paddingVertical: 10,
            },
          ]}
        />
        <Text style={[TABULAR, { color: THEME.textMuted, fontSize: 11, textAlign: "right", marginTop: 4 }]}>
          {len}/{CARB_TEXT_MAX}
        </Text>
        {error ? (
          <View className="rounded-2xl bg-glass border border-hair px-3.5 py-3 mt-2">
            <Text
              accessibilityRole="alert"
              style={{ color: THEME.text, fontSize: 13, lineHeight: 19 }}
            >
              {t(ERROR_KEY[error])}
            </Text>
            {error === "limit" && !isPro ? (
              <View style={{ marginTop: 10 }}>
                <Text style={{ color: THEME.textMuted, fontSize: 12, lineHeight: 18, marginBottom: 10 }}>
                  {t("carbEstimate.proNudge")}
                </Text>
                <GradientCTA
                  label={t(proCta.key, proCta.params)}
                  onPress={() => {
                    hapticSelect();
                    onClose();
                    router.push({ pathname: "/paywall", params: { reason: "spike" } });
                  }}
                />
              </View>
            ) : null}
          </View>
        ) : null}
        <View style={{ marginTop: 12 }}>
          {busy ? (
            <View
              className="flex-row items-center justify-center rounded-2xl border border-hair"
              style={{ minHeight: HIT_TARGET, columnGap: 8 }}
              accessibilityLiveRegion="polite"
            >
              <ActivityIndicator color={THEME.accent} />
              <Text style={{ color: THEME.textMuted, fontSize: 13 }}>{t("carbEstimate.estimating")}</Text>
            </View>
          ) : (
            <GradientCTA
              label={t("carbEstimate.submit")}
              disabled={text.trim().length === 0}
              onPress={() => void submit()}
            />
          )}
        </View>
        <Text style={{ color: THEME.textMuted, fontSize: 11, lineHeight: 16, marginTop: 10 }}>
          {t("carbEstimate.note")}
        </Text>
      </View>
    );
  }

  return (
    <View
      style={[StyleSheet.absoluteFill, { zIndex: 300 }]}
      accessibilityViewIsModal
      importantForAccessibility="yes"
      onAccessibilityEscape={onClose}
    >
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: anim }]}>
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.7)" }]} // theme-ok
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t("common.cancel")}
        />
      </Animated.View>
      <View style={{ flex: 1, justifyContent: "flex-end" }} pointerEvents="box-none">
        <Animated.View
          style={{
            maxHeight: "92%",
            transform: [
              { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) },
            ],
          }}
        >
          <Pressable
            className="rounded-t-3xl border-t border-x border-hair px-4 pt-3"
            style={{ backgroundColor: THEME.bg.g1, paddingBottom: insets.bottom + 20, flexShrink: 1 }}
            onPress={(e) => e.stopPropagation()}
            accessible={false}
            focusable={false}
            importantForAccessibility="auto"
          >
            <View className="items-center mb-2">
              <View className="w-10 h-1 rounded-full bg-hair" />
            </View>
            <Pressable
              onPress={close}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t("common.close")}
              style={{
                position: "absolute",
                top: 8,
                right: 12,
                zIndex: 1,
                minWidth: HIT_TARGET,
                minHeight: HIT_TARGET,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="close" size={22} color={THEME.textMuted} />
            </Pressable>
            <ScrollView
              {...keyboardAwareScrollProps}
              style={{ flexShrink: 1 }}
              showsVerticalScrollIndicator={false}
            >
              {body}
            </ScrollView>
          </Pressable>
        </Animated.View>
      </View>
    </View>
  );
}
