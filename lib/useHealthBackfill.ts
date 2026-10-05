import { useCallback, useEffect, useState } from "react";
import { Platform } from "react-native";
import { useTranslation } from "react-i18next";

import { useFeedback } from "../components/Feedback";
import { logCrash } from "./analytics";
import { HEALTH_BACKFILL_WINDOWS, type HealthBackfillWindow } from "./healthBackfill";
import {
  backfillGlucoseToHealth,
  getHealthBackfillProgress,
  subscribeHealthBackfill,
} from "./services/health";
import { healthBackfillOfferSeen, markHealthBackfillOfferSeen } from "./services/healthWritePrompt";

/** Window picker + run + result toast for the "send past readings" action,
 *  shared by Settings > Data and the first-time offer after writing is enabled. */
export function useHealthBackfill() {
  const { t } = useTranslation();
  const { toast, confirm, actionSheet } = useFeedback();
  // The transfer is app-wide (one at a time), so progress is read from the
  // service rather than held per hook instance: the dashboard and Settings
  // always show the same one.
  const [progress, setProgress] = useState(getHealthBackfillProgress());
  useEffect(() => {
    setProgress(getHealthBackfillProgress());
    return subscribeHealthBackfill(() => setProgress(getHealthBackfillProgress()));
  }, []);
  const healthName = t(
    Platform.OS === "ios" ? "settings.healthSection" : "settings.healthSectionAndroid"
  );

  const run = useCallback(
    async (profileId: string, days: HealthBackfillWindow) => {
      try {
        const res = await backfillGlucoseToHealth(profileId, days);
        if (res.alreadyRunning) {
          const p = getHealthBackfillProgress();
          toast(
            t("settings.healthBackfillRunning", { done: p?.done ?? 0, total: p?.total ?? 0 }),
            "info"
          );
        } else if (res.skipped) toast(t("settings.healthBackfillSkipped", { health: healthName }), "info");
        else if (res.total === 0) toast(t("settings.healthBackfillNone"), "info");
        else if (res.failed > 0) {
          toast(
            t("settings.healthBackfillPartial", {
              n: res.written,
              failed: res.failed,
              health: healthName,
            }),
            "info"
          );
        } else {
          toast(t("settings.healthBackfillDone", { n: res.written, health: healthName }), "success");
        }
      } catch (err) {
        // The service clears its own in-flight state in a finally; this only
        // keeps a native/DB failure from becoming an unhandled rejection.
        logCrash(err, { screen: "health", op: "backfillRun" });
        toast(t("common.saveFailed"), "error");
      }
    },
    [t, toast, healthName]
  );

  const pickWindow = useCallback(
    (profileId: string) => {
      actionSheet({
        title: t("settings.healthBackfillPick"),
        actions: HEALTH_BACKFILL_WINDOWS.map((d) => ({
          label: t("insights.windowDays", { n: d }),
          icon: "calendar-outline" as const,
          onPress: () => void run(profileId, d),
        })),
      });
    },
    [actionSheet, run, t]
  );

  /** Asks once, ever, right after writing is first switched on. */
  const offerOnce = useCallback(
    async (profileId: string) => {
      if (await healthBackfillOfferSeen()) return;
      await markHealthBackfillOfferSeen();
      const yes = await confirm({
        title: t("settings.healthBackfillOfferTitle"),
        message: t("settings.healthBackfillOfferBody", { health: healthName }),
        confirmLabel: t("settings.healthBackfillOfferYes"),
        cancelLabel: t("settings.healthBackfillOfferLater"),
        icon: "cloud-upload-outline",
      });
      if (yes) pickWindow(profileId);
    },
    [confirm, pickWindow, t, healthName]
  );

  return { progress, pickWindow, offerOnce };
}
