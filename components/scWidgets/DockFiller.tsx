import React from "react";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { inkA } from "./common";
import type { FillerSpec } from "./layout";

/**
 * The bleed filler: the rest of a plausible home screen below zerospike's own
 * widgets - unbranded glass app squares, a search pill, and a dock bar that
 * runs past the composite's cut line.
 *
 * Deliberately NEUTRAL. The previous round filled this band with saturated
 * blue/red/yellow/green blocks, which read as a toy mock rather than a
 * launcher and drew the eye straight off the product. Everything here is the
 * same translucent white over the app's own wash, with a thin outline glyph
 * inside: no identity colour, no wordmark, no text, so there is nothing to
 * localize and nothing that could pass for a real (or competitor) app.
 *
 * It also carries the composite's bleed probe. selftest-v2's check 6c samples
 * the canvas centre on one fixed row and needs it 20 luminance above the page
 * margin; a translucent fill over the wash clears that by a wide margin, and
 * an ODD icon count means `space-between` puts a square dead centre rather
 * than a gutter. See layout.ts for the per-profile rows.
 *
 * Plain "row" throughout: RN's own forceRTL already mirrors a physical row, so
 * this never needs `isRTL ? "row-reverse" : "row"` on top of it.
 */

const GLASS = () => inkA(0.12);
const GLASS_EDGE = () => inkA(0.16);
const GLASS_DOCK = () => inkA(0.09);
const GLYPH = () => inkA(0.62);

/** Generic system-app glyphs, in the order a home screen would carry them. */
const ROW_GLYPHS: (keyof typeof Ionicons.glyphMap)[][] = [
  ["camera-outline", "chatbubble-outline", "calendar-outline", "mail-outline", "map-outline"],
  ["musical-notes-outline", "image-outline", "cloud-outline", "browsers-outline", "reader-outline"],
  ["call-outline", "videocam-outline", "compass-outline", "bookmark-outline", "cart-outline"],
  ["headset-outline", "wallet-outline", "sunny-outline", "timer-outline", "people-outline"],
];

const DOCK_GLYPHS: (keyof typeof Ionicons.glyphMap)[] = [
  "camera-outline",
  "chatbubble-outline",
  "calendar-outline",
  "settings-outline",
];

function GlassSquare({ size, radius, glyph, icon }: { size: number; radius: number; glyph: number; icon: keyof typeof Ionicons.glyphMap }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: GLASS(),
        borderWidth: 1,
        borderColor: GLASS_EDGE(),
      }}
    >
      <Ionicons name={icon} size={glyph} color={GLYPH()} />
    </View>
  );
}

export function DockFiller({ spec, width }: { spec: FillerSpec; width: number }) {
  const contentW = width - spec.padX * 2;
  const rows = ROW_GLYPHS.slice(0, spec.iconRows);
  return (
    <View style={{ width, paddingHorizontal: spec.padX }}>
      {rows.map((glyphs, r) => (
        <View
          key={r}
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            marginBottom: r === rows.length - 1 ? 0 : spec.iconRowGap,
          }}
        >
          {glyphs.slice(0, spec.iconCols).map((icon) => (
            <GlassSquare key={icon} size={spec.iconSize} radius={spec.iconRadius} glyph={spec.iconGlyph} icon={icon} />
          ))}
        </View>
      ))}

      <View
        style={{
          marginTop: rows.length ? spec.gapBeforePill : 0,
          width: contentW,
          height: spec.pillH,
          borderRadius: spec.pillH / 2,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: GLASS(),
          borderWidth: 1,
          borderColor: GLASS_EDGE(),
        }}
      >
        <Ionicons name="search-outline" size={Math.round(spec.pillH * 0.44)} color={GLYPH()} />
      </View>

      <View
        style={{
          marginTop: spec.gapAfterPill,
          width: contentW,
          height: spec.dockH,
          borderRadius: spec.dockRadius,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-evenly",
          backgroundColor: GLASS_DOCK(),
          borderWidth: 1,
          borderColor: GLASS_EDGE(),
        }}
      >
        {DOCK_GLYPHS.map((icon) => (
          <GlassSquare key={icon} size={spec.dockIcon} radius={Math.round(spec.dockIcon * 0.26)} glyph={spec.iconGlyph} icon={icon} />
        ))}
      </View>
    </View>
  );
}
