import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import type { CgmDayEntry } from "../lib/cgm/daySummary";
import type { GlucoseUnit } from "../lib/db/types";
import { formatGlucose, glucoseUnitLabel } from "../lib/glucose";
import { isolateLtr, pct } from "../lib/format";
import { RIPPLE_ALPHA } from "../lib/theme/uiPrimitives";
import { HIT_TARGET, SPACE, THEME } from "../lib/theme/tokens";
import { DirIcon } from "./DirIcon";
import { withAlpha } from "./rich/GlassCard";
import { Txt } from "./ui";

/**
 * The single journal row a day of sensor readings collapses into: the reading
 * count, the day's average and the share inside the target band. Tapping it
 * opens that day's curve. Styled as an in-panel row, like JournalItem's.
 */
function CgmDayRowBase({
  entry,
  unit,
  onPress,
  firstInPanel,
}: {
  entry: CgmDayEntry;
  unit: GlucoseUnit;
  onPress: (dayKey: string) => void;
  firstInPanel?: boolean;
}) {
  const { t } = useTranslation();
  const count = t("cgmCurve.dayRow", { count: entry.count });
  const sub = t("cgmCurve.dayRowSub", {
    avg: isolateLtr(`${formatGlucose(entry.avgMgdl, unit)} ${glucoseUnitLabel(unit)}`),
    share: isolateLtr(pct(entry.inRangePct)),
  });
  return (
    <Pressable
      onPress={() => onPress(entry.dayKey)}
      android_ripple={{ color: withAlpha(THEME.text, RIPPLE_ALPHA), foreground: true }}
      accessibilityRole="button"
      accessibilityLabel={`${count}. ${sub}`}
      accessibilityHint={t("cgmCurve.dayRowHint")}
      style={{
        flexDirection: "row",
        alignItems: "center",
        minHeight: HIT_TARGET,
        borderTopWidth: firstInPanel ? 0 : StyleSheet.hairlineWidth,
        borderTopColor: THEME.border,
        paddingVertical: SPACE.sm,
        paddingHorizontal: SPACE.md,
      }}
    >
      <View
        style={{
          width: 3,
          alignSelf: "stretch",
          minHeight: 22,
          borderRadius: 2,
          backgroundColor: THEME.accent,
          marginEnd: SPACE.sm,
        }}
      />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt kind="caption" style={{ fontWeight: "700" }}>
          <Ionicons name="pulse" size={11} color={THEME.accent} /> {count}
        </Txt>
        <Txt kind="micro" tone="muted" numberOfLines={2}>
          {sub}
        </Txt>
      </View>
      <DirIcon name="chevron-forward" size={16} color={THEME.textMuted} />
    </Pressable>
  );
}

export const CgmDayRow = React.memo(CgmDayRowBase);
