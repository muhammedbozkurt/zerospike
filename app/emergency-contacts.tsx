import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  Linking,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View, Platform } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  AppBackground,
  ConicAvatar,
  GlassCard,
  GradientCTA,
  IconTile,
} from "../components/rich";
import { withAlpha } from "../components/rich/GlassCard";
import { ScreenHeader } from "../components/ScreenHeader";
import { Button } from "../components/ui";
import { GLUCOSE_RICH, INPUT_TEXT, MODAL_TOP_PAD, RADIUS, THEME } from "../lib/theme/tokens";
import { upper } from "../lib/upper";
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
  contactPhoneKey,
  defaultCallingCode,
  normalizePhoneWithRegion,
  planContactAdditions,
  type ContactCandidate,
  type EmergencyContact,
} from "../lib/services/emergency";
import { FeedbackHost, useFeedback } from "../components/Feedback";
import { Skeleton } from "../components/Skeleton";
import { hapticSuccess, hapticWarning } from "../lib/haptics";
import { keyboardAwareScrollProps } from "../lib/keyboard";

/** Two-letter mark for a contact avatar (mockup 07's contact rows). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "#";
  if (parts.length === 1) return upper(parts[0].slice(0, 2));
  return upper(parts[0][0] + parts[1][0]);
}

const inputStyle = () =>
  ({
  borderRadius: RADIUS.md,
  borderWidth: 1,
  borderColor: THEME.border,
  backgroundColor: THEME.surface,
  paddingHorizontal: 14,
  paddingVertical: 12,
  color: THEME.text,
  }) as const;

/** A phone-bearing address-book entry, flattened for the in-app list. */
interface DeviceContact {
  id: string;
  name: string;
  numbers: string[];
}

/** One row of the picker is one number, not one person. Contact ids carry no
 *  "|", so each (contact, number) pair gets a distinct key. */
