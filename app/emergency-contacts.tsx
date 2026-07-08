import React, { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
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
import * as Contacts from "expo-contacts";

import {
  getEmergencyContacts,
  setEmergencyContacts,
  normalizePhone,
  type EmergencyContact,
} from "../lib/services/emergency";
import { Button } from "../components/ui";
import { useFeedback } from "../components/Feedback";
import { hapticSuccess, hapticWarning } from "../lib/haptics";

export default function EmergencyContactsScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { toast } = useFeedback();
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  useEffect(() => {
    getEmergencyContacts().then(setContacts);
  }, []);

  async function persist(next: EmergencyContact[]) {
    setContacts(next);
    await setEmergencyContacts(next);
  }

  async function add(n: string, p: string) {
    const trimmedName = n.trim();
    const trimmedPhone = normalizePhone(p);
    if (!trimmedName || trimmedPhone.replace("+", "").length < 3) {
      toast(t("emergency.invalid"), "error");
      return;
    }
    await persist([...contacts, { name: trimmedName, phone: trimmedPhone }]);
    hapticSuccess();
    setName("");
    setPhone("");
  }

  async function remove(index: number) {
    hapticWarning();
    await persist(contacts.filter((_, i) => i !== index));
  }

  async function pickFromContacts() {
    try {
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== "granted") {
        toast(t("emergency.pickDenied"), "info");
        return;
      }
      const picked = await Contacts.presentContactPickerAsync();
      if (!picked) return;
      const n = picked.name ?? picked.firstName ?? "";
      const p = picked.phoneNumbers?.[0]?.number ?? "";
      if (p) await add(n, p);
      else toast(t("emergency.noPhone"), "info");
    } catch {
      toast(t("emergency.pickFailed"), "error");
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      className="flex-1 bg-zinc-950"
      style={{ paddingTop: insets.top }}
    >
      <View className="flex-row items-center justify-between px-4 py-2">
        <Text className="text-zinc-50 text-xl font-bold">
          {t("emergency.title")}
        </Text>
        <Pressable onPress={() => router.back()} hitSlop={10} className="p-1">
          <Ionicons name="close" size={26} color="#71717a" />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 24 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text className="text-zinc-400 leading-5 mb-5">{t("emergency.subtitle")}</Text>

        {contacts.map((c, i) => (
          <View
            key={`${c.phone}-${i}`}
            className="flex-row items-center rounded-2xl bg-zinc-900 border border-zinc-800 px-4 py-3 mb-2.5"
          >
            <View className="flex-1">
              <Text className="text-zinc-50 font-semibold">{c.name}</Text>
              <Text className="text-zinc-500 text-sm">{c.phone}</Text>
            </View>
            <Pressable onPress={() => remove(i)} hitSlop={8} className="p-1">
              <Ionicons name="trash-outline" size={20} color="#fb7185" />
            </Pressable>
          </View>
        ))}

        {/* Add form */}
        <View className="rounded-2xl bg-zinc-900 border border-zinc-800 p-4 mt-2">
          <Text className="text-zinc-300 font-semibold mb-3">
            {t("emergency.addTitle")}
          </Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder={t("emergency.namePlaceholder")}
            placeholderTextColor="#52525b"
            className="rounded-xl bg-zinc-800/80 border border-zinc-700 px-4 py-3 text-zinc-50 mb-2.5"
          />
          <TextInput
            value={phone}
            onChangeText={setPhone}
            placeholder={t("emergency.phonePlaceholder")}
            placeholderTextColor="#52525b"
            keyboardType="phone-pad"
            className="rounded-xl bg-zinc-800/80 border border-zinc-700 px-4 py-3 text-zinc-50 mb-3"
          />
          <Button label={t("emergency.add")} onPress={() => add(name, phone)} />
          <Pressable
            onPress={pickFromContacts}
            className="flex-row items-center justify-center py-3 mt-1"
          >
            <Ionicons name="people-outline" size={18} color="#22d3ee" />
            <Text className="text-brand font-medium ml-2">
              {t("emergency.pickFromContacts")}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
