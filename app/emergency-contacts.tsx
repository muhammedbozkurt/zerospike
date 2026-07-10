import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Linking,
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
import {
  Contact,
  ContactField,
  requestPermissionsAsync as requestContactsPermission,
} from "expo-contacts";
import { getLocales } from "expo-localization";

import {
  getEmergencyContacts,
  setEmergencyContacts,
  defaultCallingCode,
  normalizePhoneWithRegion,
  type EmergencyContact,
} from "../lib/services/emergency";
import { Button } from "../components/ui";
import { FeedbackHost, useFeedback } from "../components/Feedback";
import { hapticSuccess, hapticWarning } from "../lib/haptics";

/** A phone-bearing address-book entry, flattened for the in-app list. */
interface DeviceContact {
  id: string;
  name: string;
  numbers: string[];
}

// The picker reads only what it needs. Note: expo-contacts v57's legacy
// getContactsAsync / presentContactPickerAsync throw at runtime, so this uses
// the class API. The native picker is avoided on purpose: this screen is a modal
// and iOS cannot present a second native modal from the root over that stack.
// Nickname and company back up fullName: number-only, business and messenger
// entries have no full name, and would otherwise render as "number over number".
const PICKER_FIELDS = [
  ContactField.FULL_NAME,
  ContactField.NICKNAME,
  ContactField.COMPANY,
  ContactField.PHONES,
] as const;

function digitsOnly(value: string): string {
  return value.replace(/[^0-9]/g, "");
}

