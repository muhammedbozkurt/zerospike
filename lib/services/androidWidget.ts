import React from "react";
import {
  FlexWidget,
  TextWidget,
  type ColorProp,
  type WidgetTaskHandlerProps,
} from "react-native-android-widget";

import { readLiveData, type LiveData } from "./liveData";
import { MGDL_PER_MMOL } from "../glucose";
import { GLUCOSE_RICH, THEME } from "../theme/tokens";
import { VERY_HIGH_MGDL } from "../glucose";

/**
 * The Android home-screen widget: last reading + time left on the next reminder.
 *
 * react-native-android-widget renders the widget from the RN JS context, so the
 * widget reads the SAME LiveData snapshot the app writes (lib/services/
 * liveData.ts) straight out of AsyncStorage. There is no second data path and no
 * second format, which is the whole point of the snapshot.
 *
 * Every string comes pre-localized inside the snapshot, so the widget never
 * needs its own copy of the five translations.
 */

/** Population-default colouring: the widget has no profile range to read. It is
 *  a glance, not a classification, and the value is always printed beside it. */
function readingColor(mgdl: number | null): ColorProp {
  // The token palette is hex throughout, which is exactly what the widget wants.
  if (mgdl == null) return THEME.muted as ColorProp;
  if (mgdl < 70) return GLUCOSE_RICH.low as ColorProp;
  if (mgdl >= VERY_HIGH_MGDL) return GLUCOSE_RICH.veryHigh as ColorProp;
  if (mgdl <= 180) return GLUCOSE_RICH.target as ColorProp;
  return GLUCOSE_RICH.high as ColorProp;
}

function formatReading(data: LiveData | null): string {
  const mgdl = data?.lastGlucoseMgdl;
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

/** Builds the widget tree from a snapshot. Pure, so it is easy to reason about. */
export function buildZerospikeWidget(data: LiveData | null): React.JSX.Element {
  const remaining = remainingLabel(data);
  return React.createElement(
    FlexWidget,
    {
      style: {
        height: "match_parent",
        width: "match_parent",
        flexDirection: "column",
        justifyContent: "space-between",
        backgroundColor: THEME.bg.g1 as ColorProp,
        borderRadius: 20,
        padding: 14,
      },
      clickAction: "OPEN_APP",
    },
    React.createElement(
      FlexWidget,
      { style: { flexDirection: "column" } },
      React.createElement(TextWidget, {
        text: data?.labels?.lastReading ?? "",
        style: { fontSize: 10, fontWeight: "bold", color: THEME.muted as ColorProp },
      }),
      React.createElement(
        FlexWidget,
        { style: { flexDirection: "row", alignItems: "flex-end" } },
        React.createElement(TextWidget, {
          text: formatReading(data),
          style: {
            fontSize: 32,
            fontWeight: "bold",
            color: readingColor(data?.lastGlucoseMgdl ?? null),
          },
        }),
        React.createElement(TextWidget, {
          text: ` ${unitLabel(data)}`,
          style: { fontSize: 11, color: THEME.muted as ColorProp, marginBottom: 5 },
        })
      )
    ),
    remaining
      ? React.createElement(
          FlexWidget,
          { style: { flexDirection: "column" } },
          React.createElement(TextWidget, {
            text: data?.labels?.nextReminder ?? "",
            style: { fontSize: 9, fontWeight: "bold", color: THEME.muted as ColorProp },
          }),
          React.createElement(TextWidget, {
            text: remaining,
            style: { fontSize: 15, fontWeight: "bold", color: THEME.accent as ColorProp },
          })
        )
      : React.createElement(TextWidget, {
          text: data?.lastGlucoseMgdl == null ? (data?.labels?.noData ?? "") : "",
          style: { fontSize: 11, color: THEME.muted as ColorProp },
        })
  );
}

/**
 * The task handler Android calls to draw or refresh the widget (placement, the
 * 15-minute period configured in app.json, and every explicit update the app
 * requests after a log). Registered once from the app entry.
 */
export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  const data = await readLiveData();
  switch (props.widgetAction) {
    case "WIDGET_ADDED":
    case "WIDGET_UPDATE":
    case "WIDGET_RESIZED":
    case "WIDGET_CLICK":
      props.renderWidget(buildZerospikeWidget(data));
      break;
    case "WIDGET_DELETED":
      break;
    default:
      break;
  }
}
