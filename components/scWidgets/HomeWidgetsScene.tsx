import React from "react";
import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { THEME } from "../../lib/theme/tokens";
import { GlassCard } from "../rich/GlassCard";
import type { LiveData } from "../../lib/services/liveData";
import { elapsedLabel, formatCountdown, nextReminderIcon, readingColor, unitLabel } from "./common";

/**
 * Home-screen replica: the systemMedium summary widget (ZerospikeWidgetView.
 * mediumView in targets/widget/index.swift) beside the systemSmall reading
 * tile (SmallReadingView.smallView in targets/widget/SmallWidgets.swift).
 *
 * Laid out on the SAME grid unit S the mini row below uses, exactly like the
 * real WidgetKit canvas: a systemSmall is S x S and a systemMedium is 2S + one
 * gutter wide at the same height. Nothing measures its parent and nothing
 * stretches - the previous round derived the pair's height from whatever the
 * section had spare, which is how the pair ended up a different size on every
 * profile.
 *
 * Plain "row": RN's own forceRTL already mirrors a physical row under RTL.
 */
export function HomeWidgetsScene({
  data,
  now,
  unit,
  gap,
  trailing,
}: {
  data: LiveData | null;
  now: number;
  unit: number;
  gap: number;
  /** One more S x S cell on the same row. The iPhone hands the glucose mini
   *  tile in here so its two widget rows are the same 372 pt wide; the iPad,
   *  which gives the mini family a section of its own, passes nothing. */
  trailing?: React.ReactNode;
}) {
  return (
    <View style={{ height: unit, flexDirection: "row", gap }}>
      <View style={{ width: unit * 2 + gap, height: unit }}>
        <MediumWidget data={data} now={now} unit={unit} />
      </View>
      <View style={{ width: unit, height: unit }}>
        <SmallReadingWidget data={data} now={now} unit={unit} />
      </View>
      {trailing ? <View style={{ width: unit, height: unit }}>{trailing}</View> : null}
    </View>
  );
}

