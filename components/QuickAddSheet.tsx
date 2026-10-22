import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  BackHandler,
  Easing,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import { THEME, RADIUS, SPACE } from "../lib/theme/tokens";
import { RIPPLE_ALPHA } from "../lib/theme/uiPrimitives";
import { withAlpha } from "./rich/GlassCard";
import { Row, Txt } from "./ui";
import { SCRIM } from "./SheetShell";
import { useLayout } from "../lib/useLayout";
import { sheetBoxStyle } from "../lib/tabletLayout";
import { sheetFrame } from "../lib/sheetLayout";
import { useSheetKeyboard } from "../lib/useSheetKeyboard";
import { IconTile, GradientCTA } from "./rich";
import { InlineDateTimePicker } from "./InlineDateTimePicker";
import { DirIcon } from "./DirIcon";
import { hapticSelect, hapticSuccess } from "../lib/haptics";
import { useApp } from "../lib/store/AppContext";
import { useFeedback } from "./Feedback";
import { logMed, upsertMedUse } from "../lib/db/meds";
import { MedNamePicker } from "./MedNamePicker";
import { logEvent } from "../lib/analytics";
import { noteFirstLog } from "../lib/services/firstLog";
import { noteJournalActivity } from "../lib/services/notifications";
import { formatTime, relativeDay } from "../lib/format";


interface QuickAddSheetProps {
  visible: boolean;
  onClose: () => void;
  onGlucose: () => void;
  onFood: () => void;
  onInjection: () => void;
  /** Hide the injection card for a profile that takes no insulin. */
  showInjection?: boolean;
  /** Show the medication card for a profile with oral-medication tracking on. */
  showMed?: boolean;
  /** Opens straight onto the medication entry step instead of the option grid
   *  (the "med" notification deep-link and the widget's quick-add shortcut). */
  openMedDirect?: boolean;
}

/**
 * The dashboard's "add record" entry. Instead of always opening the glucose
 * sheet (a dead end for a meal or an injection), it offers the three log kinds
 * as big icon cards so each is one tap from the dashboard. The dashboard is a
 * tab (root view controller), so a plain absolute overlay presents cleanly here
 * without the RN-Modal-over-modal problem the Feedback host works around.
 */
