import React, { useCallback, useEffect, useState } from "react";
import { Platform, View } from "react-native";
import { useTranslation } from "react-i18next";

import { logEvent } from "../lib/analytics";
import { subscribeCgmChanges } from "../lib/cgm/importEvents";
import { answerCgmOffer } from "../lib/cgm/offerFlow";
import { healthStoreLabelKey } from "../lib/cgm/sourceLabel";
import { shouldOfferCgmSwitch, type CgmMode, type CgmOfferAction } from "../lib/cgm/state";
import { isScreenshotMode } from "../lib/screenshotMode";
import { SPACE } from "../lib/theme/tokens";
import { useFeedback } from "./Feedback";
import { Button, Card, Txt } from "./ui";

/**
 * The one-time question shown when the health store holds sensor readings for a
 * profile that is still on manual entry. Asked once per profile: either answer
 * is recorded and the card never comes back. Accepting switches the profile to
 * CGM mode; declining leaves it manual. The mode can be changed later under
 * Settings, Data sources.
 */
export function CgmSwitchOffer({
  profileId,
  mode,
  dataVersion,
}: {
  profileId: string;
  mode: CgmMode;
  dataVersion: number;
}) {
  const { t } = useTranslation();
  const { toast } = useFeedback();
  const [due, setDue] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mode !== "manual" || isScreenshotMode()) {
      setDue(false);
      return;
    }
    let alive = true;
    const check = () =>
      void shouldOfferCgmSwitch(profileId).then((v) => {
        if (alive) setDue(v);
      });
    check();
    const off = subscribeCgmChanges((change) => {
      if (change.profileId === profileId && change.kind === "import") check();
    });
    return () => {
      alive = false;
      off();
    };
  }, [profileId, mode, dataVersion]);

  const answer = useCallback(
    async (action: CgmOfferAction) => {
      if (busy) return;
      setBusy(true);
      try {
        await answerCgmOffer(profileId, action, { log: logEvent });
        setDue(false);
      } catch {
        toast(t("common.saveFailed"), "error");
      } finally {
        setBusy(false);
      }
    },
    [busy, profileId, t, toast]
  );

  if (!due) return null;
  return (
    <Card accent style={{ marginBottom: SPACE.md }}>
      <Txt kind="body" style={{ fontWeight: "700" }}>
        {t("cgmHome.offerTitle")}
      </Txt>
      <Txt kind="caption" tone="muted" style={{ marginTop: SPACE.xs }}>
        {t("cgmHome.offerBody", { store: t(healthStoreLabelKey(Platform.OS)) })}
      </Txt>
      <View style={{ marginTop: SPACE.md, gap: SPACE.sm }}>
        <Button
          label={t("cgmHome.offerAccept")}
          onPress={() => void answer("accepted")}
          disabled={busy}
        />
        <Button
          label={t("cgmHome.offerDecline")}
          variant="outlined"
          onPress={() => void answer("declined")}
          disabled={busy}
        />
      </View>
      <Txt kind="micro" tone="muted" style={{ marginTop: SPACE.sm }}>
        {t("cgmHome.offerHint")}
      </Txt>
    </Card>
  );
}
