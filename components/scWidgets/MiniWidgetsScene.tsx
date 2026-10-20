import React from "react";
import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { THEME } from "../../lib/theme/tokens";
import type { LiveData } from "../../lib/services/liveData";
import { elapsedLabel, formatCountdown, readingColor, TILE_INK, unitLabel, widgetAccent } from "./common";

/**
 * The five single-purpose systemSmall tiles from targets/widget/
 * SmallWidgets.swift's home-screen face (SmallReadingView / SmallActionView /
 * SmallTimerView), on the same grid unit S the home row above uses.
 *
 * W4: the caller now names the rows, because the two iOS profiles have very
 * different room. The iPad prints all five as 3 + 2 under its own caption; the
 * iPhone's visible band is 682 pt for the whole scene, so it prints the three
 * action tiles on one row and hands the glucose tile to the home row beside
 * the systemMedium widget. The mini READING tile is what the iPhone drops:
 * the systemSmall reading widget one cell to its left already prints the same
 * 112 mg/dL, and a duplicate is the cheapest thing on the panel to lose.
 *
 * Rows are start-aligned, so RN's own forceRTL mirrors them to the right in
 * Arabic without any `isRTL ? "row-reverse" : "row"` here.
 */
export type MiniTileKey = "reading" | "glucose" | "meal" | "third" | "timer";

export function MiniTile({
  tile,
  data,
  now,
  unit,
}: {
  tile: MiniTileKey;
  data: LiveData | null;
  now: number;
  unit: number;
}) {
  const usesInsulin = data?.usesInsulin !== false;
  const remainingMs = data?.postMealEndsAt != null ? data.postMealEndsAt - now : null;
  const countdown = remainingMs != null && remainingMs > 0 ? formatCountdown(remainingMs) : null;

  switch (tile) {
    case "reading":
      return <ReadingTile data={data} now={now} unit={unit} />;
    case "glucose":
      return (
        <ActionTile icon="water" tint={TILE_INK.glucose} label={data?.labels?.addGlucose ?? ""} addsEntry unit={unit} />
      );
    case "meal":
      return (
        <ActionTile icon="restaurant" tint={TILE_INK.meal} label={data?.labels?.addMeal ?? ""} addsEntry unit={unit} />
      );
    case "third":
      return (
        <ActionTile
          icon={usesInsulin ? "medkit" : "open-outline"}
          tint={usesInsulin ? TILE_INK.injection : TILE_INK.glucose}
          label={usesInsulin ? (data?.labels?.addInjection ?? "") : "zerospike"}
          addsEntry={usesInsulin}
          unit={unit}
        />
      );
    case "timer":
    default:
      return (
        <TimerTile
          countdown={countdown}
          title={data?.labels?.timerTitle}
          idleLabel={data?.labels?.startCountdown}
          unit={unit}
        />
      );
  }
}

export function MiniWidgetsScene({
  data,
  now,
  unit,
  gap,
  rows,
}: {
  data: LiveData | null;
  now: number;
  unit: number;
  gap: number;
  rows: MiniTileKey[][];
}) {
  return (
    <View style={{ gap }}>
      {rows.map((row, r) => (
        <View key={r} style={{ flexDirection: "row", gap }}>
          {row.map((tile) => (
            <View key={tile} style={{ width: unit, height: unit }}>
              <MiniTile tile={tile} data={data} now={now} unit={unit} />
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function TileFrame({ tint, unit, children }: { tint: string; unit: number; children: React.ReactNode }) {
  return (
    <View
      style={{
        flex: 1,
        borderRadius: Math.round(unit * 0.18),
        padding: Math.round(unit * 0.13),
        justifyContent: "space-between",
        backgroundColor: `${tint}29`,
        borderWidth: 1,
        borderColor: `${tint}57`,
      }}
    >
      {children}
    </View>
  );
}

function GlyphBox({ icon, tint, unit }: { icon: keyof typeof Ionicons.glyphMap; tint: string; unit: number }) {
  const box = Math.round(unit * 0.25);
  return (
    <View
      style={{
        width: box,
        height: box,
        borderRadius: Math.round(box * 0.33),
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: `${tint}33`,
      }}
    >
      <Ionicons name={icon} size={Math.round(box * 0.52)} color={tint} />
    </View>
  );
}

function ActionTile({
  icon,
  tint,
  label,
  addsEntry,
  unit,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  label: string;
  addsEntry: boolean;
  unit: number;
}) {
  return (
    <TileFrame tint={tint} unit={unit}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
        <GlyphBox icon={icon} tint={tint} unit={unit} />
        {addsEntry ? <Ionicons name="add" size={Math.round(unit * 0.13)} color={tint} /> : null}
      </View>
      <Text
        style={{ fontSize: Math.round(unit * 0.1), lineHeight: Math.round(unit * 0.125), fontWeight: "600", color: THEME.ink }}
        numberOfLines={2}
      >
        {label}
      </Text>
    </TileFrame>
  );
}

function ReadingTile({ data, now, unit }: { data: LiveData | null; now: number; unit: number }) {
  const mgdl = data?.lastGlucoseMgdl ?? null;
  const hasReading = mgdl != null || data?.lastGlucoseDisplay != null;
  const meta = hasReading ? (elapsedLabel(data, now) ?? "") : (data?.labels?.noData ?? "");
  const label = Math.round(unit * 0.1);
  const value = Math.round(unit * 0.22);
  return (
    <TileFrame tint={widgetAccent()} unit={unit}>
      <Text
        style={{ fontSize: label, lineHeight: Math.round(label * 1.25), fontWeight: "700", color: THEME.muted }}
        numberOfLines={2}
      >
        {data?.labels?.lastReading ?? ""}
      </Text>
      <View>
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 3 }}>
          <Text
            style={{
              fontSize: value,
              lineHeight: Math.round(value * 1.15),
              fontWeight: "700",
              color: readingColor(mgdl, data?.band),
            }}
            numberOfLines={1}
          >
            {data?.lastGlucoseDisplay ?? "-"}
          </Text>
          <Text style={{ fontSize: label, color: THEME.muted, marginBottom: 1 }}>{unitLabel(data?.unit)}</Text>
        </View>
        <Text style={{ fontSize: label, color: THEME.muted }} numberOfLines={1}>
          {meta}
        </Text>
      </View>
    </TileFrame>
  );
}

function TimerTile({
  countdown,
  title,
  idleLabel,
  unit,
}: {
  countdown: string | null;
  title: string | null | undefined;
  idleLabel: string | null | undefined;
  unit: number;
}) {
  const tint = TILE_INK.countdown;
  return (
    <TileFrame tint={tint} unit={unit}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
        <GlyphBox icon="hourglass-outline" tint={tint} unit={unit} />
        {!countdown ? <Ionicons name="add" size={Math.round(unit * 0.13)} color={tint} /> : null}
      </View>
      <View>
        {countdown ? (
          <Text
            style={{ fontSize: Math.round(unit * 0.15), lineHeight: Math.round(unit * 0.18), fontWeight: "700", color: tint }}
            numberOfLines={1}
          >
            {countdown}
          </Text>
        ) : null}
        <Text
          style={{ fontSize: Math.round(unit * 0.1), lineHeight: Math.round(unit * 0.125), fontWeight: "600", color: THEME.ink }}
          numberOfLines={2}
        >
          {countdown ? (title ?? "") : (idleLabel ?? "zerospike")}
        </Text>
      </View>
    </TileFrame>
  );
}
