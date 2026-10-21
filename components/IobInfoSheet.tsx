import React from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";

import { SheetShell } from "./SheetShell";
import { SPACE, THEME } from "../lib/theme/tokens";
import { Txt } from "./ui";
import { num } from "../lib/format";
import type { InsulinProduct } from "../lib/insulinCatalog";

/**
 * "What does this number include?" explanation for the dashboard's active-
 * insulin card. Opens as a real bottom sheet (SheetShell) rather than the
 * small popup Tooltip the card used before, since it now also carries today's
 * totals rather than one sentence.
 */
export function IobInfoSheet({
  visible,
  onClose,
  bolusProfile,
  todayBolusUnits,
  todayBasalUnits,
}: {
  visible: boolean;
  onClose: () => void;
  /** The profile actually driving the active-insulin estimate - the user's
   *  selected bolus product, or the generic fallback (lib/insulinCatalog's
   *  bolusProfileFor). The fallback's `label` is "" - never a real product
   *  name - which is what tells the two cases apart below. */
  bolusProfile: InsulinProduct;
  /** Today's raw logged totals (units), not the decayed active-insulin
   *  estimate: a plain sum of the day's own doses. */
  todayBolusUnits: number;
  todayBasalUnits: number;
}) {
  const { t } = useTranslation();
  const isGeneric = bolusProfile.label === "";

  return (
    <SheetShell
      scrollHintId="iob-info"
      visible={visible}
      onClose={onClose}
      title={t("dashboard.activeInsulin")}
      closeLabel={t("common.close")}
    >
      <Txt kind="caption" style={{ marginBottom: SPACE.sm }}>
        {t("dashboard.iobInfoWhat")}
      </Txt>
      <Txt kind="caption" tone="muted" style={{ marginBottom: SPACE.lg }}>
        {isGeneric
          ? t("dashboard.iobInfoGeneric", {
              duration: num(bolusProfile.durationHours),
              peak: num(bolusProfile.peakHours ?? 0),
            })
          : t("dashboard.iobInfoProduct", {
              product: bolusProfile.label,
              duration: num(bolusProfile.durationHours),
              peak: num(bolusProfile.peakHours ?? 0),
            })}
      </Txt>

      <View className="flex-row rounded-2xl bg-glass border border-hair overflow-hidden mb-2">
        <View
          className="flex-1"
          style={{
            paddingHorizontal: SPACE.md,
            paddingVertical: SPACE.md,
            borderEndWidth: 1,
            borderEndColor: THEME.border,
            minWidth: 0,
          }}
        >
          <Txt kind="micro" tone="muted" numberOfLines={2}>
            {t("dashboard.iobInfoTodayBolus")}
          </Txt>
          <Txt kind="body" tabular style={{ fontWeight: "800", marginTop: SPACE.xs }}>
            {num(todayBolusUnits)} {t("common.units")}
          </Txt>
        </View>
        <View
          className="flex-1"
          style={{ paddingHorizontal: SPACE.md, paddingVertical: SPACE.md, minWidth: 0 }}
        >
          <Txt kind="micro" tone="muted" numberOfLines={2}>
            {t("dashboard.iobInfoTodayBasal")}
          </Txt>
          <Txt kind="body" tabular style={{ fontWeight: "800", marginTop: SPACE.xs }}>
            {num(todayBasalUnits)} {t("common.units")}
          </Txt>
        </View>
      </View>
    </SheetShell>
  );
}
