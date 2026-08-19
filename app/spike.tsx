import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { AppBackground, ConicAvatar, GlassCard, GradientCTA, withAlpha } from "../components/rich";
import { FeedbackHost, useFeedback } from "../components/Feedback";
import { DirIcon } from "../components/DirIcon";
import { privacyUrl } from "../lib/legal";
import { INPUT_TEXT, MODAL_TOP_PAD, THEME, glow, HIT_TARGET } from "../lib/theme/tokens";
import { askSpike, isConfigured, type SpikeMessage } from "../lib/ai/spikeClient";
import { clearHistory, loadHistory, saveHistory } from "../lib/ai/spikeHistory";
import {
  getSpikeUsage,
  noteSpikeMessage,
  FREE_DAILY_MESSAGES,
  PRO_DAILY_MESSAGES,
  type SpikeUsage,
} from "../lib/ai/spikeLimit";
import { useApp } from "../lib/store/AppContext";
import {
  grantSpikeConsent,
  hasSpikeConsent,
} from "../lib/services/spikeConsent";
import { hapticSelect, hapticSuccess } from "../lib/haptics";
import { useLayout } from "../lib/useLayout";
import { logEvent } from "../lib/analytics";
import { isScreenshotMode } from "../lib/screenshotMode";

// ── Typewriter ──────────────────────────────────────────────────────────────
// Purely visual: the reply is stored (and persisted) whole the moment it
// arrives, and only the rendered slice grows. Nothing downstream - history,
// retry, the request window - ever sees a half message.
const TYPE_STEP_WORDS = 2;
const TYPE_INTERVAL_MS = 35;

function wordCount(text: string): number {
  return text.match(/\S+/g)?.length ?? 0;
}

/** Prefix of `text` up to the end of its `count`-th word, whitespace intact. */
function wordPrefix(text: string, count: number): string {
  if (count <= 0) return "";
  const re = /\S+/g;
  let seen = 0;
  let end = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    seen += 1;
    end = m.index + m[0].length;
    if (seen >= count) break;
  }
  return text.slice(0, end);
}

/**
 * Spike - the in-app assistant. Two states behind one route: a fail-closed
 * consent gate (Apple 5.1.1) stating the data boundary, then the chat. Every
 * assistant reply carries the fixed "no medical advice" note; the client never
 * attaches health records (see lib/ai/spikeClient.ts + docs/spike-ai.md).
 */
function SpikeScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { confirm } = useFeedback();
  // `ask` prefills the input from the screen the user came from (insights,
  // injection guide). It never sends: the message is the user's to spend.
  const { ask } = useLocalSearchParams<{ ask?: string }>();
  // Tablet: the conversation keeps a readable column instead of running the full
  // width of an iPad. Undefined on phones, so nothing about that render changes.
  const { columnPad } = useLayout();

  const [ready, setReady] = useState(false);
  const [consented, setConsented] = useState(false);
  const [messages, setMessages] = useState<SpikeMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [errored, setErrored] = useState(false);
  const [usage, setUsage] = useState<SpikeUsage | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const { isProUser } = useApp();

  // Which message is still being revealed, and how many of its words are on
  // screen. null = nothing animating, every bubble renders its full content.
  const [typing, setTyping] = useState<{ index: number; count: number } | null>(null);
  const typeTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopTyping() {
    if (typeTimer.current != null) {
      clearInterval(typeTimer.current);
      typeTimer.current = null;
    }
  }

  function startTyping(index: number, text: string) {
    stopTyping();
    const total = wordCount(text);
    if (total <= TYPE_STEP_WORDS) {
      setTyping(null);
      return;
    }
    let shown = TYPE_STEP_WORDS;
    setTyping({ index, count: shown });
    typeTimer.current = setInterval(() => {
      shown += TYPE_STEP_WORDS;
      if (shown >= total) {
        stopTyping();
        setTyping(null);
        return;
      }
      setTyping({ index, count: shown });
    }, TYPE_INTERVAL_MS);
  }

  // Leaving mid-animation (back, or the modal being dismissed) must not leave a
  // timer ticking against an unmounted screen.
  useEffect(() => stopTyping, []);

  // K4: store-screenshot mode renders the chat with no backend, no consent
  // round-trip, and a fixed neutral 2-message example - never in a release
  // build (isScreenshotMode() double-locks on __DEV__ + the env flag).
  const screenshotChat = isScreenshotMode();
  const effectiveConfigured = isConfigured || screenshotChat;

  useEffect(() => {
    (async () => {
      if (screenshotChat) {
        setConsented(true);
        setUsage({ used: 1, limit: FREE_DAILY_MESSAGES, remaining: FREE_DAILY_MESSAGES - 1 });
        setMessages([
          { role: "user", content: t("spike.mockQuestion") },
          { role: "assistant", content: t("spike.mockAnswer") },
          { role: "user", content: t("spike.mockQuestion2") },
          { role: "assistant", content: t("spike.mockAnswer2") },
          { role: "user", content: t("spike.mockQuestion3") },
          { role: "assistant", content: t("spike.mockAnswer3") },
        ]);
        setReady(true);
        return;
      }
      const granted = await hasSpikeConsent();
      setConsented(granted);
      // The stored thread only exists behind consent, and it is read only when
      // consent still stands.
      if (granted) setMessages(await loadHistory());
      setUsage(await getSpikeUsage(isProUser));
      setReady(true);
    })();
  }, [isProUser, screenshotChat, t]);

  // Persist after every turn (question and reply alike), so leaving mid-answer
  // or being killed in the background does not lose the thread. Never in
  // screenshot mode: the mock chat must not overwrite a real one.
  useEffect(() => {
    if (!ready || screenshotChat || !consented) return;
    void saveHistory(messages);
  }, [messages, ready, screenshotChat, consented]);

  useEffect(() => {
    if (!ready || screenshotChat) return;
    if (ask !== "suggest2" && ask !== "suggest3") return;
    const question = ask === "suggest2" ? t("spike.suggest2") : t("spike.suggest3");
    setInput((current) => (current.length > 0 ? current : question));
  }, [ready, screenshotChat, ask, t]);

  useEffect(() => {
    logEvent("spike_opened");
  }, []);

  async function accept() {
    hapticSuccess();
    await grantSpikeConsent();
    setConsented(true);
  }

  // serverExhausted mirrors the local allowance card for a server-side 429
  // (the per-device daily cap in ai-ask-spike/index.ts) - same UI either way,
  // so a leaked function URL or a stale local counter looks identical to the
  // user: a neutral "today's allowance is spent" card, never a failed send.
  const [serverExhausted, setServerExhausted] = useState(false);
  const exhausted = serverExhausted || (usage != null && usage.remaining <= 0);

  // Shared request path. A message is counted ONLY on a successful reply, so a
  // failed request never burns the user's daily allowance; a failure exposes a
  // retry that re-sends the same history without re-appending the question.
  async function runRequest(history: SpikeMessage[]) {
    setErrored(false);
    setSending(true);
    try {
      const reply = await askSpike(history, i18n.language, isProUser ? "pro" : "free");
      // Stored whole; `history` is exactly the array being appended to, so its
      // length is the new reply's index. Screenshot mode never reaches here.
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
      startTyping(history.length, reply);
      setUsage(await noteSpikeMessage(isProUser));
    } catch (e) {
      if (e instanceof Error && e.message === "daily_limit") setServerExhausted(true);
      else setErrored(true);
    } finally {
      setSending(false);
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    }
  }

  // Shared by the input's send button and the empty-state suggestion chips:
  // both go through the same guards (consent already required to reach this
  // screen, daily limit, in-flight request), so a chip can never bypass them.
  async function sendText(raw: string) {
    const text = raw.trim();
    if (!text || sending || !isConfigured || exhausted || screenshotChat) return;
    hapticSelect();
    const next: SpikeMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    await runRequest(next);
  }

  async function send() {
    await sendText(input);
  }

  // Retry the last (failed) exchange. The user turn is still the tail of
  // `messages`, so we re-send that history as-is instead of appending again.
  function retry() {
    if (sending || !isConfigured || messages.length === 0 || screenshotChat) return;
    hapticSelect();
    void runRequest(messages);
  }

  async function clearChat() {
    if (sending || screenshotChat) return;
    const ok = await confirm({
      title: t("spike.clearChat"),
      message: t("spike.clearChatConfirm"),
      confirmLabel: t("common.delete"),
      destructive: true,
      icon: "trash-outline",
    });
    if (!ok) return;
    stopTyping();
    setTyping(null);
    setMessages([]);
    setErrored(false);
    await clearHistory();
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
      <AppBackground style={{ paddingTop: Math.max(insets.top, MODAL_TOP_PAD) }}>
        <View className="flex-row items-center justify-end px-4 py-2">
          <Pressable onPress={() => router.back()} hitSlop={10} className="p-1">
            <Ionicons name="close" size={26} color={THEME.muted} />
          </Pressable>
        </View>
        {/* The gate is avatar + title + three-line card + scope box + device-id
            note + privacy link + two buttons. At a large accessibility text size,
            or on a small phone, that runs past the screen: it scrolls instead of
            being cut off with no way to reach the buttons. */}
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            alignItems: "center",
            justifyContent: "center",
            paddingVertical: 24,
            gap: 14,
            ...columnPad(24),
          }}
          showsVerticalScrollIndicator={false}
        >
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
          {/* The medical scope is stated before consent, not only inside the
              chat, so nobody accepts without seeing what Spike is not. */}
          <View
            className="rounded-2xl px-3.5 py-3"
            style={{
              width: "100%",
              borderWidth: 1,
              borderColor: "rgba(245,158,11,0.3)",
              backgroundColor: "rgba(245,158,11,0.1)",
            }}
          >
            <View className="flex-row items-start">
              <Ionicons name="medical-outline" size={16} color="#f59e0b" />
              <Text
                style={{
                  color: "rgba(253,230,138,0.85)",
                  fontSize: 12,
                  lineHeight: 18,
                  marginLeft: 8,
                  flex: 1,
                }}
              >
                {t("spike.consentScope")}
              </Text>
            </View>
          </View>
          <Text style={{ color: THEME.muted, fontSize: 11, lineHeight: 16, textAlign: "center" }}>
            {t("spike.consentDeviceId")}
          </Text>
          {/* The trailing chevron promised a link and nothing happened on a tap;
              it now opens the policy, like every other privacy line in the app. */}
          <Pressable
            onPress={() => Linking.openURL(privacyUrl())}
            hitSlop={10}
            accessibilityRole="link"
            accessibilityLabel={t("spike.privacy")}
          >
            <Text style={{ color: THEME.accent, fontSize: 11 }}>{t("spike.privacy")} ›</Text>
          </Pressable>
          <GradientCTA label={t("spike.accept")} onPress={accept} style={{ width: "100%" }} />
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Text style={{ color: THEME.muted, fontSize: 12 }}>{t("spike.notNow")}</Text>
          </Pressable>
        </ScrollView>
      </AppBackground>
    );
  }

  // ── Chat ───────────────────────────────────────────────────────────────────
  return (
    <AppBackground style={{ paddingTop: Math.max(insets.top, MODAL_TOP_PAD) }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1"
      >
        <View className="flex-row items-center py-2" style={[{ gap: 8 }, columnPad(12)]}>
          <Pressable onPress={() => router.back()} hitSlop={10} className="p-1">
            <DirIcon name="chevron-back" size={26} color={THEME.muted} />
          </Pressable>
          <ConicAvatar label="✦" size={24} />
          <Text style={{ color: THEME.ink, fontSize: 16, fontWeight: "800" }}>
            {t("spike.title")}
          </Text>
          <View className="flex-1" />
          {messages.length > 0 && !screenshotChat ? (
            <Pressable
              onPress={clearChat}
              hitSlop={10}
              className="p-1"
              accessibilityRole="button"
              accessibilityLabel={t("spike.clearChat")}
            >
              <Ionicons name="trash-outline" size={19} color={THEME.muted} />
            </Pressable>
          ) : null}
          {usage ? (
            <View
              className="rounded-full px-2.5 py-1"
              style={{ borderWidth: 1, borderColor: THEME.border, backgroundColor: THEME.glass }}
            >
              <Text style={{ color: THEME.muted, fontSize: 10, fontWeight: "700" }}>
                {t("spike.remaining", { n: usage.remaining })}
              </Text>
            </View>
          ) : null}
        </View>

        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{
            paddingTop: 14,
            paddingBottom: 20,
            gap: 10,
            ...columnPad(14),
          }}
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

          {/* An empty chat left the user to guess what can be asked. Three
              neutral starters send straight away, through the same guards as
              the input's send button; they vanish the instant messages fills,
              so a starter can't be tapped again while its reply is pending. */}
          {messages.length === 0 && effectiveConfigured && !exhausted && !screenshotChat ? (
            <View style={{ gap: 8, alignItems: "flex-start" }}>
              {[t("spike.suggest1"), t("spike.suggest2"), t("spike.suggest3")].map((q) => (
                <Pressable
                  key={q}
                  onPress={() => {
                    void sendText(q);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={q}
                  style={{
                    maxWidth: "88%",
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: withAlpha(THEME.accent, 0.25),
                    backgroundColor: THEME.glass,
                    paddingHorizontal: 12,
                    paddingVertical: 7,
                  }}
                >
                  <Text style={{ color: THEME.accent, fontSize: 12 }}>{q}</Text>
                </Pressable>
              ))}
            </View>
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
                <Text style={{ color: THEME.ink, fontSize: 13, lineHeight: 19 }}>
                  {typing && typing.index === i ? wordPrefix(m.content, typing.count) : m.content}
                </Text>
                <View
                  style={{
                    marginTop: 6,
                    paddingTop: 5,
                    borderTopWidth: 1,
                    borderTopColor: THEME.border,
                  }}
                >
                  <Text style={{ color: THEME.muted, fontSize: 11 }}>{t("spike.disclaimer")}</Text>
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
            <View
              style={{
                alignSelf: "flex-start",
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
              }}
            >
              <Text style={{ color: "#ff7a8a", fontSize: 12 }}>{t("spike.error")}</Text>
              <Pressable
                onPress={retry}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t("spike.retry")}
                style={{
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: THEME.border,
                  backgroundColor: THEME.glass,
                  paddingHorizontal: 12,
                  paddingVertical: 5,
                }}
              >
                <Text style={{ color: THEME.accent, fontSize: 12, fontWeight: "800" }}>
                  {t("spike.retry")}
                </Text>
              </Pressable>
            </View>
          ) : null}
          {!effectiveConfigured ? (
            <Text style={{ color: THEME.muted, fontSize: 12, alignSelf: "center" }}>
              {t("spike.notConfigured")}
            </Text>
          ) : null}
        </ScrollView>

        {/* Allowance spent: a neutral card, not a failed send. */}
        {exhausted ? (
          <View style={columnPad()}>
          <GlassCard accent style={{ marginHorizontal: 12, marginBottom: 8 }}>
            <Text style={{ color: THEME.ink, fontSize: 14, fontWeight: "800" }}>
              {t("spike.limitTitle")}
            </Text>
            <Text style={{ color: THEME.muted, fontSize: 12, lineHeight: 18, marginTop: 4 }}>
              {isProUser
                ? t("spike.limitProBody", { n: PRO_DAILY_MESSAGES })
                : t("spike.limitFreeBody", {
                    n: FREE_DAILY_MESSAGES,
                    pro: PRO_DAILY_MESSAGES,
                  })}
            </Text>
            {!isProUser ? (
              <GradientCTA
                label={t("spike.limitCta")}
                onPress={() => router.push("/paywall")}
                style={{ marginTop: 12 }}
              />
            ) : null}
          </GlassCard>
          </View>
        ) : null}

        <View style={columnPad()}>
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
            editable={effectiveConfigured && !sending && !exhausted && !screenshotChat}
            onSubmitEditing={send}
            returnKeyType="send"
            style={[INPUT_TEXT, { flex: 1, color: THEME.ink, paddingVertical: 11, fontSize: 14 }]}
          />
          <Pressable
            onPress={send}
            disabled={!input.trim() || sending || !effectiveConfigured || exhausted || screenshotChat}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t("spike.title")}
            style={[
              {
                width: HIT_TARGET,
                height: HIT_TARGET,
                borderRadius: 10,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: THEME.accent,
                opacity:
                  !input.trim() || sending || !effectiveConfigured || exhausted || screenshotChat ? 0.4 : 1,
              },
              glow(THEME.accent, 10, 0.5),
            ]}
          >
            <Ionicons name="arrow-up" size={20} color="#03181c" />
          </Pressable>
        </View>
        </View>
      </KeyboardAvoidingView>
      {/* Modal route: the root host cannot paint over this view controller, so
          the clear-chat confirmation needs a host of its own. */}
      <FeedbackHost />
    </AppBackground>
  );
}

export default function SpikeRoute() {
  return (
    <SafeAreaProvider>
      <SpikeScreen />
    </SafeAreaProvider>
  );
}
