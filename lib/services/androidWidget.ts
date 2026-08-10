import React from "react";
import {
  FlexWidget,
  TextWidget,
  type ColorProp,
  type WidgetTaskHandlerProps,
} from "react-native-android-widget";

import { readLiveData, ANDROID_QUICK_ADD_WIDGET_NAME, type LiveData } from "./liveData";
import { MGDL_PER_MMOL } from "../glucose";
import { GLUCOSE_RICH, THEME } from "../theme/tokens";
import { VERY_HIGH_MGDL } from "../glucose";

/**
 * The Android home-screen widgets: the glance widget (last reading + time left
 * on the next reminder) and the Quick Add widget (deep-link shortcuts into the
 * app's own logging flows).
 *
 * react-native-android-widget renders the widgets from the RN JS context, so
 * they read the SAME LiveData snapshot the app writes (lib/services/
 * liveData.ts) straight out of AsyncStorage. There is no second data path and no
 * second format, which is the whole point of the snapshot.
 *
 * Every string comes pre-localized inside the snapshot, so the widgets never
 * need their own copy of the five translations.
 */

/** Deep links the widgets open (scheme registered in app.json; expo-router
 *  resolves the paths). Kept identical to the iOS widgetURL/Link targets. */
const URI_DASHBOARD = "zerospike:///";
const URI_ADD_GLUCOSE = "zerospike:///?sheet=glucose";
const URI_ADD_MEAL = "zerospike:///food";
const URI_ADD_INJECTION = "zerospike:///injection?compose=1";

/**
 * Pre-mixed tile colours.
 *
 * The iOS twin paints each Quick Add tile as `tint.opacity(0.16)` with a
 * `tint.opacity(0.34)` hairline. Android cannot: the widget's native colour
 * parser is `Color.parseColor`, which only understands `#rrggbb` / `#aarrggbb`,
 * so a translucent rgba string is a render-time throw, not a soft failure.
 *
 * These are therefore the SAME colours, flattened by hand over the widget
 * ground (#080e14): `round(bg + (tint - bg) * alpha)` per channel. Change the
 * tint or the ground and these must be recomputed, which is why the source
 * values and the alphas are written down beside each one.
 */
const TILE = {
  /** #2ee6ff @ 0.16 / 0.34, plus the raised primary at 0.22 / 0.44. */
  glucose: { fill: "#0e313a", border: "#155764" },
  glucosePrimary: { fill: "#103e48", border: "#196d7b" },
  /** #22e39a @ 0.16 / 0.34. */
  meal: { fill: "#0c3029", border: "#115642" },
  /** #7c5cff @ 0.16 / 0.34. */
  injection: { fill: "#1b1a3a", border: "#2f2964" },
  /** #2ee6ff @ 0.14 / 0.28 - the countdown pill on the glance widget. */
  countdown: { fill: "#0d2c35", border: "#134a56" },
} as const;

/** The identity hue of each Quick Add flow, at full strength (glyph colour). */
const TILE_INK = {
  glucose: THEME.accent,
  meal: GLUCOSE_RICH.target,
  injection: THEME.violet,
} as const;

/** The current dp footprint of a placed widget (subset of the library's
 *  WidgetInfo), delivered on WIDGET_RESIZED and on every render request. */
export interface WidgetSize {
  width: number;
  height: number;
}

/** Tiers the previously fixed glance-widget dimensions by the actual footprint:
 *  compact when the user shrinks the widget below its default 3x2 cells, roomy
 *  when they stretch it. Defaults match the pre-resize fixed look. */
function sizesFor(size?: WidgetSize) {
  const width = size?.width ?? 180;
  const height = size?.height ?? 110;
  const compact = width < 150 || height < 90;
  const roomy = width >= 250 && height >= 140;
  return {
    padding: compact ? 10 : 14,
    radius: compact ? 16 : 20,
    label: compact ? 9 : 10,
    value: compact ? 24 : roomy ? 40 : 32,
    unit: compact ? 10 : 11,
    meta: compact ? 10 : 11,
    remaining: compact ? 13 : roomy ? 17 : 15,
    // At the smallest footprint the value + the countdown already fill the tile,
    // so the averaging-window line is the one that gives way (the iOS small
    // family keeps all three because it is taller than a shrunk Android cell).
    showMeta: !compact,
  };
}

