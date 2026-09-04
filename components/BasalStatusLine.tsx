import React from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import { THEME } from "../lib/theme/tokens";
import { formatTime, isolateLtr, num } from "../lib/format";
import { getActiveLang } from "../lib/lang";

/**
 * The dashboard's basal-dose status for TODAY (device local day): either
 * today's own logged dose (time + units) or a nudge to confirm it, which
 * hands off to app/basal-confirm.tsx. Only rendered by the caller when the
 * profile actually uses basal insulin (basal_daily_units set, or a basal-type
 * reminder exists) - this component itself does not gate its own visibility.
 */
export function BasalStatusLine({
  record,
  onConfirm,
}: {
  /** Today's basal dose, when one has already been logged; null shows the
   *  "pending" nudge instead. */
  record: { loggedAt: string; units: number } | null;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();

  return (
    <View
      className="flex-row items-center justify-between rounded-2xl bg-glass border border-hair mb-3"
      style={{ paddingHorizontal: 14, paddingVertical: 10, minHeight: 46 }}
    >
      <View className="flex-row items-center flex-1" style={{ gap: 6 }}>
        <Ionicons
          name="water-outline"
          size={14}
          color={record ? THEME.accent : THEME.muted}
        />
        <Text
          numberOfLines={1}
          style={{ color: THEME.ink, fontSize: 12, fontWeight: "700", flexShrink: 1 }}
        >
          {record
            ? t("dashboard.basalTodayLine", {
                // "22:30, 24 U" is one purely-LTR run; composed and isolated
                // as a single block (lib/format's LRI/PDI wrap) so RTL never
                // reorders the time against the dose - same pattern as
                // components/CarbRatioLine.tsx. The separator matches what
                // each locale's own (now-merged) template used to spell out
                // itself - only ja's list comma differs from the rest.
                summary: isolateLtr(
                  `${formatTime(record.loggedAt)}${getActiveLang() === "ja" ? "、" : ", "}${num(record.units)} ${t("common.unitsShort")}`
                ),
              })
            : t("dashboard.basalPendingLine")}
        </Text>
      </View>
      {!record ? (
        <Pressable
          onPress={onConfirm}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t("dashboard.basalConfirmCta")}
          className="rounded-full bg-brand px-3 py-1.5 active:opacity-80"
        >
          <Text numberOfLines={1} className="text-black text-xs font-bold">
            {t("dashboard.basalConfirmCta")}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
