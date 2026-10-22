import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { OverlayModal as Modal } from "./OverlayModal";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { useApp } from "../lib/store/AppContext";
import { FONT_CAP } from "../lib/layoutForFontScale";
import { createProfile } from "../lib/db/profiles";
import { Button } from "./ui";
import { ELEVATION, INPUT_TEXT, THEME } from "../lib/theme/tokens";
import { useLayout } from "../lib/useLayout";
import { displayProfileName } from "../lib/profileName";

/** Cap for a centered, content-sized dialog card on a tablet (does not
 *  stretch edge to edge like a bottom sheet). */
const DIALOG_MAX_WIDTH = 520;

/**
 * Own trigger pill + modal by default (every existing call site just renders
 * `<ProfileSwitcher />`). `open`/`onOpenChange` let a caller drive the modal from
 * its own row instead (settings/data.tsx's "multi-profile" row) without a second,
 * competing implementation of the picker: pass `hideTrigger` to drop the pill and
 * control `open` externally: the rest of the component (list, add/create) is
 * unchanged either way.
 */
export function ProfileSwitcher({
  open: controlledOpen,
  onOpenChange,
  hideTrigger,
  nameMaxWidth = 120,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
  /** Cap for the profile name inside the pill; crowded headers pass a smaller one. */
  nameMaxWidth?: number;
} = {}) {
  const { t } = useTranslation();
  const router = useRouter();
  const {
    profiles,
    activeProfile,
    isProUser,
    setActiveProfileId,
    refreshProfiles,
    bumpData,
  } = useApp();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const { height: winHeight } = useWindowDimensions();
  const { isWide } = useLayout();

  async function handleSelect(id: string) {
    await setActiveProfileId(id);
    setOpen(false);
  }

  // Multi-profile (family/caregiver) is a Pro feature; free tier keeps 1.
  function handleAddPress() {
    if (!isProUser) {
      setOpen(false);
      router.push({ pathname: "/paywall", params: { reason: "profiles" } });
      return;
    }
    setAdding(true);
  }

  // A free/single-profile user has nothing to pick from: the switch list would
  // just show the one active profile next to a locked add button. Skip straight
  // to the paywall instead of opening a list modal with nothing to switch.
  function handlePillPress() {
    if (!isProUser && profiles.length <= 1) {
      router.push({ pathname: "/paywall", params: { reason: "profiles" } });
      return;
    }
    setOpen(true);
  }

  async function handleCreate() {
    if (!isProUser) return; // backstop; entry is gated in handleAddPress
    const trimmed = name.trim();
    if (!trimmed) return;
    const previousProfileId = activeProfile?.id ?? null;
    const p = await createProfile({ name: trimmed });
    await refreshProfiles();
    await setActiveProfileId(p.id);
    bumpData();
    setName("");
    setAdding(false);
    setOpen(false);
    // Let the user set this profile's own targets instead of silent defaults.
    //
    // The switch above has to happen BEFORE the screen opens - targets,
    // reminders and the measurement layout it offers are all profile-scoped -
    // which is exactly why the two params below matter: closing that screen
    // without saving used to leave the device on a nameless, never-configured
    // profile with no way to tell it apart from a real one. `created` marks
    // this as a draft and `previousProfileId` says where to go back to, so
    // cancelling a creation deletes the draft and restores the profile that was
    // active a moment ago (see discardDraftRef in app/profile-setup.tsx).
    router.push({
      pathname: "/profile-setup",
      params: {
        created: "1",
        ...(previousProfileId ? { previousProfileId } : {}),
      },
    });
  }

  return (
    <>
      {!hideTrigger ? (
        <Pressable
          onPress={handlePillPress}
          accessibilityRole="button"
          accessibilityLabel={t("profiles.switch")}
          className="flex-row items-center rounded-full bg-glass border border-hair px-3 py-1.5"
        >
          <Ionicons name="person-circle-outline" size={18} color={THEME.textMuted} />
          <Text
            className="text-ink font-medium text-sm mx-1.5"
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.85}
            maxFontSizeMultiplier={FONT_CAP.badge}
            style={{ maxWidth: nameMaxWidth }}
          >
            {activeProfile ? displayProfileName(activeProfile, t) : "-"}
          </Text>
          <Ionicons name="chevron-down" size={14} color={THEME.textMuted} />
        </Pressable>
      ) : null}

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        {/* The "new profile" field autofocuses and its Create/Cancel row sits
            right under it, with nothing to scroll. Lift the whole dialog. */}
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          className="flex-1"
        >
          <Pressable
            className="flex-1 bg-black/70 justify-center px-6"
            onPress={() => setOpen(false)}
            onAccessibilityEscape={() => setOpen(false)}
            accessible={false}
            focusable={false}
          >
            <Pressable
              className="rounded-3xl border border-hair p-5"
              style={[
                {
                  backgroundColor: THEME.surfaceRaised,
                  shadowColor: ELEVATION.sheet.shadowColor,
                  shadowOpacity: 0.5,
                  shadowRadius: 28,
                  shadowOffset: { width: 0, height: 12 },
                  ...ELEVATION.popover,
                },
                isWide ? { maxWidth: DIALOG_MAX_WIDTH, alignSelf: "center" } : undefined,
              ]}
              onPress={(e) => e.stopPropagation()}
              accessible={false}
              focusable={false}
              importantForAccessibility="auto"
            >
              <Text className="text-ink text-lg font-bold mb-3">
                {t("profiles.switch")}
              </Text>

              {/* Pro allows unlimited profiles (family/caregiver use), so this list
                  has no fixed length: capped height + scroll keeps the Add/Create
                  row reachable instead of it being pushed off-screen. */}
              <ScrollView
                style={{ maxHeight: winHeight * 0.5 }}
                showsVerticalScrollIndicator={false}
              >
                {profiles.map((p) => {
                  const active = p.id === activeProfile?.id;
                  return (
                    <Pressable
                      key={p.id}
                      onPress={() => handleSelect(p.id)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={displayProfileName(p, t)}
                      className={`flex-row items-center rounded-2xl px-4 py-3 mb-2 border ${
                        active
                          ? "bg-brand/10 border-brand/40"
                          : "bg-glass border-hair"
                      }`}
                    >
                      <Ionicons
                        name={active ? "person" : "person-outline"}
                        size={18}
                        color={active ? THEME.accent : THEME.textMuted}
                      />
                      <Text
                        className={`flex-1 ml-3 font-medium ${
                          active ? "text-brand" : "text-ink"
                        }`}
                      >
                        {displayProfileName(p, t)}
                      </Text>
                      {active ? (
                        <Ionicons name="checkmark-circle" size={18} color={THEME.accent} />
                      ) : null}
                    </Pressable>
                  );
                })}
              </ScrollView>

              {adding ? (
                <View className="mt-1">
                  <TextInput
                    value={name}
                    onChangeText={setName}
                    autoFocus
                    placeholder={t("profiles.newNamePlaceholder")}
                    placeholderTextColor={THEME.placeholder}
                    className="rounded-xl bg-glass border border-hair px-4 py-3 text-ink mb-3"
                    style={INPUT_TEXT}
                  />
                  <View className="flex-row gap-3">
                    <View className="flex-1">
                      <Button
                        label={t("common.cancel")}
                        variant="secondary"
                        onPress={() => {
                          setAdding(false);
                          setName("");
                        }}
                      />
                    </View>
                    <View className="flex-1">
                      <Button label={t("profiles.create")} onPress={handleCreate} />
                    </View>
                  </View>
                </View>
              ) : (
                <Button
                  label={t("profiles.add")}
                  variant="secondary"
                  icon={
                    <Ionicons
                      name={isProUser ? "add" : "lock-closed"}
                      size={isProUser ? 18 : 15}
                      color={THEME.text}
                    />
                  }
                  onPress={handleAddPress}
                />
              )}
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}