/** Colours a reading against the PROFILE's own band from the snapshot, matching
 *  the app and the iOS widget. Falls back to population defaults for a snapshot
 *  written before R7. A glance, not a classification; the value is always shown. */
function readingColor(
  mgdl: number | null,
  band: LiveData["band"] | undefined
): ColorProp {
  // The token palette is hex throughout, which is exactly what the widget wants.
  if (mgdl == null) return THEME.muted as ColorProp;
  const hypo = band?.hypo ?? 70;
  const high = band?.high ?? 180;
  const veryHigh = band?.veryHigh ?? VERY_HIGH_MGDL;
  if (mgdl < hypo) return GLUCOSE_RICH.low as ColorProp;
  if (mgdl >= veryHigh) return GLUCOSE_RICH.veryHigh as ColorProp;
  if (mgdl <= high) return GLUCOSE_RICH.target as ColorProp;
  // The step above the band mirrors classifyGlucose (lib/glucose.ts) and the iOS
  // widget: up to 1.25x the band's top is the yellow "above" step, past that the
  // amber "well above" one, so all five colours read the same on every surface.
  if (mgdl <= high * 1.25) return GLUCOSE_RICH.high as ColorProp;
  return GLUCOSE_RICH.wellAbove as ColorProp;
}

function formatReading(data: LiveData | null): string {
  // The widget pins the rolling AVERAGE (a persistent number), not a single stale
  // reading. Prefer the app's locale-formatted string (so tr/de show "6,4"); fall
  // back to the last reading only for a pre-R10 snapshot that has no average yet.
  if (data?.avgGlucoseDisplay) return data.avgGlucoseDisplay;
  const mgdl = data?.avgGlucoseMgdl ?? data?.lastGlucoseMgdl;
  if (mgdl == null) return "-";
  return data?.unit === "mmol"
    ? (mgdl / MGDL_PER_MMOL).toFixed(1)
    : String(Math.round(mgdl));
}

function unitLabel(data: LiveData | null): string {
  return data?.unit === "mmol" ? "mmol/L" : "mg/dL";
}

