import React, { useCallback, useEffect, useRef, useState } from "react";
import { I18nManager, Switch, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { SheetShell } from "../SheetShell";
import { Button } from "../ui";
import { ChipGroup, type ChipOption } from "./ChipGroup";
import { RADIUS, THEME, switchColors } from "../../lib/theme/tokens";
import { loadLastFatalReport } from "../../lib/fatalCapture";
import { composeFeedbackMessage, type FatalReport } from "../../lib/fatalReport";
import { hapticSuccess } from "../../lib/haptics";
import { submitFeedback } from "../../lib/feedbackClient";
import {
  CANCEL_REASONS,
  MAX_EMAIL_CHARS,
  MAX_MESSAGE_CHARS,
  USER_FEEDBACK_KINDS,
  canSend,
  cleanMessage,
  createSendSlot,
  draftProblem,
  failureMessageKey,
  mayCloseByButton,
  mayCloseByGesture,
  type CancelReason,
  type FeedbackDraft,
  type FeedbackKind,
  type UserFeedbackKind,
} from "../../lib/feedbackSurvey";

export type FeedbackSheetMode = "survey" | "general";

const REASON_KEY: Record<CancelReason, string> = {
  expensive: "feedback.reasonExpensive",
  not_used: "feedback.reasonNotUsed",
  missing_feature: "feedback.reasonMissingFeature",
  bug: "feedback.reasonBug",
  other_app: "feedback.reasonOtherApp",
  other: "feedback.reasonOther",
};

const KIND_KEY: Record<UserFeedbackKind, string> = {
  suggestion: "feedback.kindSuggestion",
  bug: "feedback.kindBug",
  other: "feedback.kindOther",
};

const THANKS_CLOSE_MS = 1600;

/**
 * One sheet for both entries: the one-time survey after Pro ends ("survey":
 * reason chips, text and e-mail optional) and Settings > About > Send feedback
 * ("general": kind chips, text required). "Close without sending" is always on
 * screen. A failed send keeps everything typed and says so; the text is only
 * cleared once the server has accepted it.
 */
export function FeedbackSheet({
  visible,
  mode,
  onClose,
  onShown,
}: {
  visible: boolean;
  mode: FeedbackSheetMode;
  onClose: (sent: boolean) => void;
  /** The sheet is really on screen (the survey writes its asked flag here). */
  onShown?: () => void;
}) {
  const { t } = useTranslation();
  const isSurvey = mode === "survey";
  const [kind, setKind] = useState<FeedbackKind>(isSurvey ? "cancel_survey" : "suggestion");
  const [reason, setReason] = useState<CancelReason | null>(null);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const alive = useRef(true);
  // A state flag is one render late: two quick presses would both pass `busy`.
  const sendSlot = useRef(createSendSlot());
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  const draft: FeedbackDraft = { kind, reasonCode: reason, message, email };

  // Off every time the sheet opens: the report leaves the device only when ticked now.
  const [fatalReport, setFatalReport] = useState<FatalReport | null>(null);
  const [attachReport, setAttachReport] = useState(false);
  useEffect(() => {
    if (!visible || isSurvey) return;
    setAttachReport(false);
    let live = true;
    loadLastFatalReport()
      .then((r) => live && setFatalReport(r))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [visible, isSurvey]);

  const close = useCallback(
    (wasSent: boolean) => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
      onClose(wasSent);
      if (wasSent) {
        setSent(false);
        setMessage("");
        setEmail("");
        setReason(null);
        setErrorKey(null);
      }
    },
    [onClose]
  );

  async function send() {
    const problem = draftProblem(draft);
    if (problem === "bad_email") {
      setErrorKey("feedback.errorEmail");
      return;
    }
    if (problem) return;
    if (!sendSlot.current.tryAcquire()) return;
    setBusy(true);
    setErrorKey(null);
    let result;
    try {
      const outgoing: FeedbackDraft = {
        ...draft,
        message: composeFeedbackMessage(cleanMessage(message), fatalReport, attachReport, MAX_MESSAGE_CHARS),
      };
      result = await submitFeedback(outgoing);
    } finally {
      sendSlot.current.release();
    }
    if (!alive.current) return;
    setBusy(false);
    if (result.ok) {
      hapticSuccess();
      setSent(true);
      closeTimer.current = setTimeout(() => close(true), THANKS_CLOSE_MS);
    } else {
      setErrorKey(failureMessageKey(result.reason));
    }
  }

  const reasonOptions: ChipOption<CancelReason>[] = CANCEL_REASONS.map((r) => ({
    value: r,
    label: t(REASON_KEY[r]),
  }));
  const kindOptions: ChipOption<UserFeedbackKind>[] = USER_FEEDBACK_KINDS.map((k) => ({
    value: k,
    label: t(KIND_KEY[k]),
  }));

  const inputStyle = {
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: THEME.border,
    backgroundColor: THEME.surface,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: THEME.text,
    fontSize: 15,
  } as const;

  const footer = sent ? (
    <Button label={t("common.close")} onPress={() => close(true)} />
  ) : (
    <View style={{ gap: 4 }}>
      <Button
        label={errorKey ? t("feedback.retry") : t("feedback.send")}
        onPress={send}
        loading={busy}
        disabled={!canSend(draft)}
      />
      <Button
        label={t("feedback.dismiss")}
        variant="ghost"
        onPress={() => mayCloseByButton({ busy }) && close(false)}
        disabled={busy}
      />
    </View>
  );

  // Scrim, back key and the title X: see mayCloseByGesture.
  const closeByGesture = () => {
    if (sent) return close(true);
    if (mayCloseByGesture({ busy, survey: isSurvey, hasText: cleanMessage(message).length > 0 })) close(false);
  };

  return (
    <SheetShell
      scrollHintId="feedback"
      visible={visible}
      onClose={closeByGesture}
      onShown={onShown}
      title={isSurvey ? t("feedback.surveyTitle") : t("feedback.title")}
      closeLabel={t("common.close")}
      maxHeightRatio={0.92}
      footer={footer}
    >
      {sent ? (
        <Text style={{ color: THEME.text, fontSize: 16, paddingVertical: 24, textAlign: "center" }}>
          {t("feedback.thanks")}
        </Text>
      ) : (
        <View style={{ gap: 12, paddingTop: 4, paddingBottom: 8 }}>
          {isSurvey ? (
            <>
              <Text style={{ color: THEME.textMuted, fontSize: 14 }}>{t("feedback.surveyIntro")}</Text>
              <ChipGroup
                options={reasonOptions}
                value={reason}
                onChange={setReason}
                clearable
                disabled={busy}
              />
            </>
          ) : (
            <ChipGroup
              options={kindOptions}
              value={kind as UserFeedbackKind}
              onChange={(v) => v && setKind(v)}
              disabled={busy}
            />
          )}

          <TextInput
            value={message}
            onChangeText={setMessage}
            editable={!busy}
            multiline
            maxLength={MAX_MESSAGE_CHARS}
            placeholder={isSurvey ? t("feedback.messageSurveyPlaceholder") : t("feedback.messagePlaceholder")}
            placeholderTextColor={THEME.placeholder}
            accessibilityLabel={isSurvey ? t("feedback.messageSurveyPlaceholder") : t("feedback.messagePlaceholder")}
            textAlignVertical="top"
            style={{
              ...inputStyle,
              minHeight: 96,
              textAlign: I18nManager.isRTL ? "right" : "left",
            }}
          />

          <View style={{ gap: 4 }}>
            <TextInput
              value={email}
              onChangeText={(v) => {
                setEmail(v);
                if (errorKey === "feedback.errorEmail") setErrorKey(null);
              }}
              editable={!busy}
              maxLength={MAX_EMAIL_CHARS}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              placeholder={t("feedback.emailPlaceholder")}
              placeholderTextColor={THEME.placeholder}
              accessibilityLabel={t("feedback.emailPlaceholder")}
              style={{ ...inputStyle, textAlign: "left", writingDirection: "ltr" }}
            />
            <Text style={{ color: THEME.textMuted, fontSize: 12 }}>{t("feedback.emailHint")}</Text>
          </View>

          {!isSurvey && fatalReport ? (
            <View style={{ gap: 4 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <Text style={{ flex: 1, color: THEME.text, fontSize: 15 }}>
                  {t("fatalReport.attach")}
                </Text>
                <Switch
                  value={attachReport}
                  onValueChange={setAttachReport}
                  disabled={busy}
                  {...switchColors()}
                  accessibilityLabel={t("fatalReport.attach")}
                />
              </View>
              <Text style={{ color: THEME.textMuted, fontSize: 12 }}>{t("fatalReport.attachHint")}</Text>
            </View>
          ) : null}

          {errorKey ? (
            <Text
              accessibilityLiveRegion="polite"
              accessibilityRole="alert"
              style={{ color: THEME.danger, fontSize: 14 }}
            >
              {t(errorKey)}
            </Text>
          ) : null}

          <Text style={{ color: THEME.textMuted, fontSize: 12 }}>{t("feedback.privacy")}</Text>
        </View>
      )}
    </SheetShell>
  );
}
