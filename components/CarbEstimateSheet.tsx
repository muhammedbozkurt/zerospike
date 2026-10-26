import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  BackHandler,
  Easing,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
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
  editableToEstimateLines,
  type EditableItem,
} from "../lib/ai/carbEstimateClient";
import {
  getCarbUsage,
  markCarbExhausted,
  noteCarbEstimate,
} from "../lib/ai/carbEstimateLimit";
import { logEvent } from "../lib/analytics";
import { animateFade, isReducedMotionNow, slideDistance, useReducedMotion } from "../lib/useReducedMotion";
import { num } from "../lib/format";
import { hapticSelect } from "../lib/haptics";
import { keyboardAwareScrollProps } from "../lib/keyboard";
import { useLayout } from "../lib/useLayout";
import { dialogCardStyle, sheetBoxStyle } from "../lib/tabletLayout";
import { useProCta } from "../lib/proCta";
import { grantSpikeConsent, hasSpikeConsent } from "../lib/services/spikeConsent";
import { HIT_TARGET, INPUT_TEXT, TABULAR, THEME } from "../lib/theme/tokens";
import type { EstimateLineInput } from "../lib/mealCompose";
import { EstimateResultCard, LiveTotalHeader } from "./meal";
import { SCRIM } from "./SheetShell";
import { FONT_CAP, linesFor, overlaySheetMaxHeight } from "../lib/layoutForFontScale";
import { useFontScale } from "../lib/useFontScale";
import { ScrollHint } from "./ScrollHint";
import { useScrollHint } from "../lib/useScrollHint";
import { hintBottomOffset } from "../lib/scrollHint";
import { useA11yModalPresence } from "../lib/a11yModal";
import { Button } from "./ui";


export type CarbEstimateSource = "food_tab" | "meal_sheet";

type ErrorKind = "limit" | "busy" | "failed" | "input" | "noFood";

const ERROR_KEY: Record<ErrorKind, string> = {
  limit: "carbEstimate.errorLimit",
  busy: "carbEstimate.errorBusy",
  failed: "carbEstimate.errorFailed",
  input: "carbEstimate.errorInput",
  noFood: "carbEstimate.errorNoFood",
};

/**
 * Carb estimate from a typed meal description. It never writes the journal:
 * "Add to meal" hands the edited lines to the caller (estimate lines in the
 * meal compose list), and onAdd fires only from that button, never when a
 * result arrives. Consent comes
 * first: without the current Spike consent no text is sent. The typed text
 * lives in this component's state only and is never stored or logged.
 */