function rowKey(contactId: string, number: string): string {
  return `${contactId}|${number}`;
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

function EmergencyContactsScreen() {
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
  // The saved-contacts list sits ABOVE the add form; if it were left to pop in
  // once loaded, the form and the "pick from contacts" CTA would shove down
  // right as someone is about to use them. Both wait on this instead.
  const [contactsLoaded, setContactsLoaded] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState(phonePrefill);
  const [nameError, setNameError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerDenied, setPickerDenied] = useState(false);
  const [deviceContacts, setDeviceContacts] = useState<DeviceContact[]>([]);
  const [query, setQuery] = useState("");
  // Ticked numbers, keyed by row. Survives searching and re-filtering.
  const [selected, setSelected] = useState<Map<string, ContactCandidate>>(new Map());

  useEffect(() => {
    getEmergencyContacts().then((list) => {
      setContacts(list);
      setContactsLoaded(true);
    });
  }, []);

  // Android hardware back, while the picker is open, must match the header's
  // own back arrow: close the picker, not the whole screen (same pattern as
  // Feedback.tsx's overlay handler).
  useEffect(() => {
    if (!pickerOpen) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setPickerOpen(false);
      return true;
    });
    return () => sub.remove();
  }, [pickerOpen]);

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
    setSelected(new Map());
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

  function toggleNumber(contact: DeviceContact, rawNumber: string) {
    const key = rowKey(contact.id, rawNumber);
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(key)) next.delete(key);
      else next.set(key, { name: contact.name, number: rawNumber });
      return next;
    });
  }

  /**
   * Adds every ticked number in one go. Numbers already saved cannot be ticked,
   * and two numbers that qualify to the same E.164 are stored once. Anything
   * that cannot be qualified is reported rather than dropped in silence.
   */
  async function addSelected() {
    const candidates = [...selected.values()];
    if (candidates.length === 0) return;
    const plan = planContactAdditions(contacts, candidates, callingCode);

    // A single unqualifiable pick is worth recovering: drop it into the form
    // with its inline error, the way the old one-tap picker did.
    if (plan.add.length === 0 && plan.invalid.length === 1) {
      const only = plan.invalid[0];
      setPickerOpen(false);
      setSelected(new Map());
      setName(only.name || only.number);
      setPhone(only.number);
      setNameError(null);
      setPhoneError(t("emergency.invalidPhone"));
      return;
    }

    if (plan.add.length > 0) {
      await persist([...contacts, ...plan.add]);
      hapticSuccess();
    } else {
      hapticWarning();
    }

    setPickerOpen(false);
    setSelected(new Map());

    if (plan.add.length > 0 && plan.invalid.length > 0) {
      toast(
        t("emergency.addedWithInvalid", {
          added: plan.add.length,
          invalid: plan.invalid.length,
        }),
        "info"
      );
    } else if (plan.add.length > 0) {
      toast(t("emergency.addedSummary", { n: plan.add.length }), "success");
    } else {
      toast(t("emergency.invalidNumbers", { n: plan.invalid.length }), "error");
    }
  }

  // Numbers already saved, keyed exactly as planContactAdditions keys them, so
  // the "added" marker and the batch's duplicate check never disagree.
  const savedPhones = useMemo(
    () => new Set(contacts.map((c) => contactPhoneKey(c.phone, callingCode))),
    [contacts, callingCode]
  );

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
    <AppBackground>
      <View className="flex-1" style={{ paddingTop: Math.max(insets.top, MODAL_TOP_PAD) }}>
        {/* Header (mockup 07: back, centred title, add action) */}
        <ScreenHeader
          title={pickerOpen ? t("emergency.pickFromContacts") : t("emergency.title")}
          onBack={() => (pickerOpen ? setPickerOpen(false) : router.back())}
          backIcon={pickerOpen ? "chevron-back" : "close"}
          accessibilityLabel={t("common.close")}
          right={
            pickerOpen ? undefined : (
              <Pressable
                onPress={openPicker}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t("emergency.pickFromContacts")}
              >
                <IconTile icon="add" size={30} radius={10} />
              </Pressable>
            )
          }
        />

        {pickerOpen ? (
          <View className="flex-1 px-5">
            {/* Selection bar. Sits above the search field so the count and the
                Add button stay put while the list filters underneath. */}
            {!pickerLoading && !pickerDenied && deviceContacts.length > 0 ? (
              <View className="flex-row items-center justify-between mb-3">
                <Text style={{ color: THEME.textMuted, fontSize: 13 }}>
                  {t("emergency.selectedCount", { n: selected.size })}
                </Text>
                <Button
                  size="sm"
                  onPress={addSelected}
                  disabled={selected.size === 0}
                  label={t("emergency.add")}
                />
              </View>
            ) : null}

            <View
              className="flex-row items-center rounded-xl px-3 mb-3"
              style={{ borderWidth: 1, borderColor: THEME.border, backgroundColor: THEME.surface }}
            >
              <Ionicons name="search" size={16} color={THEME.textMuted} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={t("emergency.searchPlaceholder")}
                placeholderTextColor={withAlpha(THEME.textMuted, 0.7)}
                autoCorrect={false}
                className="flex-1 px-2 py-3"
                style={[INPUT_TEXT, { color: THEME.text }]}
              />
            </View>

            {pickerLoading ? (
              <View className="items-center py-10">
                <ActivityIndicator color={THEME.accent} />
              </View>
            ) : pickerDenied ? (
              <GlassCard style={{ alignItems: "center", paddingVertical: 20 }}>
                <IconTile icon="lock-closed-outline" size={44} radius={14} tint={THEME.textMuted} />
                <Text
                  style={{
                    color: THEME.textMuted,
                    textAlign: "center",
                    marginTop: 12,
                    marginBottom: 14,
                    lineHeight: 20,
                  }}
                >
                  {t("emergency.permissionHint")}
                </Text>
                <GradientCTA
                  label={t("settings.openSystemSettings")}
                  onPress={() => Linking.openSettings().catch(() => {})}
                  style={{ alignSelf: "stretch" }}
                />
              </GlassCard>
            ) : deviceContacts.length === 0 ? (
              <GlassCard style={{ alignItems: "center", paddingVertical: 20 }}>
                <IconTile icon="people-outline" size={44} radius={14} tint={THEME.textMuted} />
                <Text
                  style={{
                    color: THEME.textMuted,
                    textAlign: "center",
                    marginTop: 12,
                    lineHeight: 20,
                  }}
                >
                  {t("emergency.noDeviceContacts")}
                </Text>
              </GlassCard>
            ) : (
              <FlatList
                {...keyboardAwareScrollProps}
                data={filtered}
                keyExtractor={(c) => c.id}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
                ListEmptyComponent={
                  <Text style={{ color: THEME.textMuted, textAlign: "center", paddingVertical: 40 }}>
                    {t("emergency.noResults")}
                  </Text>
                }
                renderItem={({ item }) => (
                  <View className="mb-2.5">
                    <Text
                      style={{
                        color: THEME.textMuted,
                        fontSize: 11,
                        fontWeight: "700",
                        paddingHorizontal: 4,
                        marginBottom: 4,
                      }}
                    >
                      {item.name || t("emergency.unnamedContact")}
                    </Text>
                    {item.numbers.map((number) => {
                      const key = rowKey(item.id, number);
                      const e164 = normalizePhoneWithRegion(number, callingCode);
                      const already = e164 != null && savedPhones.has(e164);
                      const checked = selected.has(key);
                      return (
                        <Pressable
                          key={key}
                          onPress={() => toggleNumber(item, number)}
                          disabled={already}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: checked || already, disabled: already }}
                          className="flex-row items-center rounded-2xl px-4 py-3 mb-1.5 active:opacity-80"
                          style={{
                            borderWidth: 1,
                            borderColor: checked && !already ? THEME.accent : THEME.border,
                            backgroundColor:
                              checked && !already
                                ? withAlpha(THEME.accent, 0.12)
                                : THEME.surface,
                            opacity: already ? 0.5 : 1,
                          }}
                        >
                          {/* The box is always visible: no long-press to reach
                              selection mode, one tap ticks a number. */}
                          <View
                            className="w-5 h-5 rounded-md items-center justify-center mr-3"
                            style={{
                              borderWidth: 1,
                              borderColor: checked && !already ? THEME.accent : THEME.border,
                              backgroundColor:
                                checked && !already ? THEME.accentFill : "transparent",
                            }}
                          >
                            {checked && !already ? (
                              <Ionicons name="checkmark" size={14} color={THEME.accentOnFill} />
                            ) : null}
                          </View>
                          <Text
                            className="flex-1"
                            style={{ color: THEME.text }}
                            numberOfLines={1}
                          >
                            {number}
                          </Text>
                          {already ? (
                            <View className="flex-row items-center">
                              <Ionicons
                                name="checkmark-circle"
                                size={16}
                                color={THEME.textMuted}
                              />
                              <Text style={{ color: THEME.textMuted, fontSize: 11, marginLeft: 6 }}>
                                {t("emergency.alreadyAdded")}
                              </Text>
                            </View>
                          ) : null}
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              />
            )}
          </View>
        ) : (
          <ScrollView
            {...keyboardAwareScrollProps}
            contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 24 }}
            showsVerticalScrollIndicator={false}
          >
            {/* Static content - not tied to the contacts read - stays on
                screen the whole time instead of waiting on it too. */}
            <Text style={{ color: THEME.textMuted, lineHeight: 20, marginBottom: 18, fontSize: 13 }}>
              {t("emergency.subtitle")}
            </Text>

            {!contactsLoaded ? (
              // Only the list itself reserves a loading placeholder, shaped
              // like one real contact row so this area doesn't resize when
              // the real (possibly empty) list replaces it.
              <View
                className="flex-row items-center rounded-xl bg-glass border border-hair px-3 py-2.5 mb-2"
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                <Skeleton width={30} height={30} radius={15} />
                <View className="flex-1 ml-3" style={{ gap: 6 }}>
                  <Skeleton width="45%" height={12} />
                  <Skeleton width="30%" height={10} />
                </View>
              </View>
            ) : (
              contacts.map((c, i) => (
                <View
                  key={`${c.phone}-${i}`}
                  className="flex-row items-center rounded-xl bg-glass border border-hair px-3 py-2.5 mb-2"
                >
                  <ConicAvatar label={initials(c.name)} size={30} />
                  <View className="flex-1 ml-3">
                    <Text style={{ color: THEME.text, fontSize: 13, fontWeight: "700" }}>
                      {c.name}
                    </Text>
                    <Text style={{ color: THEME.textMuted, fontSize: 11 }}>{c.phone}</Text>
                  </View>
                  <Pressable
                    onPress={() => remove(i)}
                    hitSlop={10}
                    className="p-1"
                    accessibilityRole="button"
                    accessibilityLabel={t("common.delete")}
                  >
                    <Ionicons name="trash-outline" size={18} color={GLUCOSE_RICH.low} />
                  </Pressable>
                </View>
              ))
            )}

            {/* Add form */}
            <GlassCard style={{ marginTop: 10 }}>
              <Text
                style={{
                  color: THEME.textMuted,
                  fontSize: 11,
                  letterSpacing: 1.3,
                  fontWeight: "800",
                  marginBottom: 10,
                }}
              >
                {upper(t("emergency.addTitle"))}
              </Text>
              <TextInput
                value={name}
                onChangeText={(v) => {
                  setName(v);
                  if (nameError) setNameError(null);
                }}
                placeholder={t("emergency.namePlaceholder")}
                placeholderTextColor={withAlpha(THEME.textMuted, 0.7)}
                style={[inputStyle(), INPUT_TEXT]}
              />
              {nameError ? (
                <Text style={{ color: GLUCOSE_RICH.low, fontSize: 11, marginTop: 6, marginLeft: 4 }}>
                  {nameError}
                </Text>
              ) : null}

              <TextInput
                value={phone}
                onChangeText={(v) => {
                  setPhone(v);
                  if (phoneError) setPhoneError(null);
                }}
                placeholder={t("emergency.phonePlaceholder")}
                placeholderTextColor={withAlpha(THEME.textMuted, 0.7)}
                keyboardType="phone-pad"
                style={[inputStyle(), INPUT_TEXT, { marginTop: 10 }]}
              />
              {phoneError ? (
                <Text style={{ color: GLUCOSE_RICH.low, fontSize: 11, marginTop: 6, marginLeft: 4 }}>
                  {phoneError}
                </Text>
              ) : null}

              <View className="h-3" />
              <GradientCTA label={t("emergency.add")} onPress={addTyped} />
            </GlassCard>

            {/* The mockup's bottom secondary action */}
            <GradientCTA
              variant="sub"
              label={t("emergency.pickFromContacts")}
              icon={<Ionicons name="people-outline" size={17} color={THEME.text} />}
              onPress={openPicker}
              style={{ marginTop: 12 }}
            />
          </ScrollView>
        )}
      </View>
      <FeedbackHost />
    </AppBackground>
  );
}

export default function EmergencyContactsRoute() {
  return (
    <SafeAreaProvider>
      <EmergencyContactsScreen />
    </SafeAreaProvider>
  );
}
