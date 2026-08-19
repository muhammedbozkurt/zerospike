import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  BackHandler,
  Easing,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import { THEME, RADIUS } from "../lib/theme/tokens";
import { IconTile, GradientCTA, withAlpha } from "./rich";
import { InlineDateTimePicker } from "./InlineDateTimePicker";
import { DirIcon } from "./DirIcon";
import { hapticSelect, hapticSuccess } from "../lib/haptics";
import { useApp } from "../lib/store/AppContext";
import { useFeedback } from "./Feedback";
import { listSavedMeds, logMed, upsertMedUse } from "../lib/db/meds";
import { logEvent } from "../lib/analytics";
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
  // Saved-medication chips (schema v18 registry, lib/db/meds.ts): the profile's
  // own list, most-recently-used first, tap-to-fill. Empty until the fetch
  // below resolves, so a fresh list renders no chip row rather than a flash of
  // placeholders (and stays empty for a profile that has never saved one).
  const [medChips, setMedChips] = useState<string[]>([]);
  // Whether the name field has already been pre-filled for THIS sheet open, so
  // the chips effect below (which also re-runs on a profile switch while the
  // sheet stays open) only ever pre-fills once and never overwrites what the
  // user has since typed.
  const prefilledMedNameRef = useRef(false);

  useEffect(() => {
    if (!visible) return;
    setStep(openMedDirect ? "med" : "grid");
    setMedName("");
    setMedNote("");
    setMedAt(null);
    setMedTimePickerOpen(false);
    setSavingMed(false);
    prefilledMedNameRef.current = false;
    anim.setValue(0);
    Animated.timing(anim, {
      toValue: 1,
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible, openMedDirect, anim]);

  // Kept separate from the reset effect above so a profile switch mid-session
  // cannot restart the sheet's open animation - it only ever refills the chips
  // (and, once, pre-fills the name field).
  useEffect(() => {
    if (!visible || !activeProfile) {
      setMedChips([]);
      return;
    }
    let cancelled = false;
    void listSavedMeds(activeProfile.id).then((rows) => {
      if (cancelled) return;
      const names = rows.map((r) => r.name);
      setMedChips(names);
      // Pre-fills the last-used medication so logging a repeat entry needs no
      // typing at all; the user can still clear or change it (see
      // prefilledMedNameRef above for why this only ever fires once per open).
      if (!prefilledMedNameRef.current && names.length > 0) {
        prefilledMedNameRef.current = true;
        setMedName(names[0]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [visible, activeProfile]);

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
      logEvent("log_added", { kind: "med", source: "manual" });
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
          style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.7)" }]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t("common.close")}
        />
      </Animated.View>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1, justifyContent: "flex-end" }}
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
            style={{
              backgroundColor: THEME.bg.g1,
              borderTopLeftRadius: RADIUS["2xl"],
              borderTopRightRadius: RADIUS["2xl"],
              borderTopWidth: 1,
              borderColor: THEME.border,
              paddingHorizontal: 16,
              paddingTop: 8,
              paddingBottom: insets.bottom + 20,
            }}
          >
            <View style={{ alignItems: "center", marginBottom: 6 }}>
              <View
                style={{
                  width: 40,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: THEME.border,
                }}
              />
            </View>
            {step === "grid" ? (
              // The cards carry their own labels, so a question above them
              // would only repeat what they already say.
              <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
                {options.map((opt) => (
                  <Pressable
                    key={opt.key}
                    // "med" stays on this sheet (opens the form below) instead
                    // of closing + navigating like the other cards.
                    onPress={() => (opt.key === "med" ? opt.onPress() : select(opt.onPress))}
                    style={{
                      flex: 1,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: THEME.glass,
                      borderWidth: 1,
                      borderColor: THEME.border,
                      borderRadius: RADIUS.lg,
                      paddingVertical: 18,
                      gap: 10,
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={opt.label}
                  >
                    <IconTile icon={opt.icon} size={48} radius={14} hero />
                    <Text
                      style={{ color: THEME.ink, fontWeight: "700", fontSize: 13 }}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.85}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : (
              <View style={{ marginTop: 4 }}>
                <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 14 }}>
                  <Pressable
                    onPress={() => setStep("grid")}
                    hitSlop={12}
                    accessibilityRole="button"
                    accessibilityLabel={t("common.back")}
                    style={{ padding: 4, marginLeft: -4 }}
                  >
                    <DirIcon name="chevron-back" size={22} color={THEME.muted} />
                  </Pressable>
                  <Text
                    style={{
                      color: THEME.ink,
                      fontSize: 16,
                      fontWeight: "800",
                      flex: 1,
                      textAlign: "center",
                      marginRight: 26,
                    }}
                  >
                    {t("meds.title")}
                  </Text>
                </View>

                {medChips.length > 0 ? (
                  // One-tap fill, never a submit: picking a chip only writes
                  // the name field below, so the time/note the user already
                  // set (or is about to) survives the tap.
                  <View
                    style={{
                      flexDirection: "row",
                      flexWrap: "wrap",
                      gap: 8,
                      marginBottom: 10,
                    }}
                  >
                    {medChips.map((name) => (
                      <Pressable
                        key={name}
                        onPress={() => {
                          hapticSelect();
                          setMedName(name);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={name}
                        style={{
                          borderRadius: RADIUS.full,
                          borderWidth: 1,
                          borderColor: withAlpha(THEME.accent, 0.25),
                          backgroundColor: THEME.glass,
                          paddingHorizontal: 12,
                          paddingVertical: 6,
                        }}
                      >
                        <Text
                          style={{ color: THEME.accent, fontSize: 12 }}
                          numberOfLines={1}
                        >
                          {name}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}

                <TextInput
                  value={medName}
                  onChangeText={setMedName}
                  placeholder={t("meds.nameOptional")}
                  placeholderTextColor={THEME.muted}
                  accessibilityLabel={t("meds.nameOptional")}
                  style={{
                    borderRadius: RADIUS.md,
                    borderWidth: 1,
                    borderColor: THEME.border,
                    backgroundColor: THEME.glass,
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    color: THEME.ink,
                    fontSize: 14,
                    marginBottom: 12,
                  }}
                />

                <Pressable
                  onPress={() => {
                    Keyboard.dismiss();
                    setMedTimePickerOpen((v) => !v);
                  }}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    borderRadius: RADIUS.md,
                    borderWidth: 1,
                    borderColor: THEME.border,
                    backgroundColor: THEME.glass,
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    marginBottom: 14,
                  }}
                >
                  <Ionicons name="time-outline" size={16} color={THEME.muted} />
                  <Text style={{ color: THEME.ink, marginLeft: 8, fontSize: 13 }}>
                    {relativeDay((medAt ?? new Date()).toISOString(), {
                      today: t("common.today"),
                      yesterday: t("common.yesterday"),
                    })}
                    {" · "}
                    {formatTime((medAt ?? new Date()).toISOString())}
                  </Text>
                </Pressable>
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
                  placeholderTextColor={THEME.muted}
                  accessibilityLabel={t("injection.notePlaceholder")}
                  returnKeyType="done"
                  style={{
                    borderRadius: RADIUS.md,
                    borderWidth: 1,
                    borderColor: THEME.border,
                    backgroundColor: THEME.glass,
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    color: THEME.ink,
                    fontSize: 14,
                    marginBottom: 14,
                  }}
                />

                <GradientCTA label={t("meds.logCta")} disabled={savingMed} onPress={saveMed} />
              </View>
            )}
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}
