import React from "react";
import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Circle } from "react-native-svg";

import { formatDate, formatTime, formatWeekday } from "../../lib/format";
import type { LiveData } from "../../lib/services/liveData";
import { THEME } from "../../lib/theme/tokens";
import { formatCountdown, inkA, nextReminderIcon, readingColor, unitLabel } from "./common";

/**
 * The lock screen itself, stacked the way iOS stacks it rather than as a row
 * of three sample tiles:
 *
 *   accessoryInline   ABOVE the clock, where iOS puts it (a drop + "112 mg/dL")
 *   the clock, then the date
 *   accessoryCircular + accessoryRectangular BELOW the date
 *
 * All three families come from targets/widget/index.swift's
 * ZerospikeWidgetView, replicated here because the real families only exist
 * inside the WidgetKit extension and never in the RN bundle. The previous
 * round drew them as one labelled row under the clock, which read as a widget
 * catalogue, not a lock screen.
 *
 * The rectangular family carries the general next-reminder countdown
 * (data.nextReminderAt) - a DIFFERENT number from the post-meal timer the Live
 * Activity shows. The capture device has no notification permission, so the
 * snapshot carries no reminder and the family draws its real empty state:
 * reading over caption, exactly as index.swift does when nextReminderAt is nil.
 *
 * Plain "row" throughout: RN's own forceRTL already mirrors a physical row, so
 * this never needs `isRTL ? "row-reverse" : "row"` on top of it.
 */
export function LockScreenScene({
  data,
  now,
  inlineH,
  gapInlineToClock,
  clockSize,
  clockLine,
  dateSize,
  dateLine,
  gapClockToAccessory,
  accessoryH,
}: {
  data: LiveData | null;
  now: number;
  inlineH: number;
  gapInlineToClock: number;
  clockSize: number;
  clockLine: number;
  dateSize: number;
  dateLine: number;
  gapClockToAccessory: number;
  accessoryH: number;
}) {
  const nowIso = new Date(now).toISOString();
  const remainingMs = data?.nextReminderAt != null ? data.nextReminderAt - now : null;
  const countdown = remainingMs != null && remainingMs > 0 ? formatCountdown(remainingMs) : null;
  const mgdl = data?.lastGlucoseMgdl ?? null;
  const reading = data?.lastGlucoseDisplay ?? "-";
  const color = readingColor(mgdl, data?.band);
  const gutter = Math.round(accessoryH * 0.2);

  return (
    <View style={{ alignItems: "center" }}>
      <InlineAccessory reading={reading} unit={data?.unit} height={inlineH} />

      <View style={{ height: gapInlineToClock }} />

      <Text
        style={{
          fontSize: clockSize,
          lineHeight: clockLine,
          fontWeight: "300",
          color: THEME.text,
          letterSpacing: -1,
        }}
        numberOfLines={1}
      >
        {formatTime(nowIso)}
      </Text>
      <Text
        style={{ fontSize: dateSize, lineHeight: dateLine, fontWeight: "600", color: THEME.text }}
        numberOfLines={1}
      >
        {formatWeekday(nowIso)}, {formatDate(nowIso)}
      </Text>

      <View
        style={{
          marginTop: gapClockToAccessory,
          height: accessoryH,
          flexDirection: "row",
          alignItems: "center",
          gap: gutter,
        }}
      >
        <CircularAccessory size={accessoryH} reading={reading} color={color} />
        <RectangularAccessory
          data={data}
          countdown={countdown}
          reading={reading}
          color={color}
          size={accessoryH}
        />
      </View>
    </View>
  );
}

function CircularAccessory({ size, reading, color }: { size: number; reading: string; color: string }) {
  const stroke = Math.max(3, Math.round(size * 0.06));
  const r = size / 2 - stroke;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={{ position: "absolute" }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={inkA(0.24)} strokeWidth={stroke} fill="none" />
      </Svg>
      <Text style={{ fontSize: Math.round(size * 0.3), fontWeight: "700", color: THEME.text }} numberOfLines={1}>
        {reading}
      </Text>
      <Ionicons name="water" size={Math.round(size * 0.19)} color={color} />
    </View>
  );
}

function RectangularAccessory({
  data,
  countdown,
  reading,
  color,
  size,
}: {
  data: LiveData | null;
  countdown: string | null;
  reading: string;
  color: string;
  size: number;
}) {
  const label = Math.round(size * 0.155);
  // index.swift's rectangularView sets the reading at 21pt when it is the
  // whole tile and 15pt when a lead row sits above it, against the ~72pt real
  // family height - the same two ratios reproduced here.
  const value = Math.round(size * (countdown ? 0.21 : 0.29));
  return (
    <View
      style={{
        // The real accessoryRectangular is ~160x72 pt against a 76pt circular,
        // i.e. a hair over 2.2:1 at a shared family height.
        width: Math.round(size * 2.25),
        height: size,
        borderRadius: Math.round(size * 0.24),
        paddingHorizontal: Math.round(size * 0.14),
        justifyContent: "center",
        backgroundColor: inkA(0.08),
      }}
    >
      {countdown ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Ionicons name={nextReminderIcon(data?.nextReminderMode ?? null)} size={label} color={THEME.text} />
          <Text style={{ fontSize: label, fontWeight: "600", color: THEME.text, flexShrink: 1 }} numberOfLines={1}>
            {data?.nextReminderLabel ?? data?.labels?.nextReminder ?? ""}
          </Text>
          <View style={{ flex: 1 }} />
          <Text style={{ fontSize: label, fontWeight: "700", color: THEME.text }} numberOfLines={1}>
            {countdown}
          </Text>
        </View>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 4 }}>
        <Text style={{ fontSize: value, lineHeight: Math.round(value * 1.15), fontWeight: "700", color }}>
          {reading}
        </Text>
        <Text style={{ fontSize: label, color: inkA(0.62), marginBottom: Math.round(size * 0.03) }}>
          {unitLabel(data?.unit)}
        </Text>
      </View>
      {/* index.swift prints the caption UNDER the value, and only when the
          reading is the whole tile - with a lead row above it the caption is
          what gives way, not the number. */}
      {countdown ? null : (
        <Text style={{ fontSize: label, fontWeight: "500", color: inkA(0.62) }} numberOfLines={1}>
          {data?.labels?.lastReading ?? ""}
        </Text>
      )}
    </View>
  );
}

/** accessoryInline: the one family iOS draws ABOVE the clock, as a single
 *  tinted line. Sized from its own row height so the lock-screen stack stays
 *  on known offsets. */
function InlineAccessory({
  reading,
  unit,
  height,
}: {
  reading: string;
  unit: LiveData["unit"] | undefined;
  height: number;
}) {
  const font = Math.round(height * 0.75);
  return (
    <View style={{ height, flexDirection: "row", alignItems: "center", gap: Math.round(height * 0.3) }}>
      <Ionicons name="water" size={font} color={THEME.text} />
      <Text style={{ fontSize: font, lineHeight: height, fontWeight: "600", color: THEME.text }} numberOfLines={1}>
        {`${reading} ${unitLabel(unit)}`}
      </Text>
    </View>
  );
}
