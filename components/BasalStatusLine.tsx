import React from "react";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import { HIT_TARGET, SPACE, THEME } from "../lib/theme/tokens";
import { formatTime, isolateLtr, num } from "../lib/format";
import { getActiveLang } from "../lib/lang";
import { Button, Card, Txt } from "./ui";

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
    <Card
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: SPACE.md,
        paddingVertical: SPACE.md,
        minHeight: HIT_TARGET,
      }}
    >
      <View className="flex-row items-center flex-1" style={{ gap: SPACE.sm, minWidth: 0 }}>
        <Ionicons
          name="water-outline"
          size={14}
          color={record ? THEME.accent : THEME.textMuted}
        />
        <Txt kind="caption" numberOfLines={2} style={{ fontWeight: "700", flexShrink: 1 }}>
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
        </Txt>
      </View>
      {!record ? (
        // The wrapper owns the shrink and the gap: the Button keeps its natural
        // width up to the cap, so a long de/fr label cannot push the status text
        // out of the row.
        <View style={{ flexShrink: 1, maxWidth: "50%", marginStart: SPACE.md }}>
          <Button
            label={t("dashboard.basalConfirmCta")}
            size="sm"
            minHit
            onPress={onConfirm}
          />
        </View>
      ) : null}
    </Card>
  );
}
