import React from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { SheetShell } from "./SheetShell";
import { THEME } from "../lib/theme/tokens";
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
      visible={visible}
      onClose={onClose}
      title={t("dashboard.activeInsulin")}
      closeLabel={t("common.close")}
    >
      <Text style={{ color: THEME.text, fontSize: 13, lineHeight: 19, marginBottom: 10 }}>
        {t("dashboard.iobInfoWhat")}
      </Text>
      <Text style={{ color: THEME.textMuted, fontSize: 12, lineHeight: 18, marginBottom: 16 }}>
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
      </Text>

      <View className="flex-row rounded-2xl bg-glass border border-hair overflow-hidden mb-2">
        <View
          className="flex-1 px-3.5 py-3"
          style={{ borderRightWidth: 1, borderRightColor: THEME.border }}
        >
          <Text numberOfLines={1} style={{ color: THEME.textMuted, fontSize: 10 }}>
            {t("dashboard.iobInfoTodayBolus")}
          </Text>
          <Text
            numberOfLines={1}
            style={{ color: THEME.text, fontSize: 15, fontWeight: "800", marginTop: 2 }}
          >
            {num(todayBolusUnits)} {t("common.units")}
          </Text>
        </View>
        <View className="flex-1 px-3.5 py-3">
          <Text numberOfLines={1} style={{ color: THEME.textMuted, fontSize: 10 }}>
            {t("dashboard.iobInfoTodayBasal")}
          </Text>
          <Text
            numberOfLines={1}
            style={{ color: THEME.text, fontSize: 15, fontWeight: "800", marginTop: 2 }}
          >
            {num(todayBasalUnits)} {t("common.units")}
          </Text>
        </View>
      </View>
    </SheetShell>
  );
}