export function QuickAddSheet({
  visible,
  onClose,
  onGlucose,
  onFood,
  onInjection,
  showInjection = true,
  showMed = false,
  openMedDirect = false,
}: QuickAddSheetProps) {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const { isWide, isDialog, width: layoutWidth, height: layoutHeight } = useLayout();
  const { height: windowH } = useWindowDimensions();
  const { hostRef, onHostLayout, hostHeight, lift, liftAnim, keyboardOpen } = useSheetKeyboard(visible);
  // The grabber, the med header and the close path stay on screen: the sheet is
  // capped at what the keyboard and the status-bar inset leave, and only the
  // med form body scrolls.
  const sheetAvail = sheetFrame({
    hostHeight,
    windowHeight: windowH,
    lift,
    keyboardOpen,
    insetTop: insets.top,
    insetBottom: insets.bottom,
    contentHeight: 0,
    maxHeightRatio: 1,
  }).sheetMaxHeight;
  const { activeProfile, bumpData } = useApp();
  const { toast } = useFeedback();
  const anim = useRef(new Animated.Value(0)).current;
  // Which body the sheet shows: the option grid, or the medication mini-form
  // (name + time + save) reached from the "Medication" card or opened directly
  // by the deep-link/widget shortcut.
  const [step, setStep] = useState<"grid" | "med">("grid");
  const [medName, setMedName] = useState("");
  const [medNote, setMedNote] = useState("");
  // null keeps the "log it as of now" default, same convention as the glucose
  // sheet; a Date is an explicit pick.
  const [medAt, setMedAt] = useState<Date | null>(null);
  const [medTimePickerOpen, setMedTimePickerOpen] = useState(false);
  const [savingMed, setSavingMed] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setStep(openMedDirect ? "med" : "grid");
    setMedName("");
    setMedNote("");
    setMedAt(null);
    setMedTimePickerOpen(false);
    setSavingMed(false);
    anim.setValue(0);
    Animated.timing(anim, {
      toValue: 1,
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible, openMedDirect, anim]);

  async function saveMed() {
    if (!activeProfile || savingMed) return;
    setSavingMed(true);
    try {
      const trimmedName = medName.trim();
      const takenAt = (medAt ?? new Date()).getTime();
      await logMed({
        profileId: activeProfile.id,
        takenAt,
        name: trimmedName || null,
        note: medNote.trim() || null,
      });
      if (trimmedName) await upsertMedUse(activeProfile.id, trimmedName, takenAt);
      logEvent("log_added", { kind: "med" });
      void noteFirstLog("med");
      void noteJournalActivity();
      bumpData();
      hapticSuccess();
      toast(t("meds.took"), "success");
      onClose();
    } finally {
      setSavingMed(false);
    }
  }

  /**
   * Android hardware back closes the sheet.
   *
   * This is an absolute overlay, not an RN <Modal>, so back was never routed to
   * it: pressing back with the sheet open left the sheet on screen and popped the
   * dashboard out from under it. Registered only while visible, and it consumes
   * the event so the navigator does not also act on it.
   */
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  if (!visible) return null;

  const options: {
    key: string;
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    onPress: () => void;
  }[] = [
    { key: "glucose", icon: "water", label: t("dashboard.quickAddGlucose"), onPress: onGlucose },
    { key: "food", icon: "restaurant", label: t("dashboard.quickAddFood"), onPress: onFood },
    ...(showInjection
      ? [
          {
            key: "injection",
            icon: "medkit" as keyof typeof Ionicons.glyphMap,
            label: t("dashboard.quickAddInjection"),
            onPress: onInjection,
          },
        ]
      : []),
    ...(showMed
      ? [
          {
            key: "med",
            icon: "medical-outline" as keyof typeof Ionicons.glyphMap,
            label: t("meds.entryLabel"),
            // Stays on this sheet: tapping opens the mini-form below instead
            // of closing + navigating like the other three cards (see the
            // onPress branch on the Pressable below).
            onPress: () => {
              hapticSelect();
              setStep("med");
            },
          },
        ]
      : []),
  ];

  const select = (fn: () => void) => {
    hapticSelect();
    onClose();
    fn();
  };

  return (
    <View
      style={[StyleSheet.absoluteFill, { zIndex: 200 }]}
      accessibilityViewIsModal
      importantForAccessibility="yes"
    >
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: anim }]}>
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: SCRIM }]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t("common.close")}
        />
      </Animated.View>
      <View
        ref={hostRef}
        collapsable={false}
        onLayout={onHostLayout}
        style={{ flex: 1 }}
        pointerEvents="box-none"
      >
      <Animated.View
        style={{ flex: 1, justifyContent: isDialog ? "center" : "flex-end", paddingBottom: liftAnim }}
        pointerEvents="box-none"
      >
        <Animated.View
          style={{
            transform: [
              {
                translateY: anim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [40, 0],
                }),
              },
            ],
          }}
        >
          <View
            style={[
              {
                maxHeight: sheetAvail,
                backgroundColor: THEME.bg.g1,
                borderTopLeftRadius: RADIUS["2xl"],
                borderTopRightRadius: RADIUS["2xl"],
                borderTopWidth: 1,
                borderColor: THEME.border,
                paddingHorizontal: SPACE.lg,
                paddingTop: SPACE.sm,
                paddingBottom: insets.bottom + SPACE.xl,
              },
              sheetBoxStyle(layoutWidth, isWide, layoutHeight, sheetAvail, true, { minRatio: 0 }),
            ]}
          >
            <View style={{ alignItems: "center", marginBottom: SPACE.sm }}>
              <View
                style={{
                  width: 38,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: THEME.border,
                }}
              />
            </View>
            {step === "grid" ? (
              // The cards carry their own labels, so a question above them
              // would only repeat what they already say.
              <View style={{ flexDirection: "row", gap: SPACE.sm, marginTop: SPACE.md }}>
                {options.map((opt) => (
                  <Pressable
                    key={opt.key}
                    // "med" stays on this sheet (opens the form below) instead
                    // of closing + navigating like the other cards.
                    onPress={() => (opt.key === "med" ? opt.onPress() : select(opt.onPress))}
                    android_ripple={{ color: withAlpha(THEME.text, RIPPLE_ALPHA), foreground: true }}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: THEME.surface,
                      borderWidth: 1,
                      borderColor: THEME.border,
                      borderRadius: RADIUS.lg,
                      paddingVertical: SPACE.lg,
                      paddingHorizontal: SPACE.xs,
                      gap: SPACE.sm,
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={opt.label}
                  >
                    <IconTile icon={opt.icon} size={48} radius={14} hero />
                    <Txt
                      kind="caption"
                      numberOfLines={2}
                      style={{ fontWeight: "700", textAlign: "center" }}
                    >
                      {opt.label}
                    </Txt>
                  </Pressable>
                ))}
              </View>
            ) : (
              <View style={{ marginTop: SPACE.xs, flexShrink: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", marginBottom: SPACE.md }}>
                  <Pressable
                    onPress={() => setStep("grid")}
                    hitSlop={12}
                    accessibilityRole="button"
                    accessibilityLabel={t("common.back")}
                    android_ripple={{ color: withAlpha(THEME.text, RIPPLE_ALPHA), borderless: true }}
                    style={{ padding: SPACE.xs, marginLeft: -SPACE.xs }}
                  >
                    <DirIcon name="chevron-back" size={22} color={THEME.textMuted} />
                  </Pressable>
                  <Txt
                    kind="subtitle"
                    style={{
                      flex: 1,
                      textAlign: "center",
                      marginRight: 26,
                    }}
                  >
                    {t("meds.title")}
                  </Txt>
                </View>

                <ScrollView
                  style={{ flexShrink: 1 }}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                >
                <MedNamePicker
                  profileId={activeProfile?.id ?? null}
                  value={medName}
                  onChange={setMedName}
                />

                <View style={{ marginBottom: SPACE.xs }}>
                  <Row
                    icon="time-outline"
                    label={`${relativeDay((medAt ?? new Date()).toISOString(), {
                      today: t("common.today"),
                      yesterday: t("common.yesterday"),
                    })} · ${formatTime((medAt ?? new Date()).toISOString())}`}
                    onPress={() => {
                      Keyboard.dismiss();
                      setMedTimePickerOpen((v) => !v);
                    }}
                  />
                </View>
                <InlineDateTimePicker
                  visible={medTimePickerOpen}
                  value={medAt ?? new Date()}
                  max={new Date()}
                  locale={i18n.language}
                  onChange={setMedAt}
                  onClose={() => setMedTimePickerOpen(false)}
                />

                <TextInput
                  value={medNote}
                  onChangeText={setMedNote}
                  placeholder={t("injection.notePlaceholder")}
                  placeholderTextColor={THEME.textMuted}
                  accessibilityLabel={t("injection.notePlaceholder")}
                  returnKeyType="done"
                  style={{
                    borderRadius: RADIUS.md,
                    borderWidth: 1,
                    borderColor: THEME.border,
                    backgroundColor: THEME.surface,
                    paddingHorizontal: SPACE.lg,
                    paddingVertical: SPACE.md,
                    color: THEME.text,
                    fontSize: 14,
                    marginBottom: SPACE.lg,
                  }}
                />

                <GradientCTA label={t("meds.logCta")} disabled={savingMed} onPress={saveMed} />
                </ScrollView>
              </View>
            )}
          </View>
        </Animated.View>
      </Animated.View>
      </View>
    </View>
  );
}
