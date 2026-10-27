import React, { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { SheetShell } from "./SheetShell";
import { Button } from "./ui";
import { HIDDEN_FROM_A11Y } from "../lib/a11y";
import { THEME } from "../lib/theme/tokens";
import { useApp } from "../lib/store/AppContext";
import { isScreenshotMode } from "../lib/screenshotMode";
import { SURVEY_ASKED_KEY, SURVEY_PENDING_KEY, onSurveyRelease, overlayOpen, surveyHeld } from "../lib/feedbackSurvey";
import {
  WHATS_NEW_DELAY_MS,
  WHATS_NEW_ITEMS,
  isWhatsNewRoute,
  surveyInTheWay,
  takeWhatsNew,
  whatsNewMayPresent,
} from "../lib/whatsNew";
import { currentAppVersion, whatsNewKv } from "../lib/whatsNewStore";
import { useOverlayPresence } from "../lib/useOverlayPresence";
import { claimSheet, onSheetRelease } from "../lib/sheetClaim";

export function WhatsNewSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  // Counted as an overlay in its own right, so the thank-you sheet never opens over it.
  useOverlayPresence(visible);
  return (
    <SheetShell
      scrollHintId="whats-new"
      visible={visible}
      onClose={onClose}
      title={t("whatsNew.title")}
      closeLabel={t("common.close")}
      footer={<Button label={t("whatsNew.ok")} onPress={onClose} />}
      testID="whats-new-sheet"
    >
      <View style={{ gap: 14, paddingTop: 4, paddingBottom: 8 }}>
        {WHATS_NEW_ITEMS.map((key) => (
          <View key={key} style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
            <View
              {...HIDDEN_FROM_A11Y}
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                marginTop: 8,
                backgroundColor: THEME.accent,
              }}
            />
            <Text style={{ flex: 1, color: THEME.text, fontSize: 15, lineHeight: 22 }}>{t(key)}</Text>
          </View>
        ))}
      </View>
    </SheetShell>
  );
}

/**
 * Mounted once under the root navigator. After the settle delay, on a tab screen,
 * for an already-onboarded user who has not seen this release's sheet, opens it
 * once. The seen flag is written when the sheet opens, so it never returns. It
 * yields to the winback and to the cancellation survey: while the survey is armed
 * or has been shown this session, the sheet waits for the next launch.
 */
export function WhatsNewHost({ root }: { root: string | undefined }) {
  const { ready, onboarded } = useApp();
  const [visible, setVisible] = useState(false);
  const latest = useRef({ ready, onboarded, root });
  latest.current = { ready, onboarded, root };
  const askedAtStart = useRef<boolean | null>(null);
  // Bumped when the thank-you sheet lets go of the slot, so a sheet that had to
  // wait for it looks again instead of being lost.
  const [slotTick, setSlotTick] = useState(0);
  const releaseSlot = useRef<(() => void) | null>(null);

  useEffect(() => {
    const bump = () => setSlotTick((n) => n + 1);
    const offSlot = onSheetRelease(bump);
    const offOverlay = onSurveyRelease(bump);
    return () => {
      offSlot();
      offOverlay();
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void whatsNewKv
      .get(SURVEY_ASKED_KEY)
      .then((v) => {
        if (alive) askedAtStart.current = v === "true";
      })
      .catch(() => {
        if (alive) askedAtStart.current = true;
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!ready || !onboarded || visible || !isWhatsNewRoute(root)) return;
    const timer = setTimeout(() => {
      const s = latest.current;
      const gate = {
        ready: s.ready,
        onboarded: s.onboarded,
        screenshotMode: isScreenshotMode(),
        root: s.root,
        winbackHold: surveyHeld(),
        // A thank-you sheet may already be up: two Modals cannot present together.
        surveyBusy: overlayOpen(),
      };
      if (!whatsNewMayPresent(gate) || askedAtStart.current === null) return;
      void (async () => {
        const slot = claimSheet();
        if (!slot) return;
        let opened = false;
        try {
          const inTheWay = await surveyInTheWay(whatsNewKv, askedAtStart.current === true, {
            pending: SURVEY_PENDING_KEY,
            asked: SURVEY_ASKED_KEY,
          });
          if (inTheWay) return;
          const again = latest.current;
          if (!isWhatsNewRoute(again.root) || surveyHeld()) return;
          const due = await takeWhatsNew(whatsNewKv, {
            onboarded: again.onboarded,
            appVersion: currentAppVersion(),
          });
          if (due) {
            opened = true;
            releaseSlot.current = slot;
            setVisible(true);
          }
        } finally {
          if (!opened) slot();
        }
      })();
    }, WHATS_NEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [ready, onboarded, root, visible, slotTick]);

  useEffect(() => {
    if (visible) return;
    releaseSlot.current?.();
    releaseSlot.current = null;
  }, [visible]);

  useEffect(() => () => releaseSlot.current?.(), []);

  useEffect(() => {
    if (visible && !isWhatsNewRoute(root)) setVisible(false);
  }, [visible, root]);

  const close = useCallback(() => setVisible(false), []);

  return <WhatsNewSheet visible={visible} onClose={close} />;
}
