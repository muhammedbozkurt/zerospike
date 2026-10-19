import React from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { num, pct } from "../../lib/format";
import { TABULAR, THEME } from "../../lib/theme/tokens";
import { AnimatedNumber } from "../AnimatedNumber";
import { splitTotalLine, targetSharePct } from "./mealCards";

const SLOT = "";

/**
 * The meal's running total, big: "26,5 g carbohydrates", and one quiet line
 * under it stating the meal as a share of the daily carbohydrate target.
 * The share is a neutral proportion: no colour change, no wording about
 * exceeding anything. No target set means no second line.
 *
 * todayG (carbohydrates already logged today) is accepted so the caller keeps
 * one prop shape; the line reads the MEAL's share, not the day's running sum.
 */
export function LiveTotalHeader({
  totalG,
  targetG,
}: {
  totalG: number;
  targetG: number | null;
  todayG?: number;
}) {
  const { t } = useTranslation();
  const safeTotal = Number.isFinite(totalG) && totalG > 0 ? totalG : 0;
  const { before, after } = splitTotalLine(t("mealCompose.totalLine", { value: SLOT }), SLOT);
  const share = targetSharePct(safeTotal, targetG);
  const spoken = t("mealCompose.totalLine", { value: num(safeTotal) });

  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={
        share === null ? spoken : `${spoken}. ${t("mealCompose.ofTarget", { pct: pct(share) })}`
      }
    >
      <Text style={{ color: THEME.text }} numberOfLines={2}>
        {before ? (
          <Text style={{ fontSize: 16, fontWeight: "600", color: THEME.textMuted }}>{before}</Text>
        ) : null}
        <AnimatedNumber
          value={safeTotal}
          decimals={1}
          format={num}
          duration={350}
          style={[TABULAR, { fontSize: 40, lineHeight: 46, fontWeight: "800", color: THEME.text }]}
        />
        <Text style={{ fontSize: 16, fontWeight: "600", color: THEME.textMuted }}>{after}</Text>
      </Text>
      {share !== null ? (
        <Text
          numberOfLines={2}
          style={{ marginTop: 2, fontSize: 13, color: THEME.textMuted }}
        >
          {t("mealCompose.ofTarget", { pct: pct(share) })}
        </Text>
      ) : null}
    </View>
  );
}