export default function EmergencyContactsScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { toast } = useFeedback();

  // The device region gives the default calling code. It is pre-filled into the
  // phone field as a real, editable value (not a placeholder).
  const callingCode = useMemo(() => {
    try {
      return defaultCallingCode(getLocales()[0]?.regionCode);
    } catch {
      return "";
    }
  }, []);
  const phonePrefill = callingCode ? `${callingCode} ` : "";

  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState(phonePrefill);
  const [nameError, setNameError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerDenied, setPickerDenied] = useState(false);
  const [deviceContacts, setDeviceContacts] = useState<DeviceContact[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    getEmergencyContacts().then(setContacts);
  }, []);

  async function persist(next: EmergencyContact[]) {
    setContacts(next);
    await setEmergencyContacts(next);
  }

  async function saveContact(contactName: string, e164: string) {
    await persist([...contacts, { name: contactName, phone: e164 }]);
    hapticSuccess();
    setName("");
    setPhone(phonePrefill);
    setNameError(null);
    setPhoneError(null);
  }

  // Manual add: both problems are reported inline, under their own field.
  async function addTyped() {
    const trimmedName = name.trim();
    const e164 = normalizePhoneWithRegion(phone, callingCode);
    setNameError(trimmedName ? null : t("emergency.nameRequired"));
    setPhoneError(e164 ? null : t("emergency.invalidPhone"));
    if (!trimmedName || !e164) return;
    await saveContact(trimmedName, e164);
  }

  async function remove(index: number) {
    hapticWarning();
    await persist(contacts.filter((_, i) => i !== index));
  }

  // In-app picker: read the address book into a searchable list. On iOS 18
  // "limited" access this returns the subset the user allowed, which is enough.
  async function openPicker() {
    setPickerOpen(true);
    setPickerDenied(false);
    setQuery("");
    setPickerLoading(true);
    try {
      const permission = await requestContactsPermission();
      if (!permission.granted) {
        setPickerDenied(true);
        toast(t("emergency.pickDenied"), "info");
        return;
      }
      const rows = await Contact.getAllDetails(PICKER_FIELDS);
      const list: DeviceContact[] = rows
        .map((row) => ({
          id: row.id,
          name: (row.fullName || row.nickname || row.company || "").trim(),
          numbers: (row.phones ?? [])
            .map((p) => (p.number ?? "").trim())
            .filter((n) => n.length > 0),
        }))
        .filter((c) => c.numbers.length > 0)
        // Named contacts alphabetically first; the nameless ones (which sort
        // ahead of every letter as "") go to the end where they belong.
        .sort((a, b) => {
          const aNamed = a.name.length > 0;
          const bNamed = b.name.length > 0;
          if (aNamed !== bNamed) return aNamed ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      setDeviceContacts(list);
    } catch {
      setPickerOpen(false);
      toast(t("emergency.pickFailed"), "error");
    } finally {
      setPickerLoading(false);
    }
  }

  // A picked number goes through the same normalization. If it cannot be
  // qualified, drop it into the form with an inline error instead of failing.
  function pickNumber(contactName: string, rawNumber: string) {
    setPickerOpen(false);
    const display = contactName || rawNumber;
    const e164 = normalizePhoneWithRegion(rawNumber, callingCode);
    if (!e164) {
      setName(display);
      setPhone(rawNumber);
      setNameError(null);
      setPhoneError(t("emergency.invalidPhone"));
      return;
    }
    void saveContact(display, e164);
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return deviceContacts;
    const qDigits = digitsOnly(q);
    return deviceContacts.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (qDigits.length > 0 &&
          c.numbers.some((n) => digitsOnly(n).includes(qDigits)))
    );
  }, [deviceContacts, query]);

  return (
    <View className="flex-1 bg-zinc-950">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1"
        style={{ paddingTop: insets.top }}
      >
        <View className="flex-row items-center justify-between px-4 py-2">
          {pickerOpen ? (
            <Pressable onPress={() => setPickerOpen(false)} hitSlop={10} className="p-1">
              <Ionicons name="chevron-back" size={24} color="#a1a1aa" />
            </Pressable>
          ) : null}
          <Text className="text-zinc-50 text-xl font-bold flex-1 ml-1">
            {pickerOpen ? t("emergency.pickFromContacts") : t("emergency.title")}
          </Text>
          <Pressable
            onPress={() => (pickerOpen ? setPickerOpen(false) : router.back())}
            hitSlop={10}
            className="p-1"
          >
            <Ionicons name="close" size={26} color="#71717a" />
          </Pressable>
        </View>

        {pickerOpen ? (
          <View className="flex-1 px-5">
            <View className="flex-row items-center rounded-xl bg-zinc-800/80 border border-zinc-700 px-3 mb-3">
              <Ionicons name="search" size={16} color="#71717a" />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={t("emergency.searchPlaceholder")}
                placeholderTextColor="#52525b"
                autoCorrect={false}
                className="flex-1 px-2 py-3 text-zinc-50"
              />
            </View>

            {pickerLoading ? (
              <View className="items-center py-10">
                <ActivityIndicator color="#22d3ee" />
              </View>
            ) : pickerDenied ? (
              <View className="rounded-2xl bg-zinc-900 border border-zinc-800 p-5 items-center">
                <Ionicons name="lock-closed-outline" size={26} color="#71717a" />
                <Text className="text-zinc-300 text-center mt-3 mb-4 leading-5">
                  {t("emergency.permissionHint")}
                </Text>
                <Button
                  label={t("settings.openSystemSettings")}
                  onPress={() => Linking.openSettings().catch(() => {})}
                />
              </View>
            ) : deviceContacts.length === 0 ? (
              <Text className="text-zinc-500 text-center py-10 px-6 leading-5">
                {t("emergency.noDeviceContacts")}
              </Text>
            ) : (
              <FlatList
                data={filtered}
                keyExtractor={(c) => c.id}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
                ListEmptyComponent={
                  <Text className="text-zinc-500 text-center py-10">
                    {t("emergency.noResults")}
                  </Text>
                }
                renderItem={({ item }) => (
                  <View className="mb-2.5">
                    <Text className="text-zinc-400 text-xs font-semibold px-1 mb-1">
                      {item.name || t("emergency.unnamedContact")}
                    </Text>
                    {item.numbers.map((number) => (
                      <Pressable
                        key={`${item.id}-${number}`}
                        onPress={() => pickNumber(item.name, number)}
                        className="flex-row items-center rounded-2xl bg-zinc-900 border border-zinc-800 px-4 py-3 mb-1.5 active:bg-zinc-800"
                      >
                        <Text className="text-zinc-100 flex-1">{number}</Text>
                        <Ionicons name="add-circle-outline" size={20} color="#22d3ee" />
                      </Pressable>
                    ))}
                  </View>
                )}
              />
            )}
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 24 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text className="text-zinc-400 leading-5 mb-5">
              {t("emergency.subtitle")}
            </Text>

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
                onChangeText={(v) => {
                  setName(v);
                  if (nameError) setNameError(null);
                }}
                placeholder={t("emergency.namePlaceholder")}
                placeholderTextColor="#52525b"
                className="rounded-xl bg-zinc-800/80 border border-zinc-700 px-4 py-3 text-zinc-50"
              />
              {nameError ? (
                <Text className="text-rose-400 text-xs mt-1.5 ml-1">{nameError}</Text>
              ) : null}

              <TextInput
                value={phone}
                onChangeText={(v) => {
                  setPhone(v);
                  if (phoneError) setPhoneError(null);
                }}
                placeholder={t("emergency.phonePlaceholder")}
                placeholderTextColor="#52525b"
                keyboardType="phone-pad"
                className="rounded-xl bg-zinc-800/80 border border-zinc-700 px-4 py-3 text-zinc-50 mt-2.5"
              />
              {phoneError ? (
                <Text className="text-rose-400 text-xs mt-1.5 ml-1">{phoneError}</Text>
              ) : null}

              <View className="h-3" />
              <Button label={t("emergency.add")} onPress={addTyped} />
              <Pressable
                onPress={openPicker}
                className="flex-row items-center justify-center py-3 mt-1"
              >
                <Ionicons name="people-outline" size={18} color="#22d3ee" />
                <Text className="text-brand font-medium ml-2">
                  {t("emergency.pickFromContacts")}
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        )}
      </KeyboardAvoidingView>
      <FeedbackHost />
    </View>
  );
}
