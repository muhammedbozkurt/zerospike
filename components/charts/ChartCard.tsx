import React, { useState } from "react";
import { LayoutChangeEvent, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { CHART } from "./theme";

interface LegendEntry {
  label: string;
  color: string;
  /** A translucent swatch reads as a band rather than a line. */
  faded?: boolean;
}

/**
 * The frame every Insights chart sits in: title, optional legend, the plot, and
 * a caption.
 *
 * The caption is not decoration. It states, in words, what the chart shows, so
 * a screen-reader user gets the same information: the plot itself is hidden
 * from accessibility (an SVG announces nothing useful) and the caption carries
 * it. Keep captions descriptive and never interpretive.
 *
 * `children` is called with the measured plot width, because an SVG needs a
 * concrete width and the card is fluid.
 */
export function ChartCard({
  title,
  subtitle,
  accessory,
  legend,
  caption,
  emptyNote,
  height,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Sits opposite the title, e.g. a delta chip. */
  accessory?: React.ReactNode;
  legend?: LegendEntry[];
  /** Spoken (and shown) summary of the plot. Omitted when emptyNote is set. */
  caption?: string;
  /** Shown instead of the plot when there is not enough data yet. */
  emptyNote?: string;
  height: number;
  children: (width: number) => React.ReactNode;
}) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  return (
    <View className="rounded-2xl bg-zinc-900 border border-zinc-800 p-4 mt-3">
      <View className="flex-row items-start">
        <Text className="text-zinc-300 font-semibold flex-1 pr-2">{title}</Text>
        {accessory}
      </View>
      {subtitle ? (
        <Text className="text-zinc-500 text-xs mt-1 leading-4">{subtitle}</Text>
      ) : null}

      {emptyNote ? (
        <View
          className="flex-row items-center justify-center py-8 px-2"
          style={{ minHeight: height / 2 }}
        >
          <Ionicons name="hourglass-outline" size={16} color={CHART.axis} />
          <Text className="text-zinc-500 text-xs ml-2 flex-1 leading-4">
            {emptyNote}
          </Text>
        </View>
      ) : (
        <>
          {legend && legend.length > 0 ? (
            <View className="flex-row flex-wrap mt-3 -mb-1">
              {legend.map((entry) => (
                <View key={entry.label} className="flex-row items-center mr-4 mb-1">
                  <View
                    className={`w-2.5 h-2.5 mr-1.5 ${
                      entry.faded ? "rounded-sm" : "rounded-full"
                    }`}
                    style={{
                      backgroundColor: entry.color,
                      opacity: entry.faded ? 0.35 : 1,
                    }}
                  />
                  <Text className="text-zinc-400 text-[11px]">{entry.label}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {/* The plot says nothing useful to a screen reader; the caption does. */}
          <View
            onLayout={onLayout}
            className="mt-3"
            style={{ height }}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            {width > 0 ? children(width) : null}
          </View>

          {caption ? (
            <Text className="text-zinc-500 text-[11px] leading-4 mt-2.5">
              {caption}
            </Text>
          ) : null}
        </>
      )}
    </View>
  );
}
