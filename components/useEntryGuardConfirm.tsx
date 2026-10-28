import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { useFeedback } from "./Feedback";
import { useApp } from "../lib/store/AppContext";
import {
  checkEntryGuards,
  guardQueryRange,
  GUARD_WINDOW_MS,
  type EntryGuardInput,
  type EntryGuardNotice,
} from "../lib/entryGuard";
import { formatTime, num } from "../lib/format";
import { formatGlucose, glucoseUnitLabel } from "../lib/glucose";
import { listRecentSugarLogs } from "../lib/db/logs";
import { listRecentInjections } from "../lib/db/injections";
import { listRecentMealLogs } from "../lib/db/logs";
import { logCrash } from "../lib/analytics";
import { runGuardDialog, type GuardAddSiteChoice } from "../lib/injectionEditTarget";

export interface EntryGuardRequest {
  entryKind: "glucose" | "meal" | "injection" | "post_meal_timer";
  entryAtIso?: string;
  insulinType?: "basal" | "bolus" | null;
  foodKey?: string | null;
  foodName?: string | null;
  runningTimerEndsAtIso?: string | null;
  /** The record being edited, if any - see lib/entryGuard.ts's own doc on
   *  EntryGuardInput.excludeId. Omitted (or null) for a brand-new entry. */
  excludeId?: string | null;
  /** Caller reads this from the DB itself if it already has it; otherwise the
   *  hook fetches the profile's last few hours on its own. */
  recent?: EntryGuardInput["recent"];
  /** Units on the injection form; part of the "add region" eligibility. */
  doseUnits?: number | null;
  /** Injection form only: when the matched bolus is a region-less meal-save
   *  row, the dialog also offers "add region to that entry"; picking it calls
   *  this with the row id and the pending save is dropped (no second row). */
  onAddSite?: (injectionId: string) => void;
}

/**
 * A notice -> i18n key + interpolation vars, with no t() call, so it is
 * testable without react-i18next. Window numbers are read off GUARD_WINDOW_MS
 * at call time rather than hardcoded, so this stays correct if that window
 * ever changes. `formatTimeFn` is injected so a plain-node test can drive it
 * without lib/format's locale machinery.
 *
 * scripts/entryGuardWire.test.ts pins this exact block (see that file's
 * header): this component otherwise imports react-native-touching modules
 * (Feedback, AppContext, the db layer) that the plain-node test harness
 * cannot load, the same constraint lib/db/injections.ts documents at its own
 * TEST-EXTRACT markers.
 */
// TEST-EXTRACT-START
export function entryGuardMessageKeys(
  notices: EntryGuardNotice[],
  formatTimeFn: (iso: string) => string
): { key: string; vars: Record<string, string | number> }[] {
  return notices.map((n) => {
    const time = formatTimeFn(n.atIso);
    switch (n.kind) {
      case "recent_basal": {
        const vars: Record<string, string | number> = {
          h: GUARD_WINDOW_MS.recent_basal / (60 * 60 * 1000),
          time,
        };
        if (n.detail?.units !== undefined) vars.units = num(n.detail.units);
        return { key: "entryGuard.recentBasal", vars };
      }
      case "recent_bolus": {
        const vars: Record<string, string | number> = {
          m: GUARD_WINDOW_MS.recent_bolus / (60 * 1000),
          time,
        };
        if (n.detail?.units !== undefined) vars.units = num(n.detail.units);
        return { key: "entryGuard.recentBolus", vars };
      }
      case "recent_glucose": {
        const vars: Record<string, string | number> = {
          m: GUARD_WINDOW_MS.recent_glucose / (60 * 1000),
          time,
        };
        if (n.detail?.valueText !== undefined) vars.value = n.detail.valueText;
        return { key: "entryGuard.recentGlucose", vars };
      }
      case "recent_meal":
        return {
          key: "entryGuard.recentMeal",
          vars: { m: GUARD_WINDOW_MS.recent_meal / (60 * 1000), time },
        };
      case "timer_running":
        return { key: "entryGuard.timerRunning", vars: { time } };
      case "future_dated":
      default:
        return { key: "entryGuard.futureDated", vars: { time } };
    }
  });
}
// TEST-EXTRACT-END