function MediumWidget({ data, now, unit }: { data: LiveData | null; now: number; unit: number }) {
  const avgMgdl = data?.avgGlucoseMgdl ?? null;
  const avgReading = data?.avgGlucoseDisplay ?? data?.lastGlucoseDisplay ?? "-";
  const metaLine = avgMgdl == null ? (data?.labels?.noData ?? "") : (data?.labels?.avgWindow ?? "");
  const lastMgdl = data?.lastGlucoseMgdl ?? null;
  const remainingMs = data?.nextReminderAt != null ? data.nextReminderAt - now : null;
  const countdown = remainingMs != null && remainingMs > 0 ? formatCountdown(remainingMs) : null;

  const pad = Math.round(unit * 0.15);
  const label = Math.round(unit * 0.095);
  const value = Math.round(unit * 0.28);
  const small = Math.round(unit * 0.2);

  return (
    <GlassCard style={{ flex: 1, padding: pad }} radius={Math.round(unit * 0.2)}>
      <View style={{ flex: 1, flexDirection: "row" }}>
        <View style={{ flex: 1.1, justifyContent: "center" }}>
          <Text style={{ fontSize: label, fontWeight: "700", color: THEME.muted }} numberOfLines={1}>
            {data?.labels?.avgGlucose ?? ""}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 4 }}>
            <Text
              style={{
                fontSize: value,
                lineHeight: Math.round(value * 1.15),
                fontWeight: "700",
                color: readingColor(avgMgdl, data?.band),
              }}
            >
              {avgReading}
            </Text>
            <Text style={{ fontSize: Math.round(unit * 0.105), color: THEME.muted, marginBottom: Math.round(unit * 0.04) }}>
              {unitLabel(data?.unit)}
            </Text>
          </View>
          {metaLine ? (
            <Text style={{ fontSize: label, color: THEME.muted }} numberOfLines={1}>
              {metaLine}
            </Text>
          ) : null}
        </View>

        <View style={{ width: 1, backgroundColor: "rgba(255,255,255,0.08)", marginHorizontal: pad * 0.8 }} />

        <View style={{ flex: 1, justifyContent: "center", gap: Math.round(unit * 0.06) }}>
          {data?.lastGlucoseDisplay ? (
            <View>
              {/* Two lines: "Letzte Messung" is a hair wider than this column
                  at the iPhone's 84 pt grid unit and came back as "Letzte
                  Mess..." on the German capture. The real widget answers that
                  with minimumScaleFactor, which has no RN twin that is not the
                  banned adjustsFontSizeToFit. */}
              <Text
                style={{ fontSize: label, lineHeight: Math.round(label * 1.25), fontWeight: "700", color: THEME.muted }}
                numberOfLines={2}
              >
                {data.labels?.lastReading ?? ""}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 3 }}>
                <Text
                  style={{
                    fontSize: small,
                    lineHeight: Math.round(small * 1.15),
                    fontWeight: "700",
                    color: readingColor(lastMgdl, data?.band),
                  }}
                >
                  {data.lastGlucoseDisplay}
                </Text>
                <Text style={{ fontSize: label, color: THEME.muted }}>{unitLabel(data?.unit)}</Text>
              </View>
            </View>
          ) : null}
          {countdown ? (
            <View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                <Ionicons name={nextReminderIcon(data?.nextReminderMode ?? null)} size={label} color={THEME.muted} />
                <Text style={{ fontSize: label, fontWeight: "700", color: THEME.muted, flexShrink: 1 }} numberOfLines={1}>
                  {data?.nextReminderLabel ?? data?.labels?.nextReminder ?? ""}
                </Text>
              </View>
              <View
                style={{
                  alignSelf: "flex-start",
                  marginTop: 2,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: "rgba(46,230,255,0.28)",
                  backgroundColor: "rgba(46,230,255,0.14)",
                  paddingHorizontal: Math.round(unit * 0.07),
                  paddingVertical: 2,
                }}
              >
                <Text style={{ fontSize: Math.round(unit * 0.12), fontWeight: "700", color: THEME.accent }}>
                  {countdown}
                </Text>
              </View>
            </View>
          ) : null}
        </View>
      </View>
    </GlassCard>
  );
}

function SmallReadingWidget({ data, now, unit }: { data: LiveData | null; now: number; unit: number }) {
  const mgdl = data?.lastGlucoseMgdl ?? null;
  const hasReading = mgdl != null || data?.lastGlucoseDisplay != null;
  const meta = hasReading ? (elapsedLabel(data, now) ?? "") : (data?.labels?.noData ?? "");
  const pad = Math.round(unit * 0.15);
  const label = Math.round(unit * 0.1);
  const value = Math.round(unit * 0.26);
  return (
    <GlassCard style={{ flex: 1, padding: pad, justifyContent: "space-between" }} radius={Math.round(unit * 0.2)}>
      {/* Two lines, not one: at this tile's scale "Letzte Messung" is a hair
          wider than the box, and the real widget answers that with
          minimumScaleFactor - which has no RN twin that is not
          adjustsFontSizeToFit. A wrapped caption reads better than "Letzte
          Mess...". */}
      <Text
        style={{ fontSize: label, lineHeight: Math.round(label * 1.25), fontWeight: "700", color: THEME.muted }}
        numberOfLines={2}
      >
        {data?.labels?.lastReading ?? ""}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 3 }}>
        <Text
          style={{
            fontSize: value,
            lineHeight: Math.round(value * 1.15),
            fontWeight: "700",
            color: readingColor(mgdl, data?.band),
          }}
        >
          {data?.lastGlucoseDisplay ?? "-"}
        </Text>
        <Text style={{ fontSize: Math.round(unit * 0.105), color: THEME.muted, marginBottom: Math.round(unit * 0.03) }}>
          {unitLabel(data?.unit)}
        </Text>
      </View>
      <Text style={{ fontSize: label, color: THEME.muted }} numberOfLines={1}>
        {meta}
      </Text>
    </GlassCard>
  );
}
