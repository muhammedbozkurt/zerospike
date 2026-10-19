import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
  type ViewStyle,
} from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { AppBackground, ConicAvatar, GlassCard, GradientCTA, withAlpha } from "../components/rich";
import { FeedbackHost, useFeedback } from "../components/Feedback";
import { DirIcon } from "../components/DirIcon";
import { privacyUrl } from "../lib/legal";
import { INPUT_TEXT, MODAL_TOP_PAD, THEME, glow, HIT_TARGET, switchColors } from "../lib/theme/tokens";
import {
  askSpike,
  isConfigured,
  spikeErrorCode,
  spikeSourceRoute,
  SPIKE_ACTION_ROUTES,
  type SpikeActionId,
  type SpikeMessage,
  type SpikeSource,
} from "../lib/ai/spikeClient";
import { SPIKE_CONTEXT_DAYS, summarizeForSpike } from "../lib/ai/spikeContext";
import { clearHistory, loadHistory, saveHistory } from "../lib/ai/spikeHistory";
import {
  getSpikeUsage,
  noteSpikeMessage,
  FREE_DAILY_MESSAGES,
  PRO_DAILY_MESSAGES,
  type SpikeUsage,
} from "../lib/ai/spikeLimit";
import { listMealLogs } from "../lib/db/logs";
import { useApp } from "../lib/store/AppContext";
import {
  grantSpikeConsent,
  hasSpikeConsent,
  hasSpikeContextConsent,
  setSpikeContextConsent,
} from "../lib/services/spikeConsent";
import { hapticSelect, hapticSuccess } from "../lib/haptics";
import { useLayout } from "../lib/useLayout";
import { logEvent } from "../lib/analytics";
import { isScreenshotMode } from "../lib/screenshotMode";

// ── Typewriter ──────────────────────────────────────────────────────────────
// Purely visual, and only for a reply that arrived whole (the single-reply
// fallback): the reply is stored (and persisted) whole the moment it arrives,
// and only the rendered slice grows. A streamed reply is already arriving word
// by word, so it skips this. Nothing downstream - history, retry, the request
// window - ever sees a half message.
const TYPE_STEP_WORDS = 2;
const TYPE_INTERVAL_MS = 35;

/** Streamed text reaches the screen in steps of this size, not once per token. */
const STREAM_FLUSH_MS = 60;

/** A meal logged this recently is the one the post-meal timer is about. */
const RECENT_MEAL_MS = 3 * 60 * 60 * 1000;

/** The UTC day, the key the function counts a day's messages by. The device's own
 *  counter (spikeLimit.ts) runs on the local day, so a server 429 is tracked here
 *  by the server's day instead. */
function utcDayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function msUntilNextUtcDay(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - ms;
}

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

type Translate = (key: string) => string;
type ReplyFeedback = "up" | "down";
type ErrorKind = "generic" | "rate_limit" | "capacity" | "consent";

/** What sits under one assistant reply. It lives for the session only: the
 *  stored thread is plain role + content, so a reply restored from history
 *  shows no buttons or sources. */
interface ReplyMeta {
  actions: SpikeActionId[];
  sources: SpikeSource[];
  feedback?: ReplyFeedback;
}
const NO_META: ReplyMeta = { actions: [], sources: [] };

const ACTION_ICON: Record<SpikeActionId, keyof typeof Ionicons.glyphMap> = {
  open_reminders: "notifications-outline",
  start_meal_timer: "timer-outline",
  open_injection_map: "body-outline",
  connect_health: "heart-outline",
  open_insights: "bar-chart-outline",
  open_widget_guide: "apps-outline",
  open_journal: "book-outline",
};

/** One literal t() per action, so i18n:check sees every key. */
function actionLabel(id: SpikeActionId, t: Translate): string {
  switch (id) {
    case "open_reminders":
      return t("spike.actionOpenReminders");
    case "start_meal_timer":
      return t("spike.actionStartMealTimer");
    case "open_injection_map":
      return t("spike.actionOpenInjectionMap");
    case "connect_health":
      return t("spike.actionConnectHealth");
    case "open_insights":
      return t("spike.actionOpenInsights");
    case "open_widget_guide":
      return t("spike.actionOpenWidgetGuide");
    case "open_journal":
      return t("spike.actionOpenJournal");
  }
}

