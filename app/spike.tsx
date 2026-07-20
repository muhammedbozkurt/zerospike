import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
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

import { AppBackground, ConicAvatar, GlassCard, GradientCTA, withAlpha } from "../components/rich";
import { THEME, glow } from "../lib/theme/tokens";
import { askSpike, isConfigured, type SpikeMessage } from "../lib/ai/spikeClient";
import {
  grantSpikeConsent,
  hasSpikeConsent,
} from "../lib/services/spikeConsent";
import { hapticSelect, hapticSuccess } from "../lib/haptics";
import { logEvent } from "../lib/analytics";

/**
 * Spike - the in-app assistant. Two states behind one route: a fail-closed
 * consent gate (Apple 5.1.1) stating the data boundary, then the chat. Every
 * assistant reply carries the fixed "no medical advice" note; the client never
 * attaches health records (see lib/ai/spikeClient.ts + docs/spike-ai.md).
 */
export default function SpikeScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [ready, setReady] = useState(false);
  const [consented, setConsented] = useState(false);
  const [messages, setMessages] = useState<SpikeMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [errored, setErrored] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    (async () => {
      setConsented(await hasSpikeConsent());
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    logEvent("spike_opened");
  }, []);

  async function accept() {
    hapticSuccess();
    await grantSpikeConsent();
    setConsented(true);
  }

  async function send() {
    const text = input.trim();
    if (!text || sending || !isConfigured) return;
    hapticSelect();
    setErrored(false);
    const next: SpikeMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setSending(true);
    try {
      const reply = await askSpike(next, i18n.language);
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
    } catch {
      setErrored(true);
    } finally {
      setSending(false);
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    }
  }

  if (!ready) {
    return (
      <AppBackground>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={THEME.accent} />
        </View>
      </AppBackground>
    );
  }

  // ── Consent gate ───────────────────────────────────────────────────────────
  if (!consented) {
    return (
      <AppBackground style={{ paddingTop: insets.top }}>
        <View className="flex-row items-center justify-end px-4 py-2">
          <Pressable onPress={() => router.back()} hitSlop={10} className="p-1">
            <Ionicons name="close" size={26} color={THEME.muted} />
          </Pressable>
        </View>
        <View className="flex-1 items-center justify-center px-6" style={{ gap: 14 }}>
          <ConicAvatar label="✦" size={64} />
          <Text style={{ color: THEME.ink, fontSize: 22, fontWeight: "800" }}>
            {t("spike.consentTitle")}
          </Text>
          <GlassCard style={{ width: "100%" }}>
            <View style={{ gap: 8 }}>
              <Text style={{ color: THEME.ink, fontSize: 13, lineHeight: 20 }}>
                {t("spike.consentSent")}
              </Text>
              <Text style={{ color: THEME.ink, fontSize: 13, lineHeight: 20 }}>
                {t("spike.consentRecipient")}
              </Text>
              <Text style={{ color: THEME.ink, fontSize: 13, lineHeight: 20 }}>
                {t("spike.consentNotSent")}
              </Text>
            </View>
          </GlassCard>
          <Text style={{ color: THEME.muted, fontSize: 11 }}>{t("spike.privacy")} ›</Text>
          <GradientCTA label={t("spike.accept")} onPress={accept} style={{ width: "100%" }} />
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Text style={{ color: THEME.muted, fontSize: 12 }}>{t("spike.notNow")}</Text>
          </Pressable>
        </View>
      </AppBackground>
    );
  }

  // ── Chat ───────────────────────────────────────────────────────────────────
  return (
    <AppBackground style={{ paddingTop: insets.top }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1"
      >
        <View className="flex-row items-center px-3 py-2" style={{ gap: 8 }}>
          <Pressable onPress={() => router.back()} hitSlop={10} className="p-1">
            <Ionicons name="chevron-back" size={26} color={THEME.muted} />
          </Pressable>
          <ConicAvatar label="✦" size={24} />
          <Text style={{ color: THEME.ink, fontSize: 16, fontWeight: "800" }}>
            {t("spike.title")}
          </Text>
        </View>

        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{ padding: 14, paddingBottom: 20, gap: 10 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        >
          {messages.length === 0 ? (
            <GlassCard style={{ alignSelf: "flex-start", maxWidth: "88%" }}>
              <Text style={{ color: THEME.ink, fontSize: 13, lineHeight: 20 }}>
                {t("spike.intro")}
              </Text>
            </GlassCard>
          ) : null}

          {messages.map((m, i) =>
            m.role === "user" ? (
              <View
                key={i}
                style={{
                  alignSelf: "flex-end",
                  maxWidth: "82%",
                  backgroundColor: THEME.glass,
                  borderWidth: 1,
                  borderColor: THEME.border,
                  borderRadius: 14,
                  borderBottomRightRadius: 4,
                  paddingVertical: 9,
                  paddingHorizontal: 12,
                }}
              >
                <Text style={{ color: THEME.ink, fontSize: 13, lineHeight: 19 }}>{m.content}</Text>
              </View>
            ) : (
              <View
                key={i}
                style={[
                  {
                    alignSelf: "flex-start",
                    maxWidth: "88%",
                    backgroundColor: withAlpha(THEME.accent, 0.08),
                    borderWidth: 1,
                    borderColor: withAlpha(THEME.accent, 0.25),
                    borderRadius: 14,
                    borderBottomLeftRadius: 4,
                    padding: 11,
                  },
                  glow(THEME.accent, 18, 0.25),
                ]}
              >
                <Text style={{ color: THEME.ink, fontSize: 13, lineHeight: 19 }}>{m.content}</Text>
                <View
                  style={{
                    marginTop: 6,
                    paddingTop: 5,
                    borderTopWidth: 1,
                    borderTopColor: THEME.border,
                  }}
                >
                  <Text style={{ color: THEME.muted, fontSize: 9 }}>{t("spike.disclaimer")}</Text>
                </View>
              </View>
            )
          )}

          {sending ? (
            <View style={{ alignSelf: "flex-start", padding: 8 }}>
              <ActivityIndicator color={THEME.accent} />
            </View>
          ) : null}
          {errored ? (
            <Text style={{ color: "#ff7a8a", fontSize: 12, alignSelf: "flex-start" }}>
              {t("spike.error")}
            </Text>
          ) : null}
          {!isConfigured ? (
            <Text style={{ color: THEME.muted, fontSize: 12, alignSelf: "center" }}>
              {t("spike.notConfigured")}
            </Text>
          ) : null}
        </ScrollView>

        <View
          className="flex-row items-center mx-3 mb-2 px-3"
          style={{
            marginBottom: insets.bottom + 8,
            backgroundColor: THEME.glass,
            borderWidth: 1,
            borderColor: THEME.border,
            borderRadius: 16,
            gap: 8,
          }}
        >
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder={t("spike.inputPlaceholder")}
            placeholderTextColor={THEME.muted}
            editable={isConfigured && !sending}
            onSubmitEditing={send}
            returnKeyType="send"
            style={{ flex: 1, color: THEME.ink, paddingVertical: 11, fontSize: 14 }}
          />
          <Pressable
            onPress={send}
            disabled={!input.trim() || sending || !isConfigured}
            style={[
              {
                width: 30,
                height: 30,
                borderRadius: 8,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: THEME.accent,
                opacity: !input.trim() || sending || !isConfigured ? 0.4 : 1,
              },
              glow(THEME.accent, 10, 0.5),
            ]}
          >
            <Ionicons name="arrow-up" size={18} color="#03181c" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </AppBackground>
  );
}
