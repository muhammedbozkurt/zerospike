import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import * as SMS from "expo-sms";
import * as Location from "expo-location";
import { getLocales } from "expo-localization";

import {
  getEmergencyContacts,
  normalizePhone,
  emergencyNumberForRegion,
  type EmergencyContact,
} from "../lib/services/emergency";
import { logEvent } from "../lib/analytics";
import { hapticSelect } from "../lib/haptics";
import { FeedbackHost } from "../components/Feedback";

/** Tries to build a maps link from the current location; null if unavailable. */
async function tryLocationLink(): Promise<string | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") return null;
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    const { latitude, longitude } = pos.coords;
    return `https://maps.google.com/?q=${latitude},${longitude}`;
  } catch {
    return null;
  }
}

function ActionButton({
  icon,
  label,
  color,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center rounded-2xl px-5 py-4 mb-3 active:opacity-80"
      style={{ backgroundColor: color }}
    >
      <Ionicons name={icon} size={24} color="#fff" />
      <Text className="text-white font-bold text-base ml-3 flex-1">{label}</Text>
      <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.7)" />
    </Pressable>
  );
}

export default function SosScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);

  // 112 is not the emergency number everywhere, so follow the device region.
  // The app can only OPEN the dialer; it never places a call on its own.
  const emergencyNumber = useMemo(() => {
    try {
      return emergencyNumberForRegion(getLocales()[0]?.regionCode);
    } catch {
      return "112";
    }
  }, []);

  useEffect(() => {
    logEvent("sos_opened");
  }, []);

  // Re-read on focus, not just on mount: adding a contact and coming back from
  // /emergency-contacts must show it immediately, with no manual refresh.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      getEmergencyContacts().then((list) => {
        if (alive) setContacts(list);
      });
      return () => {
        alive = false;
      };
    }, [])
  );

  async function buildMessage(): Promise<string> {
    const loc = await tryLocationLink();
    return loc
      ? t("sos.messageWithLocation", { location: loc })
      : t("sos.messageNoLocation");
  }

  async function messageContact(phone: string) {
    hapticSelect();
    logEvent("sos_action", { method: "sms" });
    const body = await buildMessage();
    const to = normalizePhone(phone);
    try {
      if (await SMS.isAvailableAsync()) {
        await SMS.sendSMSAsync([to], body);
        return;
      }
    } catch {
      // fall through to the URL scheme
    }
    const sep = Platform.OS === "ios" ? "&" : "?";
    Linking.openURL(`sms:${to}${sep}body=${encodeURIComponent(body)}`).catch(() => {});
  }

  async function whatsappContact(phone: string) {
    hapticSelect();
    logEvent("sos_action", { method: "contact" });
    const body = await buildMessage();
    const to = normalizePhone(phone).replace("+", "");
    Linking.openURL(`https://wa.me/${to}?text=${encodeURIComponent(body)}`).catch(
      () => {}
    );
  }

  function callNumber(phone: string) {
    hapticSelect();
    logEvent("sos_action", { method: "call" });
    Linking.openURL(`tel:${normalizePhone(phone)}`).catch(() => {});
  }

  function callEmergency() {
    hapticSelect();
    logEvent("sos_action", { method: "call" });
    Linking.openURL(`tel:${emergencyNumber}`).catch(() => {});
  }

  return (
    <View className="flex-1 bg-zinc-950">
      <View className="flex-1" style={{ paddingTop: insets.top }}>
        <View className="flex-row items-center justify-between px-4 py-2">
          <Text className="text-zinc-50 text-xl font-bold">{t("sos.title")}</Text>
          <Pressable onPress={() => router.back()} hitSlop={10} className="p-1">
            <Ionicons name="close" size={26} color="#71717a" />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 24 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Honest framing: no auto-send, no auto-call. */}
          <Text className="text-zinc-400 leading-5 mb-5">{t("sos.subtitle")}</Text>

          {/* Emergency number is always available */}
          <ActionButton
            icon="call"
            label={t("sos.callEmergency", { number: emergencyNumber })}
            color="#dc2626"
            onPress={callEmergency}
          />

          {contacts.length === 0 ? (
            <View className="rounded-2xl bg-zinc-900 border border-zinc-800 p-5 mt-2">
              <Text className="text-zinc-300 text-center mb-4">
                {t("sos.noContacts")}
              </Text>
              <Pressable
                onPress={() => router.push("/emergency-contacts")}
                className="rounded-xl bg-brand active:bg-brandDark py-3 items-center"
              >
                <Text className="text-black font-semibold">{t("sos.addContact")}</Text>
              </Pressable>
            </View>
          ) : (
            <>
              {contacts.map((c, i) => (
                <View
                  key={`${c.phone}-${i}`}
                  className="rounded-2xl bg-zinc-900 border border-zinc-800 p-4 mt-4"
                >
                  <Text className="text-zinc-50 font-bold text-base">{c.name}</Text>
                  <Text className="text-zinc-500 text-sm mb-3">{c.phone}</Text>
                  <ActionButton
                    icon="call"
                    label={t("sos.callContact")}
                    color="#16a34a"
                    onPress={() => callNumber(c.phone)}
                  />
                  <ActionButton
                    icon="chatbubble-ellipses"
                    label={t("sos.messageContact")}
                    color="#2563eb"
                    onPress={() => messageContact(c.phone)}
                  />
                  <ActionButton
                    icon="logo-whatsapp"
                    label={t("sos.whatsappContact")}
                    color="#059669"
                    onPress={() => whatsappContact(c.phone)}
                  />
                </View>
              ))}

              {/* Once a contact exists the big empty-state card is gone, and with
                  it the only way to reach the contacts screen. A second contact
                  has to be reachable from here. The list refreshes on focus. */}
              <Pressable
                onPress={() => router.push("/emergency-contacts")}
                className="flex-row items-center justify-center rounded-2xl border border-zinc-800 py-3.5 mt-4 active:bg-zinc-900"
              >
                <Ionicons name="person-add-outline" size={17} color="#22d3ee" />
                <Text
                  className="text-brand font-medium ml-2"
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.85}
                >
                  {t("sos.manageContacts")}
                </Text>
              </Pressable>
            </>
          )}

          <Text className="text-zinc-600 text-[11px] text-center leading-4 mt-6 px-2">
            {t("sos.disclaimer")}
          </Text>
        </ScrollView>
      </View>
      <FeedbackHost />
    </View>
  );
}