export function CarbEstimateSheet({
  source,
  isPro,
  locale,
  saving = false,
  screenshotResult,
  onClose,
  onAdd,
}: {
  source: CarbEstimateSource;
  isPro: boolean;
  locale: string;
  /** Optional: the caller has no save of its own now; true only disables "Add to meal". */
  saving?: boolean;
  /** Store capture only (honoured in screenshot mode): open on the filled sample result. */
  screenshotResult?: boolean;
  onClose: () => void;
  /** The named, edited lines (editableToEstimateLines). The sheet closes itself right after. */
  onAdd: (lines: EstimateLineInput[]) => void;
}) {
  const { t } = useTranslation();
  useA11yModalPresence(true);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { isWide, isDialog, width: layoutWidth, height: layoutHeight } = useLayout();
  const router = useRouter();
  const anim = useRef(new Animated.Value(0)).current;
  const reducedMotion = useReducedMotion();
  const scrollHint = useScrollHint("sheet.carb-estimate");
  const aborter = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const [consented, setConsented] = useState<boolean | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorKind | null>(null);
  const [items, setItems] = useState<EditableItem[] | null>(null);
  const [keyboardH, setKeyboardH] = useState(0);
  const [hostHeight, setHostHeight] = useState(0);
  const fontScale = useFontScale();
  const proCta = useProCta(!isPro);
  const tier = isPro ? "pro" : "free";

  useEffect(() => {
    animateFade(isReducedMotionNow(), anim, {
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

  // iOS only: Android is adjustResize and already lifts the sheet.
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    const show = Keyboard.addListener("keyboardWillShow", (e) =>
      setKeyboardH(e?.endCoordinates?.height ?? 0)
    );
    const hide = Keyboard.addListener("keyboardWillHide", () => setKeyboardH(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const blocked = useCallback((reason: "quota" | "filtered" | "error") => {
    logEvent("carb_estimate_blocked", { reason });
  }, []);

  async function accept() {
    if (!agreed) return;
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
      logEvent("carb_estimate_requested", { tier, source });
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

  function replaceItem(next: EditableItem) {
    setItems((prev) => prev && prev.map((it) => (it.key === next.key ? next : it)));
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

  const title = (
    <Text
      accessibilityRole="header"
      numberOfLines={linesFor(fontScale, 2)}
      maxFontSizeMultiplier={FONT_CAP.ringNumber}
      style={{
        color: THEME.text,
        fontSize: 18,
        fontWeight: "800",
        paddingEnd: HIT_TARGET,
        marginBottom: 6,
      }}
    >
      {t("carbEstimate.title")}
    </Text>
  );
  const fixedNote = (
    <Text style={{ color: THEME.textMuted, fontSize: 12, lineHeight: 18, marginBottom: 10 }}>
      {t("carbEstimate.noteShort")}
    </Text>
  );

  let top: React.ReactNode = null;
  let body: React.ReactNode;
  let footer: React.ReactNode = null;
  if (consented === null) {
    body = <ActivityIndicator color={THEME.accent} style={{ marginVertical: 24 }} />;
  } else if (!consented) {
    const para = { color: THEME.text, fontSize: 13, lineHeight: 20 } as const;
    body = (
      <View>
        <Text
          accessibilityRole="header"
          style={{
            color: THEME.text,
            fontSize: 17,
            fontWeight: "800",
            marginBottom: 10,
            paddingEnd: HIT_TARGET,
          }}
        >
          {t("spike.consentTitle")}
        </Text>
        <View style={{ rowGap: 8, marginBottom: 10 }}>
          <Text style={para}>{t("spike.consentShort1")}</Text>
          <Text style={para}>{t("spike.consentShort2")}</Text>
          <Text style={para}>{t("spike.consentShort3")}</Text>
          <Text style={{ color: THEME.warning, fontSize: 12, lineHeight: 18 }}>
            {t("spike.consentShortScope")}
          </Text>
        </View>
        {/* The short lines summarise the full text; every line of it sits
            behind this toggle, as on the Spike consent screen. */}
        <Pressable
          onPress={() => {
            hapticSelect();
            setDetailsOpen((open) => !open);
          }}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityState={{ expanded: detailsOpen }}
          accessibilityLabel={t("spike.consentDetails")}
          style={{
            flexDirection: "row",
            alignItems: "center",
            columnGap: 4,
            minHeight: HIT_TARGET,
          }}
        >
          <Text style={{ color: THEME.accent, fontSize: 13 }}>{t("spike.consentDetails")}</Text>
          <Ionicons
            name={detailsOpen ? "chevron-up" : "chevron-down"}
            size={14}
            color={THEME.accent}
          />
        </Pressable>
        {detailsOpen ? (
          <View style={{ rowGap: 8, marginBottom: 10 }}>
            <Text style={para}>{t("spike.consentSent")}</Text>
            <Text style={para}>{t("spike.consentRecipient")}</Text>
            <Text style={para}>{t("spike.consentNotSent")}</Text>
            <Text style={para}>{t("spike.consentCarb")}</Text>
            <Text style={{ color: THEME.textMuted, fontSize: 12, lineHeight: 18 }}>
              {t("spike.consentSummaryNote")}
            </Text>
            <Text style={{ color: THEME.warning, fontSize: 12, lineHeight: 18 }}>
              {t("spike.consentScope")}
            </Text>
            <Text style={{ color: THEME.textMuted, fontSize: 11, lineHeight: 16 }}>
              {t("spike.consentDeviceId")}
            </Text>
          </View>
        ) : null}
        <Pressable
          onPress={() => {
            hapticSelect();
            setAgreed((v) => !v);
          }}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: agreed }}
          accessibilityLabel={t("spike.consentAgree")}
          hitSlop={8}
          style={{
            flexDirection: "row",
            alignItems: "center",
            columnGap: 10,
            minHeight: HIT_TARGET,
            marginBottom: 6,
          }}
        >
          <Ionicons
            name={agreed ? "checkbox" : "square-outline"}
            size={24}
            color={agreed ? THEME.accent : THEME.textMuted}
          />
          <Text style={{ color: THEME.text, fontSize: 14, lineHeight: 20, flex: 1 }}>
            {t("spike.consentAgree")}
          </Text>
        </Pressable>
        <Button label={t("spike.accept")} disabled={!agreed} onPress={() => void accept()} />
        <View style={{ marginTop: 4 }}>
          <Button variant="tertiary" label={t("spike.notNow")} onPress={onClose} />
        </View>
      </View>
    );
  } else if (items) {
    top = (
      <View>
        {title}
        {fixedNote}
      </View>
    );
    body = (
      <View>
        <View
          accessible
          accessibilityLabel={`${t("carbEstimate.approx")} ${t("mealCompose.totalLine", {
            value: num(total),
          })}`}
          style={{ flexDirection: "row", alignItems: "center", columnGap: 6, marginBottom: 12 }}
        >
          <Text
            importantForAccessibility="no"
            style={{ color: THEME.textMuted, fontSize: 28, fontWeight: "700" }}
          >
            ≈
          </Text>
          <View style={{ flex: 1, minWidth: 0 }}>
            <LiveTotalHeader totalG={total} targetG={null} />
          </View>
        </View>
        {items.map((item) => (
          <EstimateResultCard
            key={item.key}
            line={item}
            onChange={replaceItem}
            onRemove={() => removeItem(item.key)}
          />
        ))}
      </View>
    );
    footer = (
      <View style={{ paddingTop: 10 }}>
        <Button
          label={t("carbEstimate.addToMeal")}
          disabled={!canAdd}
          onPress={() => {
            if (canAdd && items) {
              onAdd(editableToEstimateLines(items));
              logEvent("carb_estimate_accepted", { item_count: itemCountBucket(items.length) });
              close();
            }
          }}
        />
      </View>
    );
  } else {
    const len = [...text].length;
    top = (
      <View>
        {title}
        {fixedNote}
      </View>
    );
    body = (
      <View>
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
          placeholderTextColor={THEME.placeholder}
          accessibilityLabel={t("carbEstimate.title")}
          style={[
            INPUT_TEXT,
            {
              minHeight: 96,
              maxHeight: 160,
              textAlignVertical: "top",
              color: THEME.text,
              fontSize: 16,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: THEME.border,
              backgroundColor: THEME.surface,
              paddingHorizontal: 14,
              paddingVertical: 10,
              opacity: busy ? 0.6 : 1,
            },
          ]}
        />
        <Text style={[TABULAR, { color: THEME.textMuted, fontSize: 11, textAlign: "right", marginTop: 4 }]}>
          {len}/{CARB_TEXT_MAX}
        </Text>
        {error ? (
          <View className="rounded-2xl bg-glass border border-hair px-3.5 py-3 mt-2">
            <Text accessibilityRole="alert" style={{ color: THEME.text, fontSize: 13, lineHeight: 19 }}>
              {t(ERROR_KEY[error])}
            </Text>
            {error === "limit" && !isPro ? (
              <View style={{ marginTop: 10 }}>
                <Text style={{ color: THEME.textMuted, fontSize: 12, lineHeight: 18, marginBottom: 10 }}>
                  {t("carbEstimate.proNudge")}
                </Text>
                <Button
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
      </View>
    );
    footer = (
      <View style={{ paddingTop: 10 }}>
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
          <Button
            label={t("carbEstimate.submit")}
            disabled={text.trim().length === 0}
            onPress={() => void submit()}
          />
        )}
      </View>
    );
  }

  // With large text the tab bar grows and the window-based cap let the sheet
  // reach under the status bar, so the measured host bounds it too. At 1.0 the
  // window-based cap stays as is (store screenshots).
  const maxHeight = overlaySheetMaxHeight({ windowHeight, hostHeight, keyboardH, insetTop: insets.top, fontScale });
  const bottomPad = keyboardH > 0 ? 12 : insets.bottom + 16;

  return (
    <View
      style={[StyleSheet.absoluteFill, { zIndex: 300 }]}
      accessibilityViewIsModal
      importantForAccessibility="yes"
      onAccessibilityEscape={onClose}
      onLayout={(e) => setHostHeight(e.nativeEvent.layout.height)}
    >
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: anim }]}>
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: SCRIM }]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t("common.cancel")}
        />
      </Animated.View>
      <View
        style={{ flex: 1, justifyContent: "flex-end", paddingBottom: keyboardH }}
        pointerEvents="box-none"
      >
        <Animated.View
          style={[
            {
              maxHeight,
              transform: [
                { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [slideDistance(reducedMotion, 40), 0] }) },
              ],
            },
            sheetBoxStyle(layoutWidth, isWide, layoutHeight, maxHeight, false),
          ]}
        >
          <Pressable
            className="rounded-t-3xl border-t border-x border-hair px-4 pt-3"
            style={[
              { backgroundColor: THEME.bg.g1, paddingBottom: bottomPad, flexShrink: 1 },
              isDialog ? dialogCardStyle : null,
            ]}
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
            {top}
            <ScrollView
              {...keyboardAwareScrollProps}
              style={isDialog ? { flexShrink: 1, flexGrow: 1 } : { flexShrink: 1 }}
              showsVerticalScrollIndicator={false}
              onScroll={scrollHint.onScroll}
              onContentSizeChange={scrollHint.onContentSizeChange}
              onLayout={scrollHint.onLayout}
              scrollEventThrottle={scrollHint.scrollEventThrottle}
            >
              {body}
            </ScrollView>
            <ScrollHint visible={scrollHint.visible} bottomOffset={hintBottomOffset({})} />
            {footer}
          </Pressable>
        </Animated.View>
      </View>
    </View>
  );
}