/** "1:23" / "12:04" style remaining time; empty when nothing is pending. */
function remainingLabel(data: LiveData | null, now = Date.now()): string {
  const at = data?.nextReminderAt;
  if (at == null || at <= now) return "";
  const totalMinutes = Math.floor((at - now) / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return hours > 0 ? `${hours}:${pad(minutes)}` : `${minutes}`;
}

/** Builds the glance widget tree from a snapshot. Pure, so it is easy to reason
 *  about; `size` (when known) tiers the layout to the placed footprint. */
export function buildZerospikeWidget(
  data: LiveData | null,
  size?: WidgetSize
): React.JSX.Element {
  const remaining = remainingLabel(data);
  const s = sizesFor(size);
  const metaText =
    data?.avgGlucoseMgdl == null
      ? (data?.labels?.noData ?? "")
      : (data?.labels?.avgWindow ?? "");
  return React.createElement(
    FlexWidget,
    {
      style: {
        height: "match_parent",
        width: "match_parent",
        flexDirection: "column",
        justifyContent: "space-between",
        // The app's own vertical wash (bg.g2 at the top down to bg.g1), so the
        // widget sits on the same ground as every screen. Hex only: the native
        // parser is Color.parseColor. No border on this element - a gradient
        // background replaces the border drawable in the library.
        backgroundGradient: {
          from: THEME.bg.g2 as ColorProp,
          to: THEME.bg.g1 as ColorProp,
          orientation: "TOP_BOTTOM",
        },
        borderRadius: s.radius,
        padding: s.padding,
      },
      clickAction: "OPEN_URI",
      clickActionData: { uri: URI_DASHBOARD },
    },
    React.createElement(
      FlexWidget,
      { style: { flexDirection: "column" } },
      React.createElement(TextWidget, {
        text: data?.labels?.avgGlucose ?? data?.labels?.lastReading ?? "",
        truncate: "END",
        maxLines: 1,
        style: { fontSize: s.label, fontWeight: "bold", color: THEME.muted as ColorProp },
      }),
      React.createElement(
        FlexWidget,
        { style: { flexDirection: "row", alignItems: "flex-end", marginTop: 1 } },
        React.createElement(TextWidget, {
          text: formatReading(data),
          maxLines: 1,
          style: {
            fontSize: s.value,
            fontWeight: "bold",
            color: readingColor(data?.avgGlucoseMgdl ?? data?.lastGlucoseMgdl ?? null, data?.band),
          },
        }),
        React.createElement(TextWidget, {
          text: ` ${unitLabel(data)}`,
          maxLines: 1,
          style: { fontSize: s.unit, color: THEME.muted as ColorProp, marginBottom: 5 },
        })
      ),
      // The context line now stays put under the value instead of being swapped
      // out by the countdown, so the two never trade places as a reminder comes
      // and goes. Only the tightest footprint drops it (see sizesFor).
      s.showMeta && metaText
        ? React.createElement(TextWidget, {
            text: metaText,
            truncate: "END",
            maxLines: 1,
            style: { fontSize: s.meta, color: THEME.muted as ColorProp },
          })
        : null
    ),
    remaining
      ? React.createElement(
          FlexWidget,
          { style: { flexDirection: "column", marginTop: 6 } },
          React.createElement(TextWidget, {
            text: data?.labels?.nextReminder ?? "",
            truncate: "END",
            maxLines: 1,
            style: { fontSize: s.label, fontWeight: "bold", color: THEME.muted as ColorProp },
          }),
          // The countdown as its own pill, matching the iOS small family: the
          // fill and the hairline are the accent pre-mixed over the ground (see
          // TILE), because rgba is not parseable here.
          React.createElement(
            FlexWidget,
            {
              style: {
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: TILE.countdown.fill as ColorProp,
                borderColor: TILE.countdown.border as ColorProp,
                borderWidth: 1,
                // ~half the pill's own height at every tier, so it reads as a
                // capsule without relying on an out-of-bounds radius.
                borderRadius: 14,
                paddingHorizontal: 8,
                paddingVertical: 3,
                marginTop: 2,
              },
            },
            React.createElement(TextWidget, {
              text: remaining,
              maxLines: 1,
              style: {
                fontSize: s.remaining,
                fontWeight: "bold",
                color: THEME.accent as ColorProp,
              },
            })
          )
        )
      : !s.showMeta && metaText
        ? React.createElement(TextWidget, {
            text: metaText,
            truncate: "END",
            maxLines: 1,
            style: { fontSize: s.meta, color: THEME.muted as ColorProp },
          })
        : null
  );
}

/** The Quick Add shortcuts, labels straight from the localized snapshot. The
 *  English fallbacks only ever show before the app has written a snapshot,
 *  mirroring the iOS QuickAdd.swift policy. */
function quickAddShortcuts(data: LiveData | null) {
  return [
    {
      key: "glucose",
      label: data?.labels?.addGlucose ?? "Glucose",
      uri: URI_ADD_GLUCOSE,
      // Weighted wider than the other two: glucose is the flow this widget
      // exists for, so it is the primary tile here exactly as it is on iOS.
      weight: 4,
      ink: TILE_INK.glucose as ColorProp,
      tile: TILE.glucosePrimary,
    },
    {
      key: "meal",
      label: data?.labels?.addMeal ?? "Meal",
      uri: URI_ADD_MEAL,
      weight: 3,
      ink: TILE_INK.meal as ColorProp,
      tile: TILE.meal,
    },
    {
      key: "injection",
      label: data?.labels?.addInjection ?? "Injection",
      uri: URI_ADD_INJECTION,
      weight: 3,
      ink: TILE_INK.injection as ColorProp,
      tile: TILE.injection,
    },
  ];
}

/** Builds the Quick Add widget: a titled row of three deep-link tiles into the
 *  logging flows. Purely navigational; nothing here interprets anything. */
export function buildQuickAddWidget(
  data: LiveData | null,
  size?: WidgetSize
): React.JSX.Element {
  const compact = (size?.height ?? 70) < 60;
  return React.createElement(
    FlexWidget,
    {
      style: {
        height: "match_parent",
        width: "match_parent",
        flexDirection: "column",
        backgroundGradient: {
          from: THEME.bg.g2 as ColorProp,
          to: THEME.bg.g1 as ColorProp,
          orientation: "TOP_BOTTOM",
        },
        borderRadius: 20,
        padding: compact ? 8 : 10,
      },
    },
    compact
      ? null
      : React.createElement(TextWidget, {
          text: data?.labels?.quickAdd ?? "Quick add",
          truncate: "END",
          maxLines: 1,
          style: {
            fontSize: 9,
            fontWeight: "bold",
            color: THEME.muted as ColorProp,
            marginBottom: 5,
            marginLeft: 2,
          },
        }),
    React.createElement(
      FlexWidget,
      { style: { flexDirection: "row", flex: 1, width: "match_parent" } },
      ...quickAddShortcuts(data).map((shortcut, i) =>
        React.createElement(
          FlexWidget,
          {
            key: shortcut.key,
            style: {
              flex: shortcut.weight,
              height: "match_parent",
              flexDirection: "column",
              justifyContent: "center",
              alignItems: "center",
              // Each flow carries its OWN identity colour instead of the one flat
              // grey they used to share. Pre-mixed opaque hex, never rgba: the
              // widget's native colour parser only reads #rrggbb (see TILE).
              backgroundColor: shortcut.tile.fill as ColorProp,
              borderColor: shortcut.tile.border as ColorProp,
              borderWidth: 1,
              borderRadius: 14,
              paddingHorizontal: 4,
              marginLeft: i === 0 ? 0 : 6,
            },
            clickAction: "OPEN_URI",
            clickActionData: { uri: shortcut.uri },
          },
          React.createElement(TextWidget, {
            text: "+",
            maxLines: 1,
            style: {
              fontSize: i === 0 ? (compact ? 16 : 18) : compact ? 13 : 15,
              fontWeight: "bold",
              color: shortcut.ink,
            },
          }),
          // The iOS twin shrinks this label (minimumScaleFactor 0.6); a
          // TextWidget cannot, so at one line "Glukose eintragen" / "Injection
          // enregistrer" simply lost their tails in a ~70dp tile. Two lines at a
          // slightly smaller size is the closest Android equivalent, centred so
          // a wrapped label still reads as one label.
          React.createElement(TextWidget, {
            text: shortcut.label,
            truncate: "END",
            maxLines: compact ? 1 : 2,
            style: {
              fontSize: compact ? 9 : 10,
              fontWeight: "bold",
              color: THEME.ink as ColorProp,
              marginTop: 1,
              textAlign: "center",
            },
          })
        )
      )
    )
  );
}

/**
 * The task handler Android calls to draw or refresh a widget (placement, the
 * 15-minute period configured in app.json, resizes, and every explicit update
 * the app requests after a log). Registered once from the app entry; branches
 * on the widget name so both widgets share the one snapshot read.
 */
export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  const data = await readLiveData();
  const build =
    props.widgetInfo.widgetName === ANDROID_QUICK_ADD_WIDGET_NAME
      ? buildQuickAddWidget
      : buildZerospikeWidget;
  switch (props.widgetAction) {
    case "WIDGET_ADDED":
    case "WIDGET_UPDATE":
    case "WIDGET_RESIZED":
    case "WIDGET_CLICK":
      props.renderWidget(build(data, props.widgetInfo));
      break;
    case "WIDGET_DELETED":
      break;
    default:
      break;
  }
}
