import React from "react";
import { I18nManager, Text, View } from "react-native";

import { CHART } from "./theme";
import { pct } from "../../lib/format";
import { THEME } from "../../lib/theme/tokens";

/** A segment narrower than this cannot hold its own percentage legibly. */
const MIN_INLINE_LABEL_PCT = 14;

interface Segment {
  key: "low" | "inRange" | "high";
  label: string;
  pct: number;
  color: string;
}

/**
 * The stacked time-in-range bar. Every segment carries its own percentage, both
 * on the bar (when it is wide enough) and in the legend below, so the chart
 * never depends on telling three colours apart.
 */
export function TimeInRangeBar({
  lowPct,
  inRangePct,
  highPct,
  labels,
}: {
  lowPct: number;
  inRangePct: number;
  highPct: number;
  labels: { low: string; inRange: string; high: string };
}) {
  // RTL EXEMPTION: low -> inRange -> high is a fixed severity progression, not
  // a reading-direction list - the bar and its legend stay in that exact order
  // under RTL instead of following RN's automatic row mirroring.
  const rtl = I18nManager.isRTL;
  const segments: Segment[] = [
    { key: "low", label: labels.low, pct: lowPct, color: CHART.low },
    { key: "inRange", label: labels.inRange, pct: inRangePct, color: CHART.inRange },
    { key: "high", label: labels.high, pct: highPct, color: CHART.high },
  ];

  return (
    <View>
      <View
        className="h-7 rounded-lg overflow-hidden bg-glass"
        style={{ flexDirection: rtl ? "row-reverse" : "row" }}
      >
        {segments.map((s) =>
          s.pct > 0 ? (
            <View
              key={s.key}
              className="h-full items-center justify-center"
              style={{ width: `${s.pct}%`, backgroundColor: s.color }}
            >
              {s.pct >= MIN_INLINE_LABEL_PCT ? (
                // Near-black on every segment: it clears WCAG AA against all
                // three (5.4:1 on the blue, 7.8:1 on the emerald, 9.3:1 on the
                // amber), where white would only reach 3.7:1 on the blue.
                <Text
                  numberOfLines={1}
                  className="text-[11px] font-bold"
                  style={{ color: THEME.bg.g1 }}
                >
                  {pct(s.pct)}
                </Text>
              ) : null}
            </View>
          ) : null
        )}
      </View>

      <View
        className="justify-between mt-3"
        style={{ flexDirection: rtl ? "row-reverse" : "row" }}
      >
        {segments.map((s) => (
          <View key={s.key} className="flex-row items-center">
            <View
              className="w-2.5 h-2.5 rounded-full mr-1.5"
              style={{ backgroundColor: s.color }}
            />
            <Text className="text-mut text-xs">
              {s.label} {pct(s.pct)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