function AssistantBubble({ text }: { text: string }) {
  return (
    <View
      style={[
        {
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
      <Text style={{ color: THEME.text, fontSize: 13, lineHeight: 19 }}>{text}</Text>
    </View>
  );
}

function FeedbackButton({
  value,
  meta,
  label,
  onRate,
}: {
  value: ReplyFeedback;
  meta: ReplyMeta;
  label: string;
  onRate: (value: ReplyFeedback) => void;
}) {
  const chosen = meta.feedback === value;
  const icon =
    value === "up"
      ? chosen
        ? "thumbs-up"
        : "thumbs-up-outline"
      : chosen
        ? "thumbs-down"
        : "thumbs-down-outline";
  return (
    <Pressable
      onPress={() => onRate(value)}
      disabled={meta.feedback != null}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: chosen, disabled: meta.feedback != null }}
      style={{ paddingHorizontal: 8, paddingVertical: 5 }}
    >
      <Ionicons name={icon} size={16} color={chosen ? THEME.accent : THEME.textMuted} />
    </Pressable>
  );
}

/** Buttons, sources and the rating row under one assistant reply. */
function ReplyExtras({
  meta,
  t,
  onAction,
  onSource,
  onRate,
}: {
  meta: ReplyMeta;
  t: Translate;
  onAction: (id: SpikeActionId) => void;
  onSource: (source: SpikeSource) => void;
  onRate: (value: ReplyFeedback) => void;
}) {
  return (
    <View style={{ gap: 8 }}>
      {meta.actions.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {meta.actions.map((id) => (
            <Pressable
              key={id}
              onPress={() => onAction(id)}
              hitSlop={4}
              accessibilityRole="button"
              accessibilityLabel={actionLabel(id, t)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                maxWidth: "100%",
                borderRadius: 999,
                borderWidth: 1,
                borderColor: withAlpha(THEME.accent, 0.35),
                backgroundColor: withAlpha(THEME.accent, 0.1),
                paddingHorizontal: 12,
                paddingVertical: 8,
              }}
            >
              <Ionicons name={ACTION_ICON[id]} size={14} color={THEME.accent} />
              <Text
                style={{ color: THEME.accent, fontSize: 12, fontWeight: "700", flexShrink: 1 }}
              >
                {actionLabel(id, t)}
              </Text>
              <DirIcon name="chevron-forward" size={12} color={THEME.accent} />
            </Pressable>
          ))}
        </View>
      ) : null}
      {meta.sources.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
          <Text style={{ color: THEME.textMuted, fontSize: 11 }}>{t("spike.sourcesLabel")}</Text>
          {meta.sources.map((source) => (
            <Pressable
              key={source.id}
              onPress={() => onSource(source)}
              hitSlop={6}
              accessibilityRole="link"
              accessibilityLabel={source.title}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                maxWidth: "100%",
                borderRadius: 999,
                borderWidth: 1,
                borderColor: THEME.border,
                backgroundColor: THEME.surface,
                paddingHorizontal: 9,
                paddingVertical: 4,
              }}
            >
              <Ionicons name="open-outline" size={11} color={THEME.textMuted} />
              <Text numberOfLines={1} style={{ color: THEME.textMuted, fontSize: 11, flexShrink: 1 }}>
                {source.title}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap" }}>
        <FeedbackButton value="up" meta={meta} label={t("spike.feedbackUp")} onRate={onRate} />
        <FeedbackButton value="down" meta={meta} label={t("spike.feedbackDown")} onRate={onRate} />
        {meta.feedback ? (
          <Text style={{ color: THEME.textMuted, fontSize: 11, marginStart: 4 }}>
            {t("spike.feedbackThanks")}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function ConsentBullet({
  icon,
  color,
  text,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  text: string;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
      <Ionicons name={icon} size={16} color={color} style={{ marginTop: 1 }} />
      <Text style={{ color: THEME.text, fontSize: 13, lineHeight: 19, flex: 1 }}>{text}</Text>
    </View>
  );
}

/**
 * The separate consent for the 14-day summary. It is a screen of this route,
 * not an RN Modal: a Modal opened from a `presentation: "modal"` route is
 * silently refused by iOS (see components/Feedback.tsx).
 */
function ContextConsentView({
  t,
  topPad,
  bottomPad,
  columnPad,
  saveFailed,
  onAccept,
  onDecline,
}: {
  t: Translate;
  topPad: number;
  bottomPad: number;
  columnPad: ViewStyle;
  /** Storing the choice failed: say so, the screen stays and nothing is switched on. */
  saveFailed: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <AppBackground style={{ paddingTop: topPad }}>
      <View className="flex-row items-center justify-end px-4 py-2">
        <Pressable
          onPress={onDecline}
          hitSlop={10}
          className="p-1"
          accessibilityRole="button"
          accessibilityLabel={t("common.close")}
        >
          <Ionicons name="close" size={26} color={THEME.textMuted} />
        </Pressable>
      </View>
      <ScrollView
        contentContainerStyle={[
          { alignItems: "center", paddingTop: 8, paddingBottom: bottomPad + 16, gap: 14 },
          columnPad,
        ]}
        showsVerticalScrollIndicator={false}
      >
        <ConicAvatar label="✦" size={56} />
        <Text style={{ color: THEME.text, fontSize: 22, fontWeight: "800", textAlign: "center" }}>
          {t("spike.ctxTitle")}
        </Text>
        <Text style={{ color: THEME.textMuted, fontSize: 13, lineHeight: 20, textAlign: "center" }}>
          {t("spike.ctxIntro")}
        </Text>
        <GlassCard style={{ width: "100%" }}>
          <View style={{ gap: 8 }}>
            <Text style={{ color: THEME.text, fontSize: 14, fontWeight: "800" }}>
              {t("spike.ctxSharedTitle")}
            </Text>
            <ConsentBullet icon="checkmark-circle-outline" color={THEME.accent} text={t("spike.ctxShared1")} />
            <ConsentBullet icon="checkmark-circle-outline" color={THEME.accent} text={t("spike.ctxShared2")} />
            <ConsentBullet icon="checkmark-circle-outline" color={THEME.accent} text={t("spike.ctxShared3")} />
            <ConsentBullet icon="checkmark-circle-outline" color={THEME.accent} text={t("spike.ctxShared4")} />
            <ConsentBullet icon="checkmark-circle-outline" color={THEME.accent} text={t("spike.ctxShared5")} />
          </View>
        </GlassCard>
        <GlassCard style={{ width: "100%" }}>
          <View style={{ gap: 8 }}>
            <Text style={{ color: THEME.text, fontSize: 14, fontWeight: "800" }}>
              {t("spike.ctxNotSharedTitle")}
            </Text>
            <ConsentBullet icon="close-circle-outline" color={THEME.textMuted} text={t("spike.ctxNotShared1")} />
            <ConsentBullet icon="close-circle-outline" color={THEME.textMuted} text={t("spike.ctxNotShared2")} />
            <ConsentBullet icon="close-circle-outline" color={THEME.textMuted} text={t("spike.ctxNotShared3")} />
            <ConsentBullet icon="close-circle-outline" color={THEME.textMuted} text={t("spike.ctxNotShared4")} />
          </View>
        </GlassCard>
        <View style={{ gap: 4, width: "100%" }}>
          <Text style={{ color: THEME.textMuted, fontSize: 11, lineHeight: 16, textAlign: "center" }}>
            {t("spike.ctxRecipient")}
          </Text>
          <Text style={{ color: THEME.textMuted, fontSize: 11, lineHeight: 16, textAlign: "center" }}>
            {t("spike.ctxPromise")}
          </Text>
        </View>
        <Pressable
          onPress={() => Linking.openURL(privacyUrl())}
          hitSlop={10}
          accessibilityRole="link"
          accessibilityLabel={t("spike.privacy")}
        >
          <Text style={{ color: THEME.accent, fontSize: 11 }}>{t("spike.privacy")} ›</Text>
        </Pressable>
        {saveFailed ? (
          <Text
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={{ color: THEME.danger, fontSize: 12, lineHeight: 18, textAlign: "center" }}
          >
            {t("spike.errorContextSave")}
          </Text>
        ) : null}
        <GradientCTA label={t("spike.ctxAccept")} onPress={onAccept} style={{ width: "100%" }} />
        <Pressable onPress={onDecline} hitSlop={8}>
          <Text style={{ color: THEME.textMuted, fontSize: 12 }}>{t("spike.ctxDecline")}</Text>
        </Pressable>
      </ScrollView>
    </AppBackground>
  );
}

/**
 * Spike - the in-app assistant. States behind one route: a fail-closed consent
 * gate (Apple 5.1.1) stating the data boundary, the chat, and a second, separate
 * consent for the optional 14-day summary. The chat shows a fixed
 * "no medical advice" note at the top. The summary packet is built on this device
 * (lib/ai/spikeContext.ts) and goes out only while that second consent is on.
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
  const [agreed, setAgreed] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [contextOn, setContextOn] = useState(false);
  const [contextView, setContextView] = useState(false);
  const [contextSaveFailed, setContextSaveFailed] = useState(false);
  const [messages, setMessages] = useState<SpikeMessage[]>([]);
  const [replyMeta, setReplyMeta] = useState<Record<number, ReplyMeta>>({});
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<ErrorKind | null>(null);
  const [usage, setUsage] = useState<SpikeUsage | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const { isProUser, activeProfile } = useApp();

  // The reply being streamed in, shown as its own bubble and moved into
  // `messages` whole once it is done. null = no stream running.
  const [streamText, setStreamText] = useState<string | null>(null);
  const streamPending = useRef<string | null>(null);
  const streamTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  function showStream(textSoFar: string) {
    if (textSoFar.length === 0) {
      discardStream();
      return;
    }
    streamPending.current = textSoFar;
    if (streamTimer.current != null) return;
    streamTimer.current = setTimeout(() => {
      streamTimer.current = null;
      if (streamPending.current != null) setStreamText(streamPending.current);
    }, STREAM_FLUSH_MS);
  }

  function discardStream() {
    if (streamTimer.current != null) {
      clearTimeout(streamTimer.current);
      streamTimer.current = null;
    }
    streamPending.current = null;
    setStreamText(null);
  }

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

  // Leaving mid-animation or mid-stream (back, or the modal being dismissed)
  // must not leave a timer ticking or a request running against an unmounted
  // screen.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stopTyping();
      if (streamTimer.current != null) clearTimeout(streamTimer.current);
      abortRef.current?.abort();
    };
  }, []);

  // Android's back button closes the summary consent first, like its X does.
  useEffect(() => {
    if (!contextView) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      declineContext();
      return true;
    });
    return () => sub.remove();
  }, [contextView]);

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
          { role: "user", content: t("spike.mockQuestion4") },
          { role: "assistant", content: t("spike.mockAnswer4") },
          { role: "user", content: t("spike.mockQuestion5") },
          { role: "assistant", content: t("spike.mockAnswer5") },
          { role: "user", content: t("spike.mockQuestion6") },
          { role: "assistant", content: t("spike.mockAnswer6") },
        ]);
        setReady(true);
        return;
      }
      const granted = await hasSpikeConsent();
      setConsented(granted);
      // The stored thread only exists behind consent, and it is read only when
      // consent still stands.
      if (granted) {
        setMessages(await loadHistory());
        setContextOn(await hasSpikeContextConsent());
      }
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
    if (!agreed) return;
    hapticSuccess();
    await grantSpikeConsent();
    setConsented(true);
  }

  // The switch only asks: turning it on opens the consent screen and the packet
  // stays off until that screen is accepted. Turning it off takes effect at once
  // on screen, whether or not storing it works: the packet is only ever built
  // while contextOn is true, so an off switch never sends.
  async function toggleContext(next: boolean) {
    if (next) {
      setContextSaveFailed(false);
      setContextView(true);
      return;
    }
    hapticSelect();
    setContextOn(false);
    logEvent("spike_context_consent", { granted: false });
    await setSpikeContextConsent(false);
  }

  async function acceptContext() {
    setContextSaveFailed(false);
    // The choice only counts once it is stored, so the switch never claims a
    // consent the next launch would not find. When storing fails the consent
    // screen stays, says so, and the switch stays off.
    if (!(await setSpikeContextConsent(true))) {
      setContextSaveFailed(true);
      return;
    }
    hapticSuccess();
    setContextOn(true);
    setContextView(false);
    logEvent("spike_context_consent", { granted: true });
  }

  function declineContext() {
    setContextSaveFailed(false);
    setContextView(false);
    logEvent("spike_context_consent", { granted: false });
  }

  // serverExhaustedDay mirrors the local allowance card for a server-side 429
  // (the per-device daily cap in ai-ask-spike/index.ts) - same UI either way,
  // so a leaked function URL or a stale local counter looks identical to the
  // user: a neutral "today's allowance is spent" card, never a failed send.
  // It holds the server's UTC day the 429 came for, so it ends with that day (the
  // device's own counter runs on the local day, hours apart) and, below, as soon
  // as the user is Pro and the cap is higher.
  const [serverExhaustedDay, setServerExhaustedDay] = useState<string | null>(null);
  const exhausted =
    (serverExhaustedDay !== null && serverExhaustedDay === utcDayKey(Date.now())) ||
    (usage != null && usage.remaining <= 0);

  useEffect(() => {
    if (serverExhaustedDay === null) return;
    const wait = Math.min(msUntilNextUtcDay(Date.now()) + 1000, 2_147_000_000);
    const timer = setTimeout(() => setServerExhaustedDay(null), wait);
    return () => clearTimeout(timer);
  }, [serverExhaustedDay]);

  useEffect(() => {
    if (isProUser) setServerExhaustedDay(null);
  }, [isProUser]);

  // Shared request path. A message is counted ONLY on a successful reply, so a
  // failed request never burns the user's daily allowance; a failure exposes a
  // retry that re-sends the same history without re-appending the question.
  async function runRequest(history: SpikeMessage[]) {
    setError(null);
    setSending(true);
    discardStream();
    const controller = new AbortController();
    abortRef.current = controller;
    const startedAt = Date.now();
    const tier = isProUser ? "pro" : "free";
    try {
      const context = contextOn
        ? await summarizeForSpike(SPIKE_CONTEXT_DAYS, { profile: activeProfile })
        : null;
      const result = await askSpike({
        messages: history,
        locale: i18n.language,
        tier,
        context,
        signal: controller.signal,
        onDelta: showStream,
        onDispatch: ({ hasContext }) =>
          logEvent("spike_message_sent", { has_context: hasContext, tier }),
      });
      if (!mounted.current) return;
      // A filtered reply carries the function's own safe text; the streamed
      // words are replaced by it, never shown next to it.
      const base = result.reply || t("spike.filtered");
      // A reply cut off at the model's token ceiling ends on an ellipsis, so a
      // half sentence never reads as a finished one.
      const text = result.truncated ? `${base.replace(/[\s,;:]+$/, "")}…` : base;
      // Stored whole; `history` is exactly the array being appended to, so its
      // length is the new reply's index. Screenshot mode never reaches here.
      const index = history.length;
      setMessages((m) => [...m, { role: "assistant", content: text }]);
      setReplyMeta((prev) => ({
        ...prev,
        [index]: { actions: result.actions, sources: result.sources },
      }));
      discardStream();
      if (!result.streamed) startTyping(index, text);
      logEvent("spike_reply", {
        latency_ms: Date.now() - startedAt,
        filtered: result.filtered,
        actions: result.actions.length,
        streamed: result.streamed,
      });
      setUsage(await noteSpikeMessage(isProUser));
    } catch (e) {
      if (!mounted.current) return;
      discardStream();
      const code = spikeErrorCode(e);
      if (code === "daily_limit") setServerExhaustedDay(utcDayKey(startedAt));
      else if (code === "rate_limit") setError("rate_limit");
      else if (code === "capacity") setError("capacity");
      else if (code === "consent_required") setError("consent");
      else if (code !== "aborted") setError("generic");
    } finally {
      if (mounted.current) {
        setSending(false);
        requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
      }
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
    setReplyMeta({});
    setError(null);
    await clearHistory();
  }

  async function openAction(id: SpikeActionId) {
    hapticSelect();
    logEvent("spike_action_tap", { action: id });
    if (id === "start_meal_timer") {
      // The post-meal screen is per meal, and a timer only makes sense for a meal
      // that is still fresh: open it for the latest meal when that was logged in the
      // last 3 hours, otherwise go to the journal, where the meal gets logged.
      let recentId: string | null = null;
      try {
        const latest = activeProfile ? (await listMealLogs(activeProfile.id, 1))[0] : undefined;
        const age = latest ? Date.now() - new Date(latest.logged_at).getTime() : Number.NaN;
        recentId = latest && age <= RECENT_MEAL_MS ? latest.id : null;
      } catch {
        recentId = null;
      }
      if (recentId) {
        router.push({ pathname: SPIKE_ACTION_ROUTES[id], params: { mealId: recentId } });
      } else {
        router.push(SPIKE_ACTION_ROUTES.open_journal);
      }
      return;
    }
    // A tab is reached by going back to it, which also closes this modal.
    if (id === "open_injection_map") {
      router.navigate(SPIKE_ACTION_ROUTES[id]);
      return;
    }
    router.push(SPIKE_ACTION_ROUTES[id]);
  }

  function rate(index: number, value: ReplyFeedback) {
    if (replyMeta[index]?.feedback) return;
    hapticSelect();
    setReplyMeta((prev) => ({ ...prev, [index]: { ...(prev[index] ?? NO_META), feedback: value } }));
    logEvent("spike_feedback", { value });
  }

  function openSource(source: SpikeSource) {
    // The app's own references screen opens inside the app; every other source is a link.
    const route = spikeSourceRoute(source);
    if (route) {
      router.push(route);
      return;
    }
    void Linking.openURL(source.url).catch(() => {});
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
            <Ionicons name="close" size={26} color={THEME.textMuted} />
          </Pressable>
        </View>
        {/* The gate is avatar + title + four-line card + scope box + device-id
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
          <Text style={{ color: THEME.text, fontSize: 22, fontWeight: "800" }}>
            {t("spike.consentTitle")}
          </Text>
          <GlassCard style={{ width: "100%" }}>
            <View style={{ gap: 8 }}>
              <Text style={{ color: THEME.text, fontSize: 13, lineHeight: 20 }}>
                {t("spike.consentShort1")}
              </Text>
              <Text style={{ color: THEME.text, fontSize: 13, lineHeight: 20 }}>
                {t("spike.consentShort2")}
              </Text>
              <Text style={{ color: THEME.text, fontSize: 13, lineHeight: 20 }}>
                {t("spike.consentShort3")}
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
              borderColor: withAlpha(THEME.warning, 0.3),
              backgroundColor: withAlpha(THEME.warning, 0.1),
            }}
          >
            <View className="flex-row items-start">
              <Ionicons name="medical-outline" size={16} color={THEME.warning} />
              <Text
                style={{
                  color: THEME.warning,
                  fontSize: 12,
                  lineHeight: 18,
                  marginLeft: 8,
                  flex: 1,
                }}
              >
                {t("spike.consentShortScope")}
              </Text>
            </View>
          </View>
          {/* The short card is a summary of the full text, not a replacement:
              every line of the full consent sits behind this toggle, unchanged. */}
          <Pressable
            onPress={() => {
              hapticSelect();
              setDetailsOpen((open) => !open);
            }}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityState={{ expanded: detailsOpen }}
            accessibilityLabel={t("spike.consentDetails")}
            style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
          >
            <Text style={{ color: THEME.accent, fontSize: 13 }}>{t("spike.consentDetails")}</Text>
            <Ionicons name={detailsOpen ? "chevron-up" : "chevron-down"} size={14} color={THEME.accent} />
          </Pressable>
          {detailsOpen ? (
            <View style={{ width: "100%", gap: 14 }}>
              <GlassCard style={{ width: "100%" }}>
                <View style={{ gap: 8 }}>
                  <Text style={{ color: THEME.text, fontSize: 13, lineHeight: 20 }}>
                    {t("spike.consentSent")}
                  </Text>
                  <Text style={{ color: THEME.text, fontSize: 13, lineHeight: 20 }}>
                    {t("spike.consentRecipient")}
                  </Text>
                  <Text style={{ color: THEME.text, fontSize: 13, lineHeight: 20 }}>
                    {t("spike.consentNotSent")}
                  </Text>
                  <Text style={{ color: THEME.text, fontSize: 13, lineHeight: 20 }}>
                    {t("spike.consentCarb")}
                  </Text>
                  <Text style={{ color: THEME.textMuted, fontSize: 12, lineHeight: 18 }}>
                    {t("spike.consentSummaryNote")}
                  </Text>
                </View>
              </GlassCard>
              <Text style={{ color: THEME.warning, fontSize: 12, lineHeight: 18 }}>
                {t("spike.consentScope")}
              </Text>
              <Text style={{ color: THEME.textMuted, fontSize: 11, lineHeight: 16, textAlign: "center" }}>
                {t("spike.consentDeviceId")}
              </Text>
            </View>
          ) : null}
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
          <Pressable
            onPress={() => {
              hapticSelect();
              setAgreed((v) => !v);
            }}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: agreed }}
            accessibilityLabel={t("spike.consentAgree")}
            hitSlop={8}
            style={{
              width: "100%",
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              minHeight: HIT_TARGET,
            }}
          >
            <Ionicons
              name={agreed ? "checkbox" : "square-outline"}
              size={24}
              color={agreed ? THEME.accent : THEME.textMuted}
            />
            <Text style={{ color: THEME.text, fontSize: 14, lineHeight: 20, flex: 1 }}>
              {t("spike.consentAgree")}
            </Text>
          </Pressable>
          <GradientCTA
            label={t("spike.accept")}
            onPress={accept}
            disabled={!agreed}
            style={{ width: "100%" }}
          />
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Text style={{ color: THEME.textMuted, fontSize: 12 }}>{t("spike.notNow")}</Text>
          </Pressable>
        </ScrollView>
      </AppBackground>
    );
  }

  // ── Summary consent ────────────────────────────────────────────────────────
  if (contextView) {
    return (
      <ContextConsentView
        t={t}
        topPad={Math.max(insets.top, MODAL_TOP_PAD)}
        bottomPad={insets.bottom}
        columnPad={columnPad(24)}
        saveFailed={contextSaveFailed}
        onAccept={acceptContext}
        onDecline={declineContext}
      />
    );
  }

  // ── Chat ───────────────────────────────────────────────────────────────────
  // Starters follow the summary switch: with it on they ask about the user's own
  // last 14 days, with it off they stay on education and app help.
  const quickQuestions = contextOn
    ? [t("spike.ctxSuggest1"), t("spike.ctxSuggest2"), t("spike.ctxSuggest3")]
    : [t("spike.suggest1"), t("spike.suggest2"), t("spike.suggest3")];
  const streaming = streamText != null && streamText.length > 0;
  const errorText =
    error === "rate_limit"
      ? t("spike.errorRateLimit")
      : error === "capacity"
        ? t("spike.errorCapacity")
        : error === "consent"
          ? t("spike.errorConsent")
          : t("spike.error");

  return (
    <AppBackground style={{ paddingTop: Math.max(insets.top, MODAL_TOP_PAD) }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1"
      >
        <View className="flex-row items-center py-2" style={[{ gap: 8 }, columnPad(12)]}>
          <Pressable onPress={() => router.back()} hitSlop={10} className="p-1">
            <DirIcon name="chevron-back" size={26} color={THEME.textMuted} />
          </Pressable>
          <ConicAvatar label="✦" size={24} />
          <Text style={{ color: THEME.text, fontSize: 16, fontWeight: "800" }}>
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
              <Ionicons name="trash-outline" size={19} color={THEME.textMuted} />
            </Pressable>
          ) : null}
          {usage ? (
            <View
              className="rounded-full px-2.5 py-1"
              style={{ borderWidth: 1, borderColor: THEME.border, backgroundColor: THEME.surface }}
            >
              <Text style={{ color: THEME.textMuted, fontSize: 10, fontWeight: "700" }}>
                {t("spike.remaining", { n: usage.remaining })}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={[{ paddingBottom: 6 }, columnPad(14)]}>
          <Text style={{ color: THEME.textMuted, fontSize: 11, lineHeight: 15 }}>
            {t("spike.disclaimer")}
          </Text>
        </View>

        {/* The 14-day summary is off until the user turns it on and accepts its
            own consent screen; turning it off here takes effect on the next send. */}
        {isConfigured && !screenshotChat ? (
          <View style={columnPad(12)}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                marginBottom: 6,
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: contextOn ? withAlpha(THEME.accent, 0.3) : THEME.border,
                backgroundColor: THEME.surface,
              }}
            >
              <Ionicons
                name={contextOn ? "shield-checkmark-outline" : "shield-outline"}
                size={18}
                color={contextOn ? THEME.accent : THEME.textMuted}
              />
              <View style={{ flex: 1 }}>
                <Text style={{ color: THEME.text, fontSize: 12, fontWeight: "700" }}>
                  {t("spike.ctxToggle")}
                </Text>
                <Text style={{ color: THEME.textMuted, fontSize: 11, lineHeight: 15, marginTop: 1 }}>
                  {contextOn ? t("spike.ctxToggleOn") : t("spike.ctxToggleOff")}
                </Text>
              </View>
              <Switch
                value={contextOn}
                onValueChange={(next) => void toggleContext(next)}
                disabled={sending}
                {...switchColors()}
                accessibilityLabel={t("spike.ctxToggle")}
              />
            </View>
          </View>
        ) : null}

        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: "flex-end",
            paddingTop: 14,
            paddingBottom: 20,
            gap: 10,
            ...columnPad(14),
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() =>
            scrollRef.current?.scrollToEnd({ animated: streamText == null })
          }
        >
          {messages.length === 0 ? (
            <GlassCard style={{ alignSelf: "flex-start", maxWidth: "88%" }}>
              <Text style={{ color: THEME.text, fontSize: 13, lineHeight: 20 }}>
                {t("spike.intro")}
              </Text>
            </GlassCard>
          ) : null}

          {/* An empty chat left the user to guess what can be asked. Three
              starters send straight away, through the same guards as the
              input's send button; they vanish the instant messages fills,
              so a starter can't be tapped again while its reply is pending. */}
          {messages.length === 0 && effectiveConfigured && !exhausted && !screenshotChat ? (
            <View style={{ gap: 8, alignItems: "flex-start" }}>
              {quickQuestions.map((q) => (
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
                    backgroundColor: THEME.surface,
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
                  backgroundColor: THEME.surface,
                  borderWidth: 1,
                  borderColor: THEME.border,
                  borderRadius: 14,
                  borderBottomRightRadius: 4,
                  paddingVertical: 9,
                  paddingHorizontal: 12,
                }}
              >
                <Text style={{ color: THEME.text, fontSize: 13, lineHeight: 19 }}>{m.content}</Text>
              </View>
            ) : (
              <View key={i} style={{ alignSelf: "flex-start", maxWidth: "88%", gap: 6 }}>
                <AssistantBubble
                  text={
                    typing && typing.index === i ? wordPrefix(m.content, typing.count) : m.content
                  }
                />
                {!screenshotChat && !(typing && typing.index === i) ? (
                  <ReplyExtras
                    meta={replyMeta[i] ?? NO_META}
                    t={t}
                    onAction={(id) => void openAction(id)}
                    onSource={openSource}
                    onRate={(value) => rate(i, value)}
                  />
                ) : null}
              </View>
            )
          )}

          {streaming ? (
            <View style={{ alignSelf: "flex-start", maxWidth: "88%" }}>
              <AssistantBubble text={streamText ?? ""} />
            </View>
          ) : null}
          {sending && !streaming ? (
            <View style={{ alignSelf: "flex-start", padding: 8 }}>
              <ActivityIndicator color={THEME.accent} />
            </View>
          ) : null}
          {error ? (
            <View
              style={{
                alignSelf: "flex-start",
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
              }}
            >
              <Text style={{ color: THEME.danger, fontSize: 12, flexShrink: 1 }}>{errorText}</Text>
              <Pressable
                onPress={retry}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t("spike.retry")}
                style={{
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: THEME.border,
                  backgroundColor: THEME.surface,
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
            <Text style={{ color: THEME.textMuted, fontSize: 12, alignSelf: "center" }}>
              {t("spike.notConfigured")}
            </Text>
          ) : null}
        </ScrollView>

        {/* Allowance spent: a neutral card, not a failed send. */}
        {exhausted ? (
          <View style={columnPad()}>
          <GlassCard accent style={{ marginHorizontal: 12, marginBottom: 8 }}>
            <Text style={{ color: THEME.text, fontSize: 14, fontWeight: "800" }}>
              {t("spike.limitTitle")}
            </Text>
            <Text style={{ color: THEME.textMuted, fontSize: 12, lineHeight: 18, marginTop: 4 }}>
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
                onPress={() =>
                  router.push({ pathname: "/paywall", params: { reason: "spike" } })
                }
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
            backgroundColor: THEME.surface,
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
            placeholderTextColor={THEME.textMuted}
            editable={effectiveConfigured && !sending && !exhausted && !screenshotChat}
            onSubmitEditing={send}
            returnKeyType="send"
            style={[INPUT_TEXT, { flex: 1, color: THEME.text, paddingVertical: 11, fontSize: 14 }]}
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
                backgroundColor: THEME.accentFill,
                opacity:
                  !input.trim() || sending || !effectiveConfigured || exhausted || screenshotChat ? 0.4 : 1,
              },
              glow(THEME.accentFill, 10, 0.5),
            ]}
          >
            <Ionicons name="arrow-up" size={20} color={THEME.accentOnFill} />
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
