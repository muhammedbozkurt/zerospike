import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { useApp } from "../lib/store/AppContext";
import { createProfile } from "../lib/db/profiles";
import { Button } from "./ui";

export function ProfileSwitcher() {
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
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

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

  async function handleCreate() {
    if (!isProUser) return; // backstop; entry is gated in handleAddPress
    const trimmed = name.trim();
    if (!trimmed) return;
    const p = await createProfile({ name: trimmed });
    await refreshProfiles();
    await setActiveProfileId(p.id);
    bumpData();
    setName("");
    setAdding(false);
    setOpen(false);
    // Let the user set this profile's own targets instead of silent defaults.
    router.push("/profile-setup");
  }

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        className="flex-row items-center rounded-full bg-glass border border-hair px-3 py-1.5"
      >
        <Ionicons name="person-circle-outline" size={18} color="#a1a1aa" />
        <Text className="text-zinc-200 font-medium text-sm mx-1.5" numberOfLines={1}>
          {activeProfile?.name ?? "-"}
        </Text>
        <Ionicons name="chevron-down" size={14} color="#71717a" />
      </Pressable>

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
          >
            <Pressable
              className="rounded-3xl bg-glass border border-hair p-5"
              onPress={(e) => e.stopPropagation()}
            >
              <Text className="text-zinc-50 text-lg font-bold mb-3">
                {t("profiles.switch")}
              </Text>

              {profiles.map((p) => {
                const active = p.id === activeProfile?.id;
                return (
                  <Pressable
                    key={p.id}
                    onPress={() => handleSelect(p.id)}
                    className={`flex-row items-center rounded-2xl px-4 py-3 mb-2 border ${
                      active
                        ? "bg-brand/10 border-brand/40"
                        : "bg-zinc-800/60 border-zinc-700"
                    }`}
                  >
                    <Ionicons
                      name={active ? "person" : "person-outline"}
                      size={18}
                      color={active ? "#2ee6ff" : "#a1a1aa"}
                    />
                    <Text
                      className={`flex-1 ml-3 font-medium ${
                        active ? "text-brand" : "text-zinc-200"
                      }`}
                    >
                      {p.name}
                    </Text>
                    {active ? (
                      <Ionicons name="checkmark-circle" size={18} color="#2ee6ff" />
                    ) : null}
                  </Pressable>
                );
              })}

              {adding ? (
                <View className="mt-1">
                  <TextInput
                    value={name}
                    onChangeText={setName}
                    autoFocus
                    placeholder={t("profiles.newNamePlaceholder")}
                    placeholderTextColor="#52525b"
                    className="rounded-xl bg-zinc-800 border border-zinc-700 px-4 py-3 text-zinc-50 mb-3"
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
                      color="#e4e4e7"
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
