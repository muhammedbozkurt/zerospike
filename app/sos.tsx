import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
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
import { GlassCard, GradientCTA } from "../components/rich";
import { ScreenHeader } from "../components/ScreenHeader";
import { Skeleton } from "../components/Skeleton";
import { GLUCOSE_RICH, MODAL_TOP_PAD, RADIUS, THEME, glow } from "../lib/theme/tokens";
import { withAlpha } from "../components/rich/GlassCard";

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

/** Content comparison (not object identity), so a re-focus that found the same
 *  contacts never re-renders the CTA/list for nothing (same pattern as the
 *  food tab's favorites/recent reload). */
function sameList<T>(a: T[], b: T[]): boolean {
  return a.length === b.length && JSON.stringify(a) === JSON.stringify(b);
}

/** The mockup's warm red wash - this one screen departs from the cyan wash. */
function SosBackground() {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: THEME.bg.base }]}>
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <RadialGradient id="sosGlow" cx="50%" cy="26%" rx="120%" ry="60%">
            <Stop offset="0" stopColor={THEME.glucose.low} stopOpacity={THEME.scheme === "dark" ? 0.16 : 0.1} />
            <Stop offset="1" stopColor={THEME.bg.base} stopOpacity={1} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#sosGlow)" />
      </Svg>
    </View>
  );
}

function SosScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  // Whether contacts have EVER resolved this mount. The primary CTA reads
  // contacts[0] to decide between "message contact" and "add contact" - two
  // different actions, not two visual states of the same one - so it must not
  // commit to either before the real list is in.
  const [contactsLoaded, setContactsLoaded] = useState(false);

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
        if (!alive) return;
        setContacts((prev) => (sameList(prev, list) ? prev : list));
        setContactsLoaded(true);
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

  const primaryContact = contacts[0];

  return (
    <View className="flex-1">
      <SosBackground />
      <View className="flex-1" style={{ paddingTop: Math.max(insets.top, MODAL_TOP_PAD) }}>
        <ScreenHeader
          title={t("sos.title")}
          onBack={() => router.back()}
          backIcon="close"
          accessibilityLabel={t("common.close")}
        />

        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingBottom: insets.bottom + 24,
          }}
          showsVerticalScrollIndicator={false}
        >
          {/* Hero: radial red emblem, title, one line of honest framing */}
          <View className="items-center mt-4 mb-5">
            <View
              className="w-16 h-16 rounded-full items-center justify-center"
              style={[
                {
                  backgroundColor: withAlpha(GLUCOSE_RICH.low, 0.18),
                  borderWidth: 1,
                  borderColor: withAlpha(GLUCOSE_RICH.low, 0.3),
                },
                glow(GLUCOSE_RICH.low, 34, 0.6),
              ]}
            >
              <Ionicons name="medical" size={30} color={THEME.glucoseText.low} />
            </View>
            <Text
              style={{
                color: THEME.text,
                fontSize: 24,
                fontWeight: "800",
                marginTop: 12,
              }}
            >
              {t("sos.title")}
            </Text>
            <Text
              style={{
                color: THEME.textMuted,
                fontSize: 13,
                lineHeight: 19,
                textAlign: "center",
                marginTop: 6,
                maxWidth: 260,
              }}
            >
              {t("sos.subtitle")}
            </Text>
          </View>

          {/* The two primary actions the mockup leads with */}
          <GradientCTA
            danger
            label={t("sos.callEmergency", { number: emergencyNumber })}
            icon={<Ionicons name="call" size={17} color={THEME.accentOnFill} />}
            onPress={callEmergency}
            style={{ marginBottom: 10 }}
          />
          {!contactsLoaded ? (
            // Same shell (padding, radius, border) as either resolved sub CTA
            // below, so the height never shifts once the real one lands - but
            // a neutral shimmer instead of a visibly empty button, and hidden
            // from the accessibility tree instead of announcing an unnamed one.
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: RADIUS.lg,
                borderWidth: 1,
                borderColor: THEME.border,
                backgroundColor: THEME.surface,
                paddingVertical: 13,
                paddingHorizontal: 14,
                marginBottom: 18,
              }}
            >
              <Skeleton width={140} height={17} radius={4} />
            </View>
          ) : primaryContact ? (
            <GradientCTA
              variant="sub"
              label={t("sos.messageContact")}
              icon={<Ionicons name="chatbubble-ellipses" size={17} color={THEME.text} />}
              onPress={() => messageContact(primaryContact.phone)}
              style={{ marginBottom: 18 }}
            />
          ) : (
            <GradientCTA
              variant="sub"
              label={t("sos.addContact")}
              icon={<Ionicons name="person-add-outline" size={17} color={THEME.text} />}
              onPress={() => router.push("/emergency-contacts")}
              style={{ marginBottom: 18 }}
            />
          )}

          {contacts.length === 0 ? null : (
            <>
              {contacts.map((c, i) => (
                <GlassCard key={`${c.phone}-${i}`} style={{ marginBottom: 10 }}>
                  <Text style={{ color: THEME.text, fontSize: 15, fontWeight: "800" }}>
                    {c.name}
                  </Text>
                  <Text style={{ color: THEME.textMuted, fontSize: 12, marginBottom: 10 }}>
                    {c.phone}
                  </Text>
                  <View className="flex-row" style={{ gap: 8 }}>
                    <ContactAction
                      icon="call"
                      label={t("sos.callContact")}
                      onPress={() => callNumber(c.phone)}
                    />
                    <ContactAction
                      icon="chatbubble-ellipses"
                      label={t("sos.messageContact")}
                      onPress={() => messageContact(c.phone)}
                    />
                    <ContactAction
                      icon="logo-whatsapp"
                      label={t("sos.whatsappContact")}
                      onPress={() => whatsappContact(c.phone)}
                    />
                  </View>
                </GlassCard>
              ))}

              {/* Once a contact exists the empty-state route is gone, so the
                  contacts screen has to stay reachable from here. */}
              <Pressable
                onPress={() => router.push("/emergency-contacts")}
                className="flex-row items-center justify-center rounded-2xl py-3.5 mt-2 active:opacity-80"
                style={{ borderWidth: 1, borderColor: THEME.border }}
              >
                <Ionicons name="person-add-outline" size={17} color={THEME.accent} />
                <Text
                  style={{ color: THEME.accent, fontWeight: "700", marginLeft: 8 }}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.85}
                >
                  {t("sos.manageContacts")}
                </Text>
              </Pressable>
            </>
          )}

          <Text
            style={{
              color: THEME.textMuted,
              fontSize: 11,
              textAlign: "center",
              lineHeight: 16,
              marginTop: 22,
              paddingHorizontal: 8,
            }}
          >
            {t("sos.disclaimer")}
          </Text>
        </ScrollView>
      </View>
      <FeedbackHost />
    </View>
  );
}

/** One compact action tile inside a contact card. */
function ContactAction({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={label}
      className="flex-1 items-center rounded-xl py-3 active:opacity-80"
      style={{
        borderWidth: 1,
        borderColor: THEME.border,
        backgroundColor: THEME.surface,
      }}
    >
      <Ionicons name={icon} size={18} color={THEME.accent} />
      <Text
        style={{ color: THEME.textMuted, fontSize: 10, marginTop: 4 }}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export default function SosRoute() {
  return (
    <SafeAreaProvider>
      <SosScreen />
    </SafeAreaProvider>
  );
}