/**
 * One shared confirmation for every duplicate-entry / future-dated check
 * (see lib/entryGuard.ts). This is a DATA-ENTRY confirmation, never a
 * medical warning: each line states a fact the profile already logged and
 * asks whether to save anyway. Declining never deletes anything; saving is
 * always one tap on the primary button.
 *
 * An empty notice list resolves `true` without showing anything - most saves
 * never see a dialog at all.
 */
export function useEntryGuardConfirm(): (req: EntryGuardRequest) => Promise<boolean> {
  const { t } = useTranslation();
  const { confirm, actionSheet } = useFeedback();
  const { activeProfile } = useApp();

  return useCallback(
    async (req: EntryGuardRequest): Promise<boolean> => {
      const now = Date.now();
      let recent = req.recent;
      if (recent === undefined) {
        if (!activeProfile) return true;
        try {
          // Read from BOTH sides of the entry's own time, not just "now" back
          // (see lib/entryGuard.ts's guardQueryRange doc): a backdated entry
          // more than the old fixed 8 h behind now used to read an empty
          // window and silently skip every guard.
          const { sinceIso, untilIso } = guardQueryRange(now, req.entryAtIso);
          const [injections, glucose, meals] = await Promise.all([
            listRecentInjections(activeProfile.id, sinceIso, untilIso),
            listRecentSugarLogs(activeProfile.id, sinceIso, untilIso),
            listRecentMealLogs(activeProfile.id, sinceIso, untilIso),
          ]);
          recent = {
            injections,
            glucose: glucose.map((g) => ({
              id: g.id,
              logged_at: g.logged_at,
              valueText: `${formatGlucose(g.glucose_level_mgdl, activeProfile.glucose_unit)} ${glucoseUnitLabel(activeProfile.glucose_unit)}`,
            })),
            meals,
          };
        } catch (err) {
          // A duplicate-entry confirmation is never worth blocking the save
          // over: an unreadable DB here just means "nothing to ask about".
          logCrash(err, { screen: "entryGuard", step: "recentRead" });
          return true;
        }
      }

      const notices = checkEntryGuards({
        now,
        entryAtIso: req.entryAtIso,
        entryKind: req.entryKind,
        insulinType: req.insulinType,
        foodKey: req.foodKey,
        foodName: req.foodName,
        doseUnits: req.doseUnits,
        excludeId: req.excludeId,
        runningTimerEndsAtIso: req.runningTimerEndsAtIso,
        recent,
      });
      if (notices.length === 0) return true;

      const message = entryGuardMessageKeys(notices, formatTime)
        .map(({ key, vars }) => t(key, vars))
        .join("\n");

      const addSiteId = req.onAddSite
        ? notices.find((n) => n.kind === "recent_bolus" && n.detail?.addSiteToId)?.detail?.addSiteToId
        : undefined;
      return runGuardDialog({
        hasNotices: true,
        addSiteId,
        onAddSite: req.onAddSite,
        confirmSave: () =>
          confirm({
            title: t("entryGuard.title"),
            message,
            confirmLabel: t("common.save"),
            cancelLabel: t("common.cancel"),
            destructive: false,
            icon: "time-outline",
          }),
        // Three ways out, and the sheet states what each does: the region goes
        // onto THAT entry and the new dose is not saved; save anyway; give up.
        chooseAddSite: () =>
          new Promise<GuardAddSiteChoice>((resolve) => {
            actionSheet({
              title: `${t("entryGuard.addSiteTitle")}\n${message}\n${t("entryGuard.addSiteBody")}`,
              actions: [
                {
                  label: t("entryGuard.addSiteToRecord"),
                  icon: "add-circle-outline",
                  onPress: () => resolve("addSite"),
                },
                {
                  label: t("entryGuard.saveAnyway"),
                  icon: "save-outline",
                  onPress: () => resolve("save"),
                },
              ],
              cancelLabel: t("entryGuard.cancelSave"),
              onDismiss: () => resolve("cancel"),
            });
          }),
      });
    },
    [activeProfile, confirm, actionSheet, t]
  );
}
